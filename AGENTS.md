# AGENTS.md

## プロジェクト概要

InkNel は Electron 32、React 18、TypeScript で実装されたローカルファーストの Markdown ノートアプリです。macOS を主対象としつつ、Windows 向けビルドにも配慮しています。

- Renderer: React、CodeMirror 6、markdown-it
- Main process: Electron、Node.js
- 永続化: SQLite (`better-sqlite3`) と YAML front-matter 付き Markdown
- ビルド: electron-vite、electron-builder
- テスト: Vitest

## 主要ファイル

- `src/App.tsx`: Renderer 全体の状態管理と画面構成
- `src/components/`: UI コンポーネント
- `src/settings.ts`: 設定型、既定値、DB レコードとの変換
- `src/plugins/`: バンドル／ランタイムプラグイン
- `electron/main.ts`: ウィンドウ、メニュー、アプリライフサイクル
- `electron/preload.ts`: `contextBridge` で Renderer に公開する API
- `electron/ipc.ts`: IPC ハンドラと Main 側ユースケース
- `electron/db/`: SQLite スキーマとクエリ
- `electron/storage/`: Markdown、画像、添付、バックアップのファイル操作
- `electron/sync/`: 共有プロバイダー同期
- `tests/`: DB、ストレージ、同期、設定などのテスト

## アーキテクチャ上の前提

Renderer から Node.js API やファイルシステムを直接操作しないでください。処理は次の境界を維持します。

```text
React Renderer
  -> window.api (preload/contextBridge)
  -> IPC
  -> Electron Main
  -> SQLite / filesystem / network
```

IPC を追加・変更するときは、原則として次を同時に更新してください。

1. `electron/ipc.ts` のハンドラ
2. `electron/preload.ts` の公開 API
3. `src/global.d.ts` の型定義
4. 呼び出し元と関連テスト

## データ管理の重要事項

- ノート ID は UUID とし、ファイル名入力には必ず既存の検証処理を通します。
- SQLite は各端末のローカルキャッシュ兼検索インデックスです。
- 共有可能なノート実体は `<storage-root>/notes/<uuid>.md` です。
- Markdown の front-matter にはタイトル、仮想フォルダ、タグ、保護状態、リンク、更新日時などを保持します。
- 本文更新時は SQLite の本文キャッシュと Markdown ファイルの整合性を維持します。
- 削除同期には tombstone を使用します。単純なファイル削除へ置き換えると、別端末でノートが復活する可能性があります。
- 画像と添付ファイルは SHA-256 名で重複排除します。パストラバーサル防止の検証を迂回しないでください。
- フォルダはファイルシステム上のディレクトリではなく、ノートメタデータ上の仮想階層です。

## UI 実装方針

- macOS のネイティブメニュー、キーボードショートカット、コンテキストメニューを維持します。
- ライト／ダーク両テーマを確認し、既存の CSS 変数を優先します。
- マウス操作だけでなく、キーボード操作とアクセシビリティラベルも考慮します。
- 設定値を追加するときは `AppSettings`、`DEFAULT_SETTINGS`、`parseSettings`、`settingToRecord` の対応を揃えます。
- `src/App.tsx`、`src/components/PreferencesModal.tsx`、`electron/ipc.ts` は特に大きいため、無関係な整形や広範囲の書き換えを避けます。

## セキュリティ

- `contextIsolation: true` と `nodeIntegration: false` を維持します。
- 外部 URL は Main process で検証し、OS の既定ブラウザへ渡します。
- Renderer から渡る値を信頼せず、Main process 側でも ID、パス、URL、ファイルサイズを検証します。
- CSP やカスタムプロトコルの許可範囲を安易に広げないでください。
- AI トークンなどの秘密情報をログ、テスト fixture、リポジトリへ書き込みません。
- ランタイムプラグインは実行可能コードです。読み込み経路とファイル名検証を維持してください。

## 開発コマンド

```bash
npm install
npm run dev
npm run build
npx tsc --noEmit
npm test
```

`better-sqlite3` はネイティブモジュールです。現在の依存バージョンは Node.js 26 でホスト向けリビルドに失敗するため、テストには Node.js 22 を使用してください。この環境では次の形式で実行できます。

```bash
PATH=/Users/akira/.asdf/installs/nodejs/22.23.1/bin:$PATH npm test
```

`npm test` は一時的に `better-sqlite3` をホスト Node.js 向けにリビルドし、終了時に Electron 向けへ戻します。途中で失敗して復元されなかった場合は、Node.js 22 で次を実行します。

```bash
PATH=/Users/akira/.asdf/installs/nodejs/22.23.1/bin:$PATH npx electron-rebuild -f -w better-sqlite3
```

## 検証方針

- 小さな変更でも最低限 `npx tsc --noEmit` と関連テストを実行します。
- Renderer、IPC、ビルド設定に関わる変更では `npm run build` も実行します。
- DB、front-matter、同期、削除処理の変更には回帰テストを追加します。
- UI 変更ではメインウィンドウと設定ウィンドウ、ライト／ダーク、狭いウィンドウ幅を確認します。
- 作業後に `git status --short` を確認し、生成物や無関係な変更を含めません。

## 現行実装と古い文書の差異

- パッケージの現行バージョンは `0.8.0` です。README 内には古い配布バージョン表記が残っています。
- 仕様書には FTS5 とありますが、現在の検索実装は SQLite の `LIKE` 検索です。
- 保存先フォルダ同期と、旧来のプロバイダー別共有同期が併存しています。片方を変更するときも他方への影響を確認してください。
- 不明点がある場合は、文書より現在のコードとテストを優先して判断し、仕様変更が必要なら文書も更新してください。
