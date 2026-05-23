/**
 * preload (electron/preload.ts) で contextBridge 経由公開される API の型。
 */

import type { NoteMeta } from '../electron/db/notes';

export type { NoteMeta };

export interface NotesApi {
  list(): Promise<NoteMeta[]>;
  create(input: {
    title?: string;
    folder?: string;
    body?: string;
  }): Promise<NoteMeta>;
  readBody(id: string): Promise<string>;
  updateMeta(
    id: string,
    patch: { title?: string; folder?: string; tags?: string[] },
  ): Promise<NoteMeta>;
  updateBody(id: string, body: string): Promise<void>;
  setProtected(id: string, isProtected: boolean): Promise<NoteMeta>;
  setSecret(id: string, isSecret: boolean): Promise<NoteMeta>;
  addLink(id: string, linkedNoteId: string): Promise<NoteMeta>;
  removeLink(id: string, linkedNoteId: string): Promise<NoteMeta>;
  search(query: string): Promise<NoteMeta[]>;
  /** 全ノートをスキャンしてタグ → 該当ノート一覧を返す */
  listTags(): Promise<Array<{ tag: string; notes: NoteMeta[] }>>;
  /** ダイアログで選んだ .md ファイルの中身を読み込んで返す */
  importMd(): Promise<Array<{ name: string; body: string }>>;
  /** ダイアログで選んだディレクトリ配下の .md を再帰的に読み込んで返す */
  importDir(): Promise<
    Array<{ name: string; body: string; subFolder: string }>
  >;
  /** ゴミ箱へ移動 (実体は残し、復元可能)。.md は保存先から削除される */
  delete(id: string): Promise<void>;
  /** ゴミ箱内ノート一覧 */
  listTrashed(): Promise<NoteMeta[]>;
  /** ゴミ箱から復元 (.md 再書き出し)。保護ノートはパスワード確認後に呼ぶ */
  restore(id: string): Promise<NoteMeta | null>;
  /** ゴミ箱を空にする (物理削除)。削除した id 配列を返す */
  emptyTrash(): Promise<string[]>;
  /** ゴミ箱内で指定日数以上経過したノートを物理削除 */
  purgeOldTrash(daysOld: number): Promise<string[]>;
  /** ゴミ箱内のノートを物理削除 (1 件、ゴミ箱以外には使えない) */
  deletePermanent(id: string): Promise<void>;
}

export interface FoldersApi {
  list(): Promise<string[]>;
  create(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  /** フォルダを配下のノート・サブフォルダごと丸ごと削除 */
  deleteRecursive(path: string): Promise<{ deletedCount: number }>;
  /** フォルダパスを書き換え。配下の全ノートと全サブフォルダを一括更新 */
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface SettingsApi {
  getAll(): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void>;
}

export interface ImagesApi {
  /** 画像バイナリを保存し、ファイル名（hash.ext）を返す */
  save(data: ArrayBuffer, ext: string): Promise<string>;
  /** ファイルが存在するか確認 */
  exists(filename: string): Promise<boolean>;
}

export interface AttachmentsApi {
  /** 添付ファイルバイナリを保存し、ファイル名（hash.ext）を返す */
  save(data: ArrayBuffer, ext: string): Promise<string>;
  /** ファイルが存在するか確認 */
  exists(filename: string): Promise<boolean>;
  /** OS の既定アプリで開く */
  open(filename: string): Promise<void>;
}

export interface ShellApi {
  /** 外部 URL を既定ブラウザで開く（http/https のみ） */
  openExternal(url: string): Promise<void>;
}

export interface FilesApi {
  /** 現在のノート本文を Markdown として保存。true なら成功、false ならキャンセル */
  exportMarkdown(defaultName: string, body: string): Promise<boolean>;
  /** 現在のウィンドウ描画を PDF として保存 */
  exportPdf(defaultName: string): Promise<boolean>;
}

export interface AppControlApi {
  /**
   * アプリを完全初期化する（全データ削除 + 再起動）。
   * UI 側で破壊的操作の確認を取った後に呼ぶこと。
   */
  resetAll(): Promise<void>;
  /** データを触らずアプリを再起動するだけ */
  relaunch(): Promise<void>;
}

export interface BackupApi {
  /**
   * 保存先フォルダ (notes / images / attachments) を ZIP 化してユーザー選択の場所に保存。
   * 呼び出し前に UI 側で DB↔MD 同期を済ませておくこと。
   * 戻り値: 保存に成功したら { savedPath, fileCount }、キャンセル時 null。
   */
  create(): Promise<{ savedPath: string; fileCount: number } | null>;
  /**
   * ZIP を選んでリストア。既存の notes/ images/ attachments/ は削除されて上書きされる。
   * リストア後に UI 側で MD→DB 同期を呼ぶこと。
   * 戻り値: 成功時 { restoredPath, fileCount }、キャンセル時 null。
   */
  restore(): Promise<{ restoredPath: string; fileCount: number } | null>;
}

export interface StorageApi {
  /** 現在のファイル保存ルート（既定: userData、または設定で指定したフォルダ） */
  getRoot(): Promise<string>;
  /** フォルダ選択ダイアログを開く。キャンセル時は null */
  chooseFolder(): Promise<string | null>;
  /**
   * 現在の保存先配下 (notes/ images/ attachments/ plugins/) を
   * 指定フォルダへコピーしてから設定 `storage.path` を切り替える。
   * 古いフォルダは残す (安全側)。
   */
  migrateTo(
    targetRoot: string,
  ): Promise<{ copied: number; skipped: number; newRoot: string }>;
  /**
   * DB の notes / folders を空にしてから storage.path を新フォルダへ切替。
   * 保存先のファイル群はコピーも削除もしない。再起動後は空 DB で起動。
   */
  resetAndSet(targetRoot: string): Promise<{ newRoot: string }>;
  /**
   * 全ノート本文から参照されていない画像 / 添付ファイル (orphan) の一覧を返す。
   */
  scanOrphans(): Promise<
    Array<{
      filename: string;
      kind: 'images' | 'attachments';
      size: number;
    }>
  >;
  /** 指定した orphan ファイルを削除 (サーバ側でも参照を再チェック) */
  deleteOrphans(
    targets: Array<{ filename: string; kind: 'images' | 'attachments' }>,
  ): Promise<{ deleted: number; failed: number }>;
  /** 保存先フォルダの内容をスキャンして DB との差分を返す（タイムスタンプベース） */
  scan(): Promise<{
    storageRoot: string;
    dbNoteCount: number;
    diskFileCount: number;
    /** 最後に同期した日時 (epoch ms)。0 は未同期 */
    lastSync: number;
    /** DB → ディスクへ反映すべきノート（書き出し対象） */
    dbToDiskTargets: Array<{
      id: string;
      title: string;
      reason: 'missing' | 'newer';
    }>;
    /** ディスク → DB へ反映すべきノート（取り込み対象） */
    diskToDbTargets: Array<{
      id: string;
      title: string;
      reason: 'missing' | 'newer';
    }>;
    /** disk が tombstone なので DB から削除すべきノート */
    dbDeleteTargets: Array<{ id: string; deletedAt: number }>;
  }>;
  /** DB ↔ disk の同期を実行し、書き出し / 取り込み / 削除の件数を返す */
  sync(): Promise<{ saved: number; imported: number; deleted: number }>;
  /** DB の全ノートを保存先フォルダに強制上書きする */
  overwriteAll(): Promise<{ written: number; failed: number }>;
  /**
   * 保存先の .md ファイルから DB を完全再構築する。
   * 既存の notes / folders テーブルを破棄してから取り込み直す。
   * リストア後に呼ぶことを想定。
   */
  rebuildFromMd(): Promise<{ imported: number }>;
}

export interface UiApi {
  /**
   * 汎用の OS ネイティブコンテキストメニュー。
   * 選ばれた item の id を返す（キャンセル時は null）。
   */
  showContextMenu(opts: {
    position?: { x: number; y: number };
    items: Array<{
      id?: string;
      label?: string;
      enabled?: boolean;
      separator?: boolean;
    }>;
  }): Promise<string | null>;
  /** OS ネイティブのノート操作メニューを指定位置にポップアップする */
  showNoteMenu(position: {
    x: number;
    y: number;
    labels?: {
      exportPdf?: string;
      exportMarkdown?: string;
      print?: string;
    };
  }): Promise<void>;
  onExportPdf(callback: () => void): () => void;
  onExportMarkdown(callback: () => void): () => void;
}

export interface MediaApi {
  /** 候補のうち、どのノートからも参照されていないファイルを削除 */
  gc(candidates: {
    images: string[];
    attachments: string[];
  }): Promise<{ deletedImages: string[]; deletedAttachments: string[] }>;
}

export type ShareProviderId = 'none' | 'icloud' | 'dropbox' | 'gdrive';

export interface ShareProviderInfo {
  id: 'icloud' | 'dropbox' | 'gdrive';
  label: string;
  path: string | null;
  available: boolean;
}

export interface ShareStatus {
  provider: ShareProviderId;
  available: boolean;
  path: string | null;
  /** 最終同期時刻 (epoch ms)。0 は未同期 */
  lastSync: number;
  /** クラウド側のマニフェストに載っているノート数 */
  cloudNoteCount: number;
}

export interface ShareSyncResult {
  pushed: number;
  pulled: number;
  unchanged: number;
  total: number;
  /** メディア (images + attachments) の同期件数 */
  mediaPushed: number;
  mediaPulled: number;
  lastSync: number;
}

/** 同期進捗イベント */
export type ShareSyncProgress =
  | { phase: 'start'; total: number }
  | { phase: 'push'; current: number; total: number; noteTitle: string }
  | { phase: 'pull'; current: number; total: number; noteTitle: string }
  | { phase: 'skip'; current: number; total: number; noteTitle: string }
  | { phase: 'media'; kind: 'images' | 'attachments'; pushed: number; pulled: number; total: number }
  | { phase: 'finalizing'; total: number }
  | { phase: 'done'; result: ShareSyncResult };

export interface TemplateEntry {
  /** テンプレート名（ノートの title） */
  name: string;
  /** ノート ID */
  noteId: string;
}

export interface TemplateApi {
  /** folder='template' のノート一覧を返す */
  list(): Promise<TemplateEntry[]>;
  /**
   * 指定ノートの本文 + タグを返す（テンプレートとして挿入用）。
   * タグはテンプレート採用時に現在ノートのタグへマージされる。
   */
  read(noteId: string): Promise<{ body: string; tags: string[] }>;
}

export type AiAction =
  | 'summarizeByHeading'
  | 'generateTitleFromContent'
  | 'organizeBullets'
  | 'improveCodeBlocks'
  | 'formatTables'
  | 'convertHtmlToMarkdown'
  | 'convertToSchedule'
  | 'convertToChecklist';

export interface AiTransformInput {
  provider: 'general' | 'chatgpt' | 'claudeCode' | 'copilot' | 'gemini';
  token: string;
  endpoint: string;
  model: string;
  action: AiAction;
  content: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatInput {
  provider: 'general' | 'chatgpt' | 'claudeCode' | 'copilot' | 'gemini';
  token: string;
  endpoint: string;
  model: string;
  messages: AiChatMessage[];
  /**
   * 役割設定（ベースプロンプト）。空文字 or 未指定なら system プロンプトには
   * 追加されない。指定時はビルトインシステム文の前段に差し込まれる。
   */
  basePrompt?: string;
  noteContext?: {
    title: string;
    body: string;
    relatedNotes?: Array<{
      title: string;
      body: string;
    }>;
  };
  /**
   * 「編集モード」フラグ。true のときだけノート操作ディレクティブ
   * (create_note / append_to_current_note / rewrite_current_note) を
   * AI 側に許可する。false（チャットモード）では普通の会話のみ。
   */
  allowNoteActions?: boolean;
  attachments?: Array<{
    kind: 'image';
    name: string;
    mimeType: string;
    dataUrl: string;
  }>;
}

export interface AiApi {
  transform(input: AiTransformInput): Promise<string>;
  /**
   * AI とチャット。`requestId` を渡すと `abort()` で中断できる。
   * 同じ requestId を `abort` に渡すこと。
   */
  chat(input: AiChatInput, requestId?: string): Promise<string>;
  /** 進行中の chat() を中断する。中断対象が見つかれば true、無ければ false */
  abort(requestId: string): Promise<boolean>;
  /**
   * チャットのストリーミングデルタを購読する。chat() の最終結果が解決される前に
   * 何度でも発火する。戻り値は購読解除関数。
   */
  onChatChunk(
    callback: (payload: { requestId: string; delta: string }) => void,
  ): () => void;
}

/**
 * Web ページの取得 API。AI チャットで URL を渡されたとき、main 側で実際に
 * fetch して本文を取り出すために使う (AI 自体は URL を読めないため)。
 */
export interface WebApi {
  fetchUrl(
    url: string,
  ): Promise<
    | { ok: true; url: string; title: string; content: string }
    | { ok: false; url: string; error: string }
  >;
}

export interface PluginCatalogEntry {
  /** プラグイン ID */
  id: string;
  /** カタログ baseUrl からの相対 manifest ファイル名 */
  manifest: string;
}

export interface PluginCatalog {
  /** plugins.json があった URL のディレクトリ部分（manifest 解決の基底） */
  baseUrl: string;
  plugins: PluginCatalogEntry[];
}

export interface PluginManifestFile {
  filename: string;
  /** mermaid.json などをパースしたもの。形式は将来拡張可能なので unknown */
  content: unknown;
}

export interface PluginsApi {
  /** ローカル格納ディレクトリ（userData/plugins/）を返す */
  getDir(): Promise<string>;
  /** プラグインフォルダを OS のファイルマネージャで開く */
  openDir(): Promise<void>;
  /** ダウンロード済み manifest 一覧 */
  listLocal(): Promise<PluginManifestFile[]>;
  /**
   * plugins ディレクトリ配下の全ファイル名。
   * UI で「ダウンロード済み」の判定に使う：manifest.files が全て揃っているかを
   * チェックするため。
   */
  listLocalFiles(): Promise<string[]>;
  /**
   * プラグイン本体ファイル (.js 等) の中身をテキストで返す。
   * ランタイムロード用。renderer 側で Blob URL を作って dynamic import する。
   */
  readFile(filename: string): Promise<string | null>;
  /**
   * リモートカタログを取得。URL に到達できない / 形式不正は null。
   * 呼び出し元は null を「プラグインが見つかりません」として扱う。
   */
  fetchCatalog(url: string): Promise<PluginCatalog | null>;
  /** 個別 manifest を取得（baseUrl + filename）。失敗時 null */
  fetchManifest(
    baseUrl: string,
    filename: string,
  ): Promise<PluginManifestFile | null>;
  /**
   * 【開発モード専用】`plugin-dev/plugins/` 配下のカタログを
   * ファイルシステムから直接読み、manifest 込みで返す。
   * production パッケージでは常に null。
   */
  fetchDevCatalog(): Promise<{
    baseUrl: string;
    rows: Array<{
      id: string;
      filename: string;
      manifest: unknown | null;
    }>;
  } | null>;
  /**
   * manifest と、manifest.files で列挙された付属ファイルを一括 DL して保存。
   * baseUrl は fetchCatalog の戻り値の baseUrl をそのまま渡す。
   * 戻り値: 保存できたファイル一覧 / 保存失敗ファイル一覧。
   * すべて失敗時は null。
   */
  install(args: {
    filename: string;
    content: unknown;
    baseUrl: string;
  }): Promise<{
    savedFiles: string[];
    missingFiles: string[];
  } | null>;
  /**
   * 指定 manifest をアンインストール。manifest 本体 +
   * manifest.files で列挙された付属ファイルをローカルから削除する。
   */
  uninstall(filename: string): Promise<{
    removed: string[];
    failed: string[];
  }>;
  /**
   * バンドル版プラグインのソースを `plugin-dev/plugins/<sourceDir>/` から
   * `src/plugins/<id>/` へ展開（dev モード限定）。production では skipped=true。
   */
  materializeSource(args: {
    id: string;
    sourceDir: string;
  }): Promise<{
    ok: boolean;
    skipped?: boolean;
    copied?: string[];
    error?: string;
  }>;
  /** `src/plugins/<id>/` を丸ごと削除（dev モード限定） */
  dematerializeSource(args: {
    id: string;
  }): Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
}

export interface ShareApi {
  /** iCloud / Dropbox / Google Drive のフォルダ検出結果を返す */
  detectProviders(): Promise<ShareProviderInfo[]>;
  /** 指定プロバイダの同期状態を返す */
  getStatus(provider: ShareProviderId): Promise<ShareStatus>;
  /**
   * 指定ノートについて PC とクラウドのタイムスタンプを比較し双方向同期。
   * 'pulled' = クラウドから取得 / 'pushed' = PC からクラウドへ /
   * 'same' = 同一 / 'skip' = プロバイダ無効
   */
  checkNote(
    provider: ShareProviderId,
    noteId: string,
  ): Promise<'pulled' | 'pushed' | 'same' | 'skip'>;
  /** 指定プロバイダのクラウドフォルダと双方向同期を実行 */
  sync(provider: ShareProviderId): Promise<ShareSyncResult>;
  /** 同期中の進捗イベントを購読。返り値は購読解除関数 */
  onProgress(callback: (ev: ShareSyncProgress) => void): () => void;
}

export interface InkNelApi {
  onOpenPreferences(callback: () => void): () => void;
  openPreferencesWindow(): Promise<void>;
  closeCurrentWindow(): Promise<void>;
  onSettingsChanged(callback: () => void): () => void;
  onPrint(callback: () => void): () => void;
  onCreateNote(callback: () => void): () => void;
  onFind(callback: () => void): () => void;
  onReplace(callback: () => void): () => void;
  onMacroCaptureStart(callback: () => void): () => void;
  onMacroCaptureStop(callback: () => void): () => void;
  onMacroPlay(callback: () => void): () => void;
  onMacroShow(callback: () => void): () => void;
  onMacroSelect(callback: (id: string) => void): () => void;
  updateMacroMenu(macros: Array<{ id: string; name: string }>): void;
  onImportMd(callback: () => void): () => void;
  onImportDir(callback: () => void): () => void;
  notes: NotesApi;
  folders: FoldersApi;
  settings: SettingsApi;
  images: ImagesApi;
  attachments: AttachmentsApi;
  shell: ShellApi;
  files: FilesApi;
  storage: StorageApi;
  app: AppControlApi;
  backup: BackupApi;
  ui: UiApi;
  media: MediaApi;
  template: TemplateApi;
  ai: AiApi;
  web: WebApi;
  share: ShareApi;
  plugins: PluginsApi;
}

declare global {
  interface Window {
    api: InkNelApi;
  }
}

export {};
