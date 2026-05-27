import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import ActivityBar from './components/ActivityBar';
import AiChatPanel, {
  type PersistedChatState,
} from './components/AiChatPanel';
import Editor, {
  type EditorHandle,
  type MacroAction,
} from './components/Editor';
import EditorToolbar from './components/EditorToolbar';
import Preview, { type PreviewHandle } from './components/Preview';
import Sidebar, {
  type SidebarMode,
  type SidebarHandle,
} from './components/Sidebar';
import NoteHeader from './components/NoteHeader';
import TabBar from './components/TabBar';
import TagBar from './components/TagBar';
import PreferencesModal from './components/PreferencesModal';
import FindDialog from './components/FindDialog';
import PasswordDialog from './components/PasswordDialog';
import RenameDialog from './components/RenameDialog';
import AiTransformResultModal, {
  type AiResultPayload,
} from './components/AiTransformResultModal';
import ReplaceDialog from './components/ReplaceDialog';
import MacroKeysDialog from './components/MacroKeysDialog';
import SavedMacroDialog from './components/SavedMacroDialog';
import logoUrl from './assets/logo.png';
import {
  DEFAULT_SETTINGS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  getActiveAiSettings,
  parseSettings,
  settingToRecord,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type AppSettings,
  type FontSize,
} from './settings';
import {
  extractAttachmentRefs,
  extractImageRefs,
} from './utils/mediaRefs';
import { buildPath, parsePath } from './utils/notePath';
import {
  getRuntimePlugins,
  importPluginById,
  loadImportedPlugins,
} from './plugins/runtimeLoader';
import { getEnabledPlugins } from './plugins/registry';
import { LocaleProvider, resolveLocale } from './i18n';
import type { AiAction, NoteMeta } from './global';

export const SIDEBAR_MIN_WIDTH = SIDEBAR_WIDTH_MIN;
export const SIDEBAR_MAX_WIDTH = SIDEBAR_WIDTH_MAX;
export const SIDEBAR_DEFAULT_WIDTH = SIDEBAR_WIDTH_DEFAULT;

type ViewKey = 'edit' | 'preview' | 'mix';

const SAVE_DEBOUNCE_MS = 300;
const NOTE_DRAG_TYPE = 'application/x-inknel-note-id';
const AI_CHAT_WIDTH_SETTING_KEY = 'ui.aiChatWidth';
const AI_CHAT_WIDTH_DEFAULT = 360;
const AI_CHAT_WIDTH_MIN = 280;
const AI_CHAT_WIDTH_MAX = 720;
const AI_CHAT_SPLITTER_WIDTH = 8;
const SAVED_MACROS_STORAGE_KEY = 'inknel.savedMacros.v1';
const SAVED_MACROS_LIMIT = 10;

interface SavedMacro {
  id: string;
  name: string;
  actions: MacroAction[];
  display: string[];
  createdAt: number;
}

function createSavedMacroId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isMacroAction(value: unknown): value is MacroAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<MacroAction>;
  if (action.kind === 'text') {
    return typeof action.text === 'string';
  }
  if (action.kind !== 'key' || !action.key || typeof action.key !== 'object') {
    return false;
  }
  const key = action.key as unknown as Record<string, unknown>;
  return (
    typeof key.key === 'string' &&
    typeof key.code === 'string' &&
    typeof key.shiftKey === 'boolean' &&
    typeof key.ctrlKey === 'boolean' &&
    typeof key.altKey === 'boolean' &&
    typeof key.metaKey === 'boolean'
  );
}

function parseSavedMacros(): SavedMacro[] {
  try {
    const raw = window.localStorage.getItem(SAVED_MACROS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SavedMacro => {
        if (!item || typeof item !== 'object') return false;
        const macro = item as Partial<SavedMacro>;
        return (
          typeof macro.id === 'string' &&
          typeof macro.name === 'string' &&
          Array.isArray(macro.actions) &&
          macro.actions.every(isMacroAction) &&
          Array.isArray(macro.display) &&
          macro.display.every((line) => typeof line === 'string') &&
          typeof macro.createdAt === 'number'
        );
      })
      .slice(0, SAVED_MACROS_LIMIT);
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}


function parseAiChatWidth(raw: string | undefined): number {
  if (!raw) return AI_CHAT_WIDTH_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return AI_CHAT_WIDTH_DEFAULT;
  return clamp(parsed, AI_CHAT_WIDTH_MIN, AI_CHAT_WIDTH_MAX);
}

export default function App() {
  const isPreferencesWindow =
    window.location.hash === '#preferences' ||
    window.location.hash === '#/preferences';
  // ----- ノート一覧 / 選択中ノート -----
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  // ゴミ箱内ノート (notes とは別管理。Sidebar の「ゴミ箱」セクションに表示)
  const [trashedNotes, setTrashedNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  // フォルダパス → アイコン色 (CSS 文字列 or null)。Sidebar のフォルダアイコン描画に使う。
  const [folderIconColors, setFolderIconColors] = useState<
    Record<string, string | null>
  >({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [body, setBody] = useState<string>('');
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [editingFolder, setEditingFolder] = useState<string>('');
  const [editingTags, setEditingTags] = useState<string[]>([]);

  // ----- タブ状態 -----
  // 開いているノート ID のリスト（順序 = タブの表示順）
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  // タブごとの表示モード（edit / preview）。キーはノート ID
  const [tabViews, setTabViews] = useState<Record<string, ViewKey>>({});
  /**
   * 「プレビュータブ」として開いた直近のノート ID。
   * - サイドバーからノートをクリックすると、設定 `openNoteInNewTab` が
   *   false（既定）の場合、そのタブが「プレビュー」として一時的に開かれる。
   * - 別のノートをクリックするとプレビュータブは閉じられ、新しいノートが
   *   プレビュータブの位置に置かれる。
   * - そのタブで本文 / メタを編集すると previewTabId は null になり、
   *   タブが「固定」される（以降クリックで閉じられない）。
   * - openNoteInNewTab=true ではこの仕組みは使われず、常に null に近い状態を保つ。
   */
  const [previewTabId, setPreviewTabId] = useState<string | null>(null);
  /**
   * 明示的に「ピン留め」されたタブ ID の集合 (順序維持のため配列)。
   * - ダブルクリックで開く / 本文 or メタを編集する のいずれかで自動的に追加される。
   * - 一度入ったらタブを閉じるまで残り続ける (タブクリックや再選択では外れない)。
   * - 表示の 📍 はこの集合の有無で判定する (旧モデルは previewTabId の補集合だった
   *   ためタブクリックで一時的に外れていた)。
   * - previewTabId と相互排他: ピン入り = previewTabId から外す。
   */
  const [pinnedTabIds, setPinnedTabIds] = useState<string[]>([]);

  // アクティブタブの view モード（tabViews から導出）
  const view: ViewKey = activeId ? tabViews[activeId] ?? 'preview' : 'preview';
  const setView = useCallback(
    (next: ViewKey) => {
      if (!activeId) return;
      setTabViews((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  // ----- UI 状態 -----
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('files');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_WIDTH);
  const [aiChatWidth, setAiChatWidth] = useState<number>(AI_CHAT_WIDTH_DEFAULT);
  const [aiChatResizing, setAiChatResizing] = useState<boolean>(false);
  const [preferencesOpen, setPreferencesOpen] = useState<boolean>(false);
  const [replaceOpen, setReplaceOpen] = useState<boolean>(false);
  const [findOpen, setFindOpen] = useState<boolean>(false);
  const [macroKeysOpen, setMacroKeysOpen] = useState<boolean>(false);
  const [macroKeys, setMacroKeys] = useState<string[]>([]);
  const [macroActions, setMacroActions] = useState<MacroAction[]>([]);
  const [savedMacros, setSavedMacros] = useState<SavedMacro[]>(parseSavedMacros);
  const [selectedSavedMacroId, setSelectedSavedMacroId] = useState<string | null>(
    null,
  );
  const [savedMacroDialogId, setSavedMacroDialogId] = useState<string | null>(
    null,
  );
  const [aiChatOpen, setAiChatOpen] = useState<boolean>(false);
  // ノートごとに独立した AI チャット状態を保持する Map。
  // - AiChatPanel は `key={activeId}` で再マウントされるので、ノートを切り替えると
  //   新しい (もしくは Map から復元された) 状態で表示される。
  // - タブを閉じる時、ピン留めされていない (= 編集中ではない) ノートのチャットは
  //   破棄。ピン留めタブは Map に残し、再選択時に途中まで入った状態を復元する。
  const chatStatesRef = useRef<Map<string, PersistedChatState>>(new Map());

  // ----- 保護の解錠状態 -----
  // セッション中に正しいパスワードを入れた対象ノート ID の集合。
  // タブを閉じると該当 ID を除く（= 閉じてから再度開くと再ロック）
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  // セッション中にパスワードで解錠したシークレットノート ID の集合
  // （アプリ再起動でクリア。secretLock-OFF にしたノートも含まれて良い）
  const [unlockedSecretIds, setUnlockedSecretIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // パスワードダイアログの用途。null の場合はダイアログを閉じている。
  type PasswordPurpose =
    | { kind: 'unlock-edit' } // 編集モードに切替時の解錠
    | { kind: 'unprotect'; noteId: string } // 保護解除
    | { kind: 'view-secret'; noteId: string } // シークレットノートを開く
    | { kind: 'unset-secret'; noteId: string }; // シークレット解除
  const [passwordPurpose, setPasswordPurpose] =
    useState<PasswordPurpose | null>(null);
  const passwordDialogOpen = passwordPurpose !== null;

  // ----- 編集セッション中に本文に存在したメディア参照 -----
  // ノートを開いた瞬間の参照 + 編集中に追加された参照を蓄積する。
  // 編集→プレビュー切替時に「セッション中に存在したが現在は無い」ものを GC 候補にする。
  const sessionImagesRef = useRef<Set<string>>(new Set());
  const sessionAttachmentsRef = useRef<Set<string>>(new Set());

  // ----- アプリ設定 -----
  // 初期値はテーマだけ localStorage キャッシュから引き継ぐ。これをやらないと
  // 初回マウント時の `useEffect` が `data-theme="dark"` (= DEFAULT_SETTINGS)
  // で `<html>` を上書きしてしまい、IPC で本来のテーマが届くまでの間ライト
  // ユーザにも一瞬黒背景が見える（main.tsx の先読みが台無しになる）。
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const cached = localStorage.getItem('inknel.theme');
      if (cached === 'dark' || cached === 'light') {
        return { ...DEFAULT_SETTINGS, theme: cached };
      }
    } catch {
      // localStorage 不可: DEFAULT_SETTINGS をそのまま使う
    }
    return DEFAULT_SETTINGS;
  });

  // App コンポーネント自身は LocaleProvider の外側にいるため useT が使えない。
  // settings.language から直接ロケールを解決して、IPC メニュー等に渡す。
  const locale = useMemo(
    () => resolveLocale(settings.language),
    [settings.language],
  );

  // ----- 検索履歴（新しい順、メモリ保持。persistモード時はDBにも保存） -----
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  // ----- ノート開封履歴（新しい順、常に DB へ永続化） -----
  // settings.historyEnabled が ON のときだけ新規エントリを追加する。
  // 値自体は OFF にしても消さない（再 ON で復活できるように）。
  const [openHistory, setOpenHistory] = useState<
    { noteId: string; openedAt: number }[]
  >([]);

  // ----- サイドバー幅の保存タイマ（ドラッグリサイズ時のみ保存） -----
  const sidebarWidthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleSidebarResize = useCallback((next: number) => {
    setSidebarWidth(next);
    if (sidebarWidthSaveTimer.current) {
      clearTimeout(sidebarWidthSaveTimer.current);
    }
    sidebarWidthSaveTimer.current = setTimeout(() => {
      sidebarWidthSaveTimer.current = null;
      void window.api.settings.set('ui.sidebarWidth', String(next));
    }, 300);
  }, []);

  // テーマを document.documentElement に反映 +
  // 次回起動時の初期フラッシュ防止用に localStorage へミラー（main.tsx 参照）
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    try {
      localStorage.setItem('inknel.theme', settings.theme);
    } catch {
      // localStorage 不可の環境は無視（次回起動はダーク既定）
    }
  }, [settings.theme]);

  // フォント設定を CSS 変数として documentElement に反映
  // メイン画面（ノート本文）: --note-font-family / --note-font-size
  useEffect(() => {
    const opt = FONT_FAMILY_OPTIONS.find((o) => o.value === settings.fontFamily);
    if (opt) {
      document.documentElement.style.setProperty(
        '--note-font-family',
        opt.cssValue,
      );
    }
  }, [settings.fontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--note-font-size',
      `${settings.fontSize}px`,
    );
  }, [settings.fontSize]);

  // サイドメニュー: --sidebar-font-family / --sidebar-font-size
  useEffect(() => {
    const opt = FONT_FAMILY_OPTIONS.find(
      (o) => o.value === settings.sidebarFontFamily,
    );
    if (opt) {
      document.documentElement.style.setProperty(
        '--sidebar-font-family',
        opt.cssValue,
      );
    }
  }, [settings.sidebarFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-font-size',
      `${settings.sidebarFontSize}px`,
    );
  }, [settings.sidebarFontSize]);

  // 検索履歴を SQLite に保存（persist モード時のみ）
  const persistSearchHistory = useCallback(
    async (list: string[], mode: AppSettings['searchHistoryMode']) => {
      if (mode === 'persist') {
        await window.api.settings.set(
          'search.history',
          JSON.stringify(list),
        );
      }
    },
    [],
  );

  const handleSettingChange = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const prev = settings;
      const nextSettings: AppSettings = { ...prev, [key]: value };
      setSettings(nextSettings);
      const record = settingToRecord(key, value);
      await window.api.settings.set(record.key, record.value);

      // 検索履歴の件数が縮小された場合は既存履歴をプルーン
      if (key === 'searchHistoryLimit') {
        const limit = value as number;
        setSearchHistory((current) => {
          const pruned = current.slice(0, limit);
          void persistSearchHistory(pruned, nextSettings.searchHistoryMode);
          return pruned;
        });
      }

      // 開封履歴の件数が縮小された場合は既存履歴をプルーン
      if (key === 'historyLimit') {
        const limit = value as number;
        setOpenHistory((current) => {
          if (current.length <= limit) return current;
          const pruned = current.slice(0, limit);
          void window.api.settings.set(
            'history.openedNotes',
            JSON.stringify(pruned),
          );
          return pruned;
        });
      }

      // 保存方式が reset → persist に切り替わったら現状の履歴を保存
      if (
        key === 'searchHistoryMode' &&
        prev.searchHistoryMode === 'reset' &&
        value === 'persist'
      ) {
        setSearchHistory((current) => {
          void window.api.settings.set(
            'search.history',
            JSON.stringify(current),
          );
          return current;
        });
      }
    },
    [persistSearchHistory, settings],
  );

  // ノート開封履歴: 永続化ヘルパ
  const persistOpenHistory = useCallback(
    async (list: { noteId: string; openedAt: number }[]) => {
      await window.api.settings.set(
        'history.openedNotes',
        JSON.stringify(list),
      );
    },
    [],
  );

  // ノート開封履歴: 同一 noteId は最新だけ残す。historyLimit でトリム。
  // settings.historyEnabled が OFF なら記録しない。
  // 既にトップにいる場合は no-op (編集中に毎キーストロークで呼ばれても安全)。
  const recordNoteOpen = useCallback(
    (noteId: string) => {
      if (!settings.historyEnabled) return;
      setOpenHistory((current) => {
        if (current[0]?.noteId === noteId) return current;
        const filtered = current.filter((e) => e.noteId !== noteId);
        const next = [
          { noteId, openedAt: Date.now() },
          ...filtered,
        ].slice(0, settings.historyLimit);
        void persistOpenHistory(next);
        return next;
      });
    },
    [settings.historyEnabled, settings.historyLimit, persistOpenHistory],
  );

  /**
   * 履歴パネルから選択された noteId を一時的に保持する ref。
   * activeId 変更を検知する useEffect 側で、この id と一致する遷移は
   * 「履歴クリック由来」なので履歴に再記録しない (順序を保つ)。
   * 編集が発生したら recordNoteOpen を明示的に呼んでトップへ繰り上げる。
   */
  const skipHistoryRecordForRef = useRef<string | null>(null);

  /**
   * 「解錠後に実際に編集 (body / meta) が走ったかどうか」を追跡する集合。
   * 別ノートへ切替えた瞬間に未編集ノートは自動的に再ロックする方針なので、
   * このセットに居ない解錠ノートは selectNote で removeFromUnlocked される。
   * 編集発生時 (handleBodyChange / scheduleMetaSave) に追加され、
   * 再ロック時 (selectNote の手前 or pwd 再解錠時) にクリアされる。
   */
  const editedAfterUnlockRef = useRef<Set<string>>(new Set());

  const handleClearOpenHistory = useCallback(() => {
    setOpenHistory([]);
    void persistOpenHistory([]);
  }, [persistOpenHistory]);

  // activeId が変わるたびに開封履歴を記録（historyEnabled=true のときのみ）。
  // ただし「履歴パネルから直接クリックで開いた」場合は skipHistoryRecordForRef
  // と一致するので、その一度だけ記録をスキップ (履歴の順序が動かないようにする)。
  // recordNoteOpen 内で OFF なら早期 return するため、ここで活性判定は不要。
  useEffect(() => {
    if (!activeId) return;
    if (skipHistoryRecordForRef.current === activeId) {
      // 履歴クリックでの遷移 → 記録しない。次回以降のため ref はクリア。
      skipHistoryRecordForRef.current = null;
      return;
    }
    recordNoteOpen(activeId);
  }, [activeId, recordNoteOpen]);

  // historyEnabled が OFF になった瞬間、サイドバーが history モードのままだと
  // アクティビティバーから戻れなくなるので、files にフォールバックする。
  useEffect(() => {
    if (!settings.historyEnabled && sidebarMode === 'history') {
      setSidebarMode('files');
    }
  }, [settings.historyEnabled, sidebarMode]);

  // カレンダー無効化中に calendar モード表示だった場合、files にフォールバック
  useEffect(() => {
    if (!settings.calendarEnabled && sidebarMode === 'calendar') {
      setSidebarMode('files');
    }
  }, [settings.calendarEnabled, sidebarMode]);

  // プラグイン提供モードがサイドバーで表示中だったが、そのプラグインが
  // 無効化された場合は files モードへ自動的に戻す。
  // 「組み込みモード以外 ＆ どの有効化プラグインも mode を提供していない」が条件。
  useEffect(() => {
    const builtins = new Set([
      'files',
      'search',
      'tags',
      'history',
      'calendar',
      'sync',
    ]);
    if (builtins.has(sidebarMode)) return;
    const enabled = getEnabledPlugins(settings.enabledPlugins);
    const provided = enabled.some(
      (p) => p.module.activityBarItem?.mode === sidebarMode,
    );
    if (!provided) setSidebarMode('files');
  }, [settings.enabledPlugins, sidebarMode]);

  // 履歴に追加（新しい順、重複除去、上限プルーン）
  const handleAddSearchHistory = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setSearchHistory((current) => {
        const filtered = current.filter((h) => h !== trimmed);
        const next = [trimmed, ...filtered].slice(0, settings.searchHistoryLimit);
        void persistSearchHistory(next, settings.searchHistoryMode);
        return next;
      });
    },
    [
      settings.searchHistoryLimit,
      settings.searchHistoryMode,
      persistSearchHistory,
    ],
  );

  // ----- Editor へのコマンド呼び出し用 ref -----
  const editorRef = useRef<EditorHandle>(null);
  /** エディタにカーソル/フォーカスがあるか。EditorToolbar の有効/無効を切り替える */
  const [editorFocused, setEditorFocused] = useState(false);
  // preview モードに切替えたら editorFocused をリセット（次回 edit/mix 切替後の
  // 「toolbar が前回の focus 状態で開く」を防ぐ）
  useEffect(() => {
    if (view === 'preview') setEditorFocused(false);
  }, [view]);

  // ----- 文字数 / 単語数（フッタ右端に表示） -----
  // 文字数は body.length（改行や空白を含む素直な値）。
  // 単語数は混在テキストに対応するため CJK 文字（漢字 / かな / 全角記号一部）は
  // 1 文字 = 1 語、それ以外は連続英数字を 1 語として加算する。
  const noteStats = useMemo(() => {
    const chars = body.length;
    const cjkMatches = body.match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/g);
    const latinMatches = body.match(/[A-Za-z0-9]+(?:[''-][A-Za-z0-9]+)*/g);
    const words = (cjkMatches?.length ?? 0) + (latinMatches?.length ?? 0);
    return { chars, words };
  }, [body]);

  // ----- MIX (ライブプレビュー) のスクロール同期 -----
  // Editor / Preview それぞれがコンポーネント内部で scroll を購読し、
  // onScroll コールバックでスクロール要素自体を渡してくれる。
  // 受け取った側で比率を計算して反対側の scrollTop を更新する。
  const mixBodyRef = useRef<HTMLDivElement | null>(null);
  const previewMixRef = useRef<PreviewHandle | null>(null);
  // ----- MIX モードの左右分割比 (Editor 側の % 値、0-100) -----
  // ユーザーが境界線をドラッグして変更可能。localStorage に永続化。
  // 旧バージョンでは 50/50 固定だったため未保存 = 50 を既定値にする。
  const [mixSplitPercent, setMixSplitPercent] = useState<number>(() => {
    try {
      const raw = window.localStorage?.getItem('inknel.mixSplitPercent');
      const n = raw ? parseFloat(raw) : NaN;
      if (Number.isFinite(n) && n >= 15 && n <= 85) return n;
    } catch {
      /* localStorage 不可環境はデフォルト */
    }
    return 50;
  });
  const [mixResizing, setMixResizing] = useState(false);
  // mousemove 中の比率更新。コンテナの絶対座標を基準に Editor 側の幅を %換算。
  useEffect(() => {
    if (!mixResizing) return;
    const handleMove = (e: MouseEvent) => {
      const el = mixBodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = ((e.clientX - rect.left) / rect.width) * 100;
      // 端まで寄せて両方が潰れないよう 15-85% にクランプ
      const clamped = Math.min(85, Math.max(15, next));
      setMixSplitPercent(clamped);
    };
    const handleUp = () => setMixResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [mixResizing]);
  // 分割比をデバウンスで localStorage へ永続化
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage?.setItem(
          'inknel.mixSplitPercent',
          String(mixSplitPercent),
        );
      } catch {
        /* quota / privacy mode */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mixSplitPercent]);
  // 片側を programmatic に動かしている間は反対側の scroll コールバックを無視する
  // ガード。requestAnimationFrame の次フレームで自動的に解除。
  const isSyncingScrollRef = useRef(false);
  const syncScroll = useCallback(
    (source: HTMLElement, target: HTMLElement | null) => {
      if (!target) return;
      if (isSyncingScrollRef.current) return;
      const maxSrc = source.scrollHeight - source.clientHeight;
      const maxTgt = target.scrollHeight - target.clientHeight;
      if (maxSrc <= 0 || maxTgt <= 0) return;
      const ratio = source.scrollTop / maxSrc;
      isSyncingScrollRef.current = true;
      target.scrollTop = ratio * maxTgt;
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    },
    [],
  );
  const handleEditorScroll = useCallback(
    (scrollEl: HTMLElement) => {
      if (view !== 'mix') return;
      syncScroll(scrollEl, previewMixRef.current?.getScrollElement() ?? null);
    },
    [view, syncScroll],
  );
  const handlePreviewScroll = useCallback(
    (scrollEl: HTMLElement) => {
      if (view !== 'mix') return;
      syncScroll(scrollEl, editorRef.current?.getScrollElement() ?? null);
    },
    [view, syncScroll],
  );
  const sidebarRef = useRef<SidebarHandle>(null);
  const aiChatWidthRef = useRef<number>(AI_CHAT_WIDTH_DEFAULT);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const syncingNoteSeqRef = useRef(0);

  // ----- 設定メニュー購読 -----
  useEffect(() => {
    return window.api?.onOpenPreferences(() => {
      void window.api.openPreferencesWindow();
    });
  }, []);

  useEffect(() => {
    return window.api?.onSettingsChanged(() => {
      void (async () => {
        const rawSettings = await window.api.settings.getAll();
        const parsed = parseSettings(rawSettings);
        setSettings(parsed);
        setSidebarWidth(parsed.sidebarWidth);
        setAiChatWidth(parseAiChatWidth(rawSettings[AI_CHAT_WIDTH_SETTING_KEY]));
      })();
    });
  }, []);

  // 別ウィンドウ(設定パネル)で importedPlugins が増えた場合、こちらの
  // ランタイム registry にはまだ載っていないので、差分を取って import する。
  // これにより設定でトグル ON した瞬間、メインウィンドウのアクティビティバーへ
  // すぐ反映される(再起動不要)。
  useEffect(() => {
    if (isPreferencesWindow) return;
    const runtimeIds = new Set(getRuntimePlugins().map((p) => p.id));
    for (const id of settings.importedPlugins) {
      if (runtimeIds.has(id)) continue;
      void (async () => {
        try {
          await importPluginById(id);
        } catch (err) {
          console.warn(
            '[plugins] auto-import on settings change failed',
            id,
            err,
          );
        }
      })();
    }
  }, [settings.importedPlugins, isPreferencesWindow]);

  useEffect(() => {
    aiChatWidthRef.current = aiChatWidth;
  }, [aiChatWidth]);

  // ============================================================
  // メイン画面の Cmd/Ctrl + ホイールでフォントサイズを増減
  // ============================================================
  // macOS は metaKey、Windows/Linux は ctrlKey をズーム修飾キーとする (ブラウザの慣行)。
  // wheel イベントは passive デフォルト true なので preventDefault のため
  // capture/passive: false で手動 attach する必要がある。
  // 変更時に中央へ現在サイズをチップ表示する (fontSizeIndicator)。
  const [fontSizeIndicator, setFontSizeIndicator] = useState<number | null>(
    null,
  );
  const fontSizeIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    const target = workspaceRef.current;
    if (!target) return;
    const isMac =
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPod|iPad/.test(navigator.platform);

    const onWheel = (e: WheelEvent) => {
      const zoomKey = isMac ? e.metaKey : e.ctrlKey;
      if (!zoomKey) return;
      e.preventDefault();
      // 上 (deltaY < 0) で拡大、下で縮小
      const direction = e.deltaY < 0 ? +1 : -1;
      const current = settings.fontSize as number;
      const min = FONT_SIZE_OPTIONS[0];
      const max = FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1];
      const next = Math.min(max, Math.max(min, current + direction));
      // 端での操作でも視覚フィードバックは出す
      setFontSizeIndicator(next);
      if (fontSizeIndicatorTimerRef.current) {
        clearTimeout(fontSizeIndicatorTimerRef.current);
      }
      fontSizeIndicatorTimerRef.current = setTimeout(() => {
        setFontSizeIndicator(null);
        fontSizeIndicatorTimerRef.current = null;
      }, 900);
      if (next === current) return;
      void handleSettingChange('fontSize', next as FontSize);
    };

    // passive: false で preventDefault を呼べるようにする
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => target.removeEventListener('wheel', onWheel);
  }, [settings.fontSize, handleSettingChange]);
  // アンマウント時にタイマー残骸を掃除
  useEffect(() => {
    return () => {
      if (fontSizeIndicatorTimerRef.current) {
        clearTimeout(fontSizeIndicatorTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!aiChatResizing) return;

    const handleMove = (e: MouseEvent) => {
      const workspace = workspaceRef.current;
      const workspaceRight =
        workspace?.getBoundingClientRect().right ?? window.innerWidth;
      const next = clamp(
        workspaceRight - e.clientX - AI_CHAT_SPLITTER_WIDTH,
        AI_CHAT_WIDTH_MIN,
        AI_CHAT_WIDTH_MAX,
      );
      setAiChatWidth(next);
    };
    const handleUp = () => {
      setAiChatResizing(false);
      void window.api.settings.set(
        AI_CHAT_WIDTH_SETTING_KEY,
        String(aiChatWidthRef.current),
      );
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [aiChatResizing]);

  // ----- 印刷メニュー購読 -----
  // メインプロセスの「印刷...」メニューが押されたら window.print() を呼び、
  // OS のプリントダイアログを開く。@media print の CSS で UI 周りは隠してある。
  //
  // macOS の「PDF として保存」のデフォルトファイル名は document.title から決まるため、
  // 印刷前にノート名へ一時的に書き換え、印刷後に元のタイトルへ戻す。
  // 現在のノートから「保存時のファイル名ベース」を組み立てる（スラッシュは " - " に）
  const buildDefaultExportName = useCallback((): string => {
    return (
      [editingFolder, editingTitle]
        .filter((s) => s.length > 0)
        .join(' - ') || '無題'
    );
  }, [editingFolder, editingTitle]);

  // 印刷（OS の印刷ダイアログ）を開く。document.title を一時的にノート名に変える。
  const triggerPrint = useCallback(() => {
    const originalTitle = document.title;
    const noteName = buildDefaultExportName();
    document.title = noteName;
    window.setTimeout(() => {
      try {
        window.print();
      } finally {
        document.title = originalTitle;
      }
    }, 0);
  }, [buildDefaultExportName]);

  useEffect(() => {
    return window.api?.onPrint(() => triggerPrint());
  }, [triggerPrint]);

  // ----- ケバブメニュー: PDF / Markdown 購読（印刷は onPrint で拾う） -----
  // 具体的なハンドラは下記 handleExportPdf / handleExportMarkdown。
  // 最新クロージャを呼ぶため ref 経由で発火する。
  const exportPdfRef = useRef<(() => void) | null>(null);
  const exportMarkdownRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return window.api?.ui?.onExportPdf(() => exportPdfRef.current?.());
  }, []);
  useEffect(() => {
    return window.api?.ui?.onExportMarkdown(() =>
      exportMarkdownRef.current?.(),
    );
  }, []);

  // ----- NoteHeader ケバブメニュー: PDF / Markdown / 印刷 -----
  // PDF は preview モードで出力したいので、edit 中なら一度 preview に切り替える。
  const handleExportPdf = useCallback(async () => {
    if (!activeId) return;
    const defaultName = buildDefaultExportName();
    // edit / mix モードの場合は preview に切替えてから PDF 出力する
    const wasNotPreview = view !== 'preview';
    if (wasNotPreview) setView('preview');
    // 次の描画フレームまで待ってから printToPDF を呼ぶ
    await new Promise((r) => window.setTimeout(r, wasNotPreview ? 120 : 0));
    const originalTitle = document.title;
    document.title = defaultName;
    try {
      await window.api.files.exportPdf(defaultName);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'PDF 出力に失敗しました',
      );
    } finally {
      document.title = originalTitle;
    }
  }, [activeId, buildDefaultExportName, view, setView]);

  const handleExportMarkdown = useCallback(async () => {
    if (!activeId) return;
    const defaultName = buildDefaultExportName();
    try {
      await window.api.files.exportMarkdown(defaultName, body);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Markdown 保存に失敗しました',
      );
    }
  }, [activeId, body, buildDefaultExportName]);

  // ref に最新のハンドラを入れておく（購読側から呼ばれる）
  exportPdfRef.current = () => void handleExportPdf();
  exportMarkdownRef.current = () => void handleExportMarkdown();

  // ----- ファイル / ディレクトリインポートの進捗表示用 -----
  // フッターのプログレスバーで進捗を可視化する。
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);

  // ----- ファイル読み込み (.md インポート) -----
  // メニュー「ファイルの読み込み」押下で起動。OS のファイルダイアログで
  // .md ファイルを 1 つ以上選択し、それぞれを folder='読み込みファイル' で
  // ノートとして DB に追加する。
  const handleImportMd = useCallback(async () => {
    try {
      const imported = await window.api.notes.importMd();
      if (imported.length === 0) return;
      let lastId: string | null = null;
      const total = imported.length;
      setImportProgress({ current: 0, total, fileName: '' });
      for (let i = 0; i < imported.length; i++) {
        const file = imported[i];
        setImportProgress({
          current: i + 1,
          total,
          fileName: file.name || '無題',
        });
        const created = await window.api.notes.create({
          title: file.name || '無題',
          folder: '読み込みファイル',
          body: file.body,
        });
        lastId = created.id;
        // UI が進捗を描画できるように event loop に制御を返す
        await new Promise((r) => setTimeout(r, 0));
      }
      // ノート一覧を再取得
      const list = await window.api.notes.list();
      setNotes(list);
      if (lastId) {
        await selectNote(lastId, list);
      }
      setSidebarMode('files');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    } catch (err) {
      window.alert(
        'ファイルの読み込みに失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setImportProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarCollapsed]);

  useEffect(() => {
    return window.api?.onImportMd(() => void handleImportMd());
  }, [handleImportMd]);

  // ----- ディレクトリ読み込み -----
  // 選択したディレクトリ配下の .md を再帰走査して
  // 読み込みファイル/<ディレクトリ名>/<サブフォルダ>/<ノート> として
  // 一括インポートする。
  const handleImportDir = useCallback(async () => {
    try {
      const imported = await window.api.notes.importDir();
      if (imported.length === 0) return;
      let lastId: string | null = null;
      const total = imported.length;
      setImportProgress({ current: 0, total, fileName: '' });
      for (let i = 0; i < imported.length; i++) {
        const file = imported[i];
        setImportProgress({
          current: i + 1,
          total,
          fileName: file.subFolder
            ? `${file.subFolder}/${file.name || '無題'}`
            : file.name || '無題',
        });
        const folder = file.subFolder
          ? `読み込みファイル/${file.subFolder}`
          : '読み込みファイル';
        const created = await window.api.notes.create({
          title: file.name || '無題',
          folder,
          body: file.body,
        });
        lastId = created.id;
        // UI 更新のために event loop に譲る
        // 数十件以上あると毎回譲ると遅すぎるので 5 件ごと
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      const list = await window.api.notes.list();
      setNotes(list);
      if (lastId) {
        await selectNote(lastId, list);
      }
      setSidebarMode('files');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    } catch (err) {
      window.alert(
        'ディレクトリの読み込みに失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setImportProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarCollapsed]);

  useEffect(() => {
    return window.api?.onImportDir(() => void handleImportDir());
  }, [handleImportDir]);

  // ----- 初回ロード -----
  useEffect(() => {
    void (async () => {
      if (isPreferencesWindow) {
        const rawSettings = await window.api.settings.getAll();
        const parsed = parseSettings(rawSettings);
        setSettings(parsed);
        setSidebarWidth(parsed.sidebarWidth);
        setAiChatWidth(parseAiChatWidth(rawSettings[AI_CHAT_WIDTH_SETTING_KEY]));
        // 設定ウィンドウは別レンダラープロセスで動くため、runtimePlugins が
        // 空の状態で起動する。DL 版プラグインの SettingsComponent を表示するには
        // ここでもインポート済みプラグインをランタイムに載せる必要がある。
        // 失敗してもウィンドウ起動自体は継続。
        try {
          await loadImportedPlugins(parsed.importedPlugins);
        } catch (err) {
          console.warn(
            '[plugins] import on prefs window startup failed:',
            err,
          );
        }
        return;
      }
      const [list, trashed, folderList, folderColors, rawSettings] =
        await Promise.all([
          window.api.notes.list(),
          window.api.notes.listTrashed(),
          window.api.folders.list(),
          // 共有 folders.json と DB をマージしてから返してもらう
          // (他デバイスでの色変更があれば起動時に反映)
          window.api.folders.syncIconColors(),
          window.api.settings.getAll(),
        ]);
      setNotes(list);
      setTrashedNotes(trashed);
      setFolders(folderList);
      setFolderIconColors(folderColors);
      const parsed = parseSettings(rawSettings);
      setSettings(parsed);
      // 永続化されたサイドバー幅を反映
      setSidebarWidth(parsed.sidebarWidth);
      setAiChatWidth(parseAiChatWidth(rawSettings[AI_CHAT_WIDTH_SETTING_KEY]));

      // 検索履歴: persist モード時のみ DB から復元
      if (parsed.searchHistoryMode === 'persist') {
        const raw = rawSettings['search.history'];
        if (raw) {
          try {
            const arr = JSON.parse(raw);
            if (
              Array.isArray(arr) &&
              arr.every((s) => typeof s === 'string')
            ) {
              setSearchHistory(arr.slice(0, parsed.searchHistoryLimit));
            }
          } catch {
            // 不正なJSON は無視
          }
        }
      }

      // ノート開封履歴: 常に復元（記録 ON/OFF と件数のみ設定で制御）
      {
        const raw = rawSettings['history.openedNotes'];
        if (raw) {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
              const validated = arr
                .filter(
                  (e): e is { noteId: string; openedAt: number } =>
                    !!e &&
                    typeof e === 'object' &&
                    typeof (e as { noteId?: unknown }).noteId === 'string' &&
                    typeof (e as { openedAt?: unknown }).openedAt === 'number',
                )
                .slice(0, parsed.historyLimit);
              setOpenHistory(validated);
            }
          } catch {
            // 不正なJSON は無視
          }
        }
      }

      // ----- タブの復元 -----
      // 前回開いていたタブをリストアする。存在しない ID は除外。
      const existingIds = new Set(list.map((n) => n.id));
      let restoredTabs: string[] = [];
      const rawTabs = rawSettings['ui.openTabs'];
      if (rawTabs) {
        try {
          const arr = JSON.parse(rawTabs);
          if (Array.isArray(arr)) {
            restoredTabs = arr.filter(
              (s): s is string => typeof s === 'string' && existingIds.has(s),
            );
          }
        } catch {
          // 不正な JSON は無視
        }
      }
      if (restoredTabs.length > 0) {
        setOpenTabIds(restoredTabs);
        setTabViews(
          Object.fromEntries(restoredTabs.map((id) => [id, 'preview'])),
        );
        // ピン状態の復元。保存されていなければ「開いていたタブ全部をピン扱い」で
        // 互換 (旧モデルは preview-tab 以外すべて 📍 を表示していたため、復元時に
        // ピン無しだとユーザー体感が悪化する)。
        const rawPins = rawSettings['ui.pinnedTabs'];
        let restoredPins: string[] = [];
        if (rawPins) {
          try {
            const arr = JSON.parse(rawPins);
            if (Array.isArray(arr)) {
              restoredPins = arr.filter(
                (s): s is string =>
                  typeof s === 'string' && restoredTabs.includes(s),
              );
            }
          } catch {
            /* 不正な JSON は無視 */
          }
        } else {
          // 初回 (旧バージョンからのアップグレード) は全タブをピン扱い
          restoredPins = [...restoredTabs];
        }
        setPinnedTabIds(restoredPins);
        const savedActive = rawSettings['ui.activeTab'];
        const activeToLoad =
          savedActive && restoredTabs.includes(savedActive)
            ? savedActive
            : restoredTabs[0];
        await selectNote(activeToLoad, list);
      } else if (list.length > 0) {
        await selectNote(list[0].id, list);
      }

      // ----- 起動時のクラウド同期（旧 share API 経由、現在は使われない可能性が高い） -----
      // 共有プロバイダが設定されていたら、起動直後に双方向同期を走らせる。
      if (parsed.shareProvider !== 'none') {
        try {
          const result = await window.api.share.sync(parsed.shareProvider);
          if (result.pulled > 0) {
            const refreshed = await window.api.notes.list();
            setNotes(refreshed);
          }
        } catch (err) {
          console.warn('[share] 起動時同期に失敗:', err);
        }
      }

      // ----- 起動時のストレージ自動同期 -----
      // 設定でカスタム保存先フォルダが指定されている場合のみ、起動時に自動で
      // スキャン+同期を行う。既定の userData (storagePath が空) なら何もしない。
      if (parsed.storagePath.trim().length > 0) {
        try {
          const scan = await window.api.storage.scan();
          const diffCount =
            scan.dbToDiskTargets.length +
            scan.diskToDbTargets.length +
            scan.dbDeleteTargets.length;
          if (diffCount > 0) {
            await window.api.storage.sync();
            // 取り込みでノートが増えた / メタが変わった可能性があるので
            // notes / folders と folderIconColors を取り直して画面に反映する。
            // storage:sync 内で folders.json ↔ DB の merge も走っているので
            // ここでは listIconColors で十分 (再度の merge は不要)。
            const [refreshedNotes, refreshedFolders, refreshedColors] =
              await Promise.all([
                window.api.notes.list(),
                window.api.folders.list(),
                window.api.folders.listIconColors(),
              ]);
            setNotes(refreshedNotes);
            setFolders(refreshedFolders);
            setFolderIconColors(refreshedColors);
            // 現在開いているアクティブノートが更新されていれば本文も再読み込み
            if (activeId) {
              try {
                const body = await window.api.notes.readBody(activeId);
                setBody(body);
              } catch {
                /* ignore */
              }
            }
          }
        } catch (err) {
          console.warn('[storage] 起動時自動同期に失敗:', err);
          // 失敗してもアプリ起動は継続
        }
      }

      // ----- インポート済みプラグインの再ロード -----
      // 「ダウンロード = ファイル保存だけ」「インポート = runtime 登録」の二段構成。
      // ここでは settings.importedPlugins に永続化された ID のみを再ロードする。
      try {
        await loadImportedPlugins(parsed.importedPlugins);
      } catch (err) {
        console.warn('[plugins] import on startup failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ----- タブの永続化 -----
  // openTabIds / activeId が変わるたびに settings に保存（デバウンス）。
  // 起動直後の初期化フェーズは書き込みを抑制するため、マウント完了後にのみ反映。
  const tabsPersistReady = useRef(false);
  useEffect(() => {
    if (isPreferencesWindow) return;
    // 初回レンダリング時は skip（初期ロードが終わった次のレンダリングから有効化）
    if (!tabsPersistReady.current) {
      tabsPersistReady.current = true;
      return;
    }
    const timer = setTimeout(() => {
      void window.api.settings.set(
        'ui.openTabs',
        JSON.stringify(openTabIds),
      );
      void window.api.settings.set('ui.activeTab', activeId ?? '');
      void window.api.settings.set(
        'ui.pinnedTabs',
        JSON.stringify(pinnedTabIds),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [openTabIds, activeId, pinnedTabIds]);

  // ----- ノート選択（保留中の保存をフラッシュしてから切り替え） -----
  // 保護ノートとシークレットノートは、セッション中に未解錠なら
  // パスワードダイアログを先に開き、認証後に再度この関数が呼ばれて
  // 実際にロードされる。
  //
  // 第 3 引数 `bypassLockChecks` は、パスワード認証後に handlePasswordSubmit から
  // 再呼び出しする時に true を渡す。useCallback のクロージャキャプチャにより
  // setTimeout が掴んでいる state が古いままなので、明示的に
  // チェックをバイパスしないとダイアログが再度開いてしまう。
  const selectNote = useCallback(
    async (
      id: string,
      fromList?: NoteMeta[],
      bypassLockChecks?: boolean,
      options?: { pin?: boolean },
    ) => {
      const list = fromList ?? notes;
      const meta = list.find((n) => n.id === id);
      if (!meta) return;

      if (!bypassLockChecks) {
        // シークレットかつ未解錠 → パスワード要求
        if (meta.secret && !unlockedSecretIds.has(id)) {
          setPasswordPurpose({ kind: 'view-secret', noteId: id });
          return;
        }
        // ※ 保護ノートは表示(プレビュー)は自由。
        //   編集モードへの切替時に handleSelectEditOrPreview で
        //   unlock-edit ダイアログを表示する。
      }

      await flushPendingSaves();
      const loadedBody = await window.api.notes.readBody(id);

      // ----- 「未編集の解錠ノート」を別ノート遷移で再ロック -----
      // 保護ノートを解錠 → 編集せず別ノートへ切替えた場合、保護状態へ戻す
      // (= サイドバーの錠前アイコンが赤→白に戻る)。
      // 自分自身への遷移、認証フロー (bypassLockChecks) では何もしない。
      const prevId = activeId;
      if (
        prevId !== null &&
        prevId !== id &&
        !bypassLockChecks &&
        unlockedNoteIds.has(prevId) &&
        !editedAfterUnlockRef.current.has(prevId)
      ) {
        setUnlockedNoteIds((prev) => {
          if (!prev.has(prevId)) return prev;
          const next = new Set(prev);
          next.delete(prevId);
          return next;
        });
      }
      // 切替先の編集追跡もリセット (新ノートで編集すれば再度追加される)
      editedAfterUnlockRef.current.delete(id);

      setActiveId(id);
      setEditingTitle(meta.title);
      setEditingFolder(meta.folder);
      setEditingTags(meta.tags ?? []);
      setBody(loadedBody);
      // セッショントラッキング: 初期メディア参照を記録
      sessionImagesRef.current = extractImageRefs(loadedBody);
      sessionAttachmentsRef.current = extractAttachmentRefs(loadedBody);

      // ----- タブの追加 / プレビュータブの切り替え -----
      // - options.pin=true (ダブルクリック由来): 既存の preview-tab を置換せず、
      //   常に新規タブとして追加する。previewTabId は変更しない（既存の
      //   preview-tab はそのまま残る）。結果として 📍 が立つ。
      // - openNoteInNewTab=true: 常に新規タブ追加（VS Code でいう「シングル
      //   クリック=新しいタブ」モード）。previewTabId は使わない。
      // - openNoteInNewTab=false (既定): プレビュータブ動作。直前の preview-tab を
      //   ・存在 ・未編集 ・自分以外、なら閉じて新ノートを同位置に置く。
      // ----- ピン (📍) の永続化ロジック -----
      // ピン状態は新モデルでは明示的 (pinnedTabIds) に管理される。
      // pin=true で開いた / 編集したタブはここに入り、閉じるまで外れない。
      // 既にピンされているタブ id を再選択する経路では、preview-tab 経路は
      // 一切走らせず「現在の表示状態を変えない選択」だけする。
      const alreadyPinned = pinnedTabIds.includes(id);

      if (options?.pin) {
        // ピン留めオープン: 末尾に追加する(既に開いていれば順序維持)。
        setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        // pinnedTabIds に追加 + previewTabId と相互排他にする
        setPinnedTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setPreviewTabId((prev) => (prev === id ? null : prev));
      } else if (settings.openNoteInNewTab) {
        // 単純に追加
        setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        // 新規タブモードでは preview-tab の概念を使わない
        setPreviewTabId(null);
      } else if (alreadyPinned) {
        // 既にピンされているタブをクリック (タブバー or サイドバー):
        // 既存のピンを維持し、preview-tab 入替えロジックを走らせない。
        // → タブクリックでピンが一時的に消えるバグを根本解決。
        setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } else {
        // プレビュータブモード (未ピンタブの単発クリック)
        setOpenTabIds((prev) => {
          // 既に開いていれば preview 入替え不要、そのまま選択するだけ
          if (prev.includes(id)) return prev;
          // 直前のプレビュータブが存在し、それが「未編集」(= previewTabId が
          // クリアされていない)で「未ピン」かつ自分自身ではないなら閉じて入替え
          if (
            previewTabId &&
            previewTabId !== id &&
            !pinnedTabIds.includes(previewTabId) &&
            prev.includes(previewTabId)
          ) {
            return prev.map((x) => (x === previewTabId ? id : x));
          }
          // それ以外は末尾に追加
          return [...prev, id];
        });
        // この新しいタブは「プレビュータブ」として記録
        setPreviewTabId(id);
        // 旧プレビュータブの view モードエントリを掃除（残しても無害だが整える）
        if (previewTabId && previewTabId !== id) {
          setTabViews((prev) => {
            if (!(previewTabId in prev)) return prev;
            const next = { ...prev };
            delete next[previewTabId];
            return next;
          });
        }
      }
      // タブごとの view モード: 初回は preview、既存なら保持
      setTabViews((prev) => (prev[id] ? prev : { ...prev, [id]: 'preview' }));

      // ----- バックグラウンドでクラウドの最新を確認 -----
      // ローカル版をまず即座に表示した後で、クラウドの方が新しければ pull して
      // body と notes 一覧を更新する。
      // 取り込み中は syncingNoteId を立てて状態表示する。
      // 遅延・障害時でも操作を止めないよう、一定時間で古い同期結果として扱う。
      if (settings.shareProvider !== 'none') {
        const syncSeq = ++syncingNoteSeqRef.current;
        setSyncingNoteId(id);
        const clearSyncingIfCurrent = () => {
          if (syncingNoteSeqRef.current === syncSeq) {
            setSyncingNoteId(null);
          }
        };
        const syncTimeout = window.setTimeout(() => {
          if (syncingNoteSeqRef.current === syncSeq) {
            syncingNoteSeqRef.current += 1;
            setSyncingNoteId(null);
          }
        }, 15_000);
        void window.api.share
          .checkNote(settings.shareProvider, id)
          .then(async (result) => {
            if (syncingNoteSeqRef.current !== syncSeq) return;
            if (result === 'pulled') {
              // クラウドが新しかった → 表示中のノートを再読み込み
              const refreshedList = await window.api.notes.list();
              if (syncingNoteSeqRef.current !== syncSeq) return;
              setNotes(refreshedList);
              const refreshedMeta = refreshedList.find((n) => n.id === id);
              if (refreshedMeta) {
                setEditingTitle(refreshedMeta.title);
                setEditingFolder(refreshedMeta.folder);
                setEditingTags(refreshedMeta.tags ?? []);
              }
              const refreshedBody = await window.api.notes.readBody(id);
              if (syncingNoteSeqRef.current !== syncSeq) return;
              setBody(refreshedBody);
              sessionImagesRef.current = extractImageRefs(refreshedBody);
              sessionAttachmentsRef.current = extractAttachmentRefs(refreshedBody);
            }
            // 'pushed' / 'same' / 'skip' → UI 変更不要
            window.clearTimeout(syncTimeout);
            clearSyncingIfCurrent();
          })
          .catch(() => {
            // ネットワーク障害等: ブロックを解除してそのまま操作可能
            window.clearTimeout(syncTimeout);
            clearSyncingIfCurrent();
          });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      notes,
      unlockedSecretIds,
      unlockedNoteIds,
      activeId,
      settings.shareProvider,
      settings.openNoteInNewTab,
      previewTabId,
      pinnedTabIds,
    ],
  );

  // ----- 自動保存（デバウンス） -----
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBody = useRef<{ id: string; body: string } | null>(null);
  const pendingMeta = useRef<{
    id: string;
    title: string;
    folder: string;
    tags: string[];
  } | null>(null);

  const flushPendingSaves = useCallback(async () => {
    if (bodyTimer.current) {
      clearTimeout(bodyTimer.current);
      bodyTimer.current = null;
    }
    if (metaTimer.current) {
      clearTimeout(metaTimer.current);
      metaTimer.current = null;
    }
    if (pendingBody.current) {
      const { id, body } = pendingBody.current;
      pendingBody.current = null;
      await window.api.notes.updateBody(id, body);
    }
    if (pendingMeta.current) {
      const { id, title, folder, tags } = pendingMeta.current;
      pendingMeta.current = null;
      const updated = await window.api.notes.updateMeta(id, {
        title,
        folder,
        tags,
      });
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n)),
      );
    }
  }, []);

  const handleBodyChange = useCallback(
    (next: string) => {
      setBody(next);
      // 編集中に新しく追加されたメディア参照をセッションに蓄積
      // (削除→Undo→再削除のような操作でも追跡できるよう union を取る)
      for (const f of extractImageRefs(next)) sessionImagesRef.current.add(f);
      for (const f of extractAttachmentRefs(next))
        sessionAttachmentsRef.current.add(f);

      if (!activeId) return;
      // 編集中のタブを「固定 (ピン)」状態に昇格させる:
      //   - pinnedTabIds へ追加 (以降タブクリックでもピン外れない)
      //   - 同タブが previewTabId だったら相互排他のため null に
      if (previewTabId && previewTabId === activeId) {
        setPreviewTabId(null);
      }
      setPinnedTabIds((prev) =>
        prev.includes(activeId) ? prev : [...prev, activeId],
      );
      // 履歴から開いただけでは履歴順を動かさない方針なので、編集発生時に
      // 明示的に履歴トップへ繰り上げる。既にトップなら recordNoteOpen 側で
      // no-op になるため毎キーストロークで呼んでも安全。
      recordNoteOpen(activeId);
      // 解錠状態のノートを「編集した」と記録 (別ノートに切替えても再ロックしない)
      editedAfterUnlockRef.current.add(activeId);
      pendingBody.current = { id: activeId, body: next };
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
      bodyTimer.current = setTimeout(async () => {
        bodyTimer.current = null;
        if (!pendingBody.current) return;
        const { id, body } = pendingBody.current;
        pendingBody.current = null;
        await window.api.notes.updateBody(id, body);
        const list = await window.api.notes.list();
        setNotes(list);
      }, SAVE_DEBOUNCE_MS);
    },
    [activeId, previewTabId, recordNoteOpen],
  );

  const scheduleMetaSave = useCallback(
    (title: string, folder: string, tags: string[]) => {
      if (!activeId) return;
      // メタ編集も「ピン昇格」イベントとして扱う (body 編集と同じ)
      if (previewTabId && previewTabId === activeId) {
        setPreviewTabId(null);
      }
      setPinnedTabIds((prev) =>
        prev.includes(activeId) ? prev : [...prev, activeId],
      );
      // 履歴からの開封 → 編集 のときに履歴トップへ繰り上げる (body 編集と同じ)
      recordNoteOpen(activeId);
      // 解錠状態のノートを「編集した」と記録 (別ノートに切替えても再ロックしない)
      editedAfterUnlockRef.current.add(activeId);
      pendingMeta.current = { id: activeId, title, folder, tags };
      if (metaTimer.current) clearTimeout(metaTimer.current);
      metaTimer.current = setTimeout(async () => {
        metaTimer.current = null;
        if (!pendingMeta.current) return;
        const { id, title, folder, tags } = pendingMeta.current;
        pendingMeta.current = null;
        const updated = await window.api.notes.updateMeta(id, {
          title,
          folder,
          tags,
        });
        setNotes((prev) =>
          prev
            .map((n) => (n.id === updated.id ? updated : n))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [activeId, previewTabId, recordNoteOpen],
  );

  // ファイル名（パス形式）入力の変更ハンドラ。
  // "階層1/テスト1" のようなスラッシュ区切り文字列を folder と title に分解して保存する。
  const handleNameChange = (path: string) => {
    const { folder, title } = parsePath(path);
    setEditingTitle(title);
    setEditingFolder(folder);
    scheduleMetaSave(title, folder, editingTags);
  };

  // タグバー（バッジ入力）の変更ハンドラ
  const handleTagsChange = (next: string[]) => {
    setEditingTags(next);
    scheduleMetaSave(editingTitle, editingFolder, next);
  };

  // ----- 新規ノート -----
  /** 指定フォルダに「無題」ノートを作成し、edit モードで開く共通処理。 */
  const createNoteInFolder = async (folder: string) => {
    await flushPendingSaves();
    const created = await window.api.notes.create({
      title: '無題',
      folder,
      body: '',
    });
    const list = await window.api.notes.list();
    setNotes(list);
    setActiveId(created.id);
    setEditingTitle(created.title);
    setEditingFolder(created.folder);
    setEditingTags(created.tags ?? []);
    setBody('');
    // 新規ノートをタブに追加し、初期 view は edit モード
    setOpenTabIds((prev) =>
      prev.includes(created.id) ? prev : [...prev, created.id],
    );
    setTabViews((prev) => ({ ...prev, [created.id]: 'edit' }));
    // 新規ノートは作成直後から「固定タブ」として扱う。
    // - これで preview-tab スワップ対象外になり、タイトル/フォルダの
    //   1 文字目入力で誤って前のタブへ切り替わる事故を防ぐ
    // - 📍 も作成直後から表示される (旧モデルの体感とも一致)
    setPinnedTabIds((prev) =>
      prev.includes(created.id) ? prev : [...prev, created.id],
    );
    // 新規ノート作成時は preview スロットを解放する。
    // 古い previewTabId を持ち越すと、後続の単発クリックで意図しないタブが
    // 入れ替えられる可能性がある。新規ノート起点では preview 概念をリセット。
    setPreviewTabId(null);
    setSidebarMode('files');
    // 作成先フォルダ（とその全祖先）を展開して、作成したノートが見えるようにする
    if (created.folder) {
      sidebarRef.current?.expandFolder(created.folder);
    }
    // 上の state 更新で view=edit の Editor がマウント (もしくは body 切替) されるので、
    // 1 フレーム待ってから focus を当てる (即時呼び出しでは EditorView がまだ無いことがある)。
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  };

  // ヘッダ「+ 新規ノート」やショートカット (⌘N) から: 常に **最上位階層** に作成。
  // フォルダ内に作りたい時はサイドバーのフォルダ右クリック「ノートの作成」を使う。
  const handleCreateNote = () => createNoteInFolder('');

  // フォルダ右クリック → 「ノートの作成」: そのフォルダ配下に作る
  const handleCreateNoteInFolder = (folderPath: string) =>
    createNoteInFolder(folderPath);

  // ----- メニュー「メモの作成」(CmdOrCtrl+N) 購読 -----
  // handleCreateNote はクロージャが毎回再生成されるため ref 経由で最新を呼ぶ
  const handleCreateNoteRef = useRef(handleCreateNote);
  handleCreateNoteRef.current = handleCreateNote;
  useEffect(() => {
    return window.api?.onCreateNote(() => void handleCreateNoteRef.current());
  }, []);

  // ----- メニュー「検索...」(CmdOrCtrl+F) 購読 -----
  // 編集モード (edit / mix) のいずれかに切替えてから表示（mix なら editor が左に出る）
  useEffect(() => {
    return window.api?.onFind(() => {
      if (activeId && view === 'preview') setView('edit');
      setFindOpen(true);
    });
  }, [activeId, view, setView]);

  // ----- メニュー「置換...」(CmdOrCtrl+R) 購読 -----
  useEffect(() => {
    return window.api?.onReplace(() => {
      if (activeId && view === 'preview') setView('edit');
      setReplaceOpen(true);
    });
  }, [activeId, view, setView]);

  // ----- メニュー「Macro」購読 -----
  // F1/F2/F3 は Editor 側の keydown でも処理する。メニューから選ばれた場合は
  // アクティブノートを編集ビューにしてから、現在の EditorHandle に転送する。
  useEffect(() => {
    window.localStorage.setItem(
      SAVED_MACROS_STORAGE_KEY,
      JSON.stringify(savedMacros.slice(0, SAVED_MACROS_LIMIT)),
    );
    window.api.updateMacroMenu(
      savedMacros.map((macro) => ({ id: macro.id, name: macro.name })),
    );
  }, [savedMacros]);

  const runEditorMacroCommand = useCallback(
    (command: 'start' | 'stop' | 'play') => {
      if (!activeId) return;
      const run = () => {
        if (command === 'start') {
          setSelectedSavedMacroId(null);
          editorRef.current?.startKeyMacroCapture();
        } else if (command === 'stop') {
          editorRef.current?.stopKeyMacroCapture();
        } else {
          const selected = savedMacros.find(
            (macro) => macro.id === selectedSavedMacroId,
          );
          if (selected) editorRef.current?.setKeyMacroActions(selected.actions);
          editorRef.current?.playKeyMacro();
        }
      };
      if (view === 'preview') {
        setView('edit');
        window.setTimeout(run, 0);
      } else {
        run();
      }
    },
    [activeId, view, setView, savedMacros, selectedSavedMacroId],
  );

  const handleSaveMacro = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || macroActions.length === 0) return;
      const macro: SavedMacro = {
        id: createSavedMacroId(),
        name: trimmed,
        actions: macroActions,
        display: macroKeys,
        createdAt: Date.now(),
      };
      setSavedMacros((prev) => [macro, ...prev].slice(0, SAVED_MACROS_LIMIT));
      setSelectedSavedMacroId(macro.id);
      editorRef.current?.setKeyMacroActions(macro.actions);
    },
    [macroActions, macroKeys],
  );

  const savedMacroDialogMacro = useMemo(
    () =>
      savedMacroDialogId
        ? savedMacros.find((macro) => macro.id === savedMacroDialogId) ?? null
        : null,
    [savedMacroDialogId, savedMacros],
  );

  const handleRenameSavedMacro = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!savedMacroDialogId || !trimmed) return;
      setSavedMacros((prev) =>
        prev.map((macro) =>
          macro.id === savedMacroDialogId
            ? { ...macro, name: trimmed }
            : macro,
        ),
      );
    },
    [savedMacroDialogId],
  );

  const handleSetSavedMacroToF1 = useCallback(() => {
    if (!savedMacroDialogMacro) return;
    setSelectedSavedMacroId(savedMacroDialogMacro.id);
    editorRef.current?.setKeyMacroActions(savedMacroDialogMacro.actions);
  }, [savedMacroDialogMacro]);

  useEffect(() => {
    if (!selectedSavedMacroId) return;
    const macro = savedMacros.find((item) => item.id === selectedSavedMacroId);
    if (!macro) return;
    const timer = window.setTimeout(() => {
      editorRef.current?.setKeyMacroActions(macro.actions);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeId, view, savedMacros, selectedSavedMacroId]);

  const handleDeleteSavedMacro = useCallback(() => {
    if (!savedMacroDialogId) return;
    setSavedMacros((prev) =>
      prev.filter((macro) => macro.id !== savedMacroDialogId),
    );
    setSelectedSavedMacroId((current) =>
      current === savedMacroDialogId ? null : current,
    );
    setSavedMacroDialogId(null);
  }, [savedMacroDialogId]);

  useEffect(() => {
    return window.api?.onMacroCaptureStart(() =>
      runEditorMacroCommand('start'),
    );
  }, [runEditorMacroCommand]);

  useEffect(() => {
    return window.api?.onMacroCaptureStop(() =>
      runEditorMacroCommand('stop'),
    );
  }, [runEditorMacroCommand]);

  useEffect(() => {
    return window.api?.onMacroPlay(() => runEditorMacroCommand('play'));
  }, [runEditorMacroCommand]);

  useEffect(() => {
    return window.api?.onMacroShow(() => {
      setMacroKeys(editorRef.current?.getKeyMacroDisplay() ?? []);
      setMacroActions(editorRef.current?.getKeyMacroActions() ?? []);
      setMacroKeysOpen(true);
    });
  }, []);

  useEffect(() => {
    return window.api?.onMacroSelect((id) => {
      const macro = savedMacros.find((item) => item.id === id);
      if (!macro) return;
      setSavedMacroDialogId(id);
    });
  }, [savedMacros]);

  // ----- ストレージ同期からの通知でノート一覧を再取得 -----
  useEffect(() => {
    const handler = async () => {
      try {
        const [list, folderList] = await Promise.all([
          window.api.notes.list(),
          window.api.folders.list(),
        ]);
        setNotes(list);
        setFolders(folderList);
      } catch {
        /* 失敗しても無視（次の操作でリトライ） */
      }
    };
    window.addEventListener('inknel:notes-changed', handler);
    return () => window.removeEventListener('inknel:notes-changed', handler);
  }, []);

  // ----- 他コンポーネント (StoragePanel 等) からの flush 要求 -----
  // 保留中の自動保存をディスクへ書き出してから resolve を呼ぶ。
  // detail.resolve に Promise の解決関数が入っている。
  useEffect(() => {
    const handler = async (e: Event) => {
      const ev = e as CustomEvent<{ resolve?: () => void }>;
      try {
        await flushPendingSaves();
      } finally {
        ev.detail?.resolve?.();
      }
    };
    window.addEventListener(
      'inknel:flush-pending-saves',
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        'inknel:flush-pending-saves',
        handler as EventListener,
      );
  }, [flushPendingSaves]);

  // ----- タブを閉じる -----
  // openTabIds から除去し、閉じた時の隣タブをアクティブ化する。
  // 閉じたタブに紐づく view モード / 解錠状態もクリアする。
  const closeTab = useCallback(
    async (id: string) => {
      const idx = openTabIds.indexOf(id);
      if (idx < 0) return;
      const isClosingActive = id === activeId;

      if (isClosingActive) {
        await flushPendingSaves();
      }

      const nextTabs = openTabIds.filter((x) => x !== id);
      setOpenTabIds(nextTabs);
      setTabViews((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: _omit, ...rest } = prev;
        return rest;
      });
      setUnlockedNoteIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // プレビュータブが閉じられたらフラグを掃除
      if (previewTabId === id) {
        setPreviewTabId(null);
      }
      // ピンタブが閉じられたらピン状態も掃除 (再度開いた時はピン無しから始まる)
      setPinnedTabIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : prev,
      );

      if (isClosingActive) {
        const nextActive = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
        if (nextActive) {
          await selectNote(nextActive, undefined, true);
        } else {
          setActiveId(null);
          setEditingTitle('');
          setEditingFolder('');
          setEditingTags([]);
          setBody('');
        }
      }
    },
    [openTabIds, activeId, flushPendingSaves, selectNote, previewTabId],
  );

  // ----- 複数タブを一括で閉じる（右クリックメニューの「すべて閉じる」等） -----
  const closeTabs = useCallback(
    async (idsToClose: string[]) => {
      if (idsToClose.length === 0) return;
      const idsSet = new Set(idsToClose);
      const remaining = openTabIds.filter((x) => !idsSet.has(x));
      const closingActive = activeId !== null && idsSet.has(activeId);

      if (closingActive) {
        await flushPendingSaves();
      }

      setOpenTabIds(remaining);
      setTabViews((prev) => {
        let changed = false;
        const next: Record<string, ViewKey> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (!idsSet.has(k)) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
      setUnlockedNoteIds((prev) => {
        let changed = false;
        const next = new Set<string>();
        for (const v of prev) {
          if (!idsSet.has(v)) next.add(v);
          else changed = true;
        }
        return changed ? next : prev;
      });
      // プレビュータブが閉じる対象に含まれているならフラグを掃除
      if (previewTabId && idsSet.has(previewTabId)) {
        setPreviewTabId(null);
      }
      // AI チャット状態の破棄: 閉じる対象のうちピン留めされていない (= 編集中
      // ではない) ノートは、チャット履歴も一緒にクリアする。ピン留めタブは
      // Map に残しておき、再選択時に途中まで入った状態を復元する。
      for (const id of idsSet) {
        if (!pinnedTabIds.includes(id)) {
          chatStatesRef.current.delete(id);
        }
      }
      // ピンタブが閉じる対象に含まれていれば pinnedTabIds からも除去
      setPinnedTabIds((prev) => {
        const next = prev.filter((id) => !idsSet.has(id));
        return next.length === prev.length ? prev : next;
      });

      if (closingActive) {
        if (remaining.length === 0) {
          setActiveId(null);
          setEditingTitle('');
          setEditingFolder('');
          setEditingTags([]);
          setBody('');
        } else {
          // 元の activeId の位置より右で最初に残っているタブへ。
          // 無ければ左方向で最も近いものに。
          const oldIdx = openTabIds.indexOf(activeId!);
          let nextActive: string | null = null;
          for (let i = oldIdx + 1; i < openTabIds.length; i++) {
            if (!idsSet.has(openTabIds[i])) {
              nextActive = openTabIds[i];
              break;
            }
          }
          if (!nextActive) {
            for (let i = oldIdx - 1; i >= 0; i--) {
              if (!idsSet.has(openTabIds[i])) {
                nextActive = openTabIds[i];
                break;
              }
            }
          }
          if (nextActive) {
            await selectNote(nextActive, undefined, true);
          }
        }
      }
    },
    [openTabIds, activeId, flushPendingSaves, selectNote, previewTabId],
  );

  // ----- ノート削除（サイドバーのコンテキストメニューから呼ばれる） -----
  const handleDeleteNote = useCallback(
    async (id: string) => {
      // 削除対象が現在編集中のノートなら、保留中の保存はキャンセル
      if (id === activeId) {
        if (bodyTimer.current) clearTimeout(bodyTimer.current);
        if (metaTimer.current) clearTimeout(metaTimer.current);
        pendingBody.current = null;
        pendingMeta.current = null;
      }

      try {
        await window.api.notes.delete(id);
      } catch (err) {
        // メインプロセス側で保護されているノートは削除できない
        window.alert(
          err instanceof Error ? err.message : '削除に失敗しました',
        );
        return;
      }
      const [list, trashed] = await Promise.all([
        window.api.notes.list(),
        window.api.notes.listTrashed(),
      ]);
      setNotes(list);
      setTrashedNotes(trashed);

      // 削除されたノートをタブリスト・タブ状態から除去
      // ノート自体が消えるので、ピン留めの有無にかかわらず AI チャット履歴も破棄。
      chatStatesRef.current.delete(id);

      const idx = openTabIds.indexOf(id);
      const wasOpen = idx >= 0;
      if (wasOpen) {
        const nextTabs = openTabIds.filter((x) => x !== id);
        setOpenTabIds(nextTabs);
        setTabViews((prev) => {
          if (!(id in prev)) return prev;
          const { [id]: _omit, ...rest } = prev;
          return rest;
        });
        setUnlockedNoteIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setPinnedTabIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : prev,
        );

        if (id === activeId) {
          const nextActive =
            nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
          if (nextActive) {
            await selectNote(nextActive, list, true);
          } else {
            setActiveId(null);
            setEditingTitle('');
            setEditingFolder('');
            setEditingTags([]);
            setBody('');
          }
        }
      } else if (id === activeId) {
        // フォールバック: タブに含まれない activeId が削除された場合
        setActiveId(null);
        setEditingTitle('');
        setEditingFolder('');
        setEditingTags([]);
        setBody('');
      }
    },
    [activeId, openTabIds, selectNote],
  );

  // ----- 名称変更ダイアログ（ファイル / フォルダ 共通） -----
  type RenameTarget =
    | { kind: 'note'; id: string; name: string }
    | {
        kind: 'folder';
        oldPath: string;
        parent: string;
        leafName: string;
      };
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const handleStartRename = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      setRenameTarget({
        kind: 'note',
        id: noteId,
        name: buildPath(note.folder, note.title),
      });
    },
    [notes],
  );

  const handleStartRenameFolder = useCallback((folderPath: string) => {
    const segments = folderPath.split('/');
    const leafName = segments[segments.length - 1];
    const parent = segments.slice(0, -1).join('/');
    setRenameTarget({
      kind: 'folder',
      oldPath: folderPath,
      parent,
      leafName,
    });
  }, []);

  // ============================================================
  // ゴミ箱関連ハンドラ
  // ============================================================

  /** ゴミ箱内ノート一覧を再取得 */
  const refreshTrashedNotes = useCallback(async () => {
    try {
      const list = await window.api.notes.listTrashed();
      setTrashedNotes(list);
    } catch (err) {
      console.warn('[trash] listTrashed failed:', err);
    }
  }, []);

  /**
   * ゴミ箱から復元。保護ノートはパスワード入力を要求する。
   * 復元成功後、通常ノート一覧とゴミ箱一覧の両方を更新。
   */
  const handleRestoreNote = useCallback(
    async (id: string) => {
      const target = trashedNotes.find((n) => n.id === id);
      if (!target) return;
      // 保護ノートは復元前にパスワードを要求 (誤復元防止)
      if (target.protected) {
        const input = window.prompt(
          `保護されたノート「${target.title}」を復元します。\nパスワードを入力してください:`,
          '',
        );
        if (input === null) return;
        if (input !== settings.protectionPassword) {
          window.alert('パスワードが違います');
          return;
        }
      }
      try {
        await window.api.notes.restore(id);
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : '復元に失敗しました',
        );
        return;
      }
      const [list, trashed] = await Promise.all([
        window.api.notes.list(),
        window.api.notes.listTrashed(),
      ]);
      setNotes(list);
      setTrashedNotes(trashed);
    },
    [trashedNotes, settings.protectionPassword],
  );

  /** ゴミ箱内ノートを完全に削除 (1 件) */
  const handleDeletePermanent = useCallback(
    async (id: string) => {
      const target = trashedNotes.find((n) => n.id === id);
      if (!target) return;
      if (
        !window.confirm(
          `ノート「${target.title}」を完全に削除しますか?\n取り消しできません。`,
        )
      )
        return;
      try {
        await window.api.notes.deletePermanent(id);
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : '削除に失敗しました',
        );
        return;
      }
      await refreshTrashedNotes();
    },
    [trashedNotes, refreshTrashedNotes],
  );

  /** ゴミ箱を空にする (確認後にすべて物理削除) */
  const handleEmptyTrash = useCallback(async () => {
    if (trashedNotes.length === 0) return;
    if (
      !window.confirm(
        `ゴミ箱の ${trashedNotes.length} 件のノートをすべて完全に削除しますか?\n取り消しできません。`,
      )
    )
      return;
    try {
      await window.api.notes.emptyTrash();
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'ゴミ箱を空にできませんでした',
      );
      return;
    }
    await refreshTrashedNotes();
  }, [trashedNotes, refreshTrashedNotes]);

  // ----- フォルダごと削除 -----
  // 確認ダイアログを出してから、フォルダ＋配下のノート・サブフォルダを全削除。
  const handleDeleteFolder = useCallback(
    async (folderPath: string) => {
      if (!folderPath) return;
      // 配下のノート数を数えて確認メッセージに含める
      const count = notes.filter(
        (n) => n.folder === folderPath || n.folder.startsWith(folderPath + '/'),
      ).length;
      const message =
        count > 0
          ? `「${folderPath}」と配下の ${count} 件のノートを削除します。元に戻せません。よろしいですか？`
          : `「${folderPath}」フォルダを削除します。よろしいですか？`;
      if (!window.confirm(message)) return;

      // アクティブノートが影響を受ける場合は保留分をフラッシュ
      await flushPendingSaves();

      try {
        await window.api.folders.deleteRecursive(folderPath);
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'フォルダの削除に失敗しました',
        );
        return;
      }

      // 一覧を再取得
      const [list, folderList] = await Promise.all([
        window.api.notes.list(),
        window.api.folders.list(),
      ]);
      setNotes(list);
      setFolders(folderList);

      // 削除されたノートをタブリスト・タブ状態から除去
      const existingIds = new Set(list.map((n) => n.id));
      const removedOpenIds = openTabIds.filter((id) => !existingIds.has(id));
      if (removedOpenIds.length > 0) {
        const nextTabs = openTabIds.filter((id) => existingIds.has(id));
        setOpenTabIds(nextTabs);
        setTabViews((prev) => {
          let changed = false;
          const next: Record<string, ViewKey> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (existingIds.has(k)) next[k] = v;
            else changed = true;
          }
          return changed ? next : prev;
        });
        setUnlockedNoteIds((prev) => {
          let changed = false;
          const next = new Set<string>();
          for (const v of prev) {
            if (existingIds.has(v)) next.add(v);
            else changed = true;
          }
          return changed ? next : prev;
        });

        if (activeId && !existingIds.has(activeId)) {
          if (nextTabs.length > 0) {
            await selectNote(nextTabs[nextTabs.length - 1], list, true);
          } else {
            setActiveId(null);
            setEditingTitle('');
            setEditingFolder('');
            setEditingTags([]);
            setBody('');
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, activeId, openTabIds, flushPendingSaves],
  );

  const handleRenameSubmit = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;

      if (renameTarget.kind === 'note') {
        const { folder, title } = parsePath(newName);

        // アクティブノートを名称変更する場合は保留中の保存をフラッシュ
        if (renameTarget.id === activeId) {
          await flushPendingSaves();
        }

        try {
          await window.api.notes.updateMeta(renameTarget.id, {
            title,
            folder,
          });
        } catch {
          return;
        }

        const list = await window.api.notes.list();
        setNotes(list);

        if (renameTarget.id === activeId) {
          setEditingTitle(title);
          setEditingFolder(folder);
        }
      } else {
        // フォルダ名称変更
        const newLeaf = newName.trim().replace(/\//g, '');
        if (!newLeaf) return;
        const newPath = renameTarget.parent
          ? `${renameTarget.parent}/${newLeaf}`
          : newLeaf;
        if (newPath === renameTarget.oldPath) {
          setRenameTarget(null);
          return;
        }

        // アクティブノートが影響を受ける可能性があるので保留分を確定
        await flushPendingSaves();

        try {
          await window.api.folders.rename(renameTarget.oldPath, newPath);
        } catch {
          return;
        }

        // notes と folders の両方を再取得
        const [list, folderList] = await Promise.all([
          window.api.notes.list(),
          window.api.folders.list(),
        ]);
        setNotes(list);
        setFolders(folderList);

        // アクティブノートの editingFolder を再計算
        if (activeId) {
          const refreshed = list.find((n) => n.id === activeId);
          if (refreshed) {
            setEditingFolder(refreshed.folder);
          }
        }
      }

      setRenameTarget(null);
    },
    [renameTarget, activeId, flushPendingSaves],
  );

  // ----- ファイルツリーのドラッグ&ドロップでノートを別フォルダへ移動 -----
  const handleMoveNote = useCallback(
    async (noteId: string, targetFolder: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      if (note.folder === targetFolder) return; // 同じフォルダなら何もしない

      // 移動対象がアクティブノートなら、保留中の保存をフラッシュ
      // （ここで上書きされる前にユーザーの未保存編集を保存しておく）
      if (noteId === activeId) {
        await flushPendingSaves();
      }

      try {
        await window.api.notes.updateMeta(noteId, { folder: targetFolder });
      } catch {
        return;
      }

      // 一覧を再取得
      const list = await window.api.notes.list();
      setNotes(list);

      // アクティブノートを移動した場合は editingFolder も追従
      if (noteId === activeId) {
        setEditingFolder(targetFolder);
      }
    },
    [notes, activeId, flushPendingSaves],
  );

  // ----- ファイルツリーのドラッグ&ドロップでフォルダを別階層へ移動 -----
  // 選択中のフォルダ (oldPath) を newParent 配下へ移動する。
  // renameFolder を使い配下の全ノート・サブフォルダの folder 値を一括更新する。
  const handleMoveFolder = useCallback(
    async (oldPath: string, newParent: string) => {
      if (!oldPath) return;
      // 自身または自身の子孫への移動は拒否（Sidebar 側でもチェック済みだが二重で）
      if (newParent === oldPath) return;
      if (newParent.startsWith(oldPath + '/')) return;

      const segments = oldPath.split('/');
      const leafName = segments[segments.length - 1];
      const newPath = newParent ? `${newParent}/${leafName}` : leafName;
      if (newPath === oldPath) return;

      await flushPendingSaves();

      try {
        await window.api.folders.rename(oldPath, newPath);
      } catch {
        return;
      }

      const [list, folderList] = await Promise.all([
        window.api.notes.list(),
        window.api.folders.list(),
      ]);
      setNotes(list);
      setFolders(folderList);

      // アクティブノートが影響を受けていたら editingFolder を最新化
      if (activeId) {
        const refreshed = list.find((n) => n.id === activeId);
        if (refreshed) setEditingFolder(refreshed.folder);
      }
    },
    [activeId, flushPendingSaves],
  );

  // ----- ノートの保護フラグをトグル -----
  // 保護ON（next=true）: パスワード不要で即実行
  // 保護解除（next=false）: パスワードダイアログを開き、認証成功後に解除
  const handleToggleProtect = useCallback(
    async (id: string, next: boolean) => {
      if (!next) {
        setPasswordPurpose({ kind: 'unprotect', noteId: id });
        return;
      }

      await window.api.notes.setProtected(id, true);
      const list = await window.api.notes.list();
      setNotes(list);

      // 保護 ON にしたノートは解錠状態を破棄
      setUnlockedNoteIds((prev) => {
        if (!prev.has(id)) return prev;
        const nextSet = new Set(prev);
        nextSet.delete(id);
        return nextSet;
      });
      if (id === activeId && view !== 'preview') {
        // 編集モード or mix モードを保護解除でロック → preview へ戻す
        setView('preview');
      }
    },
    [activeId, view, setView],
  );

  // ----- ノートのシークレットフラグをトグル -----
  // シークレットON（next=true）: パスワード不要で即実行
  // シークレット解除（next=false）: パスワードダイアログを開き、認証成功後に解除
  const handleToggleSecret = useCallback(
    async (id: string, next: boolean) => {
      if (!next) {
        setPasswordPurpose({ kind: 'unset-secret', noteId: id });
        return;
      }

      await window.api.notes.setSecret(id, true);
      const list = await window.api.notes.list();
      setNotes(list);
      // 解除済み一覧から外す（次回開く時に再要求）
      setUnlockedSecretIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [],
  );

  // ----- 検索 IPC を SearchPanel に渡す -----
  const handleSearch = useCallback(
    (query: string) => window.api.notes.search(query),
    [],
  );

  // ----- ActivityBar ファイルアイコン -----
  const handleSelectFiles = () => {
    if (sidebarMode === 'files') {
      // 既に files モードなら折りたたみトグル
      setSidebarCollapsed((v) => !v);
    } else {
      setSidebarMode('files');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }
  };

  // ----- ActivityBar 検索アイコン -----
  const handleSelectSearch = () => {
    if (sidebarMode === 'search') {
      setSidebarCollapsed((v) => !v);
    } else {
      setSidebarMode('search');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }
  };

  // ----- ActivityBar タグアイコン -----
  const handleSelectTags = () => {
    if (sidebarMode === 'tags') {
      setSidebarCollapsed((v) => !v);
    } else {
      setSidebarMode('tags');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }
  };

  // ----- ActivityBar 履歴アイコン (サイドバーを history モードへ切替) -----
  const handleSelectHistory = () => {
    if (sidebarMode === 'history') {
      setSidebarCollapsed((v) => !v);
    } else {
      setSidebarMode('history');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }
  };

  // ----- ActivityBar カレンダーアイコン (サイドバーを calendar モードへ切替) -----
  const handleSelectCalendar = () => {
    if (sidebarMode === 'calendar') {
      setSidebarCollapsed((v) => !v);
    } else {
      setSidebarMode('calendar');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }
  };

  // ----- ActivityBar からプラグイン由来モードへ切替 -----
  // どのプラグインが提供する mode かは ActivityBar 側で集約済み。
  // ここでは渡された mode 文字列でサイドバーを切り替えるだけ。
  const handleSelectPluginMode = useCallback(
    (mode: string) => {
      if (sidebarMode === mode) {
        setSidebarCollapsed((v) => !v);
      } else {
        setSidebarMode(mode);
        if (sidebarCollapsed) setSidebarCollapsed(false);
      }
    },
    [sidebarMode, sidebarCollapsed],
  );

  /**
   * プラグインから「新規ノート作成」を依頼された時の汎用ハンドラ。
   * App 内部の保留保存 flush / state 反映 / タブ追加 / フォルダ展開を
   * まとめて行うので、プラグイン側はファイル名と本文を渡すだけでよい。
   */
  const handlePluginCreateNote = useCallback(
    async (input: {
      title?: string;
      folder?: string;
      body?: string;
      tags?: string[];
    }) => {
      await flushPendingSaves();
      let created = await window.api.notes.create({
        title: input.title,
        folder: input.folder,
        body: input.body,
      });
      // tags が指定されている場合、作成直後に updateMeta で反映する
      // (notes.create は tags を受け付けないため)
      if (input.tags && input.tags.length > 0) {
        try {
          created = await window.api.notes.updateMeta(created.id, {
            tags: input.tags,
          });
        } catch {
          // タグ反映失敗してもノート自体は作成済みなので致命的ではない
        }
      }
      const list = await window.api.notes.list();
      setNotes(list);
      setActiveId(created.id);
      setEditingTitle(created.title);
      setEditingFolder(created.folder);
      setEditingTags(created.tags ?? []);
      setBody(input.body ?? '');
      setOpenTabIds((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id],
      );
      setTabViews((prev) => ({ ...prev, [created.id]: 'edit' }));
      if (created.folder) sidebarRef.current?.expandFolder(created.folder);
      return created;
    },
    [flushPendingSaves],
  );

  // ----- ActivityBar 保存先アイコン (サイドバーを sync モードへ切替) -----
  const handleSelectStorage = () => {
    if (sidebarMode === 'sync') {
      setSidebarCollapsed((v) => !v);
    } else {
      setSidebarMode('sync');
      if (sidebarCollapsed) setSidebarCollapsed(false);
    }
  };

  // 現在バックグラウンドでクラウドチェック中のノート ID。
  // この ID のノートが activeId と一致していればオーバーレイを表示して操作をブロックする。
  const [syncingNoteId, setSyncingNoteId] = useState<string | null>(null);

  // ----- 同期状態管理 -----
  // share.onProgress (cloud sync 進捗イベント) を購読するためのキャッシュ。
  // 旧 SyncPanel からの手動同期 UI は廃止されたが、起動時自動同期 (line ~1133)
  // 等の進捗をフッター進捗バー / アクティビティバーのリングへ反映する用途で残す。
  const [sharing, setSharing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<
    import('./global').ShareSyncProgress | null
  >(null);

  // 進捗イベント購読（マウント時に 1 回）。
  // 旧仕様では手動同期トリガー (handleStartSync) が setSharing(true/false) を制御
  // していたが、UI からの手動トリガーは廃止されたので start/done フェーズで
  // sharing フラグを自動切替する。これでフッター進捗バー / 進捗リングが
  // 自動同期 (起動時等) でも反応する。
  useEffect(() => {
    const unsubscribe = window.api.share.onProgress((ev) => {
      setSyncProgress(ev);
      if (ev.phase === 'start') setSharing(true);
      else if (ev.phase === 'done') setSharing(false);
    });
    return unsubscribe;
  }, []);

  // ----- アクティビティバー保存先アイコンの進捗リング表示 -----
  // ShareSyncProgress を 0-100% に変換。フェーズ重み:
  //   ノート段階 (push/pull/skip): 0 → 70%
  //   メディア (images):           70 → 80%
  //   メディア (attachments):      80 → 90%
  //   仕上げ (finalizing):         95%
  //   完了 (done):                 100%
  const syncProgressToRingPercent = useCallback(
    (p: import('./global').ShareSyncProgress | null): number | null => {
      if (!p) return null;
      switch (p.phase) {
        case 'start':
          return 0;
        case 'push':
        case 'pull':
        case 'skip': {
          if (p.total <= 0) return 0;
          return Math.min(70, (p.current / p.total) * 70);
        }
        case 'media': {
          // p.total はメディア全体件数, pushed/pulled の合計が完了数
          const base = p.kind === 'images' ? 70 : 80;
          const span = 10;
          if (p.total <= 0) return base + span;
          const done = (p.pushed ?? 0) + (p.pulled ?? 0);
          return base + Math.min(span, (done / p.total) * span);
        }
        case 'finalizing':
          return 95;
        case 'done':
          return 100;
      }
    },
    [],
  );

  // リング表示用の % 値。null = リング非表示 (アイドル)。
  // sharing 中は progress イベントを反映、sharing 終了直後は 100% を 600ms 保持してから null へ。
  const [syncRingPercent, setSyncRingPercent] = useState<number | null>(null);

  // sharing 中: 進捗イベントが来るたびに % を更新
  useEffect(() => {
    if (!sharing) return;
    const pct = syncProgressToRingPercent(syncProgress);
    if (pct !== null) setSyncRingPercent(pct);
  }, [sharing, syncProgress, syncProgressToRingPercent]);

  // sharing → false になった瞬間: 100% を見せて 600ms 後に消す
  const wasSharingRef = useRef(false);
  useEffect(() => {
    if (sharing) {
      wasSharingRef.current = true;
      return;
    }
    if (!wasSharingRef.current) return;
    wasSharingRef.current = false;
    setSyncRingPercent(100);
    const t = setTimeout(() => setSyncRingPercent(null), 600);
    return () => clearTimeout(t);
  }, [sharing]);

  // ノート一覧の id → meta ルックアップを 1 度だけ Map 化しておく。
  // タブバー (連携ノート) / アクティブノート判定 / ノート削除フローなどから
  // 大量に find() されるので、O(n) → O(1) に下げる効果が大きい。
  const notesById = useMemo(
    () => new Map(notes.map((n) => [n.id, n])),
    [notes],
  );

  // 現在選択中ノートが「ロック状態」か判定 (deps が変わった時だけ再計算)
  const activeNoteMeta = useMemo(
    () => (activeId ? notesById.get(activeId) ?? null : null),
    [activeId, notesById],
  );
  const isActiveLocked =
    activeNoteMeta?.protected === true &&
    activeId !== null &&
    !unlockedNoteIds.has(activeId);
  const linkedNotes = useMemo<NoteMeta[]>(
    () =>
      activeNoteMeta
        ? activeNoteMeta.linkedNoteIds
            .map((id) => notesById.get(id))
            .filter((note): note is NoteMeta => Boolean(note))
        : [],
    [activeNoteMeta, notesById],
  );

  const handleAddLinkedNote = useCallback(
    async (linkedNoteId: string) => {
      if (!activeId || activeId === linkedNoteId) return;
      try {
        const updated = await window.api.notes.addLink(activeId, linkedNoteId);
        setNotes((prev) =>
          prev.map((n) => (n.id === updated.id ? updated : n)),
        );
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'ノートの連携に失敗しました',
        );
      }
    },
    [activeId],
  );

  const handleRemoveLinkedNote = useCallback(
    async (linkedNoteId: string) => {
      if (!activeId) return;
      try {
        const updated = await window.api.notes.removeLink(activeId, linkedNoteId);
        setNotes((prev) =>
          prev.map((n) => (n.id === updated.id ? updated : n)),
        );
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'ノートの連携解除に失敗しました',
        );
      }
    },
    [activeId],
  );

  const handleNoteDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleNoteDrop = (e: DragEvent<HTMLDivElement>) => {
    const linkedNoteId = e.dataTransfer.getData(NOTE_DRAG_TYPE);
    if (!linkedNoteId) return;
    e.preventDefault();
    e.stopPropagation();
    void handleAddLinkedNote(linkedNoteId);
  };

  const [aiBusy, setAiBusy] = useState(false);

  /**
   * 直前の「AIでノートを整形・要約」実行前のスナップショット。
   * - 全文整形 / 範囲整形どちらにも対応するよう、対象範囲と差し戻し本文を保持。
   * - activeId が変わるとクリアされる（無関係ノートを書き換える事故を防ぐ）。
   * - ユーザーが本文を手編集すると無効化（typing 後の意図しない巻き戻し回避）。
   */
  const [aiUndoSnapshot, setAiUndoSnapshot] = useState<{
    noteId: string;
    /** スナップショットを取った時点のメモ全文（範囲整形でも全文で保持しておく） */
    previousBody: string;
    /** 整形完了直後の本文（手編集検出用） */
    bodyAfterTransform: string;
  } | null>(null);

  /**
   * AI 整形の実行結果プレビューモーダル。
   * - runAiTransform が AI 応答を取得したらここに詰めてモーダルを開く
   * - ユーザーが「適用」した時点で実際にノートへ書き戻す (apply 関数を保持)
   * - エラー時は payload.kind = 'error' で理由だけ表示
   */
  const [aiResultModal, setAiResultModal] = useState<{
    actionLabel: string;
    noteTitle: string;
    isBackground: boolean;
    payload: AiResultPayload;
    /** 「適用」で書き戻す処理。error 種別では呼ばれない */
    apply: () => void;
  } | null>(null);

  const runAiTransform = useCallback(
    async (action: AiAction) => {
      if (!activeId || aiBusy) return;
      const aiActive = getActiveAiSettings(settings);
      if (!aiActive.token.trim()) {
        window.alert('設定 > AI でTokenを設定してください。');
        void window.api.openPreferencesWindow();
        return;
      }
      if (isActiveLocked) {
        setPasswordPurpose({ kind: 'unlock-edit' });
        return;
      }

      // edit / mix のどちらでも editor からの選択範囲を使う
      const hasEditor = view !== 'preview';
      const range = hasEditor
        ? editorRef.current?.getSelectionRange()
        : undefined;
      const hasSelection = Boolean(range && range.from !== range.to);
      const targetText = hasSelection && range ? range.text : body;
      if (!targetText.trim()) {
        window.alert('AIで処理する本文がありません。');
        return;
      }

      // 実行時点のノート ID / 本文を退避。AI 応答が返ってくる前にユーザーが
      // タブを切り替えても、書き戻し先は「メニューを開いた瞬間にアクティブだった
      // このノート」に固定する。
      // モーダルでユーザーが「適用」を押すまでは何も書き戻さない。
      const snapshotBody = body;
      const snapshotNoteId = activeId;
      const snapshotFolder = editingFolder;
      const snapshotTags = editingTags;
      const snapshotNoteTitle =
        notes.find((n) => n.id === snapshotNoteId)?.title ?? editingTitle;
      const actionLabel = locale.aiTransformMenu[action];

      setAiBusy(true);
      try {
        // ----- タイトル生成: 本文を AI に渡してタイトルだけを取得 -----
        if (action === 'generateTitleFromContent') {
          const generated = await window.api.ai.transform({
            provider: settings.aiProvider,
            token: aiActive.token,
            endpoint: aiActive.endpoint,
            model: aiActive.model,
            action,
            content: body,
          });
          // 改行・引用符・Markdown 記法・ファイル名禁止文字を除去し、20 文字以内に切り詰める
          const sanitized = generated
            .replace(/[\r\n]+/g, ' ')
            .replace(/^["“”'`「『]+|["“”'`」』]+$/g, '')
            .replace(/^#+\s*/, '')
            .replace(/[\\/:*?"<>|]/g, '')
            .trim()
            .slice(0, 20);
          if (!sanitized) {
            setAiResultModal({
              actionLabel,
              noteTitle: snapshotNoteTitle,
              isBackground: false,
              payload: {
                kind: 'error',
                message:
                  'AIがタイトルを生成できませんでした。本文を確認してもう一度お試しください。',
              },
              apply: () => {},
            });
            return;
          }
          setAiResultModal({
            actionLabel,
            noteTitle: snapshotNoteTitle,
            isBackground: snapshotNoteId !== activeId,
            payload: { kind: 'title', title: sanitized },
            apply: () => {
              // 適用: 実行時の snapshotNoteId に書き戻す。アクティブが変わっていれば
              // DB 直接 update、一致していれば従来の編集フローでタイトルを更新する。
              if (activeId === snapshotNoteId) {
                setEditingTitle(sanitized);
                scheduleMetaSave(sanitized, snapshotFolder, snapshotTags);
              } else {
                void window.api.notes
                  .updateMeta(snapshotNoteId, { title: sanitized })
                  .then(() => window.api.notes.list())
                  .then((list) => setNotes(list))
                  .catch((err) =>
                    console.warn(
                      '[ai-transform] background title update failed',
                      err,
                    ),
                  );
              }
            },
          });
          return;
        }

        // ----- 本文整形系 -----
        const transformed = await window.api.ai.transform({
          provider: settings.aiProvider,
          token: aiActive.token,
          endpoint: aiActive.endpoint,
          model: aiActive.model,
          action,
          content: targetText,
        });

        if (!transformed.trim()) {
          setAiResultModal({
            actionLabel,
            noteTitle: snapshotNoteTitle,
            isBackground: snapshotNoteId !== activeId,
            payload: {
              kind: 'error',
              message:
                'AIが空の応答を返しました。本文を変えてもう一度お試しください。',
            },
            apply: () => {},
          });
          return;
        }

        // モーダルプレビュー用に整形後本文・適用処理を組み立てる。
        // 範囲整形は実行時のスナップショットを基準に組み立てるので、後でタブを
        // 切り替えていても整合性が保たれる。
        const previewBody =
          hasSelection && range
            ? snapshotBody.slice(0, range.from) +
              transformed +
              snapshotBody.slice(range.to)
            : transformed;

        setAiResultModal({
          actionLabel,
          noteTitle: snapshotNoteTitle,
          isBackground: snapshotNoteId !== activeId,
          payload: {
            kind: 'body',
            transformed: previewBody,
            original: snapshotBody,
          },
          apply: () => {
            // ----- 適用: 実行時の snapshotNoteId に対して書き戻す -----
            const isStillActive = activeId === snapshotNoteId;
            if (!isStillActive) {
              // 裏に回ったノートは DB に直接書き戻し。現在見ているノートは触らない。
              void window.api.notes
                .updateBody(snapshotNoteId, previewBody)
                .then(() => window.api.notes.list())
                .then((list) => setNotes(list))
                .catch((err) =>
                  console.warn(
                    '[ai-transform] background body update failed',
                    err,
                  ),
                );
              // undo スナップショットには積まない (現在見ているノートが Cmd/Ctrl+Z で
              // 意図せず別ノートに巻き戻るのを防ぐ)
              return;
            }
            if (hasSelection && range && hasEditor) {
              editorRef.current?.replaceRange(range.from, range.to, transformed);
            } else if (hasEditor) {
              editorRef.current?.replaceRange(
                0,
                snapshotBody.length,
                transformed,
              );
            } else {
              handleBodyChange(previewBody);
            }
            setAiUndoSnapshot({
              noteId: snapshotNoteId,
              previousBody: snapshotBody,
              bodyAfterTransform: previewBody,
            });
          },
        });
      } catch (err) {
        // ネットワーク失敗・API キー無効・モデル制限などの理由をモーダルで表示
        setAiResultModal({
          actionLabel,
          noteTitle: snapshotNoteTitle,
          isBackground: snapshotNoteId !== activeId,
          payload: {
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          },
          apply: () => {},
        });
      } finally {
        setAiBusy(false);
      }
    },
    [
      activeId,
      aiBusy,
      body,
      editingFolder,
      editingTags,
      editingTitle,
      handleBodyChange,
      isActiveLocked,
      locale,
      notes,
      scheduleMetaSave,
      settings,
      view,
    ],
  );

  /**
   * 直前のAI整形を取り消し、整形前の本文に戻す。
   * 編集モードならエディタ経由で置換して CodeMirror の undo 履歴に乗せる。
   * プレビューのみのケースでは handleBodyChange で直接戻す。
   */
  const undoAiTransform = useCallback(() => {
    const snap = aiUndoSnapshot;
    if (!snap) return;
    if (snap.noteId !== activeId) return;
    const hasEditor = view !== 'preview';
    if (hasEditor && editorRef.current) {
      editorRef.current.replaceRange(0, body.length, snap.previousBody);
    } else {
      handleBodyChange(snap.previousBody);
    }
    setAiUndoSnapshot(null);
  }, [aiUndoSnapshot, activeId, body, handleBodyChange, view]);

  // 別ノートに切り替えたら、または手編集で post-transform 状態から逸脱したら
  // スナップショットは無効にする
  useEffect(() => {
    if (!aiUndoSnapshot) return;
    if (aiUndoSnapshot.noteId !== activeId) {
      setAiUndoSnapshot(null);
      return;
    }
    if (aiUndoSnapshot.bodyAfterTransform !== body) {
      // ユーザーがタイプして整形後の状態から逸脱した
      setAiUndoSnapshot(null);
    }
  }, [aiUndoSnapshot, activeId, body]);

  // Preview 専用ビューでは CodeMirror が居らず Cmd/Ctrl+Z が効かない。
  // AI整形のスナップショットがある場合に限り、グローバルに Cmd/Ctrl+Z を
  // 取って undoAiTransform に振り向ける。
  // (edit / mix ビューでは CodeMirror の undo に任せるので何もしない)
  useEffect(() => {
    if (view !== 'preview') return;
    if (!aiUndoSnapshot || aiUndoSnapshot.noteId !== activeId) return;

    const handler = (e: KeyboardEvent) => {
      const isUndo =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'z' || e.key === 'Z');
      if (!isUndo) return;
      // input / textarea / contenteditable へのフォーカス中は通常の Undo に任せる
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      undoAiTransform();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, aiUndoSnapshot, activeId, undoAiTransform]);

  const openAiTransformMenu = useCallback(
    async (position: { x: number; y: number }) => {
      if (aiBusy) return;
      const m = locale.aiTransformMenu;
      // 直前の整形を取り消せる場合のみ「取り消す」項目を先頭に出す
      const canUndo =
        aiUndoSnapshot !== null && aiUndoSnapshot.noteId === activeId;
      const items: Array<{
        id?: string;
        label?: string;
        enabled?: boolean;
        separator?: boolean;
      }> = [];
      if (canUndo) {
        items.push({ id: '__undoAiTransform', label: m.undoLast });
        items.push({ separator: true });
      }
      items.push(
        // OS ネイティブメニューにはタイトル行が無いため、disabled な
        // ヘッダ項目 + separator で見出しを表現する。
        // disabled のため OS の規約でグレーアウト表示になるが、ホバー反応・
        // クリック反応とも無効化される。
        { label: m.header, enabled: false },
        { separator: true },
        // ── 1. Markdown 変換（構造を壊さない最も穏当な整形）
        { id: 'convertHtmlToMarkdown', label: m.convertHtmlToMarkdown },
        { separator: true },
        // ── 2. 全体要約
        { id: 'summarizeWhole', label: m.summarizeWhole },
        { separator: true },
        // ── 3. 部分整形 (タイトル / 見出し / 箇条書き / 表 / コード)
        { id: 'generateTitleFromContent', label: m.generateTitleFromContent },
        { id: 'summarizeByHeading', label: m.summarizeByHeading },
        { id: 'organizeBullets', label: m.organizeBullets },
        { id: 'formatTables', label: m.formatTables },
        { id: 'improveCodeBlocks', label: m.improveCodeBlocks },
        { separator: true },
        // ── 4. 文体変換系 (お遊び的な変換)
        { id: 'dialectKansai', label: m.dialectKansai },
        { id: 'dialectInaka', label: m.dialectInaka },
        { id: 'makeQuiz', label: m.makeQuiz },
      );
      const action = await window.api.ui.showContextMenu({
        position,
        items,
      });
      if (!action) return;
      if (action === '__undoAiTransform') {
        undoAiTransform();
        return;
      }
      await runAiTransform(action as AiAction);
    },
    [aiBusy, activeId, aiUndoSnapshot, locale, runAiTransform, undoAiTransform],
  );

  const handleAiChatResizeStart = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setAiChatResizing(true);
    },
    [],
  );

  // ----- NoteHeader の表示モードトグル (preview / mix / edit) -----
  const handleSelectEditOrPreview = async (next: ViewKey) => {
    // 編集系 (edit / mix) はパスワード解錠が必要
    if ((next === 'edit' || next === 'mix') && isActiveLocked) {
      setPasswordPurpose({ kind: 'unlock-edit' });
      return;
    }

    // 編集系 → プレビューへの切替時: 未参照メディアの GC
    if (next === 'preview' && view !== 'preview' && activeId) {
      await flushPendingSaves();
      const currentImages = extractImageRefs(body);
      const currentAttachments = extractAttachmentRefs(body);
      const removedImages = [...sessionImagesRef.current].filter(
        (f) => !currentImages.has(f),
      );
      const removedAttachments = [...sessionAttachmentsRef.current].filter(
        (f) => !currentAttachments.has(f),
      );
      if (removedImages.length > 0 || removedAttachments.length > 0) {
        try {
          await window.api.media.gc({
            images: removedImages,
            attachments: removedAttachments,
          });
        } catch {
          // GC 失敗はユーザーに通知しない（次回再試行される）
        }
      }
      // セッションを現在の状態にリセット
      sessionImagesRef.current = currentImages;
      sessionAttachmentsRef.current = currentAttachments;
    }

    setView(next);
  };

  // ----- パスワードダイアログ送信 -----
  // passwordPurpose の kind に応じて分岐処理
  const handlePasswordSubmit = (password: string): boolean => {
    if (password !== settings.protectionPassword) {
      return false;
    }
    if (passwordPurpose === null) return false;

    switch (passwordPurpose.kind) {
      case 'unlock-edit': {
        if (activeId) {
          setUnlockedNoteIds((prev) => new Set(prev).add(activeId));
          // 新たに解錠した直後は「未編集」状態として扱う
          // (これで「解錠 → 編集せず別ノート」で再ロックされる)
          editedAfterUnlockRef.current.delete(activeId);
          setView('edit');
        }
        setPasswordPurpose(null);
        return true;
      }
      case 'unprotect': {
        const targetId = passwordPurpose.noteId;
        void (async () => {
          try {
            await window.api.notes.setProtected(targetId, false);
            const list = await window.api.notes.list();
            setNotes(list);
            setUnlockedNoteIds((prev) => new Set(prev).add(targetId));
          } catch (err) {
            window.alert(
              err instanceof Error ? err.message : '保護解除に失敗しました',
            );
          }
        })();
        setPasswordPurpose(null);
        return true;
      }
      case 'view-secret': {
        const targetId = passwordPurpose.noteId;
        // セッションの解錠リストに追加し、改めて selectNote を呼ぶ
        setUnlockedSecretIds((prev) => {
          const next = new Set(prev);
          next.add(targetId);
          return next;
        });
        // 対象ノートが同時に保護もされている場合、1 回のパスワード入力で
        // 編集モードの解錠も一緒に有効化する
        const meta = notes.find((n) => n.id === targetId);
        if (meta?.protected) {
          setUnlockedNoteIds((prev) => new Set(prev).add(targetId));
        }
        setPasswordPurpose(null);
        // state 更新が反映された後に selectNote を呼ぶため次フレームで実行。
        // bypassLockChecks=true を渡すことで、古いクロージャキャプチャの
        // state を参照して再度ダイアログが開くのを防ぐ。
        window.setTimeout(() => {
          void selectNote(targetId, undefined, true);
        }, 0);
        return true;
      }
      case 'unset-secret': {
        const targetId = passwordPurpose.noteId;
        void (async () => {
          try {
            await window.api.notes.setSecret(targetId, false);
            const list = await window.api.notes.list();
            setNotes(list);
            // 解除済み扱いにする（同セッション中は再要求されない）
            setUnlockedSecretIds((prev) => {
              const next = new Set(prev);
              next.add(targetId);
              return next;
            });
          } catch (err) {
            window.alert(
              err instanceof Error
                ? err.message
                : 'シークレット解除に失敗しました',
            );
          }
        })();
        setPasswordPurpose(null);
        return true;
      }
    }
  };

  // パスワードダイアログを閉じる際の共通ハンドラ（用途状態をクリア）
  const handlePasswordDialogClose = () => {
    setPasswordPurpose(null);
  };

  // エディタ拡張系の設定ハッシュ。これらは EditorState.create のタイミングでだけ
  // 反映できる (= CodeMirror を再構築しないと切替が効かない) ため、
  // `<Editor key={editorConfigKey}>` に渡してプロパティ変化時に再マウントする。
  // 同じ activeId 内では editorConfigKey も同じなので、通常編集中の re-mount は起きない。
  const editorConfigKey = useMemo(
    () =>
      [
        settings.editorHighlightActiveLineGutter,
        settings.editorBracketMatching,
        settings.editorCloseBrackets,
        settings.editorTabSize,
      ].join('|'),
    [
      settings.editorHighlightActiveLineGutter,
      settings.editorBracketMatching,
      settings.editorCloseBrackets,
      settings.editorTabSize,
    ],
  );

  // アプリ終了前にも保留分を書き出す
  useEffect(() => {
    const handler = () => {
      void flushPendingSaves();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flushPendingSaves]);

  const hasNote = activeId !== null;

  /** フッター用の小さなクラウドアイコン (12x12) */
  const FooterCloudIcon = () => (
    <svg
      className="footer__cloud-icon"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.5 13a3.5 3.5 0 0 1-.3-6.98 4.5 4.5 0 0 1 8.6-.5A3.5 3.5 0 0 1 12.5 13h-8z" />
    </svg>
  );

  if (isPreferencesWindow) {
    return (
      <LocaleProvider language={settings.language}>
        <PreferencesModal
          open={true}
          standalone
          onClose={() => void window.api.closeCurrentWindow()}
          settings={settings}
          onChange={handleSettingChange}
        />
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider language={settings.language}>
    <div className="app">
      <div className="app__content">
        <ActivityBar
          sidebarMode={sidebarMode}
          onSelectFiles={handleSelectFiles}
          onSelectSearch={handleSelectSearch}
          onSelectTags={handleSelectTags}
          onSelectHistory={handleSelectHistory}
          onSelectCalendar={handleSelectCalendar}
          calendarEnabled={settings.calendarEnabled}
          historyEnabled={settings.historyEnabled}
          enabledPlugins={settings.enabledPlugins}
          onSelectPluginMode={handleSelectPluginMode}
          onOpenSettings={() => void window.api.openPreferencesWindow()}
          onSelectStorage={handleSelectStorage}
          syncProgressPercent={syncRingPercent}
        />
        <div className="app__body">
        <Sidebar
          ref={sidebarRef}
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={SIDEBAR_MAX_WIDTH}
          onResize={handleSidebarResize}
          mode={sidebarMode}
          files={notes}
          extraFolders={folders}
          activeId={activeId}
          onSelect={(id) => void selectNote(id)}
          onHistorySelect={(id) => {
            // 履歴パネルから開いた時は履歴順を維持するため、次の activeId 遷移
            // での自動 recordNoteOpen をスキップさせる ref を立ててから開く。
            skipHistoryRecordForRef.current = id;
            void selectNote(id);
          }}
          unlockedNoteIds={unlockedNoteIds}
          onPinSelect={(id) =>
            void selectNote(id, undefined, false, { pin: true })
          }
          onCreateNote={() => void handleCreateNote()}
          onCreateNoteInFolder={(folder) =>
            void handleCreateNoteInFolder(folder)
          }
          onDeleteNote={(id) => void handleDeleteNote(id)}
          onToggleProtect={(id, next) => void handleToggleProtect(id, next)}
          onToggleSecret={(id, next) => void handleToggleSecret(id, next)}
          onSetNoteIconColor={(id, color) => {
            // 即時 UI 反映 (バックエンドからの返り値待ちで遅延しないように)
            setNotes((prev) =>
              prev.map((n) => (n.id === id ? { ...n, iconColor: color } : n)),
            );
            void window.api.notes.setIconColor(id, color);
          }}
          onSetFolderIconColor={(path, color) => {
            setFolderIconColors((prev) => ({ ...prev, [path]: color }));
            void window.api.folders.setIconColor(path, color);
          }}
          folderIconColors={folderIconColors}
          onSearch={handleSearch}
          searchHistory={searchHistory}
          onAddSearchHistory={handleAddSearchHistory}
          onMoveNote={(id, target) => void handleMoveNote(id, target)}
          onMoveFolder={(oldPath, newParent) =>
            void handleMoveFolder(oldPath, newParent)
          }
          onRenameNote={handleStartRename}
          onRenameFolder={handleStartRenameFolder}
          onDeleteFolder={(folderPath) => void handleDeleteFolder(folderPath)}
          storagePath={settings.storagePath}
          openHistory={openHistory}
          onClearOpenHistory={handleClearOpenHistory}
          notes={notes}
          settings={settings}
          onSettingsChange={handleSettingChange}
          onPluginCreateNote={handlePluginCreateNote}
          trashedNotes={trashedNotes}
          onRestoreNote={(id) => void handleRestoreNote(id)}
          onDeletePermanent={(id) => void handleDeletePermanent(id)}
          onEmptyTrash={() => void handleEmptyTrash()}
        />
        <main className="app__main">
          <TabBar
            openTabIds={openTabIds}
            activeId={activeId}
            notes={notes}
            onSelect={(id) => void selectNote(id)}
            onClose={(id) => void closeTab(id)}
            onCloseMany={(ids) => void closeTabs(ids)}
            onDeleteNote={(id) => void handleDeleteNote(id)}
            onReorder={(nextIds) => setOpenTabIds(nextIds)}
            onSummarizeClick={(position) =>
              void openAiTransformMenu(position)
            }
            onToggleAiChat={() => setAiChatOpen((v) => !v)}
            summarizeDisabled={!activeId}
            summarizeBusy={aiBusy}
            aiChatOpen={aiChatOpen}
            aiEnabled={getActiveAiSettings(settings).token.trim().length > 0}
            pinnedTabIds={pinnedTabIds}
            // 📍 表示は preview-tab モードのときだけ。
            // openNoteInNewTab=true(常に新規タブ) では preview の概念がないため、
            // 📍 を出すと全タブに 📍 が並んで意味を失うので隠す。
            pinIndicatorEnabled={!settings.openNoteInNewTab}
            // タブのダブルクリックでピン留め。アクティブ化も同時に行い、
            // プレビュータブから固定タブへの昇格と同等の挙動にする。
            onPinTab={(id) => {
              setPinnedTabIds((prev) =>
                prev.includes(id) ? prev : [...prev, id],
              );
              // ダブルクリック対象がプレビュータブだった場合は preview の指定を外す。
              setPreviewTabId((prev) => (prev === id ? null : prev));
            }}
          />
          <div className="app__workspace" ref={workspaceRef}>
            {fontSizeIndicator !== null && (
              <div
                className="font-size-indicator"
                role="status"
                aria-live="polite"
              >
                <span className="font-size-indicator__value">
                  {fontSizeIndicator}
                </span>
                <span className="font-size-indicator__unit">px</span>
              </div>
            )}
            <div
              className="app__note-pane"
              onDragOver={handleNoteDragOver}
              onDrop={handleNoteDrop}
            >
              {hasNote ? (
                <div className="note">
                  {/* バックグラウンド同期中オーバーレイ */}
                  {syncingNoteId === activeId && syncingNoteId !== null && (
                    <div className="note__syncing-overlay" aria-live="polite">
                      <div className="note__syncing-spinner" />
                      <span>同期中…</span>
                    </div>
                  )}
                  <NoteHeader
                    name={buildPath(editingFolder, editingTitle)}
                    view={view}
                    onNameChange={handleNameChange}
                    onSelectView={(next) => void handleSelectEditOrPreview(next)}
                  />
                  {view !== 'preview' && settings.showInsertButtons && (
                    <EditorToolbar
                      editorRef={editorRef}
                      dateFormat={settings.dateFormat}
                      templateFolder={settings.templateFolder}
                      enabledPlugins={settings.enabledPlugins}
                      disabled={!editorFocused}
                      onApplyTemplateTags={(tags) => {
                        // テンプレートのタグを現在のタグへマージ。重複は除く。
                        const next = [...editingTags];
                        for (const t of tags) {
                          if (!next.includes(t)) next.push(t);
                        }
                        handleTagsChange(next);
                      }}
                    />
                  )}
                  {/* TagBar はどのモードでも編集可能（preview でもタグ修正できる） */}
                  <TagBar tags={editingTags} onChange={handleTagsChange} />
                  <div
                    ref={mixBodyRef}
                    className={`note__body ${view === 'mix' ? 'note__body--mix' : ''} ${mixResizing ? 'note__body--mix-resizing' : ''}`}
                    style={
                      view === 'mix'
                        ? {
                            gridTemplateColumns: `${mixSplitPercent}% 6px 1fr`,
                          }
                        : undefined
                    }
                  >
                    {view === 'mix' ? (
                      <>
                        {/* MIX: 左 Editor / 右 Preview。Editor の onChange で
                           即座に body が更新され、右 Preview が再描画される。
                           onScroll で互いの scrollTop を比率同期する。
                           中央のリサイザーをドラッグすると分割比 (Editor 側 %) が
                           更新され、localStorage に永続化される。 */}
                        <Editor
                          key={editorConfigKey}
                          ref={editorRef}
                          value={body}
                          onChange={handleBodyChange}
                          theme={settings.theme}
                          onFocusChange={setEditorFocused}
                          onScroll={handleEditorScroll}
                          showMinimap={settings.editorMinimap}
                          activeLineUnderline={settings.editorActiveLineUnderline}
                          activeLineUnderlineColor={
                            settings.editorActiveLineUnderlineColor
                          }
                          highlightActiveLineGutter={
                            settings.editorHighlightActiveLineGutter
                          }
                          bracketMatching={settings.editorBracketMatching}
                          closeBrackets={settings.editorCloseBrackets}
                          tabSize={settings.editorTabSize}
                        />
                        <div
                          className={`note__body-splitter ${mixResizing ? 'is-active' : ''}`}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label="エディタとプレビューの幅を変更"
                          aria-valuenow={Math.round(mixSplitPercent)}
                          aria-valuemin={15}
                          aria-valuemax={85}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setMixResizing(true);
                          }}
                          onDoubleClick={() => setMixSplitPercent(50)}
                          title="ドラッグで幅を変更 / ダブルクリックで 50:50 に戻す"
                        />
                        <Preview
                          ref={previewMixRef}
                          value={body}
                          codeCopyAlwaysVisible={settings.codeCopyAlwaysVisible}
                          showLineNumbers={settings.codeShowLineNumbers}
                          enabledHighlightLangs={settings.enabledHighlightLangs}
                          enabledPlugins={settings.enabledPlugins}
                          theme={settings.theme}
                          // 保護ノートが未解錠 (isActiveLocked) なら onChange を渡さない。
                          // → Schedule などビュー側で編集できるプラグインも自動的に
                          //   read-only になり、タスクチェックボックスも反応しない。
                          onChange={isActiveLocked ? undefined : handleBodyChange}
                          onScroll={handlePreviewScroll}
                        />
                      </>
                    ) : view === 'edit' ? (
                      <Editor
                        key={editorConfigKey}
                        ref={editorRef}
                        value={body}
                        onChange={handleBodyChange}
                        theme={settings.theme}
                        onFocusChange={setEditorFocused}
                        showMinimap={settings.editorMinimap}
                        activeLineUnderline={settings.editorActiveLineUnderline}
                        activeLineUnderlineColor={
                          settings.editorActiveLineUnderlineColor
                        }
                        highlightActiveLineGutter={
                          settings.editorHighlightActiveLineGutter
                        }
                        bracketMatching={settings.editorBracketMatching}
                        closeBrackets={settings.editorCloseBrackets}
                        tabSize={settings.editorTabSize}
                      />
                    ) : (
                      <Preview
                        value={body}
                        codeCopyAlwaysVisible={settings.codeCopyAlwaysVisible}
                        showLineNumbers={settings.codeShowLineNumbers}
                        enabledHighlightLangs={settings.enabledHighlightLangs}
                        enabledPlugins={settings.enabledPlugins}
                        theme={settings.theme}
                        // 保護ノートが未解錠 (isActiveLocked) ならビュー編集系を封じる
                        onChange={isActiveLocked ? undefined : handleBodyChange}
                      />
                    )}
                  </div>
                  {linkedNotes.length > 0 && (
                    <div className="note-links-bar" aria-label="連携ノート">
                      <span className="note-links-bar__label">連携：</span>
                      <div className="note-links-bar__badges">
                        {linkedNotes.map((note) => (
                          <span
                            role="button"
                            tabIndex={0}
                            className="note-links-bar__badge"
                            key={note.id}
                            onClick={() => void selectNote(note.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                void selectNote(note.id);
                              }
                            }}
                            title={buildPath(note.folder, note.title) || '無題'}
                          >
                            <span className="note-links-bar__title">
                              {note.title || '無題'}
                            </span>
                            <button
                              type="button"
                              className="note-links-bar__remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRemoveLinkedNote(note.id);
                              }}
                              aria-label={`${note.title || '無題'} との連携を解除`}
                              title="連携解除"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <img
                    className="empty-state__logo"
                    src={logoUrl}
                    alt="InkNel ロゴ"
                    draggable={false}
                  />
                  <h1 className="empty-state__title">InkNel</h1>
                  <p className="empty-state__tagline">
                    Markdown で思考を整理する
                  </p>
                </div>
              )}
            </div>
            {/*
              AI チャットはサイドバーと同じく常時マウントしておき、
              `collapsed` で width をアニメーション切替する（チャット履歴を保持）。
              splitter は開いている時だけ表示。
            */}
            {aiChatOpen && (
              <div
                className={`app__splitter ${aiChatResizing ? 'is-active' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="AI領域の幅を変更"
                onMouseDown={handleAiChatResizeStart}
              />
            )}
            <AiChatPanel
              // activeId が変わるたびに再マウント。ノートを切り替えると新しい
              // チャットウィンドウが開いた状態になる。activeId 無しの状態
              // (どのノートも開いていない) は専用 key にして 1 つの揮発インスタンスを共有。
              key={activeId ?? '__no-note__'}
              onClose={() => setAiChatOpen(false)}
              settings={settings}
              noteTitle={activeNoteMeta?.title ?? ''}
              noteBody={body}
              activeId={activeId}
              linkedNotes={linkedNotes}
              width={aiChatWidth}
              collapsed={!aiChatOpen}
              resizing={aiChatResizing}
              initialState={
                activeId ? chatStatesRef.current.get(activeId) : undefined
              }
              onStateChange={(state) => {
                if (activeId) chatStatesRef.current.set(activeId, state);
              }}
              onNoteCreated={async (created) => {
                const list = await window.api.notes.list();
                setNotes(list);
                if (created.folder) {
                  sidebarRef.current?.expandFolder(created.folder);
                }
              }}
              onAppendToCurrentNote={(content) => {
                // 現在ノートの末尾にディレクティブ由来の内容を追記。
                // handleBodyChange で App state を更新し、デバウンス保存にも乗せる。
                if (!activeId) return;
                const sep = body.length === 0
                  ? ''
                  : body.endsWith('\n\n')
                    ? ''
                    : body.endsWith('\n')
                      ? '\n'
                      : '\n\n';
                handleBodyChange(body + sep + content + '\n');
              }}
              onRewriteCurrentNote={(newBody) => {
                // AI ディレクティブで現在ノートを完成形に書き換える。
                // 破壊的判定は AiChatPanel 側で済んでいる前提。
                if (!activeId) return;
                handleBodyChange(newBody);
              }}
            />
          </div>
        </main>
      </div>
      </div>{/* app__content */}
      <footer className="app__footer" role="contentinfo">
        {importProgress ? (
          /* ── ファイル/ディレクトリインポート中 ── */
          <>
            <div className="footer__left">
              <span className="footer__direction">📥</span>
              <span className="footer__filename">
                {importProgress.fileName
                  ? `読み込み中: ${importProgress.fileName} (${importProgress.current}/${importProgress.total})`
                  : `読み込み準備中… (${importProgress.total} 件)`}
              </span>
            </div>
            <div className="footer__progress">
              <div
                className="footer__progress-fill"
                style={{
                  width: `${
                    importProgress.total > 0
                      ? Math.round(
                          (importProgress.current / importProgress.total) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          </>
        ) : (sharing || syncingNoteId) && syncProgress ? (
          /* ── 一括同期中: [☁][↑↓][ファイル名][プログレス] ── */
          <>
            <div className="footer__left">
              <FooterCloudIcon />
              <span className="footer__direction">
                {syncProgress.phase === 'push'
                  ? '↑'
                  : syncProgress.phase === 'pull'
                    ? '↓'
                    : syncProgress.phase === 'skip'
                      ? '='
                      : syncProgress.phase === 'media'
                        ? '↑↓'
                        : '…'}
              </span>
              <span className="footer__filename">
                {syncProgress.phase === 'push' ||
                syncProgress.phase === 'pull' ||
                syncProgress.phase === 'skip'
                  ? syncProgress.noteTitle
                  : syncProgress.phase === 'media'
                    ? `${syncProgress.kind === 'images' ? '画像' : '添付'} (↑${syncProgress.pushed} ↓${syncProgress.pulled})`
                    : syncProgress.phase === 'start'
                      ? `同期開始 (${syncProgress.total} 件)`
                      : syncProgress.phase === 'finalizing'
                        ? 'マニフェスト書き込み中…'
                        : syncProgress.phase === 'done'
                          ? '同期完了'
                          : '同期中…'}
              </span>
            </div>
            <div className="footer__progress">
              <div
                className="footer__progress-fill"
                style={{
                  width: `${
                    'current' in syncProgress &&
                    'total' in syncProgress &&
                    syncProgress.total > 0
                      ? Math.round(
                          (syncProgress.current / syncProgress.total) * 100,
                        )
                      : syncProgress.phase === 'done'
                        ? 100
                        : syncProgress.phase === 'finalizing'
                          ? 95
                          : syncProgress.phase === 'media'
                            ? 90
                            : 0
                  }%`,
                }}
              />
            </div>
          </>
        ) : syncingNoteId ? (
          /* ── バックグラウンドチェック中: [☁][↑↓][確認中…][不確定プログレス] ── */
          <>
            <div className="footer__left">
              <FooterCloudIcon />
              <span className="footer__direction">↑↓</span>
              <span className="footer__filename">確認中…</span>
            </div>
            <div className="footer__progress">
              <div className="footer__progress-fill footer__progress-fill--indeterminate" />
            </div>
          </>
        ) : (
          /* ── 通常時 ── */
          <>
            <div className="footer__left">
              {activeNoteMeta && (
                <span className="footer__item">
                  {buildPath(activeNoteMeta.folder, activeNoteMeta.title) ||
                    '無題'}
                </span>
              )}
            </div>
            <div className="footer__right">
              {activeNoteMeta && (
                <span
                  className="footer__item footer__item--stats"
                  aria-label="note statistics"
                >
                  {locale.footer.chars.replace(
                    '{{count}}',
                    noteStats.chars.toLocaleString(),
                  )}
                  {' / '}
                  {locale.footer.words.replace(
                    '{{count}}',
                    noteStats.words.toLocaleString(),
                  )}
                </span>
              )}
              {settings.shareProvider !== 'none' && (
                <span className="footer__item footer__item--sync">
                  <FooterCloudIcon /> 共有
                </span>
              )}
            </div>
          </>
        )}
      </footer>
      <PreferencesModal
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        settings={settings}
        onChange={handleSettingChange}
      />
      <PasswordDialog
        open={passwordDialogOpen}
        onClose={handlePasswordDialogClose}
        onSubmit={handlePasswordSubmit}
        description={
          passwordPurpose?.kind === 'unprotect'
            ? 'このノートの保護を解除します。4桁のパスワードを入力してください。'
            : passwordPurpose?.kind === 'view-secret'
              ? 'このノートはシークレットです。表示するには4桁のパスワードを入力してください。'
              : passwordPurpose?.kind === 'unset-secret'
                ? 'このノートのシークレット設定を解除します。4桁のパスワードを入力してください。'
                : undefined
        }
        submitLabel={
          passwordPurpose?.kind === 'unprotect'
            ? '保護解除'
            : passwordPurpose?.kind === 'view-secret'
              ? '表示'
              : passwordPurpose?.kind === 'unset-secret'
                ? 'シークレット解除'
                : '解錠'
        }
      />
      <AiTransformResultModal
        open={aiResultModal !== null}
        actionLabel={aiResultModal?.actionLabel ?? ''}
        noteTitle={aiResultModal?.noteTitle ?? ''}
        isBackground={aiResultModal?.isBackground ?? false}
        payload={
          aiResultModal?.payload ?? { kind: 'error', message: '' }
        }
        onApply={() => {
          aiResultModal?.apply();
          setAiResultModal(null);
        }}
        onClose={() => setAiResultModal(null)}
      />
      <RenameDialog
        open={renameTarget !== null}
        initialName={
          renameTarget === null
            ? ''
            : renameTarget.kind === 'note'
              ? renameTarget.name
              : renameTarget.leafName
        }
        onClose={() => setRenameTarget(null)}
        onSubmit={(name) => void handleRenameSubmit(name)}
      />
      <MacroKeysDialog
        open={macroKeysOpen}
        keys={macroKeys}
        onClose={() => setMacroKeysOpen(false)}
        onSave={handleSaveMacro}
      />
      <SavedMacroDialog
        open={savedMacroDialogMacro !== null}
        name={savedMacroDialogMacro?.name ?? ''}
        keys={savedMacroDialogMacro?.display ?? []}
        onClose={() => setSavedMacroDialogId(null)}
        onRename={handleRenameSavedMacro}
        onSetToF1={handleSetSavedMacroToF1}
        onDelete={handleDeleteSavedMacro}
      />
      <FindDialog
        open={findOpen}
        onClose={() => setFindOpen(false)}
        onFindNext={(q) => editorRef.current?.findNext(q) != null}
        onFindPrev={(q) => editorRef.current?.findPrev(q) != null}
      />
      <ReplaceDialog
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        onFindNext={(q) => editorRef.current?.findNext(q) != null}
        onReplaceCurrent={(q, r) =>
          editorRef.current?.replaceCurrent(q, r) ?? false
        }
        onReplaceAll={(q, r) => editorRef.current?.replaceAll(q, r) ?? 0}
      />
    </div>
    </LocaleProvider>
  );
}
