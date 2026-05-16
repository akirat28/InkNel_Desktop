# InkNel ネットワークストレージ 調査資料

InkNel は最終的にメモを **ローカル / クラウド / ネットワークボリューム** に保存できる構成を目指している。本資料では、ネットワーク保存先として候補に挙げた以下 3 サービスを比較検討する。

| # | サービス | 提供元 |
|---|---|---|
| 1 | **Google Drive** | Google |
| 2 | **Dropbox** | Dropbox |
| 3 | **iCloud Drive** | Apple |

InkNel の典型的な保存対象は **小サイズの `.md` テキストファイル群** + **SQLite メタDB** であり、特殊な要件は次のとおり:

- **クロスプラットフォーム**: macOS / Windows / Linux 上の Electron で動く
- **モバイル参照**: iOS / Android アプリ（別途開発予定）からも同じデータにアクセスしたい
- **リアルタイム同期**: 端末間で即座に反映されるのが望ましい
- **小〜中容量**: 数千〜数万件のテキストメモ。数 GB 程度を想定

---

## 1. Google Drive

### 概要
Google が提供する汎用クラウドストレージ。Google アカウントを持つすべてのユーザーが利用可能で、世界的に最も普及している部類のクラウドストレージ。

### 接続方法（Electron からの統合）

| 項目 | 内容 |
|---|---|
| 公式 SDK | **`googleapis`** (Node.js)、ブラウザ向けには `gapi`/`gis` |
| 認証 | OAuth 2.0（**Desktop app** タイプの Client ID） |
| 推奨スコープ | `drive.file`（自アプリが作成・開いたファイルのみ）/ `drive`（フルアクセス） |
| 必要なもの | Google Cloud プロジェクト、OAuth クライアント ID、（公開時）OAuth 同意画面審査 |

実装フロー:
1. Google Cloud Console で Drive API を有効化、Desktop OAuth Client ID を発行
2. Electron 内でブラウザを開いて OAuth 認証コードを取得（loopback redirect）
3. リフレッシュトークンを Electron の `safeStorage` などで暗号化保存
4. `googleapis` 経由で `files.list` / `files.create` / `files.get` を呼ぶ

### 料金（個人プラン）

| プラン | 容量 | 月額 (USD) |
|---|---|---|
| 無料（Google One 加入なし） | **15 GB**（Gmail/Photos と共有） | $0 |
| Google One Basic | 100 GB | $1.99 |
| Google One Standard | 200 GB | $2.99 |
| Google One Premium | 2 TB | $9.99 |

API 呼び出し自体は無料。レート制限のみ存在:
- 既定 **12,000 requests / 60秒** （プロジェクト全体）
- 1分あたりの上限を守れば1日の総数制限はない

### メリット
- **無料枠が15GBと比較的大きい**（メモ用途には十分）
- **`googleapis` SDK が成熟**しており Node.js / TypeScript で扱いやすい
- 完全クロスプラットフォーム（OS 非依存）
- スマートフォンでも公式アプリ + Drive REST API でアクセス可能
- ファイル変更通知（push notifications via webhook）が利用可能 → リアルタイム同期向き
- バージョン履歴が自動で保持される
- 全文検索（Drive 自体が検索インデックスを持つ）

### デメリット
- **OAuth 同意画面の Google 審査** が必要（センシティブスコープを使う場合）。配布前に数日〜数週間
- 無料枠が **Gmail / Google Photos と共有** → メールが多いユーザーはすぐ枯渇
- API は強い分、設計がやや重い（v3 でも MIME タイプや folder の扱いに癖あり）
- **ファイルパスの概念がない**（フォルダは「親 ID」で表現される）→ 階層管理は ID ベース
- 大量の小ファイルは API コール数が膨らみコスト/速度に影響

### InkNel での実装方針
- ノート本文 (`*.md`) と SQLite DB を Drive のアプリ専用フォルダに配置
- アプリ用フォルダは `appDataFolder` スコープを使うとユーザーの目に触れず安全
- スマホアプリも同じ Google アカウントで OAuth → 同フォルダを参照

---

## 2. Dropbox

### 概要
クラウドストレージのパイオニアで、**ファイル同期に特化** したサービス。SDK・API のシンプルさで定評がある。

### 接続方法（Electron からの統合）

| 項目 | 内容 |
|---|---|
| 公式 SDK | **`dropbox`** (npm: `dropbox-sdk-js`)、Node/ブラウザ両対応 |
| 認証 | OAuth 2.0 + **PKCE**（Desktop app 推奨フロー） |
| トークン | Short-lived access token + refresh token |
| 必要なもの | Dropbox App Console で App を作成、permission scope の指定 |

実装フロー:
1. Dropbox App Console で App 作成（App folder / Full Dropbox を選択）
2. Permission スコープを設定（`files.content.write`, `files.content.read` など）
3. Electron で PKCE フローを実装（loopback HTTP server）
4. リフレッシュトークンで access token を更新しながら API を呼ぶ

### 料金（個人プラン）

| プラン | 容量 | 月額 (USD) |
|---|---|---|
| Basic（無料） | **2 GB** | $0 |
| Plus | 2 TB | $11.99（年契約 $9.99/月） |
| Professional | 3 TB | $19.99 |

無料枠は 2GB と少なめだが、テキストメモなら十分。バージョン履歴は Basic で 30 日。

### メリット
- **API が圧倒的にシンプル**: パスベース（`/notes/foo.md`）でファイル操作可能、Drive のような ID 管理不要
- SDK の出来が良く、TypeScript 型定義も完備
- **「アプリフォルダ」モード** を使うとユーザーの Dropbox の `Apps/InkNel/` 配下しか触れず、安全かつ権限要求も最小
- ファイル同期の信頼性が高く、デルタ同期やコンフリクト解決が成熟
- **`/files/list_folder/longpoll` API** で変更を待ち受けできる → リアルタイム同期実装が容易
- クロスプラットフォーム（Win/Mac/Linux/iOS/Android すべての公式アプリあり）
- OAuth 審査が Google よりずっと緩い（Production 移行も比較的簡単）

### デメリット
- **無料枠が 2GB のみ**（Google Drive の 1/7.5）
- 有料プランの容量と価格設定が「全部入り 2TB / 3TB」に偏っており、中間がない
- ユーザー普及率は Google Drive / iCloud に比べると下がる
- 日本では Google/Apple/Microsoft に比べやや知名度が低い

### InkNel での実装方針
- App folder スコープで作成 → `Apps/InkNel/notes/*.md` と `Apps/InkNel/inknel.db` を配置
- `longpoll` API を購読し、別端末からの変更を即座にローカルへ取り込む
- 3 サービスの中で **最も実装コストが低く、API が直感的**

---

## 3. iCloud Drive (Apple)

### 概要
Apple が提供するクラウドストレージ。iOS / macOS デバイスとシームレスに統合されており、Apple ユーザーには馴染みが深い。**第三者アプリからのアクセスは制限が多い** のが特徴。

### Electron からの統合の選択肢

iCloud には **公式の REST API が（事実上）存在しない**。サードパーティの選択肢は2つ:

#### 選択肢A: ローカルファイルシステム経由（推奨）

iCloud Drive は同期済みのファイルを **ローカルファイルシステム** にも展開する。これを通常のファイルとして読み書きすれば、OS の iCloud クライアントが自動同期してくれる。

| OS | パス |
|---|---|
| **macOS** | `~/Library/Mobile Documents/com~apple~CloudDocs/` |
| **Windows** | `C:\Users\<name>\iCloud Drive\`（要 [iCloud for Windows](https://support.apple.com/icloud-windows)） |
| **Linux** | **未対応**（公式クライアントなし） |

実装は単純: `fs.readFile` / `fs.writeFile` するだけ。OS が裏で iCloud に同期する。

#### 選択肢B: CloudKit Web Services

[CloudKit Web Services](https://developer.apple.com/icloud/cloudkit/) は Apple が公開している iCloud 用の Web API。ブラウザ/Node.js から呼べる。
- **要 Apple Developer Program**（年 $99）
- **要 macOS 上での Container 設定**（Xcode / Apple Developer Console）
- ユーザー認証は **Apple ID + 2FA**
- 利用は基本的に **「Apple 製アプリと連携する web アプリ」用** であり、Electron 単体での実装例は少ない

### 料金（iCloud+）

| プラン | 容量 | 月額（日本） |
|---|---|---|
| 無料 | **5 GB** | ¥0 |
| iCloud+ 50GB | 50 GB | ¥150 |
| iCloud+ 200GB | 200 GB | ¥450 |
| iCloud+ 2TB | 2 TB | ¥1,500 |
| iCloud+ 6TB | 6 TB | ¥4,500 |

### メリット
- **macOS / iOS ユーザーにとって追加設定不要**（標準で iCloud Drive が動いている）
- 認証がOSに統合されているため、アプリは認証フローを実装しなくてよい（ローカルファイル経由の場合）
- iPhone / iPad / Mac 間の同期は Apple OS が自動で行うため、**実装コストがほぼゼロ**
- ネットワーク切断時もローカルキャッシュで動作

### デメリット
- **Linux 未対応**（クロスプラットフォームの選択肢として弱い）
- **Windows は iCloud for Windows のインストールが必須**（自動でない）
- CloudKit Web Services は非 Apple プラットフォームでは事実上使えない
- iCloud Drive の挙動が **OS の同期エンジンに完全依存** → アプリ側で同期状態を制御できない
- ファイルがダウンロード前のスタブ（`.icloud` 拡張子）の場合がある → I/O 前に `coordinationFile` の解決が必要なケースあり
- 競合解決はユーザーに「○○ (iPhone のコピー)」のようなファイルが現れる素朴な方式

### InkNel での実装方針
- **既定では選択肢A（ローカルファイルシステム経由）** を採用
- 実装上は「ローカル保存先」のパスを iCloud Drive のフォルダに向けるだけで完結
- macOS では `~/Library/Mobile Documents/com~apple~CloudDocs/InkNel/` を作成
- Windows では `C:\Users\<name>\iCloud Drive\InkNel\` を提案
- Linux ユーザーには iCloud Drive オプションを無効化
- 競合は iCloud 任せ。重要な場合は将来 SQLite メタの方で世代管理を追加

---

## 同期速度の比較（マルチデバイス編集向け）

PC とスマートフォン間で同じノートを編集する想定では、**ファイル変更が他端末に届くまでの遅延** と **競合解決の挙動** が決定的に重要。各サービスを詳細比較する。

### 同期遅延（ある端末で書き込んでから他端末に反映されるまで）

| サービス | 平均遅延 | 仕組み | 備考 |
|---|---|---|---|
| **Dropbox** | **数百ms 〜 数秒** | **ブロックレベル差分同期** + longpoll API | 業界トップクラスの速度。小さなテキスト編集は事実上リアルタイム |
| **Google Drive** | 数秒 〜 数十秒 | 差分同期 + push notifications (webhook) | 公式 Drive クライアントで運用すると数秒、API直叩きだとポーリング次第 |
| **iCloud Drive** | 数秒 〜 数分 | OS 統合の同期エンジン | 安定するときは早いが、スリープ復帰時や大量変更時に詰まることがある |

### Dropbox の longpoll API

InkNel 用途で重要な点:
- `/files/list_folder/longpoll` エンドポイントで HTTP コネクションを保持し、変更があった瞬間に応答が返る
- レイテンシは **30〜90秒のランダムジッタを除けば数百ミリ秒** レベル
- ポーリングと違いネットワーク帯域も最小（変更がなければ何も流れない）
- 検出後は `/files/list_folder/continue` で実際の差分を取得
- これにより「PCで保存 → スマホに即座に反映」が現実的に可能

### Google Drive の変更通知

- **Push notifications (webhook)**: サーバー側で受け取る前提のため、Electron デスクトップアプリ単体だと利用しづらい
- 代替として **`changes.list` を定期ポーリング** が一般的（5〜30秒間隔）→ レイテンシはポーリング間隔に依存
- Google 公式の Drive for Desktop と併用すれば数秒で同期されるが、それは「OS 同期エンジン任せ」のアプローチ

### iCloud Drive の変動

- 通常時は数秒で同期されるが、**端末がスリープから復帰した直後・通信が切れた後** などに同期が遅延・停止することが知られている
- ファイルが「ダウンロード前のスタブ」(`*.icloud`) のまま放置されるケースもある
- アプリ側からは同期状態をコントロールできない（OSの同期エンジン任せ）

### 競合解決の挙動

複数端末で同じノートを **同時に編集** した場合の挙動:

| サービス | 競合時の挙動 |
|---|---|
| Dropbox | 競合ファイル `note (PC のコピー).md` を別ファイルとして残す |
| Google Drive | 後勝ちで上書き、過去版はバージョン履歴から復元可 |
| iCloud Drive | 「○○ (iPhone のコピー)」のような名前で別ファイル化 |

いずれも自動マージはしないため、**InkNel 側で楽観的同時編集を防ぐ仕組み** が必要:
- ノートを開いた瞬間にロック取得（DB に編集中フラグ）
- ローカルキャッシュ + リモート反映の前に変更検知 → 競合警告
- 最終的にはアプリ独自の差分マージ（例: 「タイムスタンプの新しい方を採用 + バックアップ世代を残す」）

---

## マルチデバイス編集に対する推奨

**結論: 速度・実装容易性・競合制御のいずれを取っても Dropbox が最良**。

### なぜ Dropbox がベストか

1. **ブロックレベル差分同期** で 1KB のテキスト編集も最速で反映
2. **longpoll API** で Electron 単体（バックエンド不要）でリアルタイム変更検知が可能
3. **パスベース API** なので InkNel の `${id}.md` モデルと噛み合う
4. **App folder スコープ** で安全 + ユーザー認証も最小権限
5. クロスプラットフォーム公式アプリが充実し、スマホからの参照・編集も容易
6. 競合ファイルがファイル名で明示されるため、アプリ側で検知して UI に出しやすい

### Google Drive が向くケース

- ユーザーが既に Google エコシステムを多用している
- 無料 15GB を活かしたい
- バックエンドサーバを立てて webhook を受けられる環境がある

### iCloud Drive が向くケース

- ユーザーが Apple 端末のみを使用（Windows/Linux 不要）
- 認証/同期エンジンの実装を自前でやりたくない
- 「設定が要らない」が最優先

---

## 比較表

| 観点 | Google Drive | Dropbox | iCloud Drive |
|---|---|---|---|
| 無料容量 | **15 GB**（共有） | 2 GB | 5 GB |
| 最低有料プラン | $1.99 / 100GB | $9.99 / 2TB | ¥150 / 50GB |
| 公式 Node SDK | ◎ `googleapis` | ◎ `dropbox` | ✗ なし（CloudKit はWeb専用） |
| OAuth 実装難易度 | 中 | **低** | 高（CloudKit）/ 不要（FS経由） |
| 配布審査 | 厳しめ（センシティブ） | 緩め | Developer Program 必須 |
| クロスプラットフォーム | ◎ | ◎ | △（**Linux ✗**） |
| 階層モデル | ID ベース（クセあり） | **パスベース** | パスベース |
| リアルタイム変更通知 | Webhook（要バックエンド） | **Longpoll（クライアント単体）** | OS 同期任せ |
| **同期速度（小さなテキスト）** | 数秒〜数十秒 | **数百ms〜数秒** | 数秒〜数分 |
| **差分同期** | 差分（後発） | **ブロックレベル差分** | OS 任せ |
| 競合の明示 | バージョン履歴で復元 | **競合ファイルとして残す** | 競合ファイルとして残す |
| アプリ専用フォルダ | `appDataFolder` | App folder | フォルダ作成のみ |
| バージョン履歴 | 自動 | 30日(Basic) | 限定的 |
| モバイル参照 | iOS/Android 公式アプリ | iOS/Android 公式アプリ | iOS のみ完全対応 |
| InkNel 実装コスト | ★★☆ | **★☆☆** | ★★☆（FS経由なら★） |
| ユーザー普及率 (国内) | ★★★ | ★★ | ★★★ |

---

## InkNel 向けの推奨実装順

InkNel フェーズ4（保存先アダプタ）でこれら3つを統合する際は、**以下の順番で実装** するのが最も効率的:

### Step 1: iCloud Drive（FS経由）— 最速で実装可能
- 既存のローカル保存先機構に「保存ディレクトリを iCloud パスに切り替える」だけで実現
- macOS のみ初版対応 → Windows は iCloud for Windows 検出後に有効化
- 認証コード不要 → ストレージアダプタの抽象化のみで完了

### Step 2: Dropbox — API が最もシンプル
- `dropbox` SDK + PKCE で OAuth 実装
- パスベース API なので既存の「ファイル名 = `${id}.md`」モデルとそのまま噛み合う
- App folder スコープで安全
- longpoll でリアルタイム同期

### Step 3: Google Drive — 最も普及しているが実装は重い
- `googleapis` + Desktop OAuth Client
- `appDataFolder` スコープで配置
- ID ベース管理のため、内部で「ファイル名 → ID」のマッピングテーブルが必要
- センシティブスコープなら配布前に Google 審査

---

## ストレージアダプタ抽象化の指針

3 サービスを統一的に扱うために、`electron/storage/` 配下に以下のインタフェースを定義する想定:

```ts
export type StorageKind = 'local' | 'icloud' | 'dropbox' | 'gdrive';

export interface StorageStatus {
  kind: StorageKind;
  /** 接続中・認証OK・エラー等 */
  state: 'connected' | 'authenticating' | 'error' | 'disconnected';
  /** ユーザー向けの状態メッセージ */
  message?: string;
}

export interface NoteStorageAdapter {
  readonly kind: StorageKind;
  /** 認証/接続を確立。OAuth が必要な場合はここでブラウザを開く */
  connect(): Promise<void>;
  /** 接続を解除（トークン破棄など） */
  disconnect(): Promise<void>;
  /** 現在の状態 */
  status(): StorageStatus;

  /** ノート本文を保存先に書き出す */
  writeNote(id: string, body: string): Promise<void>;
  /** ノート本文を保存先から読み出す */
  readNote(id: string): Promise<string>;
  /** ノートを削除 */
  deleteNote(id: string): Promise<void>;
  /** 保存先に存在するすべてのノートIDを列挙（同期検証用） */
  listNoteIds(): Promise<string[]>;

  /**
   * リモート変更を受け取るリスナー
   * - DropboxAdapter: longpoll API
   * - GoogleDriveAdapter: changes.list を ポーリング
   * - ICloudDriveAdapter / LocalStorageAdapter: fs.watch
   * 戻り値は購読解除関数
   */
  watch(callback: (changedIds: string[]) => void): () => void;
}
```

実装クラス:
- `LocalStorageAdapter` (既存の `notes/${id}.md` フラット配置)
- `ICloudDriveAdapter` (LocalStorageAdapter のパス変えるだけ)
- `DropboxAdapter` (`dropbox` SDK ラッパ + longpoll)
- `GoogleDriveAdapter` (`googleapis` ラッパ + ID キャッシュ + ポーリング)

---

## ストレージ選択 UI の設計

### 設定モーダルへの追加

設定モーダルに **「保存先」** カテゴリを新設する。基本/保護 の下に配置。

```
┌──────────────┬─────────────────────────────────┐
│ 基本         │ 保存先                          │
│ 保護         │                                 │
│ ▶ 保存先     │ 現在の保存先: Dropbox           │
│              │ 接続状態: ● 接続中               │
│              │                                 │
│              │ ┌─────────────────────────────┐ │
│              │ │ ○ ローカル                  │ │
│              │ │ ○ iCloud Drive              │ │
│              │ │ ◉ Dropbox          [接続]   │ │
│              │ │ ○ Google Drive     [接続]   │ │
│              │ └─────────────────────────────┘ │
│              │                                 │
│              │ ▼ 詳細設定                       │
│              │   フォルダパス: /Apps/InkNel    │
│              │   最終同期: 2026-04-11 12:00    │
│              │                                 │
│              │ [接続を解除] [マイグレーション] │
└──────────────┴─────────────────────────────────┘
```

### 設定キー

| キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `storage.kind` | `'local' \| 'icloud' \| 'dropbox' \| 'gdrive'` | `'local'` | 現在の保存先 |
| `storage.icloud.path` | string | OS既定 | iCloudDrive 内のフォルダパス |
| `storage.dropbox.refreshToken` | string (encrypted) | — | OAuth リフレッシュトークン（safeStorage で暗号化） |
| `storage.gdrive.refreshToken` | string (encrypted) | — | 同上 |
| `storage.lastSyncAt` | number | 0 | 最後にリモートから取り込んだ時刻 |

### 保存先切替のフロー

1. ユーザーが新しい保存先を選択（例: Dropbox）
2. 未認証なら **「接続」ボタン** で OAuth フローを開始（外部ブラウザ起動 → loopback callback）
3. 認証完了後、**「マイグレーション」ダイアログ** を表示:
   - A: 「現在のローカルデータを Dropbox にコピーして切替」
   - B: 「Dropbox 上の既存データを取り込んで切替」
   - C: 「マージ（タイムスタンプの新しい方を採用）」
4. 切替後、SQLite メタDB の `storage.kind` を更新
5. 以降の `notes:create` / `notes:update-body` 等は新しいアダプタを通じて動作

### 多端末同期のループ

```
[PC1 で保存]
   ↓ writeNote
[DropboxAdapter.writeNote]
   ↓ Dropbox /files/upload
[Dropbox サーバ]
   ↓ longpoll 通知
[PC2: DropboxAdapter.watch コールバック]
   ↓ readNote(変更ID)
[PC2 のレンダラに反映]
   ↓ 編集中なら警告 / 編集中でなければ自動更新
```

スマートフォン側（別アプリ）も同じ Dropbox API を使えば、同様のフローで PC ⇔ スマホがリアルタイム同期される。

### 衝突防止のための独自ルール

InkNel では以下を実装する想定:

1. **編集ロック (optimistic)**: ノートを開いた瞬間に SQLite メタへ「編集中フラグ + 端末ID + 開始時刻」を記録し、リモートにも保存する
2. **保存前差分検知**: 書き込み前にリモートの updated_at を確認し、自分が読み込んだ時より新しければ「他の端末で更新されました」警告を表示
3. **競合ファイルの検知**: Dropbox 等が `note (XX のコピー).md` を作った場合、起動時または `watch` で検知し、ユーザーに「マージ画面」を提示
4. **タイムスタンプ + 端末ID 付きの行ベース履歴**: 将来の機能として CRDT 風のマージを検討（フェーズ5）

### 推奨実装ロードマップ

| フェーズ | 内容 | 期間目安 |
|---|---|---|
| 4.1 | `NoteStorageAdapter` インタフェース定義 + `LocalStorageAdapter` リファクタ | 既存コードの分離のみ |
| 4.2 | `ICloudDriveAdapter`（FS経由）+ 設定モーダル「保存先」カテゴリ追加 | macOS で動作 |
| 4.3 | **`DropboxAdapter`** 実装（OAuth PKCE + ファイル CRUD + longpoll） | 最重要 |
| 4.4 | 編集ロック・競合検知 UI | マルチデバイス安全性 |
| 4.5 | `GoogleDriveAdapter`（appDataFolder + 差分ポーリング） | Google ユーザー向け |
| 4.6 | マイグレーションウィザード（保存先切替時のデータ移行） | UX 完成度向上 |

---

## まとめ

| 用途・要件 | 推奨 |
|---|---|
| **macOS ユーザー中心、最小コストで動かしたい** | iCloud Drive (FS経由) |
| **Windows / Linux 含めて広く使いたい、API を最短で書きたい** | **Dropbox** |
| **無料容量を重視、ユーザー普及率が高いものを使いたい** | Google Drive |
| **PC ⇔ スマホでリアルタイム編集したい（同期速度最優先）** | **Dropbox（断トツで最速）** |

InkNel は将来的に **3 つすべてをアダプタとして提供** し、設定画面の「保存先」カテゴリでユーザーが好きなものを選べるようにする方針。

### 同期速度を考慮した最終推奨

マルチデバイス編集では **同期遅延が UX を決定する** ため、メインのオンライン保存先として **Dropbox を既定** に位置付けることを推奨する:

- **Dropbox**: ブロックレベル差分同期 + longpoll API により、PC で保存したら数百ms〜数秒でスマホに反映可能
- **iCloud Drive**: macOS ユーザーには「設定不要オプション」として併存
- **Google Drive**: 既存 Google ユーザー向けの選択肢として提供

実装は **iCloud（FS経由）→ Dropbox → Google Drive** の順に進めると、まず macOS ユーザーが使える状態を最速で達成し、続けてリアルタイム同期が必要なメインユーザー向けに Dropbox を、最後にカバレッジ拡大のため Google Drive を実装できる。

---

## 参考リンク

### Google Drive
- [Node.js quickstart - Google Drive API](https://developers.google.com/workspace/drive/api/quickstart/nodejs)
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Usage limits - Google Drive API](https://developers.google.com/workspace/drive/api/guides/limits)
- [google-api-nodejs-client (GitHub)](https://github.com/googleapis/google-api-nodejs-client)
- [electron-google-oauth2 (GitHub)](https://github.com/getstation/electron-google-oauth2)
- [Google One プラン](https://one.google.com/about/plans)

### Dropbox
- [Dropbox SDK for JavaScript (GitHub)](https://github.com/dropbox/dropbox-sdk-js)
- [Dropbox Node SDK ドキュメント](https://dropbox.github.io/dropbox-sdk-js/)
- [OAuth code flow with Node.js & Dropbox SDK](https://dropbox.tech/developers/oauth-code-flow-implementation-using-node-js-and-dropbox-javascript-sdk)
- [npm: dropbox](https://www.npmjs.com/package/dropbox)
- [Dropbox プラン一覧](https://www.dropbox.com/plans)

### iCloud Drive / CloudKit
- [CloudKit - Apple Developer](https://developer.apple.com/icloud/cloudkit/)
- [Enabling CloudKit in Your App](https://developer.apple.com/documentation/cloudkit/enabling-cloudkit-in-your-app)
- [Set up iCloud Drive on all your devices](https://support.apple.com/guide/icloud/set-up-icloud-drive-mm203b05aec8/icloud)
- [Set up iCloud Drive on Windows](https://support.apple.com/guide/icloud-windows/set-up-icloud-drive-icw0144825a5/icloud)
- [How to Access iCloud Drive from Command Line on macOS](https://osxdaily.com/2017/11/16/access-icloud-drive-command-line-mac/)
