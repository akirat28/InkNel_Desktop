# 進捗管理

各タスク完了の都度、対応するチェックボックスを `[x]` に更新する。

## フェーズ1: ウィンドウ + 編集 + プレビュー

- [x] ドキュメント作成（docs/仕様.md, docs/step.md）
- [x] プロジェクト初期化（package.json / .gitignore）
- [x] ビルド設定（electron.vite.config.ts / tsconfig.json / tsconfig.node.json）
- [x] Electron メインプロセス実装（electron/main.ts）
- [x] preload 実装（electron/preload.ts）
- [x] React エントリ + ルート（src/main.tsx, src/App.tsx, src/index.html）
- [x] TabBar コンポーネント実装
- [x] CodeMirror 6 エディタ実装（src/components/Editor.tsx）
- [x] markdown-it プレビュー実装（src/components/Preview.tsx）
- [x] グローバルスタイル（src/styles/global.css）
- [x] 依存インストール（npm install）
- [x] 動作確認（npm run dev でウィンドウ起動・編集・プレビュー）

> フェーズ1完了。`npm run dev` でElectronウィンドウが起動し、編集タブとプレビュータブの切替が動作することを確認済み。

## フェーズ1.5: 左サイドバー（ファイル一覧）+ 折りたたみ

- [x] 仕様書に左サイドバー仕様を追記
- [x] Sidebar コンポーネント実装（ファイル一覧プレースホルダ）
- [x] TopBar に折りたたみボタン `[☰]` 追加
- [x] App レイアウトを左右分割に変更
- [x] サイドバー開閉アニメーション
- [x] ビルド検証（npm run build）

> フェーズ1.5完了。左サイドバーが表示され、`☰` ボタンで開閉できる。ファイル一覧はフェーズ2でSQLite/ファイルシステム連携に置き換える予定。

## フェーズ1.6: ディレクトリ階層メタ情報 + ツリー表示

- [x] 仕様にディレクトリ階層メタ情報とツリー表示仕様を追記
- [x] FileItem 型に `folder` フィールドを追加
- [x] フラットリスト → ツリー変換ユーティリティ実装
- [x] Sidebar をツリー表示に更新（フォルダ展開/折りたたみ）
- [x] ビルド検証（npm run build）

> フェーズ1.6完了。ファイル一覧がディレクトリ階層風のツリー表示になり、フォルダの展開/折りたたみが可能。階層情報は各ファイルの `folder` メタ情報で管理し、実体ファイルはフラット保存される設計。

## フェーズ1.7: サイドバー幅リサイズ

- [x] 仕様にサイドバー幅リサイズを追記
- [x] ドラッグハンドル + リサイズ実装（min 160 / max 480）
- [x] ビルド検証（npm run build）

> フェーズ1.7完了。サイドバー右端をドラッグして幅を自由に調整できる。最小160px・最大480px、ドラッグ中はアニメーション無効・カーソルとテキスト選択を抑止。

## フェーズ1.8: アプリ名を InkNel に変更

- [x] package.json に productName を追加
- [x] main.ts で app.setName('InkNel') を whenReady より前に実行
- [x] Menu.buildFromTemplate で日本語アプリメニューを定義
- [x] **scripts/patch-electron-name.cjs** で `node_modules/electron/dist/Electron.app/Contents/Info.plist` の `CFBundleName` / `CFBundleDisplayName` を `InkNel` に書き換え
- [x] `postinstall` / `predev` フックで自動パッチ適用
- [x] ビルド検証 + 起動確認

> macOSのメニューバー左上のアプリ名は実行する `.app` バンドルの Info.plist から決まるため、`app.setName()` だけでは上書きできない。開発時は Electron.app の Info.plist を直接書き換える必要がある。本プロジェクトでは postinstall と predev で自動パッチを適用するようにした（依存再インストール時にも自動再適用される）。

## フェーズ1.9: 二重起動防止 + 設定メニュー

- [x] 仕様に二重起動防止と「設定」メニューを追記
- [x] 単一インスタンスロック（app.requestSingleInstanceLock）
- [x] InkNel メニュー「InkNel について」の下に「設定...」を追加（Cmd+,）
- [x] preload で onOpenPreferences ブリッジを公開
- [x] レンダラに簡易設定モーダルを実装
- [x] ビルド + 起動検証

> フェーズ1.9完了。二重起動を試みたインスタンスは即座に終了し、既存ウィンドウがフォーカスされる。InkNel メニュー → 「設定...」(`Cmd+,`) でレンダラの設定モーダルが開く。モーダルの中身は今後拡張するためのプレースホルダ。

## フェーズ2: SQLite + ローカル保存 + ファイル一覧 + タイトル管理

- [x] 仕様にフェーズ2詳細設計を追記
- [x] better-sqlite3 + @electron/rebuild 導入（postinstall でリビルド）
- [x] electron/db/ にスキーマ初期化 + CRUD 実装
- [x] electron/storage/ で notes ディレクトリへの .md 読み書き
- [x] electron/ipc.ts に IPCハンドラ登録
- [x] preload に notes API ブリッジ
- [x] global.d.ts に型定義
- [x] App.tsx で実DBから一覧取得・選択・編集・自動保存
- [x] Sidebar に「+ 新規」ボタン
- [x] NoteHeader（タイトル/フォルダ/削除）コンポーネント
- [x] 空状態UI
- [x] ビルド + 動作確認

> フェーズ2完了。SQLite (`~/Library/Application Support/InkNel/inknel.db`, WALモード) と `.md` ファイル (`notes/${id}.md`) でメタとボディを分離管理。IPC 経由で list/create/read/update/delete が可能。レンダラは300msデバウンスで自動保存し、ノート切替時には保留分をフラッシュする。新規/削除/タイトル&フォルダ編集まで動作確認済み。

## フェーズ2.1: 新規アイコン化 + 空フォルダ作成

- [x] 仕様に新規アイコンと folders テーブルを追記
- [x] folders テーブル + DB CRUD
- [x] folders:list / folders:create / folders:delete IPC
- [x] preload + global.d.ts に folders API
- [x] buildTree を extraFolders 対応に拡張
- [x] Sidebar ヘッダを 📄＋ / 📁＋ アイコン2つに変更
- [x] App.tsx に folders state と新規フォルダ作成
- [x] ビルド + 動作確認

> フェーズ2.1完了。サイドバーヘッダのテキストボタンを「新規ノート」「新規フォルダ」のSVGアイコンに置き換えた。空フォルダは SQLite の `folders` テーブルで永続化し、ノートが入っていなくてもツリーに表示される。`buildTree` は extraFolders 引数で空フォルダを受け取り、ノートのfolderと統合してツリーを構築する。

## フェーズ2.2: VS Code風アクティビティバー

- [x] 仕様にアクティビティバーを追記
- [x] ActivityBar コンポーネント（プレビュー/編集/検索/設定 SVGアイコン）
- [x] SearchView プレースホルダ
- [x] App.tsx を3カラムレイアウトに変更（TabBar削除）
- [x] アクティブアイコン再クリックでサイドバートグル
- [x] CSS（activity-bar スタイル）
- [x] TabBar.tsx 削除
- [x] ビルド + 動作確認

> フェーズ2.2完了。画面左端に幅48pxのActivityBarを配置。上から「プレビュー/編集/検索」、最下部に「設定」のSVGアイコンが並ぶ。アクティブアイコンは左端に accent カラーのバーで示し、同じアイコンを再クリックするとサイドバーをトグル（VS Code 同様）。設定アイコンはビュー切替せずに設定モーダルを開く。

## フェーズ2.3: 編集ツールバー（マークダウン挿入ボタン）

- [x] 仕様に編集ツールバーを追記
- [x] Editor を forwardRef + useImperativeHandle で insert/wrap/prefixLine/focus を公開
- [x] EditorToolbar コンポーネント（見出し/強調/リスト/挿入ボタン群）
- [x] App.tsx で編集ビュー時のみツールバー表示、Editor に ref 連結
- [x] CSS（toolbar スタイル）
- [x] ビルド + 起動確認

> フェーズ2.3完了。編集ビュー時のみ NoteHeader と Editor の間にマークダウン挿入ツールバーを表示。Editor は forwardRef で `insert`/`wrap`/`prefixLine`/`focus` を公開し、ツールバーが ref 経由で呼び出す。ボタンの mousedown では preventDefault でフォーカスを保持し、wrap は選択がある場合は囲み・無い場合はプレースホルダを選択状態で挿入する。

## フェーズ2.4: ActivityBar整理 + ツールバーに表示/編集トグル

- [x] 仕様にツールバートグルとActivityBar整理を追記
- [x] ActivityBarからプレビュー/編集を削除（検索と設定のみ）
- [x] EditorToolbarをedit/preview両方で表示、右端にトグルボタン
- [x] App.tsxでlastNoteView保持、検索からのファイルクリックで復帰
- [x] CSS（spacerとtoggle）
- [x] ビルド + 起動確認

> フェーズ2.4完了。ActivityBar は検索と設定の2つだけになり、編集/プレビューの切替は編集ツールバー右端のトグルボタンに移動。プレビュービュー時は挿入ボタンが消えてトグルだけが残る。検索ビュー中にファイル一覧のメモをクリックすると `lastNoteView` を参照して直前の編集/プレビュービューに復帰する。

## フェーズ2.5: ActivityBar にファイルアイコン追加

- [x] 仕様にファイルアイコンを追記
- [x] ActivityBar に最上部のファイルアイコン追加
- [x] App.tsx に handleSelectFiles ハンドラ追加
- [x] ビルド + 起動確認

> フェーズ2.5完了。アクティビティバー最上部にファイル（ノート表示）アイコンを追加。`view==='edit' || view==='preview'` の時にアクティブ表示。検索ビューからファイルアイコンをクリックすると `lastNoteView` を参照して直前の編集/プレビュービューに復帰する。すでにノートビュー中にファイルアイコンを再クリックするとサイドバーをトグル（VS Code 同等）。

## フェーズ2.6: 設定モーダル2ペイン化 + 基本設定

- [x] 仕様に設定2ペインと基本カテゴリを追記
- [x] SQLite settings テーブル + DB CRUD
- [x] settings:getAll / settings:set IPC + preload
- [x] PreferencesModal を2ペインに改修（左カテゴリ「基本」+ 右詳細）
- [x] 「編集ボタンの表示」トグル
- [x] App.tsx で settings 読込・保存・EditorToolbar に渡す
- [x] EditorToolbar の挿入ボタン表示制御
- [x] CSS（2ペイン + トグルスイッチ）
- [x] ビルド + 起動確認

> フェーズ2.6完了。設定モーダルを 720×480 の2ペイン構成に変更し、左カテゴリ「基本」、右詳細フォームに「編集ボタンの表示」トグルを実装。SQLite に `settings` テーブル（key/value）を追加し、`editor.showInsertButtons` を保存。EditorToolbar は `showInsertButtons` prop を受けて挿入ボタン群の表示を制御し、オフにすると右端の表示/編集トグルだけが残る。設定値はアプリ起動時に `settings:getAll` で読み込まれ、未設定キーは既定値が適用される。

## フェーズ2.7: NoteHeaderから削除ボタン撤去 + 表示/編集トグル移動

- [x] 仕様/step.md更新
- [x] NoteHeaderから削除ボタンを撤去
- [x] NoteHeader右端に edit/view セグメントトグル追加
- [x] EditorToolbarからトグル/spacerを撤去（挿入ボタンのみに）
- [x] App.tsxからhandleDelete撤去、props更新
- [x] CSS更新
- [x] ビルド + 起動確認

> フェーズ2.7完了。NoteHeaderから削除ボタンを撤去し、その位置に編集/プレビューのセグメントトグル（2 アイコン横並び）を配置。EditorToolbar はマークダウン挿入ボタン専用となり、`view === 'edit' && settings.showInsertButtons` の時のみ表示。App.tsx の `handleDelete` も削除（再追加が必要なら別途UIを設ける予定）。

## フェーズ2.8: ファイル行のkebabメニュー（削除）

- [x] 仕様にファイル行コンテキストメニューを追記
- [x] ContextMenu コンポーネント新規（portal + click outside）
- [x] Sidebarのファイル行にkebab(⋮)ボタン追加（hover時のみ表示）
- [x] kebabクリックで削除メニュー表示
- [x] App.tsxにhandleDeleteNote(id)を再追加
- [x] CSS（kebab + ctx-menu）
- [x] ビルド + 起動確認

> フェーズ2.8完了。Sidebarのファイル行にホバー時のみ表示される縦三点リーダー（⋮）ボタンを追加。クリックで `ContextMenu`（react-dom portal で document.body に描画）が開き、「削除」項目を提供。`mousedown` でメニュー外クリックを検知し、Escape でも閉じる。削除実行時は確認ダイアログを出し、現在編集中のノートを削除した場合は次のノートを自動選択する。

## フェーズ2.9: テーマ設定（ダーク/ライト）

- [x] 仕様にテーマ項目を追記
- [x] settings.ts に theme フィールド追加
- [x] PreferencesModal の基本タブ最上部にテーマ選択（セグメント）追加
- [x] CodeMirror Editor を Compartment でテーマ動的切替
- [x] App.tsx で document.documentElement に data-theme 属性を設定
- [x] CSS: [data-theme="light"] 変数追加 + ハードコード色のテーマ化
- [x] ビルド + 起動確認

> フェーズ2.9完了。設定 → 基本の最上部に「テーマ」セグメント（ダーク/ライト）を追加。`appearance.theme` キーで SQLite に永続化。CSS 変数（`--bg`, `--fg`, `--accent`, `--hover`, `--shadow` 等）で配色を統一し、`[data-theme="light"]` セレクタで上書き。ハードコードされていた `rgba(255,255,255,...)` などの色を全て CSS 変数に置換。CodeMirror は `Compartment` で `oneDark` を動的に reconfigure し、ライト時はテーマ未適用（白背景）になる。

## フェーズ2.10: ノート保護 + メニューUI改善

- [x] 仕様にprotectedカラムと保護機能を追記
- [x] notes テーブルに protected カラム追加 + マイグレーション
- [x] DB CRUD 拡張（setProtected）+ delete 時の保護チェック
- [x] notes:set-protected IPC + preload
- [x] global.d.ts 更新
- [x] ContextMenu に icon prop と disabled 状態を追加
- [x] Sidebar kebabメニュー: 保護/削除 2項目、アイコン付き
- [x] App.tsx に handleToggleProtect、削除前の保護チェック
- [x] CSS: 三角ポインタ付きの右側ポップアップ、アイコン余白
- [x] ビルド + 起動確認

> フェーズ2.10完了。`notes` テーブルに `protected` カラムを追加（マイグレーションは PRAGMA で既存カラム確認後に ALTER TABLE）。サイドバーの kebab メニューを「保護 / 保護解除」（🔒/🔓 アイコン）と「削除」（🗑 アイコン）の2項目に拡張し、保護中は削除がグレーアウト。メニューは kebab ボタンの右側に表示され、左端に CSS の擬似要素で吹き出しの三角ポインタを描画。メインプロセス側でも保護中ノートの削除は Error を返してダブルセーフ。

## フェーズ2.11: 保護パスワード + 編集ロック

- [x] 仕様に保護カテゴリ・パスワード・編集ロック挙動を追記
- [x] settings.ts に protectionPassword（既定値 '1234'）追加
- [x] PreferencesModal に「保護」カテゴリ追加（基本の下）
- [x] PasswordDialog コンポーネント新規
- [x] App.tsx に unlockedNoteId、保護トグルでビュー強制切替
- [x] 編集トグルクリック時のパスワードダイアログ
- [x] CSS（PasswordDialog + 保護パネル）
- [x] ビルド + 起動確認

> フェーズ2.11完了。設定モーダルの基本の下に「保護」カテゴリを追加し、4桁パスワード（既定値 '1234'）を `protection.password` キーで保存。ノートを保護すると編集ビューに直接入れなくなり、NoteHeader の編集トグル → PasswordDialog → 正解で解錠 + 編集ビューへ遷移、誤りでエラー表示。保護をかけた瞬間に編集ビューだった場合はプレビューに強制切替。別ファイルを選択した瞬間に解錠はリセット。`unlockedNoteId` で activeId ごとのセッションロック状態を管理。

## フェーズ2.12: 保護中ファイルに錠前アイコン表示

- [x] 仕様を更新
- [x] Sidebarファイル行に錠前アイコン（is-protected時のみ）
- [x] CSS: lock-icon位置と padding-right 調整
- [x] ビルド + 起動確認

> フェーズ2.12完了。保護中のファイル行右端（kebab ボタンの左隣）に小さな錠前アイコンを常時表示。`tree__file-li.is-protected` クラスで padding-right を 46px に拡張し、`.tree__lock-indicator` を `position: absolute; right: 26px` で配置。アクティブなファイルではアクセントカラーに追従する。

## フェーズ2.13: パスワード欄のマスク表示 + 初期パスワード案内

- [x] 設定画面のパスワード入力欄を `type="password"` でマスク
- [x] 保存済みパスワードが既定値のままなら「初期パスワード: 1234」を表示
- [x] パスワード変更後は案内を非表示

> フェーズ2.13完了。設定 → 保護 のパスワード入力欄を `type="password"` に変更して `••••` 表示に。現在の保存済みパスワードが `DEFAULT_SETTINGS.protectionPassword` (`'1234'`) と一致する場合のみ、説明文の下に小さく「初期パスワード: 1234」のヒントを表示。パスワードが変更されるとこの案内は自動的に非表示になる。

## フェーズ2.14: 検索機能（サイドバー2モード化）

- [x] 仕様を更新（サイドバーモード、検索IPC）
- [x] notes:search IPC実装（タイトルLIKE + 本文ファイル走査）
- [x] preload + global.d.ts に search API
- [x] SearchPanel コンポーネント新規（入力 + ボタン + 結果リスト）
- [x] Sidebar を mode prop で2モード対応
- [x] App.tsx を sidebarMode モデルに移行（view='search'を撤去）
- [x] ActivityBar のアクティブ判定を sidebarMode に変更
- [x] SearchView.tsx 削除
- [x] CSS（SearchPanel）
- [x] ビルド + 起動確認

> フェーズ2.14完了。ActivityBar の検索アイコンを押すとサイドバーが「ファイル」モードから「検索」モードに切り替わるようになった。検索モードでは入力欄 + 検索ボタンが表示され、Enterキーまたはボタン押下で `notes:search` IPC を呼ぶ。検索はタイトル一致を優先し、続けて本文ファイル（`.md`）を走査して本文一致を追加。結果リストはタイトル + フォルダパス表示で、保護中なら錠前アイコン付き。クリックで通常の selectNote と同じ流れでメイン領域に表示される（保護中ならプレビュー強制）。`view='search'` は撤去し、メイン領域は常に edit/preview のいずれか。

## フェーズ2.15: 検索履歴 + 履歴ナビゲーション

- [x] 仕様/step.md更新
- [x] settings.ts に searchHistoryMode + searchHistoryLimit
- [x] PreferencesModal 基本に2セレクト追加
- [x] SearchPanel に上下矢印で履歴ナビゲーション
- [x] App.tsx に検索履歴state + 永続化
- [x] CSS（select）
- [x] ビルド + 起動確認

> フェーズ2.15完了。検索入力欄で `↑`/`↓` キーで過去のキーワード履歴をたどれるように実装。`historyIndex` と `draftRef` でドラフト保持、入力中の文字列は ↓ で先頭まで戻ったとき復元される。設定→基本に2つのセレクトを追加: 「検索履歴の保存」（reset/persist）と「検索履歴の件数」（100/1000）。`reset` モードはメモリのみ、`persist` モードでは SQLite の `settings` テーブルに `search.history` キーで JSON 配列として保存。件数を縮小すると即座にプルーン、保存方式を reset → persist に変えると現状のメモリ履歴がDBに反映される。

## フェーズ2.16: ウィンドウとサイドバー幅の永続化

- [x] 仕様/step.md更新
- [x] main.tsでウィンドウ位置/サイズの保存・復元
- [x] settings.tsにsidebarWidth追加
- [x] App.tsxでサイドバー幅の読込/保存
- [x] ビルド + 起動確認

> フェーズ2.16完了。`electron/main.ts` で BrowserWindow の resize/move/maximize/unmaximize/close を購読し、300msデバウンスで `window.bounds` と `window.maximized` を SQLite settings に保存。起動時は `loadWindowBounds()` で復元（範囲外チェック付き、既定 1200x800 にフォールバック）。サイドバー幅は `ui.sidebarWidth` キーで保存し、`handleSidebarResize` でドラッグ時のみ300msデバウンス保存（マウント時の初期値では発火しない）。再起動後にウィンドウサイズと最大化状態、サイドバー幅が完全に復元される。

## フェーズ2.17: 画像のドラッグ&ドロップ

- [x] 仕様/step.md更新
- [x] electron/storage/imagesFiles.ts 新規（SHA-256命名 + dedupe）
- [x] electron/protocol/inknelImage.ts 新規（カスタムプロトコル）
- [x] main.ts にプロトコル組み込み
- [x] ipc.ts に images:save / images:exists 追加
- [x] preload.ts + global.d.ts に images API
- [x] index.html の CSP に inknel-image: 追加
- [x] Preview.tsx の rules.image オーバーライド
- [x] Editor.tsx に drop ハンドラ追加
- [x] CSS（is-dragover オーバーレイ）
- [x] ビルド + 起動確認

> フェーズ2.17完了。エディタへの画像ドラッグ&ドロップを実装。`userData/images/<sha256>.<ext>` にコンテンツアドレスで保存（自動 dedupe）、マークダウンには相対パス `![...](images/<filename>)` を挿入。プレビュー描画時は markdown-it の `renderer.rules.image` で `inknel-image://<filename>` に書き換え、メインプロセス側で登録した `protocol.handle('inknel-image')` が `userData/images/` 配下のファイルを返す。プロトコル特権登録は `app.whenReady` より前で実施。CSP の `img-src` に `inknel-image:` を追加。25MB 上限、許可拡張子 allowlist、ファイル名 sanitize（`/^[a-f0-9]{64}\.[a-z0-9]{2,5}$/`）でセキュリティ確保。

## フェーズ2.18: 画像の表示サイズ制限

- [x] 仕様/step.md更新
- [x] .preview img のCSS追加（max-width 1200px / max-height 500px / アスペクト比保持）
- [x] ビルド + 起動確認

> フェーズ2.18完了。`.preview img` に `max-width: min(1200px, 100%); max-height: 500px; width: auto; height: auto;` を設定し、アスペクト比を保ったまま表示サイズを制限。実ファイルはオリジナルサイズで `userData/images/` に保存され、リサイズはしない。表示サイズより小さい画像は実寸表示される。

## フェーズ2.19: 画像クリックで拡大表示（ライトボックス）

- [x] 仕様/step.md更新
- [x] Preview.tsx にライトボックス実装（画像クリック→拡大、Escape/背景クリックで閉じる）
- [x] CSS（lightbox + zoom-in カーソル）
- [x] ビルド + 起動確認

> フェーズ2.19完了。Preview にイベント委譲で `<img>` クリックを検知し、`createPortal` で `document.body` にライトボックスをレンダ。`max-width: 95vw / max-height: 95vh` でビューポートに収まる範囲で拡大表示。背景クリック / 右上の `×` ボタン / Escape キーで閉じる。画像本体クリックは `stopPropagation` で誤閉じを防止。`.preview img` に `cursor: zoom-in` を付与してクリック可能であることを示す。

## フェーズ2.20: 添付ファイル（PDF/ZIP/LZH/7z）対応

- [x] 仕様/step.md更新
- [x] electron/storage/attachmentsFiles.ts 新規
- [x] ipc.ts に attachments:save / attachments:open / shell:open-external
- [x] preload + global.d.ts に attachments / shell API
- [x] Editor drop ハンドラを画像/添付の振り分けに拡張
- [x] Preview に添付リンクと外部URLのクリックハンドラ
- [x] CSS（添付リンクの 📎 アイコン）
- [x] ビルド + 起動確認

> フェーズ2.20完了。PDF / ZIP / LZH / LHA / 7z をエディタにドラッグ&ドロップして `userData/attachments/<sha256>.<ext>` に保存（dedupe）、マークダウンには `[名前](attachments/<filename>)` のリンクとして挿入。プレビューでは 📎 アイコン付きで表示し、クリックで `shell.openPath` 経由で OS の既定アプリで開く。`shell.openExternal` IPC も追加して、http(s) リンクを既定ブラウザで開けるようにし、レンダラ内遷移を防止。Editor は `classifyFile` で画像/添付/不明を振り分け、画像なら `images.save`、添付なら `attachments.save` を呼ぶ。サイズ上限は画像25MB / 添付100MB。

## フェーズ2.21: PDF サムネイル自動生成

- [x] 仕様/step.md更新
- [x] pdfjs-dist 依存追加 + npm install
- [x] CSP に worker-src 'self' blob: を追加
- [x] src/utils/pdfThumbnail.ts 作成
- [x] Editor の drop ハンドラを PDF サムネイル対応に拡張
- [x] Preview のクリックハンドラ調整（アンカー判定先行）
- [x] CSS（サムネイル付き添付リンク、📎の出し分け）
- [x] ビルド + 起動確認

> フェーズ2.21完了。pdfjs-dist (^4.7.76) を依存追加し、`src/utils/pdfThumbnail.ts` で PDF バイナリ → 1ページ目を canvas にレンダリング → PNG ArrayBuffer に変換するユーティリティを実装。Vite の `?url` インポートで `pdf.worker.min.mjs` を独立アセットとしてバンドルし、`GlobalWorkerOptions.workerSrc` に設定。CSP には `worker-src 'self' blob:` を追加。Editor の drop ハンドラは PDF を検知すると `images.save` でサムネイルも保存し、`[![alt](images/<thumb>)](attachments/<pdf>)` のネスト記法を挿入。サムネイル生成失敗時は通常リンクにフォールバック。Preview の click ハンドラはアンカー判定を画像判定より先に行うよう順序を入れ替え、サムネイル画像クリックでもライトボックスではなく PDF を開くように修正。CSS は `:has(img)` セレクタでサムネイル付きリンクとテキストリンクのスタイルを出し分け、サムネ画像にはホバー時のアクセントボーダーを付与。

## フェーズ2.22: テーブル挿入ボタン

- [x] 仕様/step.md更新
- [x] EditorToolbarにテーブル挿入ボタン追加（TableIcon + 3列×2行雛形）
- [x] ビルド + 起動確認

> フェーズ2.22完了。EditorToolbar の「挿入」グループ末尾にテーブル挿入ボタンを追加。クリックで `[insert()](EditorHandle)` 経由で `\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n` を現在のカーソル位置に挿入。先頭に `\n` を入れて、行の途中で押しても直前のテキストとマージしない。アイコンは既存の SVG スタイル（14×14、stroke 1.4、currentColor）に揃えた行/列の線画。markdown-it のテーブルパーサーは既定で有効、CSS の `.preview table / th / td` も既存スタイルでそのまま描画される。

## フェーズ2.23: 未参照メディアの自動GC

- [x] 仕様/step.md更新
- [x] imagesFiles / attachmentsFiles に delete関数追加
- [x] ipc.ts に media:gc ハンドラ追加
- [x] preload + global.d.ts に media API
- [x] src/utils/mediaRefs.ts 新規（参照抽出）
- [x] App.tsx でセッショントラッキング + 編集→プレビュー時のGC呼び出し
- [x] ビルド + 起動確認

> フェーズ2.23完了。編集→プレビュー切替時に未参照メディア（画像 + 添付）を自動削除する GC を実装。アクティブノートを開いた瞬間の参照と編集中に追加された参照を `sessionImagesRef` / `sessionAttachmentsRef` で蓄積し、現在の本文との差分を削除候補とする。`media:gc` IPC は全ノートを走査して dedupe された他ノートからの参照がないことを確認してから削除するため、複数ノートで共有されている画像は安全に保持される。手書きの相対パスは正規表現が SHA-256 ハッシュにのみマッチするため誤削除されない。Undo は GC 後には効かない仕様（仕様書に注意書き）。

## フェーズ2.24: prefixLine のカーソル位置を prefix 末尾に

- [x] Editor.prefixLine: 単一行時はカーソルを `startLine.from + prefix.length` に明示
- [x] step.md更新
- [x] ビルド + 起動確認

> フェーズ2.24完了。H1/H2/H3、リスト、引用などの行頭 prefix 挿入後、カーソルが `# ` の前に残ってしまう問題を修正。`view.dispatch` に `selection: { anchor: startLine.from + prefix.length }` を明示的に渡し、prefix 直後にカーソルを置くようにした。複数行選択時は CodeMirror デフォルトの選択範囲マッピングを尊重して既存の挙動を維持。

## フェーズ2.25: H4-H6追加 + テーブルサイズピッカー

- [x] 仕様/step.md更新
- [x] TablePicker コンポーネント新規（吹き出し + 8×8 グリッド）
- [x] EditorToolbar に H4 / H5 / H6 を追加
- [x] テーブルボタンを TablePicker 起動に変更
- [x] CSS（table-picker + 上向き三角ポインタ）
- [x] ビルド + 起動確認

> フェーズ2.25完了。EditorToolbar の見出しグループに H4 / H5 / H6 を追加（合計6ボタン）。テーブルボタンは固定サイズ挿入から、Word 風の **TablePicker**（吹き出し型ポップアップ）に変更。`createPortal` で document.body にレンダされ、CSS の `::before` / `::after` 二重三角でテーブルボタン真下に上向き三角ポインタを描画。8×8 の小グリッドにマウスオーバーで左上から現在位置までのセルが accent カラーでハイライト、ラベルが「N 行 × M 列」を表示。クリックで `buildTableMarkdown(rows, cols)` の雛形（ヘッダ行 + 区切り + データ行）を `insert()` で挿入してピッカーを閉じる。外側クリック / Escape でも閉じる。`ToolBtn` の `onClick` 型を `(e: React.MouseEvent<HTMLButtonElement>) => void` に拡張し、ボタン要素の `getBoundingClientRect()` でピッカーの表示位置を決定。

## フェーズ2.26: NoteHeaderをパス入力欄にマージ

- [x] 仕様/step.md更新
- [x] src/utils/notePath.ts 新規（parsePath / buildPath）
- [x] NoteHeader を 1 入力欄にマージ
- [x] App.tsx に handleNameChange 追加
- [x] CSS（.note-header__name）
- [x] ビルド + 起動確認

> フェーズ2.26完了。NoteHeader のタイトル入力とフォルダ入力を1つの「ファイル名（パス形式）」入力欄にマージ。`src/utils/notePath.ts` の `parsePath()` で最後の `/` を境に folder と title に分割、`buildPath()` で逆変換。データモデル（`notes.title` / `notes.folder`）は変更なし、UI 層の変更のみで完結。`buildTree` は既にスラッシュ区切りの folder で階層化済みのため、サイドバーの表示挙動は自動的に追従。連続スラッシュは正規化、末尾スラッシュ入力中も buildPath で同じ文字列が再構築されるため入力体験が崩れない。

## フェーズ2.27: ファイル一覧のドラッグ&ドロップでフォルダ移動

- [x] 仕様/step.md更新
- [x] Sidebarにドラッグ&ドロップハンドラ実装
- [x] App.tsxにhandleMoveNote追加
- [x] CSS（folder is-dragover）
- [x] ビルド + 起動確認

> フェーズ2.27完了。ファイルツリーで `<button class="tree__file" draggable>` をドラッグできるようにし、`dataTransfer.setData('application/x-inknel-note-id', noteId)` で ID を伝達。フォルダ行に `dragover` / `dragleave` / `drop` ハンドラを追加し、カスタム MIME タイプを検出した場合のみドロップ受け入れ。`dragOverFolder` ステートで現在ホバー中のフォルダパスを管理し、`is-dragover` クラスで accent カラーの背景 + 点線アウトラインを表示。App.tsx の `handleMoveNote(noteId, targetFolder)` で `notes.updateMeta` を呼んで folder を更新し、アクティブノート移動時は `flushPendingSaves` で保留分をフラッシュ + `editingFolder` を同期。同一フォルダへのドロップは早期リターン（no-op）。

## フェーズ2.28: ツリー行の先頭にフォルダ/ファイルアイコン

- [x] 仕様/step.md更新
- [x] Sidebar TreeView にアイコン追加 (FolderItemIcon / FileItemIcon)
- [x] CSS（.tree__icon、ファイル行のインデント調整）
- [x] ビルド + 起動確認

> フェーズ2.28完了。Sidebar の TreeView でフォルダ行に **FolderItemIcon**、ファイル行に **FileItemIcon** を行先頭に追加。アイコンは 14×14 SVG（NewFolderIcon / NewFileIcon から `+` パスを除いたもの）で `currentColor` 描画。ファイル行の `paddingLeft` を `+14` から `+16` に変更してチェブロン位置をスキップし、フォルダアイコンとファイルアイコンの x 座標が揃うように調整。`.tree__file.is-active` 時はアイコンも accent カラーに追従、ドラッグオーバー中のフォルダもアイコンが accent 色になる。

## フェーズ2.29: ケバブメニューに名称変更 + RenameDialog

- [x] 仕様/step.md更新
- [x] RenameDialog コンポーネント新規
- [x] Sidebar の kebab メニューに「名称変更」追加 + RenameIcon
- [x] App.tsx に handleStartRename / handleRenameSubmit
- [x] CSS（.modal--rename, .rename-body）
- [x] ビルド + 起動確認

> フェーズ2.29完了。Sidebar の kebab メニュー先頭に **名称変更** を追加（RenameIcon = 鉛筆）。クリックで RenameDialog（440px幅、PreferencesModal の `.modal__backdrop` スタイルを再利用）が開き、現在のファイル名（`buildPath(folder, title)` でパス形式化）が入力欄にプリセット + 全選択。Enter で送信、Escape で閉じる、空名は disabled。送信時は `parsePath` でパスを folder/title に分解して `notes.updateMeta` で保存。アクティブノートを名称変更する場合は `flushPendingSaves` で保留分をフラッシュ + `editingTitle/editingFolder` を同期。

## フェーズ2.30: フォルダのケバブメニューと一括名称変更

- [x] 仕様/step.md更新
- [x] db/folders.ts に renameFolder（トランザクション）追加
- [x] folders:rename IPC + preload + 型
- [x] Sidebarのフォルダ行にケバブとメニュー追加
- [x] App.tsxに handleStartRenameFolder + RenameDialog state を共通化
- [x] CSS（tree__row-wrap）
- [x] ビルド + 起動確認

> フェーズ2.30完了。フォルダ行にもケバブメニューを追加し、「名称変更」のみのコンテキストメニューを表示。`renameFolder(oldPath, newPath)` を `db/folders.ts` に実装し、SQLite トランザクションで notes（完全一致 + プレフィックス一致）と folders（完全一致 + プレフィックス一致）を一括更新。`folders:rename` IPC ハンドラと preload + 型も追加。Sidebar の menuState を `{ kind: 'file' | 'folder', ... }` のユニオン型にリファクタし、ContextMenu items を kind で分岐。App.tsx の renameTarget も同様にユニオン型化、folder kind は leaf 名のみダイアログで編集できるよう `parent` を分離して保持。フォルダ行は内側 `.tree__row-wrap` でラップして position: relative を作り、`:hover` で kebab を表示。

## フェーズ2.31: 編集ツールバーにアイコンピッカー

- [x] 仕様/step.md更新
- [x] IconPicker コンポーネント新規（カテゴリタブ + 絵文字グリッド）
- [x] EditorToolbarにアイコンボタン追加 + ピッカー連携
- [x] CSS（icon-picker）
- [x] ビルド + 起動確認

> フェーズ2.31完了。EditorToolbar の挿入グループ末尾にスマイリーアイコンの「アイコン」ボタンを追加。クリックで `IconPicker`（吹き出し型ポップアップ、createPortal で document.body にレンダ、上向き三角ポインタ付き）が開く。9つのカテゴリ（状態 / 文書 / 記号 / 顔 / 手 / 矢印 / 動物 / 食事 / 旅行）× 16絵文字 = 計144個。タブはカテゴリ代表絵文字を使い、`title` 属性でカテゴリ名のツールチップ表示。8列グリッドで絵文字を表示し、クリックで `insert(icon)` を呼んで現在のカーソル位置に挿入してピッカーを閉じる。外側クリック / Escape でも閉じる。挿入された絵文字は Unicode 文字列なのでマークダウンとしてそのまま保存・描画される。

## フェーズ3: 全文検索

未着手。SQLite FTS5 を使用する想定。

## フェーズ4: クラウド/ネットワーク保存先

未着手。iCloud / Google Drive / SMB などへのアダプタを設計。

## フェーズ5: スマートフォン同期

未着手。プロトコル選定から。
