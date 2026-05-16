# InkNel — クラウドプロバイダ & ネットワーク同期仕様

このドキュメントは、**クラウドプロバイダの選択と同期エンジンの詳細仕様**を、React Native で作成する iOS 版の実装に組み込むためにまとめたものです。
デスクトップ版 (Electron 版 v0.1.7) の実装 `electron/sync/cloudSync.ts` を正として記述しています。

## 目次
1. [設計思想](#1-設計思想)
2. [プロバイダ種別](#2-プロバイダ種別)
3. [プロバイダ検出](#3-プロバイダ検出)
4. [同期ルートとディレクトリ構成](#4-同期ルートとディレクトリ構成)
5. [manifest.json スキーマ](#5-manifestjson-スキーマ)
6. [同期アルゴリズム](#6-同期アルゴリズム)
7. [進捗イベント (SyncProgressEvent)](#7-進捗イベント-syncprogressevent)
8. [外部 API（IPC 相当）](#8-外部-apiipc-相当)
9. [UI 仕様（プロバイダ選択パネル）](#9-ui-仕様プロバイダ選択パネル)
10. [iOS 版での実装方針](#10-ios-版での実装方針)
11. [エラーハンドリング](#11-エラーハンドリング)
12. [エッジケース](#12-エッジケース)
13. [テストシナリオ](#13-テストシナリオ)

---

## 1. 設計思想

### 1.1 基本方針

- **OAuth / クラウド API を使わない**。各プロバイダが提供する**ローカル同期フォルダ**（OS の同期クライアントがバックグラウンドでクラウドと同期しているディレクトリ）に対して普通のファイル I/O で読み書きする
- **ネットワーク転送は OS 側に委譲**する。デバイス間の実際のデータ転送は iCloud / Dropbox / Google Drive のクライアントが行う
- アプリが直接ネットワーク通信するのは**未想定**（将来拡張として残す可能性はある）
- **同期の正は `manifest.json`**。メタデータをここで一元管理し、本文ファイルと照合する

### 1.2 メリット

- 認証フロー（OAuth）・トークンリフレッシュ不要
- レート制限を気にしなくて良い
- オフラインでも手元のコピーは常に利用可能
- 各プロバイダの有償プランでもトラフィック課金されない
- 実装がシンプル（差分もファイルシステム API のみ）

### 1.3 トレードオフ / 制約

- 対応プロバイダ＝**OS に同期クライアントをインストールしている必要**がある
- iOS では iCloud 以外は別途アプリ連携が必要
- 競合解決はシンプルな LWW（Last-Write-Wins）のみ
- リアルタイム通知はなし（ポーリング or フォアグラウンド復帰時に同期）

---

## 2. プロバイダ種別

```ts
export type ShareProvider = 'none' | 'icloud' | 'dropbox' | 'gdrive';
```

| 値 | 表示名 | 説明 |
|---|---|---|
| `'none'` | 無効 | 同期機能を完全停止。クラウド I/O は一切行わない |
| `'icloud'` | iCloud Drive | macOS / iOS で標準 |
| `'dropbox'` | Dropbox | Dropbox クライアント（Mac / Win / Mobile）経由 |
| `'gdrive'` | Google Drive | Google Drive for Desktop 経由 |

**同時利用不可**。設定画面のラジオボタンで 1 つだけ選択する。

---

## 3. プロバイダ検出

### 3.1 返却型

```ts
interface ProviderInfo {
  id: ShareProvider;       // 'icloud' | 'dropbox' | 'gdrive' （'none' は含まない）
  label: string;           // UI 表示名
  path: string | null;     // 検出されたローカル同期フォルダ。無ければ null
  available: boolean;      // path !== null と同値
}

detectProviders(): ProviderInfo[]
```

### 3.2 macOS での検出ロジック

#### iCloud Drive

```
<home>/Library/Mobile Documents/com~apple~CloudDocs/
```

の存在だけで判定。

#### Dropbox

1. `<home>/.dropbox/info.json` を読む（存在すれば）
2. JSON の各アカウントエントリの `.path` を順に見る。存在する最初の実パスを採用
3. ダメならフォールバック候補を順に判定:
   - `<home>/Dropbox`
   - `<home>/Dropbox (Personal)`
   - `<home>/Library/CloudStorage/Dropbox`

#### Google Drive (macOS 13+)

1. `<home>/Library/CloudStorage/` の存在確認
2. 直下のエントリから `GoogleDrive-` で始まるディレクトリを検索（= Google Drive for Desktop がマウントするアカウントディレクトリ）
3. その配下で以下の言語別マイドライブ名を順に試行:
   - `"My Drive"` (英)
   - `"マイドライブ"` (日)
   - `"Mon Drive"` (仏)
   - `"Meine Ablage"` (独)
   - `"Mi unidad"` (西)
4. どれも無ければ隠しフォルダ以外の最初のサブディレクトリを採用

### 3.3 Windows での検出ロジック（参考）

- iCloud: `%USERPROFILE%\iCloudDrive\`（iCloud for Windows インストール済み時）
- Dropbox: `%LOCALAPPDATA%\Dropbox\info.json` → `.path`、フォールバック `%USERPROFILE%\Dropbox`
- Google Drive: G: などのマウントドライブ。`%USERPROFILE%\Google Drive\`

（現状のデスクトップ版は macOS 前提の実装。Windows 対応は detectProviders を OS 別に分岐する拡張が必要）

### 3.4 iOS での検出ロジック（**新規実装**）

iOS ではユーザーフォルダの自由探索ができないため、以下の方式で対応:

| プロバイダ | iOS での取得方法 |
|---|---|
| iCloud Drive | `FileManager.default.url(forUbiquityContainerIdentifier: nil)` で取得できる App 専用領域を `<container>/Documents/` として使う。または `UIDocumentPickerViewController` でユーザーに `InkNel/` フォルダを選択させブックマークを保持 |
| Dropbox | Dropbox SDK for iOS でアカウント連携、または Files アプリ経由（`UIDocumentPicker` で Dropbox プロバイダを選択） |
| Google Drive | Google Drive SDK で OAuth、または Files アプリ経由 |

**推奨**: iOS 初版では **iCloud Drive のみサポート**し、Ubiquity Container を利用する（認証不要でシンプル）。Dropbox / Google Drive は将来拡張。

#### Ubiquity Container 利用時のパス

```
<UbiquityContainer>/Documents/InkNel/
```

既存のデスクトップ版 (`<iCloud>/InkNel/`) と**同じマニフェスト形式**を書き込めば、Mac と iOS で相互運用可能。

---

## 4. 同期ルートとディレクトリ構成

### 4.1 同期ルート

各プロバイダの同期フォルダ直下に `InkNel/` ディレクトリを作成し、これを**同期ルート**と呼ぶ。

```ts
function getSyncRoot(provider: ShareProvider): string | null {
  if (provider === 'none') return null;
  const found = detectProviders().find((p) => p.id === provider);
  if (!found?.path) return null;
  const root = join(found.path, 'InkNel');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'notes'), { recursive: true });
  return root;
}
```

### 4.2 ディレクトリ構成

```
<cloud-folder>/InkNel/
├── manifest.json            ← ノートのメタデータ一覧（JSON）
├── notes/
│   ├── <uuid-1>.md          ← ノート本文
│   ├── <uuid-2>.md
│   └── ...
├── images/                  ← 画像ファイル
│   ├── <sha256>.<ext>
│   └── ...
└── attachments/             ← 添付ファイル
    ├── <sha256>.<ext>
    └── ...
```

- **ノート本文**: `notes/<uuid>.md`（UTF-8、LF 改行、フラット配置）。フォルダ階層は manifest の `folder` プロパティで仮想化
- **画像**: `images/<sha256>.<ext>`。内容ベースのハッシュ命名で自動 dedupe
- **添付**: `attachments/<sha256>.<ext>`。画像と同じ命名規則

### 4.3 命名規則

| 種類 | パターン | 備考 |
|---|---|---|
| ノート ID | UUIDv4 文字列 | `crypto.randomUUID()` で生成 |
| 画像ファイル名 | `^[a-f0-9]{64}\.[a-z0-9]{2,5}$` | 拡張子: png / jpg / jpeg / gif / webp / svg / avif / bmp。以外は `.bin` |
| 添付ファイル名 | `^[a-f0-9]{64}\.[a-z0-9]{2,5}$` | 拡張子: pdf / zip / lzh / lha / 7z。以外は `.bin` |

iOS 実装時も上記パターンで厳格にバリデーション（パストラバーサル対策）。

---

## 5. manifest.json スキーマ

### 5.1 構造

```json
{
  "version": 1,
  "lastSync": 1712851200000,
  "notes": {
    "<uuid>": {
      "title": "メモのタイトル",
      "folder": "work/ideas",
      "protected": false,
      "secret": false,
      "tags": ["tag1", "tag2"],
      "createdAt": 1712800000000,
      "updatedAt": 1712850000000
    }
  }
}
```

### 5.2 フィールド定義

| フィールド | 型 | 必須 | 説明 |
|---|---|:-:|---|
| `version` | `1` | ✓ | 固定値 `1`。将来構造変更時に bump して識別 |
| `lastSync` | number | ✓ | 最終フル同期時刻 (epoch ms)。`0` は未同期 |
| `notes` | `Record<noteId, NoteEntry>` | ✓ | 全ノートのメタデータ。キーは UUID |

NoteEntry:

| フィールド | 型 | 必須 | 説明 |
|---|---|:-:|---|
| `title` | string | ✓ | ノートタイトル |
| `folder` | string | ✓ | スラッシュ区切りパス。ルートは `""` |
| `protected` | bool | ✓ | 編集時にパスワード要求 |
| `secret` | bool | ✓ | 閲覧時にもパスワード要求 |
| `tags` | string[] | ✓ | メタタグ配列 |
| `createdAt` | number | ✓ | epoch ms |
| `updatedAt` | number | ✓ | epoch ms。**同期比較の基準** |

### 5.3 不正な manifest の扱い

- **ファイルが存在しない** → 空で初期化して続行
- **JSON パース失敗** → 空で初期化（既存 notes を消さないよう push 側でのみ書き戻し）
- **`version !== 1`** → 空で初期化（将来バージョンを拒否）
- **`notes` が object でない** → 空で初期化

### 5.4 iOS 実装上の注意

- JSON 読み書きは `JSON.parse` / `JSON.stringify` で十分
- `notes` のキー順は仕様上未規定（が、書き出し時は生成順）
- **改行は `\n`** を原則とし、文字列内の改行もそのまま保持
- BOM は付けない

---

## 6. 同期アルゴリズム

### 6.1 同期の 3 層構成

| 層 | 関数 | タイミング | 範囲 |
|---|---|---|---|
| フル同期 | `runSync()` | 起動時 / 手動実行時 | 全ノート + メディア |
| 単一チェック | `checkAndSyncSingleNote()` | ノート選択時 | 指定 1 ノートのみ |
| ライトスルー | `pushSingleNote` / `removeSingleNote` / `pushSingleMedia` | mutation 直後 | 変更されたノート 1 件 |

### 6.2 タイムスタンプ比較ルール

判定の基準は常に `updatedAt` (epoch ms, int)。バイト単位比較はしない。

| ローカル | クラウド | アクション |
|---|---|---|
| あり | なし | **push**（ローカル → クラウド） |
| なし | あり | **pull**（クラウド → ローカル、DB 新規） |
| 同じ | 同じ | unchanged |
| 新しい | 古い | push（DB の値で上書き） |
| 古い | 新しい | pull（DB を更新） |

### 6.3 `runSync(provider, onProgress?)`

```ts
interface SyncResult {
  pushed: number;       // push した件数
  pulled: number;       // pull した件数
  unchanged: number;    // 未変更件数
  total: number;        // 対象ノート総数
  mediaPushed: number;  // 画像+添付の push 件数
  mediaPulled: number;  // 画像+添付の pull 件数
  lastSync: number;     // 今回完了時刻
}
```

#### フロー

```
1. getSyncRoot(provider) → root パス取得（失敗なら throw）
2. loadManifest(root/manifest.json)
3. localNotes = listNotes()
4. allIds = union(manifest.notes のキー, localNotes の id)
5. for (id of allIds) {
     local = DB の該当ノート
     cloud = manifest.notes[id]
     if (local && !cloud) → push
     else if (!local && cloud) → pull + DB upsert
     else {
       if (local.updatedAt > cloud.updatedAt) push
       else if (cloud.updatedAt > local.updatedAt) pull + DB upsert
       else unchanged
     }
     onProgress(...)
     await setImmediate()   // イベントループを返す
   }
6. syncMediaDir(localImages ↔ cloudImages)
7. syncMediaDir(localAttachments ↔ cloudAttachments)
8. manifest.lastSync = Date.now()
9. saveManifest(root/manifest.json)
10. onProgress('done', result)
```

**削除の扱い**: 明示的な削除同期は未実装。manifest に存在しない ID はローカルにも保持する（= 他デバイスで削除されてもローカルには残る）。削除は**ライトスルーの `removeSingleNote`** が manifest から削除エントリを除去することで他デバイスへ伝播する。

### 6.4 `syncMediaDir(localDir, cloudDir, filenamePattern)`

- 両ディレクトリ内で **`filenamePattern`（SHA-256 + 拡張子）にマッチする**ファイルだけを対象
- **同名ファイル = 同一バイナリ**（SHA-256 命名の前提）なのでバイト比較はしない
- ローカルにしか無い → クラウドに copy（push）
- クラウドにしか無い → ローカルに copy（pull）
- 失敗（I/O エラー）は**静かに無視**（次回同期でリトライ）

### 6.5 `checkAndSyncSingleNote(provider, noteId)`

ノート選択時にバックグラウンドで 1 件だけ同期。

```ts
type SingleNoteSyncResult = 'pulled' | 'pushed' | 'same' | 'skip';
```

- `'skip'`: provider === 'none' / 検出不可 / noteId が DB に存在しない
- `'pushed'`: manifest に無い OR ローカルが新しい → クラウドに書き出し
- `'pulled'`: クラウドが新しい → DB 更新 + body 書き換え（**呼び出し元で UI 再読込が必要**）
- `'same'`: updatedAt 同一

### 6.6 ライトスルー: `pushSingleNote(provider, noteId)`

mutation（create / update-meta / update-body / set-protected / set-secret）直後に呼ぶ:

1. `getSyncRoot` で root 取得、失敗なら何もしない
2. DB から noteMeta を取得
3. ローカル body を `notes/<id>.md` にコピー
4. manifest.notes[id] を最新の meta で上書き
5. manifest.lastSync = Date.now()
6. saveManifest

### 6.7 ライトスルー: `removeSingleNote(provider, noteId)`

ノート削除直後に呼ぶ:

1. `root/notes/<id>.md` があれば unlink
2. manifest.notes から id を delete
3. manifest.lastSync を更新して save

### 6.8 ライトスルー: `pushSingleMedia(provider, kind, localPath, filename)`

画像 / 添付の保存直後に呼ぶ:

1. `root/<kind>/<filename>` が既に存在すれば**スキップ**（SHA-256 同名 = 同一内容）
2. ローカルファイルを読んでクラウドに書く
3. エラー時は無視（次回フル同期で拾える）

---

## 7. 進捗イベント (SyncProgressEvent)

`runSync` の `onProgress` コールバックに以下の型のイベントが流れる:

```ts
type SyncProgressEvent =
  | { phase: 'start';      total: number }
  | { phase: 'push';       current: number; total: number; noteTitle: string }
  | { phase: 'pull';       current: number; total: number; noteTitle: string }
  | { phase: 'skip';       current: number; total: number; noteTitle: string }
  | { phase: 'media';      kind: 'images' | 'attachments'; pushed: number; pulled: number; total: number }
  | { phase: 'finalizing'; total: number }
  | { phase: 'done';       result: SyncResult };
```

### 7.1 イベント順序

```
start
  → push/pull/skip (current=1..total)  各ノート
  → media kind=images
  → media kind=attachments
  → finalizing
  → done
```

UI はこのイベントを受けてプログレスバー + 「ファイル名表示」を更新する（デスクトップ版はフッターに表示）。

### 7.2 イベントループ制御

各ノート処理後に `await setImmediate()` を挟み、進捗イベントが UI 側（別スレッド）に届く時間を与える。

iOS の React Native では Promise / `setTimeout(0)` で同等の効果が得られる。数千ノートあると UI が固まるので忘れずに実装する。

---

## 8. 外部 API（IPC 相当）

デスクトップ版では以下の IPC ハンドラで renderer に公開されている。iOS 版では直接関数呼び出しに置き換える（同期コードから呼び出し可能）。

| IPC 名 | 関数 | 用途 |
|---|---|---|
| `share:detect-providers` | `detectProviders()` | プロバイダ一覧取得 |
| `share:get-status` | `getSyncStatus(provider)` | 選択プロバイダの現状取得 |
| `share:check-note` | `checkAndSyncSingleNote(provider, noteId)` | 単一ノート同期 |
| `share:sync` | `runSync(provider, onProgress)` | フル同期実行 |
| `share:progress` | （sender.send で UI へ push） | 進捗イベント通知 |

### 8.1 SyncStatus

```ts
interface SyncStatus {
  provider: ShareProvider;     // 現在の選択値
  available: boolean;          // 同期フォルダが使える状態か
  path: string | null;         // 検出されたルート（例: /.../InkNel）
  lastSync: number;            // manifest.lastSync（未同期は 0）
  cloudNoteCount: number;      // manifest.notes のキー数
}
```

### 8.2 呼び出し契約（renderer 視点）

```ts
// 1. プロバイダ一覧表示
const providers: ProviderInfo[] = await window.api.share.detectProviders();

// 2. 現在のステータス取得
const status: SyncStatus = await window.api.share.getStatus(provider);

// 3. 手動でフル同期
const result: SyncSyncResult = await window.api.share.sync(provider);

// 4. 進捗イベント購読（sync() 実行中に届く）
const unsubscribe = window.api.share.onProgress((ev) => { ... });
```

### 8.3 ライトスルーの呼び出し

デスクトップ版では `ipc.ts` 内で mutation ハンドラが直接 `pushSingleNote` / `removeSingleNote` / `pushSingleMedia` を呼ぶ。レンダラからは見えない。

iOS 版でも同様に**サービス層内部**で自動発火させる（UI 側は mutation API を呼ぶだけ）。

---

## 9. UI 仕様（プロバイダ選択パネル）

デスクトップ版の `SharePanel` コンポーネントに相当する設定画面。

### 9.1 表示要素

```
┌────────────────────────────────────────────────┐
│ 共有                                           │
├────────────────────────────────────────────────┤
│ クラウド同期先                                 │
│ ノートを同期するクラウドストレージを1つ選択... │
│                                                │
│ ○ 無効                                          │
│ ● iCloud Drive              利用可能           │
│ ○ Dropbox                   未検出             │
│ ○ Google Drive              利用可能           │
├────────────────────────────────────────────────┤
│ 同期状態                                       │
│   同期フォルダ: /Users/.../iCloud/.../InkNel   │
│   クラウド上のノート数: 42 件                   │
│   最終同期: 2026/04/18 14:23                    │
│   [今すぐ同期]                                  │
│   同期完了: push 3 / pull 1 / 変更なし 38      │
│     (全 42 件)                                   │
└────────────────────────────────────────────────┘
```

### 9.2 挙動

- **ラジオボタン**: 4 択（none / icloud / dropbox / gdrive）
- 未検出のプロバイダは **disabled + "未検出" バッジ**
- 選択を変更すると即座に `share.provider` 設定へ保存 + `getStatus` で再取得
- `'none'` 時は「同期状態」セクションを非表示
- 「今すぐ同期」ボタンで `runSync(provider)` を呼び、`push/pull/unchanged` の結果を表示
- 同期中はボタン disabled + 「同期中…」ラベル

### 9.3 同期進捗表示（アプリ下部のフッター）

設定画面とは別に、アプリのフッターで進捗イベントをリアルタイム表示する。

- アイコン: クラウド ☁
- 方向: `↑`（push）/ `↓`（pull）
- ファイル名: 現在処理中のノートタイトル
- プログレスバー: `current / total`
- 完了後は「共有」のステータスバッジ表示

iOS 版では画面下部にトースト or 小さいステータスバーで同等表示。

---

## 10. iOS 版での実装方針

### 10.1 推奨スタック

| 用途 | ライブラリ |
|---|---|
| ファイル I/O | `expo-file-system` + `FileSystem.StorageAccessFramework` |
| iCloud Ubiquity Container | ネイティブモジュール（`NSFileCoordinator` + `NSFilePresenter`） or `react-native-cloud-store` |
| SHA-256 | `expo-crypto` の `digestStringAsync` |
| SQLite | `expo-sqlite` |
| 状態管理 | Zustand or React Context |
| バックグラウンド同期 | `BackgroundTasks` (`BGAppRefreshTask`) |

### 10.2 iCloud Ubiquity Container 設定

`Info.plist` に以下を追加（アプリ起動時に iCloud 権限が必要）:

```xml
<key>NSUbiquitousContainers</key>
<dict>
  <key>iCloud.com.inknel.app</key>
  <dict>
    <key>NSUbiquitousContainerIsDocumentScopePublic</key>
    <true/>
    <key>NSUbiquitousContainerSupportedFolderLevels</key>
    <string>Any</string>
    <key>NSUbiquitousContainerName</key>
    <string>InkNel</string>
  </dict>
</dict>
```

App Capabilities で **iCloud → iCloud Documents** を ON にし、container identifier `iCloud.com.inknel.app` を指定。

### 10.3 同期ルート取得（Swift → RN bridge）

```swift
// Swift: UbiquityContainerResolver.swift
@objc(UbiquityContainerResolver)
class UbiquityContainerResolver: NSObject {
  @objc func resolve(_ resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    if let url = FileManager.default.url(forUbiquityContainerIdentifier: nil) {
      let inkNelDir = url.appendingPathComponent("Documents/InkNel")
      try? FileManager.default.createDirectory(at: inkNelDir,
                                               withIntermediateDirectories: true)
      resolve(inkNelDir.path)
    } else {
      reject("ICLOUD_UNAVAILABLE", "iCloud is not available", nil)
    }
  }
}
```

TypeScript 側:

```ts
import { NativeModules } from 'react-native';
const { UbiquityContainerResolver } = NativeModules;

async function getICloudSyncRoot(): Promise<string | null> {
  try {
    return await UbiquityContainerResolver.resolve();
  } catch {
    return null;
  }
}
```

### 10.4 iOS 版 detectProviders

初版は iCloud のみ。将来 Dropbox / GDrive に対応する場合は、それぞれの SDK でアカウント接続状態を検出する。

```ts
export async function detectProviders(): Promise<ProviderInfo[]> {
  const icloudPath = await getICloudSyncRoot();
  return [
    {
      id: 'icloud',
      label: 'iCloud Drive',
      path: icloudPath,
      available: !!icloudPath,
    },
    // 将来: dropbox / gdrive
  ];
}
```

### 10.5 ファイル I/O

`expo-file-system` で `readAsStringAsync` / `writeAsStringAsync` を使う。バイナリ（画像・添付）は `EncodingType.Base64` でやりとりし、一時ファイル経由で Ubiquity コンテナにコピー。

```ts
import * as FileSystem from 'expo-file-system';

async function writeJsonToCloud(path: string, json: unknown) {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(json, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
```

**注意**: iCloud Ubiquity コンテナへの書き込みは `NSFileCoordinator` 経由が推奨される（他デバイスの同時書き込みと衝突しないため）。ネイティブモジュールで wrap する。

### 10.6 バックグラウンド同期

iOS のアプリがバックグラウンドにある間はフル同期を回せない。代わりに:

1. **起動 / フォアグラウンド復帰時**に `runSync()` を自動実行
2. **ノート選択時**に `checkAndSyncSingleNote()` をバックグラウンドで
3. **mutation 直後**にライトスルーを走らせる
4. オプションで `BGAppRefreshTask` を登録し、OS が許可したときに同期

### 10.7 UI 再マッピング

| デスクトップ | iOS 相当 |
|---|---|
| 設定モーダル | 設定タブ (Settings Screen) |
| ラジオボタン | `react-native` の `SegmentedControl` or `RadioButton` |
| フッター進捗 | 画面下部のカスタムトースト or 小さいステータス帯 |
| 「今すぐ同期」 | 設定画面の PrimaryButton |

---

## 11. エラーハンドリング

### 11.1 失敗時の原則

- **アプリ動作は継続**。同期失敗でノート編集自体は止めない
- ネットワーク / I/O エラーは**静かに無視**し、次回同期で拾う
- ユーザー向けエラーは UI に通知（Preferences のメッセージ欄 / トースト）

### 11.2 代表的な失敗ケース

| ケース | 処理 |
|---|---|
| getSyncRoot 失敗（クラウドクライアント未インストール） | `runSync` は throw。UI はエラーメッセージ表示 |
| manifest.json 破損 | 空で初期化。既存の `notes` は次回 push で再構築 |
| 個別ノートの copy 失敗 | 該当ノートだけスキップ。他は継続 |
| メディアファイル copy 失敗 | 無視（次回フル同期でリトライ） |
| 同期中にプロバイダを変更 | 現在走っている sync は最後まで実行、次回以降新しいプロバイダで |
| ディスク空き容量不足 | throw → UI に「書き込み失敗」と表示 |

### 11.3 iOS 固有のエラー

| ケース | 処理 |
|---|---|
| iCloud が無効化されている | `forUbiquityContainerIdentifier` が nil → `'icloud'` を `available: false` に |
| Ubiquity Container の権限不足 | 起動時にアラート + Settings への導線 |
| `NSFileCoordinator` タイムアウト | 一定時間（例 10s）で諦めて次回試行 |

---

## 12. エッジケース

### 12.1 同じノートを 2 デバイスで同時編集

- Last-Write-Wins。後に `updatedAt` が新しい方が勝つ
- 手動マージ UI は提供しない
- 将来: バージョン履歴を `notes/<id>/<revision>.md` として保持する拡張案あり

### 12.2 時計ずれ

- デバイス間の時刻が大きくずれている場合、古い編集が「新しい」と判定されて上書きされる
- 実運用では NTP 同期前提で問題にならないが、iOS で手動時刻変更している場合は注意
- 将来: `updatedAt` にサーバータイムスタンプを使う拡張案あり（サーバーレス運用と矛盾）

### 12.3 削除されたノートの復活

- デバイス A で削除 → manifest から削除 → ライトスルー
- その後デバイス B で古いキャッシュから push すると復活する
- 対策: フル同期時に「manifest に無い」= 削除扱いとするオプションを将来追加

### 12.4 大量ノート（数千件）

- `runSync` は全 ID をループするので O(N)
- setImmediate でイベントループを譲るため UI は固まらない
- iOS では BackgroundTask の時間制限（30 秒程度）を超える可能性 → バッチ化を検討

### 12.5 メディアファイルの破損

- SHA-256 命名の前提が崩れる
- 対策: 保存時に必ずハッシュを再計算し、ファイル名と内容が一致することを検証

### 12.6 マニフェストが書き込まれる途中で中断

- 部分的に書かれた JSON は次回読み込み時に parse 失敗 → 空で初期化
- 対策: `tmp ファイル → rename` のアトミック書き込みパターンを使用（将来強化）

```ts
// 推奨
writeFileSync(path + '.tmp', JSON.stringify(manifest));
renameSync(path + '.tmp', path);
```

### 12.7 同時書き込み（2 デバイスで同時 push）

- 片方の書き込みが他方に上書きされる
- 頻度は低いが、ライトスルー直後 → 手動同期などのシナリオで発生
- iCloud の `NSFileCoordinator` で排他制御することで緩和可能

---

## 13. テストシナリオ

React Native で iOS 版を実装する際の受け入れテスト観点:

### 13.1 機能テスト

| # | シナリオ | 期待結果 |
|---|---|---|
| T-1 | プロバイダ選択で `iCloud` を選ぶ | Ubiquity Container が作成され、available=true で表示 |
| T-2 | ノート作成（iOS）→ Mac で確認 | 数秒〜数分後、Mac 側にノートが自動表示される |
| T-3 | Mac でノート編集 → iOS で表示 | 選択時の checkNote で pull が発生、最新内容が表示される |
| T-4 | 両方で編集（競合） | updatedAt が新しい方が残る |
| T-5 | ノート削除（iOS）→ Mac で確認 | 数秒〜数分後、Mac 側からも消える |
| T-6 | 画像貼付（Mac）→ iOS で表示 | 画像ファイルが iOS 側に同期され、プレビュー表示される |
| T-7 | 手動同期ボタン | 全ノートが双方向同期される |
| T-8 | ネットワーク切断中に編集 | 編集は保存されるが同期は失敗。復帰後に自動同期 |

### 13.2 エラーテスト

| # | シナリオ | 期待結果 |
|---|---|---|
| E-1 | iCloud を OS 設定で無効化 | プロバイダ一覧で "未検出" 表示 |
| E-2 | manifest.json を手動で破壊 | 空で初期化、次回同期で再構築 |
| E-3 | ディスク空き容量 0 | ユーザーにエラー表示、ローカル操作は継続 |
| E-4 | 不正なファイル名（`../../etc/passwd.md`）をクラウド側に作る | iOS 側で無視（パターン不一致） |
| E-5 | 巨大ノート（10MB） | 同期は成功するが時間がかかる可能性あり |

### 13.3 回帰テスト

| # | シナリオ | 期待結果 |
|---|---|---|
| R-1 | デスクトップ版 v0.1.7 で作ったデータを iOS で読み込み | 全ノートが正しく表示、編集可能 |
| R-2 | iOS で作ったデータを v0.1.7 で読み込み | 全ノートが正しく表示、編集可能 |

---

## 付録 A: 関連ファイル対応表

| 機能 | デスクトップ版ファイル | iOS 版での対応 |
|---|---|---|
| プロバイダ検出 | `electron/sync/cloudSync.ts: detectProviders` | `services/cloudProvider.ts: detectProviders` |
| 同期ルート取得 | `cloudSync.ts: getSyncRoot` | `services/cloudProvider.ts: getSyncRoot` |
| フル同期 | `cloudSync.ts: runSync` | `services/cloudSync.ts: runSync` |
| 単一チェック | `cloudSync.ts: checkAndSyncSingleNote` | `services/cloudSync.ts: checkAndSyncSingleNote` |
| ライトスルー | `cloudSync.ts: pushSingleNote / removeSingleNote / pushSingleMedia` | `services/cloudSync.ts` の同名関数 |
| マニフェスト I/O | `cloudSync.ts: loadManifest / saveManifest` | 同 |
| メディア同期 | `cloudSync.ts: syncMediaDir` | 同 |
| UI パネル | `src/components/PreferencesModal.tsx: SharePanel` | `screens/SettingsSync.tsx` |

---

## 付録 B: データフロー図

### フル同期

```
┌─────────┐       manifest.json       ┌──────────────┐
│         │◀───────── read ──────────│              │
│         │                           │              │
│  Local  │       notes/<id>.md       │    Cloud     │
│   DB    │◀─────── pull (copy) ──────│  (iCloud etc)│
│         │──────── push (copy) ─────▶│              │
│         │                           │              │
│         │       images/ + attachments/             │
│         │◀──────── sync ──────────▶│              │
└─────────┘                           └──────────────┘
     │                                       │
     │          lastSync = Date.now()        │
     └────────── manifest.json ─────────────▶│
                     (write back)
```

### ライトスルー（単一ノート）

```
UI mutation
   │
   ▼
Local DB (upsert)                ┌──────────────┐
   │                             │    Cloud     │
   ▼                             │              │
writeBody('notes/<id>.md')       │              │
   │                             │              │
   ▼                             │              │
pushSingleNote()  ──── copy ──▶ │  notes/<id>.md│
                                 │              │
                  update ──────▶│  manifest.json│
                                 └──────────────┘
```

---

**この仕様書は InkNel v0.1.7 時点の実装を基準としています。**
React Native で iOS 版を構築する際は、この文書の通りに `manifest.json` と `notes/<uuid>.md` 形式を守れば、既存のデスクトップ版と相互運用できます。プロトコル変更が必要になった場合は `manifest.version` を `2` に bump し、両プラットフォームで同時対応する方針で進めてください。
