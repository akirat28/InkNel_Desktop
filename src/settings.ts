/**
 * アプリ全体の設定値（レンダラ側で扱う型）。
 * SQLite には key/value で保存される。bool は 'true'/'false' 文字列にシリアライズ。
 */

import {
  DEFAULT_ENABLED_HIGHLIGHT_LANGS,
  SUPPORTED_HIGHLIGHT_LANGS,
} from './utils/highlight';

export type Theme = 'dark' | 'light';
/** UI 表示言語の設定値。`auto` は OS 言語に追随 */
export type Language = 'auto' | 'ja' | 'en';
export type SearchHistoryMode = 'reset' | 'persist';
export type SearchHistoryLimit = 100 | 1000;
/** ノート開封履歴の最大件数（検索履歴と同じ 100 / 1000 から選択） */
export type OpenHistoryLimit = 100 | 1000;
export type AiProvider =
  | 'general'
  | 'chatgpt'
  | 'claudeCode'
  | 'copilot'
  | 'gemini';

export interface AiProviderOption {
  value: AiProvider;
  label: string;
}

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = [
  { value: 'general', label: '一般的なAI' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'claudeCode', label: 'ClaudeCode' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'gemini', label: 'Gemini' },
];

/** AI プロバイダ 1 つあたりの接続設定 */
export interface AiProviderSettings {
  token: string;
  endpoint: string;
  model: string;
  /**
   * ベースプロンプト（役割設定）。チャット送信時に必ずメッセージ先頭に
   * system role として埋め込まれる。UI のチャット履歴には表示されない。
   */
  basePrompt: string;
}

/** すべてのプロバイダの既定値（空文字） */
export const DEFAULT_AI_PROVIDER_SETTINGS: Record<AiProvider, AiProviderSettings> = {
  general: { token: '', endpoint: '', model: '', basePrompt: '' },
  chatgpt: { token: '', endpoint: '', model: '', basePrompt: '' },
  claudeCode: { token: '', endpoint: '', model: '', basePrompt: '' },
  copilot: { token: '', endpoint: '', model: '', basePrompt: '' },
  gemini: { token: '', endpoint: '', model: '', basePrompt: '' },
};

/** 現在アクティブなプロバイダの設定を取り出すヘルパ */
export function getActiveAiSettings(s: AppSettings): AiProviderSettings {
  return (
    s.aiProviderSettings[s.aiProvider] ?? {
      token: '',
      endpoint: '',
      model: '',
      basePrompt: '',
    }
  );
}

/**
 * 共有（クラウド同期）のプロバイダ。'none' は無効。
 * iCloud / Dropbox / Google Drive のいずれか一つを選択可能（複数不可）。
 */
export type ShareProvider = 'none' | 'icloud' | 'dropbox' | 'gdrive';

export interface ShareProviderOption {
  value: ShareProvider;
  label: string;
}

export const SHARE_PROVIDER_OPTIONS: ShareProviderOption[] = [
  { value: 'none', label: '無効' },
  { value: 'icloud', label: 'iCloud Drive' },
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'gdrive', label: 'Google Drive' },
];

/** ノート本文のフォントファミリー（system はブラウザ既定の system-ui スタック） */
export type FontFamily = 'system' | 'sans' | 'serif' | 'mono';

export interface FontFamilyOption {
  value: FontFamily;
  label: string;
  /** 実際に CSS の font-family に適用する値 */
  cssValue: string;
}

export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  {
    value: 'system',
    label: 'システム',
    cssValue:
      'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  },
  {
    value: 'sans',
    label: 'ゴシック',
    cssValue:
      '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", Meiryo, sans-serif',
  },
  {
    value: 'serif',
    label: '明朝',
    cssValue:
      '"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", "Noto Serif JP", "MS PMincho", serif',
  },
  {
    value: 'mono',
    label: '等幅',
    cssValue: '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
  },
];

/** ノート本文のフォントサイズ (px) */
export type FontSize = 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;
export const FONT_SIZE_OPTIONS: FontSize[] = [12, 13, 14, 15, 16, 17, 18, 19, 20];

/**
 * 日付挿入ボタンが使うフォーマット文字列。
 * トークンの意味は src/utils/dateFormat.ts を参照。
 * ここでは設定画面に並べる選択肢として固定リストを定義する。
 */
export interface DateFormatOption {
  /** 永続化される値（フォーマット文字列そのもの） */
  value: string;
  /** 設定画面に表示するプレビュー込みのラベル */
  label: string;
}

export const DATE_FORMAT_OPTIONS: DateFormatOption[] = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD（例: 2026-04-12）' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD（例: 2026/04/12）' },
  { value: 'YYYY年M月D日', label: 'YYYY年M月D日（例: 2026年4月12日）' },
  { value: 'YYYY年MM月DD日', label: 'YYYY年MM月DD日（例: 2026年04月12日）' },
  { value: 'M/D', label: 'M/D（例: 4/12）' },
  { value: 'YYYY-MM-DD HH:mm', label: 'YYYY-MM-DD HH:mm（例: 2026-04-12 14:30）' },
  { value: 'YYYY/MM/DD HH:mm', label: 'YYYY/MM/DD HH:mm（例: 2026/04/12 14:30）' },
];

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';

export const SEARCH_HISTORY_LIMIT_OPTIONS: SearchHistoryLimit[] = [100, 1000];
export const OPEN_HISTORY_LIMIT_OPTIONS: OpenHistoryLimit[] = [100, 1000];

/** カレンダープラグインの個別設定 */
export interface CalendarPluginSettings {
  /** ノートのフォルダ名（≒「ノートタイトル」の接頭部分）。既定: 'カレンダー' */
  folder: string;
  /**
   * ノートタイトルとして使う日付フォーマット。
   * 'YYYY-MM-DD', 'YYYY/M/D', 'YYYY年M月D日' などのトークン文字列。
   * formatDate() の対応トークン (YYYY, MM, M, DD, D, HH, mm, ss) で記述。
   */
  titleFormat: string;
}

/** カレンダープラグインの日付書式プリセット */
export interface CalendarTitleFormatOption {
  value: string;
  label: string;
}
export const CALENDAR_TITLE_FORMAT_OPTIONS: CalendarTitleFormatOption[] = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD（例: 2026-05-14）' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD（例: 2026/05/14）' },
  { value: 'YYYY/M/D', label: 'YYYY/M/D（例: 2026/5/14）' },
  { value: 'YYYY年M月D日', label: 'YYYY年M月D日（例: 2026年5月14日）' },
  { value: 'YYYY年MM月DD日', label: 'YYYY年MM月DD日（例: 2026年05月14日）' },
  { value: 'M/D', label: 'M/D（例: 5/14）' },
];

export const DEFAULT_CALENDAR_PLUGIN_SETTINGS: CalendarPluginSettings = {
  folder: 'カレンダー',
  titleFormat: 'YYYY-MM-DD',
};

export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 240;

export interface AppSettings {
  /** UI 全体の配色テーマ */
  theme: Theme;
  /** UI 表示言語。`auto` は OS 設定に追随、対応外言語は英語にフォールバック */
  language: Language;
  /** メイン画面（ノート本文）のフォントファミリー */
  fontFamily: FontFamily;
  /** メイン画面（ノート本文）のフォントサイズ (px) */
  fontSize: FontSize;
  /** サイドメニュー（ファイル一覧・検索・タグ）のフォントファミリー */
  sidebarFontFamily: FontFamily;
  /** サイドメニュー（ファイル一覧・検索・タグ）のフォントサイズ (px) */
  sidebarFontSize: FontSize;
  /** 日付挿入ボタンが使うフォーマット文字列 */
  dateFormat: string;
  /** 編集ツールバーにマークダウン挿入ボタン群（H1, B, I 等）を表示するか */
  showInsertButtons: boolean;
  /**
   * サイドバーでノートをクリックした時に必ず新しいタブで開くか。
   * - false (既定): 「プレビュータブ」動作。直前にサイドバーから開いた
   *   タブがまだ編集されていない（dirty でない）なら、そのタブを閉じて
   *   新しいノートを同じ場所に開く。VS Code の preview タブと同じ感覚。
   * - true: クリックする度に常に新しいタブを追加する。
   */
  openNoteInNewTab: boolean;
  /** 保護されたノートを解錠するための4桁パスワード */
  protectionPassword: string;
  /** 検索履歴の保存方式 */
  searchHistoryMode: SearchHistoryMode;
  /** 検索履歴の最大件数 */
  searchHistoryLimit: SearchHistoryLimit;
  /** ノート開封履歴を記録するか。ON のときアクティビティバーに「履歴」ボタンを表示 */
  historyEnabled: boolean;
  /** ノート開封履歴の最大件数 */
  historyLimit: OpenHistoryLimit;
  /** サイドバーの幅 (px) */
  sidebarWidth: number;
  /** コードブロックのコピーボタンを常に表示するか（false ならホバー時のみ） */
  codeCopyAlwaysVisible: boolean;
  /** コードブロックに行番号を表示するか */
  codeShowLineNumbers: boolean;
  /** エディタ右側にミニマップを表示するか（VSCode 風） */
  editorMinimap: boolean;
  /**
   * シンタックスハイライトを有効化する言語の id 一覧。
   * 空配列なら全 fence ブロックがプレーンレンダリングになる。
   */
  enabledHighlightLangs: string[];
  /** 共有プロバイダ。'none' で同期無効（UI からは廃止、互換のため型は維持） */
  shareProvider: ShareProvider;
  /**
   * ファイル保存先フォルダの絶対パス。空文字列なら既定の userData を使う。
   * notes/, images/, attachments/ がこの直下に作られる。
   */
  storagePath: string;
  /** テンプレートとして使うフォルダ名（サイドバーの仮想フォルダ） */
  templateFolder: string;
  /** ノート変換に使う AI プロバイダ */
  aiProvider: AiProvider;
  /**
   * プロバイダごとの API 設定 (token / endpoint / model)。
   * `aiProvider` で選択されているものが現在使われる。
   * `getActiveAiSettings(settings)` でアクティブ分を取得する。
   */
  aiProviderSettings: Record<AiProvider, AiProviderSettings>;
  /**
   * 有効化されているプラグイン ID の配列。
   * `src/plugins/<id>.ts` が存在し、かつここに含まれていれば有効。
   * 配列に未知の ID が混じっていても registry 側で無視される。
   */
  enabledPlugins: string[];
  /**
   * ユーザーが「削除」した ID。バンドル版が残っていても表示・実行ともに
   * スキップされる（再 DL すると自動でこのリストから外れる）。
   */
  removedPlugins: string[];
  /**
   * 「インポート」されたプラグイン ID の一覧。
   * DL = ファイル保存だけで不活性。インポートで初めて runtime registry に登録される。
   * アプリ起動時にここに含まれる ID のみ自動的にロードする。
   */
  importedPlugins: string[];
  /**
   * ユーザーが追加したプラグインカタログ URL の一覧（plugins.json への絶対 URL）。
   * 既定の公式カタログ（https://inknel.ary-ap.com/plugins/plugins.json）は
   * コード側で常に先頭に固定で組み込まれるため、ここには含めない。
   * 空配列が既定。
   */
  pluginCatalogUrls: string[];
  /**
   * プラグイン開発モード。ON にすると `inknel-plugin://` プロトコルが
   * userData ではなくプロジェクト直下の `plugin-dev/plugins/` を直接配信する。
   * ダウンロード / インポート不要で、`plugin-dev/plugins/<id>/` を編集して
   * Cmd+R すれば即反映される。dev (`!app.isPackaged`) 専用。
   */
  pluginDevMode: boolean;
  /** カレンダープラグインの個別設定 */
  calendarPlugin: CalendarPluginSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'auto',
  fontFamily: 'system',
  fontSize: 15,
  sidebarFontFamily: 'system',
  sidebarFontSize: 13,
  dateFormat: DEFAULT_DATE_FORMAT,
  showInsertButtons: true,
  openNoteInNewTab: false,
  protectionPassword: '1234',
  searchHistoryMode: 'reset',
  searchHistoryLimit: 100,
  historyEnabled: false,
  historyLimit: 100,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  codeCopyAlwaysVisible: false,
  codeShowLineNumbers: false,
  editorMinimap: false,
  enabledHighlightLangs: DEFAULT_ENABLED_HIGHLIGHT_LANGS,
  shareProvider: 'none',
  storagePath: '',
  templateFolder: 'template',
  aiProvider: 'general',
  aiProviderSettings: DEFAULT_AI_PROVIDER_SETTINGS,
  enabledPlugins: [],
  removedPlugins: [],
  importedPlugins: [],
  pluginCatalogUrls: [],
  pluginDevMode: false,
  calendarPlugin: DEFAULT_CALENDAR_PLUGIN_SETTINGS,
};

/** SQLite の文字列レコードから AppSettings を組み立てる（未設定キーは既定値）。 */
export function parseSettings(raw: Record<string, string>): AppSettings {
  return {
    theme: parseTheme(raw['appearance.theme'], DEFAULT_SETTINGS.theme),
    language: parseLanguage(
      raw['appearance.language'],
      DEFAULT_SETTINGS.language,
    ),
    fontFamily: parseFontFamily(
      raw['appearance.fontFamily'],
      DEFAULT_SETTINGS.fontFamily,
    ),
    fontSize: parseFontSize(
      raw['appearance.fontSize'],
      DEFAULT_SETTINGS.fontSize,
    ),
    sidebarFontFamily: parseFontFamily(
      raw['appearance.sidebarFontFamily'],
      DEFAULT_SETTINGS.sidebarFontFamily,
    ),
    sidebarFontSize: parseFontSize(
      raw['appearance.sidebarFontSize'],
      DEFAULT_SETTINGS.sidebarFontSize,
    ),
    dateFormat: parseDateFormat(
      raw['editor.dateFormat'],
      DEFAULT_SETTINGS.dateFormat,
    ),
    showInsertButtons: parseBool(
      raw['editor.showInsertButtons'],
      DEFAULT_SETTINGS.showInsertButtons,
    ),
    openNoteInNewTab: parseBool(
      raw['tabs.openNoteInNewTab'],
      DEFAULT_SETTINGS.openNoteInNewTab,
    ),
    protectionPassword: parsePassword(
      raw['protection.password'],
      DEFAULT_SETTINGS.protectionPassword,
    ),
    searchHistoryMode: parseHistoryMode(
      raw['search.historyMode'],
      DEFAULT_SETTINGS.searchHistoryMode,
    ),
    searchHistoryLimit: parseHistoryLimit(
      raw['search.historyLimit'],
      DEFAULT_SETTINGS.searchHistoryLimit,
    ),
    historyEnabled: parseBool(
      raw['history.enabled'],
      DEFAULT_SETTINGS.historyEnabled,
    ),
    historyLimit: parseOpenHistoryLimit(
      raw['history.limit'],
      DEFAULT_SETTINGS.historyLimit,
    ),
    sidebarWidth: parseSidebarWidth(
      raw['ui.sidebarWidth'],
      DEFAULT_SETTINGS.sidebarWidth,
    ),
    codeCopyAlwaysVisible: parseBool(
      raw['codeBlock.copyAlwaysVisible'],
      DEFAULT_SETTINGS.codeCopyAlwaysVisible,
    ),
    codeShowLineNumbers: parseBool(
      raw['codeBlock.showLineNumbers'],
      DEFAULT_SETTINGS.codeShowLineNumbers,
    ),
    editorMinimap: parseBool(
      raw['editor.minimap'],
      DEFAULT_SETTINGS.editorMinimap,
    ),
    enabledHighlightLangs: parseHighlightLangs(
      raw['codeBlock.enabledHighlightLangs'],
      DEFAULT_SETTINGS.enabledHighlightLangs,
    ),
    shareProvider: parseShareProvider(
      raw['share.provider'],
      DEFAULT_SETTINGS.shareProvider,
    ),
    storagePath: typeof raw['storage.path'] === 'string' ? raw['storage.path'] : DEFAULT_SETTINGS.storagePath,
    templateFolder: raw['template.folder']?.trim() || DEFAULT_SETTINGS.templateFolder,
    aiProvider: parseAiProvider(
      raw['ai.provider'],
      DEFAULT_SETTINGS.aiProvider,
    ),
    aiProviderSettings: parseAiProviderSettings(raw, {
      legacyToken: typeof raw['ai.token'] === 'string' ? raw['ai.token'] : '',
      legacyEndpoint:
        typeof raw['ai.endpoint'] === 'string' ? raw['ai.endpoint'] : '',
      legacyModel: typeof raw['ai.model'] === 'string' ? raw['ai.model'] : '',
      legacyProvider: parseAiProvider(
        raw['ai.provider'],
        DEFAULT_SETTINGS.aiProvider,
      ),
    }),
    enabledPlugins: parseEnabledPlugins(
      raw['plugin.enabled'],
      DEFAULT_SETTINGS.enabledPlugins,
    ),
    removedPlugins: parseEnabledPlugins(
      raw['plugin.removed'],
      DEFAULT_SETTINGS.removedPlugins,
    ),
    importedPlugins: parseEnabledPlugins(
      raw['plugin.imported'],
      DEFAULT_SETTINGS.importedPlugins,
    ),
    pluginCatalogUrls: parseCatalogUrls(
      raw['plugin.catalogUrls'],
      DEFAULT_SETTINGS.pluginCatalogUrls,
    ),
    pluginDevMode: parseBool(
      raw['plugin.devMode'],
      DEFAULT_SETTINGS.pluginDevMode,
    ),
    calendarPlugin: parseCalendarPluginSettings(
      raw['plugin.calendar'],
      DEFAULT_SETTINGS.calendarPlugin,
    ),
  };
}

/** AppSettings の特定キーから SQLite 用の (key, value) ペアを生成。 */
export function settingToRecord<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): { key: string; value: string } {
  switch (key) {
    case 'theme':
      return { key: 'appearance.theme', value: String(value) };
    case 'language':
      return { key: 'appearance.language', value: String(value) };
    case 'fontFamily':
      return { key: 'appearance.fontFamily', value: String(value) };
    case 'fontSize':
      return { key: 'appearance.fontSize', value: String(value) };
    case 'sidebarFontFamily':
      return { key: 'appearance.sidebarFontFamily', value: String(value) };
    case 'sidebarFontSize':
      return { key: 'appearance.sidebarFontSize', value: String(value) };
    case 'dateFormat':
      return { key: 'editor.dateFormat', value: String(value) };
    case 'showInsertButtons':
      return { key: 'editor.showInsertButtons', value: String(value) };
    case 'openNoteInNewTab':
      return { key: 'tabs.openNoteInNewTab', value: String(value) };
    case 'protectionPassword':
      return { key: 'protection.password', value: String(value) };
    case 'searchHistoryMode':
      return { key: 'search.historyMode', value: String(value) };
    case 'searchHistoryLimit':
      return { key: 'search.historyLimit', value: String(value) };
    case 'historyEnabled':
      return { key: 'history.enabled', value: String(value) };
    case 'historyLimit':
      return { key: 'history.limit', value: String(value) };
    case 'sidebarWidth':
      return { key: 'ui.sidebarWidth', value: String(value) };
    case 'codeCopyAlwaysVisible':
      return { key: 'codeBlock.copyAlwaysVisible', value: String(value) };
    case 'codeShowLineNumbers':
      return { key: 'codeBlock.showLineNumbers', value: String(value) };
    case 'editorMinimap':
      return { key: 'editor.minimap', value: String(value) };
    case 'enabledHighlightLangs':
      return {
        key: 'codeBlock.enabledHighlightLangs',
        value: JSON.stringify(value),
      };
    case 'shareProvider':
      return { key: 'share.provider', value: String(value) };
    case 'storagePath':
      return { key: 'storage.path', value: String(value) };
    case 'templateFolder':
      return { key: 'template.folder', value: String(value) };
    case 'aiProvider':
      return { key: 'ai.provider', value: String(value) };
    case 'aiProviderSettings':
      return { key: 'ai.providerSettings', value: JSON.stringify(value) };
    case 'enabledPlugins':
      return { key: 'plugin.enabled', value: JSON.stringify(value) };
    case 'removedPlugins':
      return { key: 'plugin.removed', value: JSON.stringify(value) };
    case 'importedPlugins':
      return { key: 'plugin.imported', value: JSON.stringify(value) };
    case 'pluginCatalogUrls':
      return { key: 'plugin.catalogUrls', value: JSON.stringify(value) };
    case 'pluginDevMode':
      return { key: 'plugin.devMode', value: String(value) };
    case 'calendarPlugin':
      return { key: 'plugin.calendar', value: JSON.stringify(value) };
    default:
      throw new Error(`unknown setting key: ${String(key)}`);
  }
}

/** 4桁の数字文字列かどうか判定 */
export function isValidProtectionPassword(v: string): boolean {
  return /^\d{4}$/.test(v);
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function parseTheme(v: string | undefined, fallback: Theme): Theme {
  if (v === 'dark' || v === 'light') return v;
  return fallback;
}

function parseLanguage(v: string | undefined, fallback: Language): Language {
  if (v === 'auto' || v === 'ja' || v === 'en') return v;
  return fallback;
}

function parseFontFamily(
  v: string | undefined,
  fallback: FontFamily,
): FontFamily {
  if (FONT_FAMILY_OPTIONS.some((o) => o.value === v)) {
    return v as FontFamily;
  }
  return fallback;
}

function parseFontSize(v: string | undefined, fallback: FontSize): FontSize {
  const n = Number(v);
  if (Number.isFinite(n) && (FONT_SIZE_OPTIONS as number[]).includes(n)) {
    return n as FontSize;
  }
  return fallback;
}

function parseDateFormat(v: string | undefined, fallback: string): string {
  // 既知のプリセットのみ通す（不正な値を弾く）
  if (v && DATE_FORMAT_OPTIONS.some((o) => o.value === v)) return v;
  return fallback;
}

function parsePassword(v: string | undefined, fallback: string): string {
  if (v && isValidProtectionPassword(v)) return v;
  return fallback;
}

function parseHistoryMode(
  v: string | undefined,
  fallback: SearchHistoryMode,
): SearchHistoryMode {
  if (v === 'reset' || v === 'persist') return v;
  return fallback;
}

function parseHistoryLimit(
  v: string | undefined,
  fallback: SearchHistoryLimit,
): SearchHistoryLimit {
  const n = Number(v);
  if (n === 100 || n === 1000) return n;
  return fallback;
}

function parseOpenHistoryLimit(
  v: string | undefined,
  fallback: OpenHistoryLimit,
): OpenHistoryLimit {
  const n = Number(v);
  if (n === 100 || n === 1000) return n;
  return fallback;
}

function parseSidebarWidth(v: string | undefined, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  // min/max にクランプ
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
}

function parseHighlightLangs(
  v: string | undefined,
  fallback: string[],
): string[] {
  if (!v) return fallback;
  try {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return fallback;
    const validIds = new Set(SUPPORTED_HIGHLIGHT_LANGS.map((l) => l.id));
    // 既知の id だけ通す（廃止されたエントリを掃除）
    return arr.filter(
      (s): s is string => typeof s === 'string' && validIds.has(s),
    );
  } catch {
    return fallback;
  }
}

function parseShareProvider(
  v: string | undefined,
  fallback: ShareProvider,
): ShareProvider {
  if (
    v === 'none' ||
    v === 'icloud' ||
    v === 'dropbox' ||
    v === 'gdrive'
  ) {
    return v;
  }
  return fallback;
}

function parseAiProvider(
  v: string | undefined,
  fallback: AiProvider,
): AiProvider {
  if (
    v === 'general' ||
    v === 'chatgpt' ||
    v === 'claudeCode' ||
    v === 'copilot' ||
    v === 'gemini'
  ) {
    return v;
  }
  return fallback;
}

/**
 * ai.providerSettings JSON をパース。形式は
 *   { general: {token,endpoint,model}, chatgpt: {...}, ... }
 *
 * 旧形式 (ai.token / ai.endpoint / ai.model のフラット保存) しか無い場合は、
 * 現在のアクティブプロバイダ枠に流し込む形でマイグレーション。
 */
function parseAiProviderSettings(
  raw: Record<string, string>,
  legacy: {
    legacyToken: string;
    legacyEndpoint: string;
    legacyModel: string;
    legacyProvider: AiProvider;
  },
): Record<AiProvider, AiProviderSettings> {
  const base: Record<AiProvider, AiProviderSettings> = {
    general: { ...DEFAULT_AI_PROVIDER_SETTINGS.general },
    chatgpt: { ...DEFAULT_AI_PROVIDER_SETTINGS.chatgpt },
    claudeCode: { ...DEFAULT_AI_PROVIDER_SETTINGS.claudeCode },
    copilot: { ...DEFAULT_AI_PROVIDER_SETTINGS.copilot },
    gemini: { ...DEFAULT_AI_PROVIDER_SETTINGS.gemini },
  };
  const rawStr = raw['ai.providerSettings'];
  if (typeof rawStr === 'string' && rawStr) {
    try {
      const parsed = JSON.parse(rawStr) as unknown;
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(base) as AiProvider[]) {
          const v = (parsed as Record<string, unknown>)[key];
          if (v && typeof v === 'object') {
            const vv = v as Record<string, unknown>;
            base[key] = {
              token: typeof vv.token === 'string' ? vv.token : '',
              endpoint: typeof vv.endpoint === 'string' ? vv.endpoint : '',
              model: typeof vv.model === 'string' ? vv.model : '',
              basePrompt:
                typeof vv.basePrompt === 'string' ? vv.basePrompt : '',
            };
          }
        }
        return base;
      }
    } catch {
      // パース失敗時はマイグレーションパスへフォールスルー
    }
  }
  // 旧形式があれば、アクティブプロバイダ枠に流し込む（1 度だけのマイグレーション）
  if (legacy.legacyToken || legacy.legacyEndpoint || legacy.legacyModel) {
    base[legacy.legacyProvider] = {
      token: legacy.legacyToken,
      endpoint: legacy.legacyEndpoint,
      model: legacy.legacyModel,
      basePrompt: '',
    };
  }
  return base;
}

function parseEnabledPlugins(
  v: string | undefined,
  fallback: string[],
): string[] {
  if (!v) return fallback;
  try {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return fallback;
    return arr.filter((s): s is string => typeof s === 'string');
  } catch {
    return fallback;
  }
}

/**
 * カレンダープラグイン設定 JSON をパース。
 * folder は前後空白除去 + 空なら既定値、titleFormat は許可リスト内のみ受理。
 */
function parseCalendarPluginSettings(
  v: string | undefined,
  fallback: CalendarPluginSettings,
): CalendarPluginSettings {
  if (!v) return fallback;
  try {
    const obj = JSON.parse(v);
    if (!obj || typeof obj !== 'object') return fallback;
    const o = obj as Record<string, unknown>;
    const folder =
      typeof o.folder === 'string' && o.folder.trim()
        ? o.folder.trim()
        : fallback.folder;
    const titleFormat =
      typeof o.titleFormat === 'string' &&
      CALENDAR_TITLE_FORMAT_OPTIONS.some((opt) => opt.value === o.titleFormat)
        ? o.titleFormat
        : fallback.titleFormat;
    return { folder, titleFormat };
  } catch {
    return fallback;
  }
}

/**
 * 追加プラグインカタログ URL の配列をパース。
 * - http(s) スキーム以外は弾く（fish:// などからの取得を防ぐ）
 * - 各 URL は前後空白を除去し、重複は除去
 */
function parseCatalogUrls(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  try {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return fallback;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const u of arr) {
      if (typeof u !== 'string') continue;
      const trimmed = u.trim();
      if (!trimmed) continue;
      if (!/^https?:\/\//i.test(trimmed)) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  } catch {
    return fallback;
  }
}
