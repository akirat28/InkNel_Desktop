import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FileItem, TreeNode } from '../types';
import { useT } from '../i18n';
import { buildTree } from '../utils/buildTree';
import SearchPanel from './SearchPanel';
import SyncPanel from './SyncPanel';
import StorageSyncPanel from './StorageSyncPanel';
import TagsPanel from './TagsPanel';
import HistoryPanel, { type HistoryEntry } from './HistoryPanel';
import CalendarPanel from '../calendar/CalendarPanel';
import { getEnabledPlugins } from '../plugins/registry';
import { subscribeRuntimePlugins } from '../plugins/runtimeLoader';
import type { AppSettings } from '../settings';
import type {
  NoteMeta,
  ShareProviderId,
  ShareSyncProgress,
  ShareSyncResult,
} from '../global';

/**
 * サイドバーのモード ID。本体組み込みは files / search / tags / history / sync。
 * プラグインが独自モード ID を `activityBarItem.mode` / `sidebarPanel.mode` で
 * 宣言してきた場合、その文字列もここに乗る。型は `string` のため拡張可能。
 */
export type SidebarMode = string;

/** ノート ID をやりとりする独自の DataTransfer タイプ */
const NOTE_DRAG_TYPE = 'application/x-inknel-note-id';

/** フォルダパスをやりとりする独自の DataTransfer タイプ */
const FOLDER_DRAG_TYPE = 'application/x-inknel-folder-path';

const TREE_CHILDREN_TRANSITION_MS = 200;

interface Props {
  collapsed: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (next: number) => void;
  mode: SidebarMode;
  files: FileItem[];
  extraFolders: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /**
   * 履歴パネル専用の選択ハンドラ。未指定なら onSelect にフォールバック。
   * App 側で「履歴をクリックしただけでは履歴順を動かさない」処理を行う想定。
   */
  onHistorySelect?: (id: string) => void;
  /**
   * セッション内で保護パスワード入力により解錠されたノート ID の集合。
   * 含まれていれば保護アイコンを「解錠状態」に切り替える。
   */
  unlockedNoteIds?: ReadonlySet<string>;
  /**
   * ダブルクリックでノートを「ピン留め」状態で開く。
   * App 側で previewTabId 経由の差し替え対象から外し、`📍` マークを付ける。
   * 未指定なら通常クリックと同じ扱い。
   */
  onPinSelect?: (id: string) => void;
  onCreateNote: () => void;
  /** 指定フォルダ配下に無題ノートを作成 */
  onCreateNoteInFolder: (folderPath: string) => void;
  onDeleteNote: (id: string) => void;
  onToggleProtect: (id: string, next: boolean) => void;
  onToggleSecret: (id: string, next: boolean) => void;
  onSearch: (query: string) => Promise<NoteMeta[]>;
  searchHistory: string[];
  onAddSearchHistory: (query: string) => void;
  /** ファイルを別フォルダへドラッグ&ドロップで移動 */
  onMoveNote: (noteId: string, targetFolder: string) => void;
  /** フォルダを別階層へドラッグ&ドロップで移動 */
  onMoveFolder: (oldPath: string, newParentPath: string) => void;
  /** ノートの名称変更ダイアログを開く */
  onRenameNote: (noteId: string) => void;
  /** フォルダの名称変更ダイアログを開く */
  onRenameFolder: (folderPath: string) => void;
  /** フォルダを配下ごと削除 */
  onDeleteFolder: (folderPath: string) => void;
  /** 共有プロバイダ（'none' なら sync パネルは使わない） */
  shareProvider: ShareProviderId;
  /**
   * 設定で指定されたファイル保存先フォルダパス。
   * 空文字列なら「保存先未設定」状態として StorageSyncPanel の代わりに案内を表示する。
   */
  storagePath: string;
  /** 同期開始トリガー（SyncPanel の「同期開始」ボタンから） */
  onStartSync: () => Promise<void>;
  /** 同期実行中フラグ */
  syncing: boolean;
  /** 最新の進捗イベント */
  syncProgress: ShareSyncProgress | null;
  /** 前回同期の結果 */
  syncLastResult: ShareSyncResult | null;
  /** 前回同期のエラー */
  syncLastError: string | null;
  /** ノート開封履歴（新しい順）。'history' モードで表示 */
  openHistory: HistoryEntry[];
  /** 履歴クリア処理 */
  onClearOpenHistory: () => void;
  /** メタ参照用に notes も渡す（タイトル解決） */
  notes: NoteMeta[];
  /** プラグインパネルに渡す: アプリ設定（プラグインの設定スライス参照用） */
  settings: AppSettings;
  /** プラグインパネルに渡す: 設定変更コールバック */
  onSettingsChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  /** プラグインパネルに渡す: 新規ノートの作成（自動でタブ/エディタにも反映） */
  onPluginCreateNote: (input: {
    title?: string;
    folder?: string;
    body?: string;
    tags?: string[];
  }) => Promise<NoteMeta>;
  /** ゴミ箱内ノート一覧 (最下部の「ゴミ箱」セクションで表示) */
  trashedNotes: NoteMeta[];
  /** ゴミ箱から復元 (保護ノートは App 側でパスワード確認) */
  onRestoreNote: (id: string) => void;
  /** ゴミ箱内ノートを完全に削除 (1 件) */
  onDeletePermanent: (id: string) => void;
  /** ゴミ箱を空にする */
  onEmptyTrash: () => void;
}

/** 外部から Sidebar を操作するためのハンドル */
export interface SidebarHandle {
  /** 指定したフォルダパスとその全祖先を展開する */
  expandFolder: (folderPath: string) => void;
}

const Sidebar = forwardRef<SidebarHandle, Props>(function Sidebar(
  {
    collapsed,
    width,
    minWidth,
    maxWidth,
    onResize,
    mode,
    files,
    extraFolders,
    activeId,
    onSelect,
    onHistorySelect,
    unlockedNoteIds,
    onPinSelect,
    onCreateNote,
    onCreateNoteInFolder,
    onDeleteNote,
    onToggleProtect,
    onToggleSecret,
    onSearch,
    searchHistory,
    onAddSearchHistory,
    onMoveNote,
    onMoveFolder,
    onRenameNote,
    onRenameFolder,
    onDeleteFolder,
    shareProvider,
    storagePath,
    onStartSync,
    syncing,
    syncProgress,
    syncLastResult,
    syncLastError,
    openHistory,
    onClearOpenHistory,
    notes,
    settings,
    onSettingsChange,
    onPluginCreateNote,
    trashedNotes,
    onRestoreNote,
    onDeletePermanent,
    onEmptyTrash,
  }: Props,
  ref,
) {
  // ゴミ箱セクションの開閉状態
  const [trashOpen, setTrashOpen] = useState(false);

  /** ゴミ箱ヘッダの右クリック: 「ゴミ箱を空にする」のみ */
  const openTrashHeaderMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = await window.api.ui.showContextMenu({
      position: { x: e.clientX, y: e.clientY },
      items: [
        {
          id: 'empty',
          label: 'ゴミ箱を空にする',
          enabled: trashedNotes.length > 0,
        },
      ],
    });
    if (id === 'empty') onEmptyTrash();
  };

  /** ゴミ箱内ノートの右クリック: 復元 / 完全に削除 */
  const openTrashNoteMenu = async (
    noteId: string,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const id = await window.api.ui.showContextMenu({
      position: { x: e.clientX, y: e.clientY },
      items: [
        { id: 'restore', label: '復元' },
        { separator: true },
        { id: 'deletePerm', label: '完全に削除' },
      ],
    });
    if (id === 'restore') onRestoreNote(noteId);
    else if (id === 'deletePerm') onDeletePermanent(noteId);
  };
  const t = useT();

  // ===== プラグイン由来のサイドバーパネル =====
  // 有効化中のプラグインから `sidebarPanel` を持つものを集め、現在の mode と
  // 一致するパネルを取り出す。runtime プラグインの追加/削除も反映するため
  // `subscribeRuntimePlugins` で再評価。
  const [pluginRev, setPluginRev] = useState(0);
  useEffect(
    () => subscribeRuntimePlugins(() => setPluginRev((r) => r + 1)),
    [],
  );
  const pluginSidebarPanel = useMemo(() => {
    const enabled = getEnabledPlugins(settings.enabledPlugins);
    for (const p of enabled) {
      if (p.module.sidebarPanel && p.module.sidebarPanel.mode === mode) {
        return p.module.sidebarPanel;
      }
    }
    return null;
    // pluginRev は subscribeRuntimePlugins の通知でインクリメントされる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, settings.enabledPlugins, pluginRev]);

  const tree = useMemo(
    () => buildTree(files, extraFolders),
    [files, extraFolders],
  );

  // フォルダの展開状態（path -> bool）。デフォルトは全展開。
  // フォルダの展開状態 (path -> bool)。デフォルトは true（展開）扱い。
  // SQLite の settings テーブルにキー 'sidebar.expanded' で永続化する。
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 「ノート」ヘッダの虫眼鏡ボタンで開閉するインライン検索。
  // 入力した文字列でツリー上のノート名に部分一致ハイライトを掛ける。
  const [inlineSearchOpen, setInlineSearchOpen] = useState(false);
  const [inlineSearchQuery, setInlineSearchQuery] = useState('');
  // ヒット内ナビゲーションの現在位置（matches 配列の index）。
  // ヒット 0 件、または query 空のときは -1。
  const [inlineSearchIndex, setInlineSearchIndex] = useState<number>(-1);
  const expandedLoadedRef = useRef(false);

  // 起動時に DB から復元
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await window.api.settings.getAll();
        if (cancelled) return;
        const raw = all['sidebar.expanded'];
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            setExpanded(parsed as Record<string, boolean>);
          }
        }
      } catch {
        // 読み込み失敗時はデフォルト (全展開)
      } finally {
        expandedLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 変更時に DB へ保存（デバウンス）
  const expandedSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!expandedLoadedRef.current) return;
    if (expandedSaveTimer.current) clearTimeout(expandedSaveTimer.current);
    expandedSaveTimer.current = setTimeout(() => {
      void window.api.settings
        .set('sidebar.expanded', JSON.stringify(expanded))
        .catch(() => {
          // 保存失敗は無視
        });
    }, 300);
    return () => {
      if (expandedSaveTimer.current) clearTimeout(expandedSaveTimer.current);
    };
  }, [expanded]);

  const isExpanded = (path: string) => expanded[path] !== false;
  const toggle = (path: string) =>
    setExpanded((prev) => ({ ...prev, [path]: !isExpanded(path) }));

  // 外部から呼び出す展開メソッド（App.tsx の handleCreateNote から使う）
  useImperativeHandle(
    ref,
    () => ({
      expandFolder(folderPath: string) {
        if (!folderPath) return;
        // folderPath とその全祖先を true に
        const segments = folderPath.split('/').filter((s) => s.length > 0);
        const toOpen: string[] = [];
        for (let i = 0; i < segments.length; i++) {
          toOpen.push(segments.slice(0, i + 1).join('/'));
        }
        setExpanded((prev) => {
          const next = { ...prev };
          for (const p of toOpen) next[p] = true;
          return next;
        });
      },
    }),
    [],
  );

  /** ツリーから全フォルダパスを再帰的に収集する */
  const collectFolderPaths = (nodes: TreeNode[]): string[] => {
    const paths: string[] = [];
    for (const node of nodes) {
      if (node.kind === 'folder') {
        paths.push(node.path);
        paths.push(...collectFolderPaths(node.children));
      }
    }
    return paths;
  };

  const expandAll = () => {
    const paths = collectFolderPaths(tree);
    const next: Record<string, boolean> = {};
    for (const p of paths) next[p] = true;
    setExpanded(next);
  };

  const collapseAll = () => {
    const paths = collectFolderPaths(tree);
    const next: Record<string, boolean> = {};
    for (const p of paths) next[p] = false;
    setExpanded(next);
  };

  /**
   * インライン検索のヒット一覧。
   * - ノート（ファイル）名 と フォルダ（ディレクトリ）名の両方を対象。
   * - ツリーを深さ優先で巡回し、表示順に並べる（◀/▶ ナビが直感的）。
   * - query 空または開いていないときは空配列。
   * - title の部分一致（大文字小文字無視）。
   * - 各エントリは識別用に { kind, id, path?, label } を持つ。
   *   kind='file' → id=ノートID / kind='folder' → path=フォルダパス。
   */
  type InlineHit =
    | { kind: 'file'; id: string }
    | { kind: 'folder'; path: string };

  const inlineSearchHits = useMemo<InlineHit[]>(() => {
    if (!inlineSearchOpen) return [];
    const q = inlineSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const out: InlineHit[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'folder') {
          if (n.name.toLowerCase().includes(q)) {
            out.push({ kind: 'folder', path: n.path });
          }
          walk(n.children);
        } else {
          if (n.file.title.toLowerCase().includes(q)) {
            out.push({ kind: 'file', id: n.file.id });
          }
        }
      }
    };
    walk(tree);
    return out;
  }, [inlineSearchOpen, inlineSearchQuery, tree]);

  // 検索クエリが変わったら index を 0 に戻す。
  // ヒット 0 件なら -1。同じクエリのままヒット数だけ変わった場合は範囲内へクランプ。
  useEffect(() => {
    if (inlineSearchHits.length === 0) {
      setInlineSearchIndex(-1);
      return;
    }
    setInlineSearchIndex((prev) => {
      if (prev < 0) return 0;
      if (prev >= inlineSearchHits.length) return inlineSearchHits.length - 1;
      return prev;
    });
  }, [inlineSearchHits.length, inlineSearchQuery]);

  /**
   * インライン検索の「現在ヒット」が変わるたびに、
   * - 祖先フォルダを自動展開
   * - 対象行を scrollIntoView
   * - ファイルヒットなら onSelect(id) で開く
   */
  useEffect(() => {
    if (!inlineSearchOpen) return;
    if (inlineSearchIndex < 0) return;
    const hit = inlineSearchHits[inlineSearchIndex];
    if (!hit) return;

    // 展開すべき祖先パスを集める
    //   file: ノートの folder
    //   folder: 親フォルダ（自身は scrollIntoView のため）
    const pathSource =
      hit.kind === 'file'
        ? files.find((f) => f.id === hit.id)?.folder ?? ''
        : (() => {
            const i = hit.path.lastIndexOf('/');
            return i >= 0 ? hit.path.slice(0, i) : '';
          })();
    if (pathSource) {
      const parts = pathSource.split('/');
      const toOpen = new Set<string>();
      for (let i = 1; i <= parts.length; i++) {
        toOpen.add(parts.slice(0, i).join('/'));
      }
      setExpanded((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const p of toOpen) {
          if (!next[p]) {
            next[p] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    // DOM 反映後にスクロール
    requestAnimationFrame(() => {
      const sel =
        hit.kind === 'file'
          ? `[data-note-id="${CSS.escape(hit.id)}"]`
          : `[data-folder-path="${CSS.escape(hit.path)}"]`;
      const el = asideRef.current?.querySelector(sel);
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    });

    // ファイルヒットなら同時にノートを開く（フォルダはノートが無いので何もしない）
    if (hit.kind === 'file') {
      onSelect(hit.id);
    }
    // onSelect は外部から渡される関数。意図しない再実行を避けるため依存配列には
    // インデックスとヒット一覧だけを入れる（onSelect は App 側で安定参照）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineSearchIndex, inlineSearchHits, inlineSearchOpen]);

  const goNextHit = () => {
    if (inlineSearchHits.length === 0) return;
    setInlineSearchIndex(
      (i) => (i + 1 + inlineSearchHits.length) % inlineSearchHits.length,
    );
  };
  const goPrevHit = () => {
    if (inlineSearchHits.length === 0) return;
    setInlineSearchIndex(
      (i) =>
        (i - 1 + inlineSearchHits.length) % inlineSearchHits.length,
    );
  };

  /**
   * ファイル行のケバブから OS ネイティブメニューを開く。
   * Web ベースの ContextMenu と違いウィンドウ外にもはみ出せる。
   */
  const openFileMenu = async (file: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const isProtected = file.protected === true;
    const isSecret = file.secret === true;
    const id = await window.api.ui.showContextMenu({
      // クリック位置（ケバブクリック / 右クリック共通）にメニューを開く
      position: { x: e.clientX, y: e.clientY },
      items: [
        { id: 'rename', label: t.sidebar.menu.fileRename },
        {
          id: 'protect',
          label: isProtected
            ? t.sidebar.menu.fileUnprotect
            : t.sidebar.menu.fileProtect,
        },
        {
          id: 'secret',
          label: isSecret
            ? t.sidebar.menu.fileUnsecret
            : t.sidebar.menu.fileMakeSecret,
        },
        { separator: true },
        {
          id: 'delete',
          label: t.sidebar.menu.fileDelete,
          enabled: !isProtected,
        },
      ],
    });
    if (id === 'rename') onRenameNote(file.id);
    else if (id === 'protect') onToggleProtect(file.id, !isProtected);
    else if (id === 'secret') onToggleSecret(file.id, !isSecret);
    else if (id === 'delete') {
      const title = file.title || t.common.untitled;
      if (
        window.confirm(t.sidebar.confirmDeleteFile.replace('{{title}}', title))
      ) {
        onDeleteNote(file.id);
      }
    }
  };

  const openFolderMenu = async (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = await window.api.ui.showContextMenu({
      position: { x: e.clientX, y: e.clientY },
      items: [
        { id: 'createNote', label: t.sidebar.menu.folderCreateNote },
        { id: 'rename', label: t.sidebar.menu.folderRename },
        { separator: true },
        {
          id: 'deleteRecursive',
          label: t.sidebar.menu.folderDeleteRecursive,
        },
      ],
    });
    if (id === 'createNote') onCreateNoteInFolder(folderPath);
    else if (id === 'rename') onRenameFolder(folderPath);
    else if (id === 'deleteRecursive') onDeleteFolder(folderPath);
  };

  // ----- ドラッグ&ドロップ（ファイル / フォルダ → フォルダ移動） -----
  // 現在ドラッグ対象のフォルダパス。視覚ハイライト用。
  // null = ルート領域（トップレベル）へのドロップターゲット状態は rootDragOver で管理。
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [rootDragOver, setRootDragOver] = useState<boolean>(false);

  // ドラッグ終了 (dragend) / ドロップ完了時にハイライト状態を必ずクリア。
  // ブラウザによっては dragleave が発火しないケースがあるため、window レベルの
  // dragend / drop イベントで強制リセットする。
  useEffect(() => {
    const clear = () => {
      setDragOverFolder(null);
      setRootDragOver(false);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  const handleFileDragStart = (
    e: React.DragEvent<HTMLButtonElement>,
    noteId: string,
  ) => {
    e.dataTransfer.setData(NOTE_DRAG_TYPE, noteId);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleFolderDragStart = (
    e: React.DragEvent<HTMLButtonElement>,
    path: string,
  ) => {
    e.dataTransfer.setData(FOLDER_DRAG_TYPE, path);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDragOver = (
    e: React.DragEvent<HTMLButtonElement>,
    path: string,
  ) => {
    const types = e.dataTransfer.types;
    const isNote = types.includes(NOTE_DRAG_TYPE);
    const isFolder = types.includes(FOLDER_DRAG_TYPE);
    if (!isNote && !isFolder) return;

    // フォルダを自分自身・自身の子孫にはドロップできない
    if (isFolder) {
      // DataTransfer の getData は dragover 中は読み取り不可のブラウザが多いので
      // dragOver 時は hint 用の判定はできない。drop 時にチェックする。
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverFolder !== path) setDragOverFolder(path);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleFolderDrop = (
    e: React.DragEvent<HTMLButtonElement>,
    path: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
    // フォルダ行へドロップした場合もルートのハイライトを念のためクリア
    setRootDragOver(false);

    // ノートのドロップ
    const noteId = e.dataTransfer.getData(NOTE_DRAG_TYPE);
    if (noteId) {
      onMoveNote(noteId, path);
      return;
    }

    // フォルダのドロップ
    const folderPath = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (folderPath) {
      // 自分自身・自身の子孫への移動は拒否
      if (folderPath === path) return;
      if (path === folderPath || path.startsWith(folderPath + '/')) return;
      // 既に親がその階層なら何もしない (例: a/b を a にドロップ → 変化なし)
      const segments = folderPath.split('/');
      segments.pop();
      const currentParent = segments.join('/');
      if (currentParent === path) return;
      onMoveFolder(folderPath, path);
    }
  };

  // ----- ルート領域（トップレベル）へのドロップ -----
  const handleRootDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types;
    if (
      !types.includes(NOTE_DRAG_TYPE) &&
      !types.includes(FOLDER_DRAG_TYPE)
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!rootDragOver) setRootDragOver(true);
  };

  const handleRootDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // 子要素への遷移は無視
    if (
      e.relatedTarget instanceof Node &&
      e.currentTarget.contains(e.relatedTarget)
    ) {
      return;
    }
    setRootDragOver(false);
  };

  const handleRootDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setRootDragOver(false);
    // 子要素（フォルダ行）が既にハンドルしていれば stopPropagation されているので
    // ここには来ない。来たということはルート領域へのドロップ。
    const noteId = e.dataTransfer.getData(NOTE_DRAG_TYPE);
    if (noteId) {
      e.preventDefault();
      onMoveNote(noteId, '');
      return;
    }
    const folderPath = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (folderPath) {
      e.preventDefault();
      // トップレベルなら何もしない
      if (!folderPath.includes('/')) return;
      onMoveFolder(folderPath, '');
    }
  };

  // ドラッグリサイズ
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!resizing) return;

    const handleMove = (e: MouseEvent) => {
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(maxWidth, Math.max(minWidth, e.clientX - left));
      onResize(next);
    };
    const handleUp = () => setResizing(false);

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
  }, [resizing, minWidth, maxWidth, onResize]);

  // 折りたたみ時は width を 0、それ以外は指定幅を CSS 変数で渡す。
  // リサイズ中は transition を切って引っかかりを防ぐ。
  const style: React.CSSProperties = {
    width: collapsed ? 0 : width,
    transition: resizing ? 'none' : undefined,
  };

  return (
    <aside
      ref={asideRef}
      className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}
      style={style}
      aria-hidden={collapsed}
    >
      <div className="sidebar__inner" style={{ width }}>
        <div className="sidebar__header">
          <span className="sidebar__title">
            {mode === 'files'
              ? t.sidebar.notes
              : mode === 'search'
                ? t.sidebar.search
                : mode === 'tags'
                  ? t.sidebar.tags
                  : mode === 'history'
                    ? t.sidebar.history
                    : mode === 'calendar'
                      ? t.activity.calendar
                      : mode === 'sync'
                        ? t.sidebar.sync
                        : // プラグイン由来モードのタイトルは
                        //   activityBarItem.label を流用する。
                        (pluginSidebarPanel
                          ? // plugin の activityBarItem.label を本体側ヘッダに使う
                            (() => {
                              const enabled = getEnabledPlugins(
                                settings.enabledPlugins,
                              );
                              const owner = enabled.find(
                                (p) =>
                                  p.module.activityBarItem?.mode === mode,
                              );
                              return owner?.module.activityBarItem?.label ?? mode;
                            })()
                          : mode)}
          </span>
          {mode === 'files' && (
            <div className="sidebar__actions">
              <button
                type="button"
                className="sidebar__icon-btn"
                onClick={expandAll}
                title={t.sidebar.expandAll}
                aria-label={t.sidebar.expandAll}
              >
                <ExpandAllIcon />
              </button>
              <button
                type="button"
                className="sidebar__icon-btn"
                onClick={collapseAll}
                title={t.sidebar.collapseAll}
                aria-label={t.sidebar.collapseAll}
              >
                <CollapseAllIcon />
              </button>
              <button
                type="button"
                className={`sidebar__icon-btn ${inlineSearchOpen ? 'is-active' : ''}`}
                onClick={() => {
                  setInlineSearchOpen((v) => {
                    const next = !v;
                    if (!next) setInlineSearchQuery('');
                    return next;
                  });
                }}
                title="ノート名で探す"
                aria-label="ノート名で探す"
                aria-pressed={inlineSearchOpen}
              >
                <SearchSmallIcon />
              </button>
              <button
                type="button"
                className="sidebar__icon-btn"
                onClick={onCreateNote}
                title={t.sidebar.newNote}
                aria-label={t.sidebar.newNote}
              >
                <NewFileIcon />
              </button>
            </div>
          )}
        </div>
        {/* インライン検索バー: ヘッダーとリストの間に挿入 */}
        {mode === 'files' && inlineSearchOpen && (
          <div className="sidebar__inline-search">
            <div className="sidebar__inline-search-inputwrap">
              <input
                type="text"
                className="sidebar__inline-search-input"
                value={inlineSearchQuery}
                placeholder="ノート名を入力..."
                autoFocus
                onChange={(e) => setInlineSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter / Shift+Enter で次/前へ
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) goPrevHit();
                    else goNextHit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setInlineSearchOpen(false);
                    setInlineSearchQuery('');
                  }
                }}
              />
              {inlineSearchQuery.length > 0 && (
                <button
                  type="button"
                  className="sidebar__inline-search-clear"
                  onClick={() => setInlineSearchQuery('')}
                  title="入力をクリア"
                  aria-label="入力をクリア"
                  // mousedown で input から focus が外れるのを防ぐ
                  onMouseDown={(e) => e.preventDefault()}
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="button"
              className="sidebar__inline-search-nav"
              onClick={goPrevHit}
              disabled={inlineSearchHits.length === 0}
              title="前のヒットへ (Shift+Enter)"
              aria-label="前のヒットへ"
            >
              ◀
            </button>
            <span
              className="sidebar__inline-search-count"
              aria-live="polite"
            >
              {inlineSearchHits.length === 0
                ? inlineSearchQuery.trim() === ''
                  ? '–'
                  : '0/0'
                : `${inlineSearchIndex + 1}/${inlineSearchHits.length}`}
            </span>
            <button
              type="button"
              className="sidebar__inline-search-nav"
              onClick={goNextHit}
              disabled={inlineSearchHits.length === 0}
              title="次のヒットへ (Enter)"
              aria-label="次のヒットへ"
            >
              ▶
            </button>
          </div>
        )}
        {mode === 'files' ? (
          <>
          <div
            className={`sidebar__list ${rootDragOver ? 'is-root-dragover' : ''}`}
            data-note-kebab={settings.noteKebabVisibility}
            data-folder-kebab={settings.folderKebabVisibility}
            data-folder-count={settings.folderCountVisibility}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
          >
            {tree.length === 0 ? (
              <div className="sidebar__empty">{t.sidebar.emptyNoNotes}</div>
            ) : (
              <TreeView
                nodes={tree}
                depth={0}
                activeId={activeId}
                onSelect={onSelect}
                onPinSelect={onPinSelect}
                unlockedNoteIds={unlockedNoteIds}
                isExpanded={isExpanded}
                onToggle={toggle}
                onOpenFileMenu={openFileMenu}
                onOpenFolderMenu={openFolderMenu}
                dragOverFolder={dragOverFolder}
                onFileDragStart={handleFileDragStart}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragOver={handleFolderDragOver}
                onFolderDragLeave={handleFolderDragLeave}
                onFolderDrop={handleFolderDrop}
                highlightQuery={
                  inlineSearchOpen ? inlineSearchQuery : ''
                }
                currentHitId={
                  inlineSearchOpen && inlineSearchIndex >= 0
                    ? (() => {
                        const h = inlineSearchHits[inlineSearchIndex];
                        return h && h.kind === 'file' ? h.id : null;
                      })()
                    : null
                }
                currentHitFolderPath={
                  inlineSearchOpen && inlineSearchIndex >= 0
                    ? (() => {
                        const h = inlineSearchHits[inlineSearchIndex];
                        return h && h.kind === 'folder' ? h.path : null;
                      })()
                    : null
                }
              />
            )}
          </div>

          {/* ===== ゴミ箱セクション (files モード最下部に固定) ===== */}
          <div className="sidebar__trash">
            <button
              type="button"
              className={`sidebar__trash-header ${trashOpen ? 'is-open' : ''}`}
              onClick={() => setTrashOpen((v) => !v)}
              onContextMenu={(e) => void openTrashHeaderMenu(e)}
              aria-expanded={trashOpen}
              title="右クリックでメニュー"
            >
              <span className="sidebar__trash-caret">
                {trashOpen ? '▾' : '▸'}
              </span>
              <span className="sidebar__trash-icon">
                <TrashSidebarIcon />
              </span>
              <span className="sidebar__trash-label">ゴミ箱</span>
              {trashedNotes.length > 0 && (
                <span className="sidebar__trash-count">
                  {trashedNotes.length}
                </span>
              )}
            </button>
            {trashOpen && (
              <ul className="sidebar__trash-list">
                {trashedNotes.length === 0 ? (
                  <li className="sidebar__trash-empty">
                    ゴミ箱は空です
                  </li>
                ) : (
                  trashedNotes.map((n) => (
                    <li
                      key={n.id}
                      className="sidebar__trash-item"
                      onClick={(e) => {
                        // ゴミ箱内のノートはクリックで開けない
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onContextMenu={(e) => void openTrashNoteMenu(n.id, e)}
                      title={`削除日: ${n.trashedAt ? new Date(n.trashedAt).toLocaleString() : ''}`}
                    >
                      <span className="sidebar__trash-item-icon">
                        <TrashFileIcon />
                      </span>
                      <span className="sidebar__trash-item-name">
                        {n.title}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          </>
        ) : mode === 'search' ? (
          <SearchPanel
            onSearch={onSearch}
            onSelect={onSelect}
            activeId={activeId}
            history={searchHistory}
            onAddHistory={onAddSearchHistory}
          />
        ) : mode === 'tags' ? (
          <TagsPanel activeId={activeId} onSelect={onSelect} />
        ) : mode === 'history' ? (
          <HistoryPanel
            entries={openHistory}
            notes={notes}
            activeId={activeId}
            onSelect={onHistorySelect ?? onSelect}
            onClear={onClearOpenHistory}
          />
        ) : mode === 'calendar' ? (
          <CalendarPanel
            notes={notes}
            settings={settings}
            onSelectNote={onSelect}
            onCreateNote={onPluginCreateNote}
          />
        ) : pluginSidebarPanel ? (
          // ===== プラグイン由来のサイドバーモード =====
          // mode と一致する `sidebarPanel.mode` を持つ有効化プラグインがあれば
          // その Component をレンダリング。アプリ本体はプラグイン名を知らない。
          <pluginSidebarPanel.Component
            notes={notes}
            settings={settings}
            onChange={onSettingsChange}
            onSelectNote={onSelect}
            onCreateNote={onPluginCreateNote}
          />
        ) : storagePath.trim().length > 0 ? (
          <StorageSyncPanel />
        ) : (
          <StorageNotConfigured />
        )}
      </div>
      {!collapsed && (
        <div
          className={`sidebar__resizer ${resizing ? 'is-active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setResizing(true);
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバーの幅を変更"
        />
      )}
    </aside>
  );
});

export default Sidebar;

interface TreeViewProps {
  nodes: TreeNode[];
  depth: number;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** ダブルクリック時のピン留めオープン用ハンドラ (任意) */
  onPinSelect?: (id: string) => void;
  /** 解錠済ノート ID 集合 (アイコン表示切替に使う) */
  unlockedNoteIds?: ReadonlySet<string>;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
  onOpenFileMenu: (file: FileItem, e: React.MouseEvent) => void;
  onOpenFolderMenu: (folderPath: string, e: React.MouseEvent) => void;
  dragOverFolder: string | null;
  onFileDragStart: (
    e: React.DragEvent<HTMLButtonElement>,
    noteId: string,
  ) => void;
  onFolderDragStart: (
    e: React.DragEvent<HTMLButtonElement>,
    path: string,
  ) => void;
  onFolderDragOver: (
    e: React.DragEvent<HTMLButtonElement>,
    path: string,
  ) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent<HTMLButtonElement>, path: string) => void;
  /** 非空ならファイル名/フォルダ名にマッチ部分を黄色背景でハイライト */
  highlightQuery: string;
  /** 現在 ◀/▶ で選んでいるヒットのノート ID（その行をより強調する） */
  currentHitId: string | null;
  /** 現在 ◀/▶ で選んでいるヒットのフォルダパス（その行をより強調する） */
  currentHitFolderPath: string | null;
}

/**
 * ファイル名に検索語を当てて、ヒット部分を <mark> でラップする。
 * 大文字小文字無視、複数回マッチに対応。query が空ならそのまま返す。
 */
function renderHighlighted(title: string, query: string) {
  const q = query.trim();
  if (!q) return title;
  const lower = title.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  while (cursor < title.length) {
    const idx = lower.indexOf(needle, cursor);
    if (idx === -1) {
      parts.push(title.slice(cursor));
      break;
    }
    if (idx > cursor) parts.push(title.slice(cursor, idx));
    parts.push(
      <mark key={`m-${i++}`} className="tree__hit">
        {title.slice(idx, idx + needle.length)}
      </mark>,
    );
    cursor = idx + needle.length;
  }
  return <>{parts}</>;
}

/**
 * フォルダノード配下のファイル (= ノート) を再帰的にカウントする。
 * サブフォルダ内のノートも合算する。
 */
function countNotesInTree(nodes: readonly TreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'file') n++;
    else n += countNotesInTree(node.children);
  }
  return n;
}

function TreeView({
  nodes,
  depth,
  activeId,
  onSelect,
  onPinSelect,
  unlockedNoteIds,
  isExpanded,
  onToggle,
  onOpenFileMenu,
  onOpenFolderMenu,
  dragOverFolder,
  onFileDragStart,
  onFolderDragStart,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  highlightQuery,
  currentHitId,
  currentHitFolderPath,
}: TreeViewProps) {
  const t = useT();
  return (
    <ul className="tree" role="tree">
      {nodes.map((node) => {
        if (node.kind === 'folder') {
          const open = isExpanded(node.path);
          const isDragOver = dragOverFolder === node.path;
          const isCurrentFolderHit = currentHitFolderPath === node.path;
          // フォルダ配下 (サブフォルダ含む) のノート総数。
          // 0 件のときはバッジを出さない。
          const noteCount = countNotesInTree(node.children);
          return (
            <li
              key={`d:${node.path}`}
              className="tree__folder-li"
              role="treeitem"
              aria-expanded={open}
              data-folder-path={node.path}
            >
              <div className="tree__row-wrap">
                <button
                  type="button"
                  className={`tree__row tree__folder ${isDragOver ? 'is-dragover' : ''} ${isCurrentFolderHit ? 'is-current-hit' : ''}`}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={() => onToggle(node.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenFolderMenu(node.path, e);
                  }}
                  draggable
                  onDragStart={(e) => onFolderDragStart(e, node.path)}
                  onDragOver={(e) => onFolderDragOver(e, node.path)}
                  onDragLeave={onFolderDragLeave}
                  onDrop={(e) => onFolderDrop(e, node.path)}
                >
                  <span className="tree__chevron">▶</span>
                  <span className="tree__icon">
                    <FolderItemIcon />
                  </span>
                  <span className="tree__label">
                    {renderHighlighted(node.name, highlightQuery)}
                  </span>
                </button>
                {noteCount > 0 && (
                  <span
                    className="tree__folder-count"
                    title={`このフォルダ内のノート: ${noteCount} 件`}
                    aria-label={`${noteCount} ノート`}
                  >
                    {noteCount}
                  </span>
                )}
                <button
                  type="button"
                  className="tree__menu-btn"
                  onClick={(e) => onOpenFolderMenu(node.path, e)}
                  title={t.sidebar.moreActions}
                  aria-label={t.sidebar.moreActions}
                >
                  <KebabIcon />
                </button>
              </div>
              <TreeChildrenTransition open={open}>
                <TreeView
                  nodes={node.children}
                  depth={depth + 1}
                  activeId={activeId}
                  onSelect={onSelect}
                  onPinSelect={onPinSelect}
                  unlockedNoteIds={unlockedNoteIds}
                  isExpanded={isExpanded}
                  onToggle={onToggle}
                  onOpenFileMenu={onOpenFileMenu}
                  onOpenFolderMenu={onOpenFolderMenu}
                  dragOverFolder={dragOverFolder}
                  onFileDragStart={onFileDragStart}
                  onFolderDragStart={onFolderDragStart}
                  onFolderDragOver={onFolderDragOver}
                  onFolderDragLeave={onFolderDragLeave}
                  onFolderDrop={onFolderDrop}
                  highlightQuery={highlightQuery}
                  currentHitId={currentHitId}
                  currentHitFolderPath={currentHitFolderPath}
                />
              </TreeChildrenTransition>
            </li>
          );
        }

        const f = node.file;
        const active = activeId === f.id;
        const isProtected = f.protected === true;
        const isSecret = f.secret === true;
        const isCurrentHit = currentHitId === f.id;
        return (
          <li
            key={`f:${f.id}`}
            className={`tree__file-li ${isProtected ? 'is-protected' : ''} ${isSecret ? 'is-secret' : ''}`}
            role="treeitem"
            data-note-id={f.id}
            // ノートの上にノート/フォルダがドラッグされた場合、ここで drop を
            // 受け止めて何もしない (= 移動キャンセル)。これがないと event が
            // ルート領域の handleRootDrop までバブルして「最上位へ移動」が
            // 発火してしまう (ノート上にドロップ = 同じフォルダ内移動の意図)。
            onDragOver={(e) => {
              const types = e.dataTransfer.types;
              if (
                types.includes(NOTE_DRAG_TYPE) ||
                types.includes(FOLDER_DRAG_TYPE)
              ) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'none';
              }
            }}
            onDrop={(e) => {
              const types = e.dataTransfer.types;
              if (
                types.includes(NOTE_DRAG_TYPE) ||
                types.includes(FOLDER_DRAG_TYPE)
              ) {
                e.preventDefault();
                e.stopPropagation();
                // 何もしない: ドラッグ元のフォルダにそのまま残す
              }
            }}
          >
            <button
              type="button"
              className={`tree__row tree__file ${active ? 'is-active' : ''} ${isCurrentHit ? 'is-current-hit' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 + 16 }}
              onClick={() => onSelect(f.id)}
              onDoubleClick={() => {
                // ダブルクリック: ピン留めオープン (📍)。preview-tab に
                // 置き換えられないので、複数ノートを並行で開く時に便利。
                if (onPinSelect) onPinSelect(f.id);
                else onSelect(f.id);
              }}
              onContextMenu={(e) => {
                // 右クリック: ケバブメニューと同じネイティブメニューを開く
                e.preventDefault();
                onOpenFileMenu(f, e);
              }}
              draggable
              onDragStart={(e) => onFileDragStart(e, f.id)}
            >
              <span className="tree__icon">
                <FileItemIcon />
              </span>
              <span className="tree__label">
                {renderHighlighted(f.title, highlightQuery)}
              </span>
            </button>
            {isSecret && (
              <span
                className="tree__secret-indicator"
                title={t.sidebar.secretIndicator}
                aria-label={t.sidebar.secretIndicator}
              >
                <SecretSmallIcon />
              </span>
            )}
            {isProtected && (() => {
              // セッション内で解錠済みなら開錠アイコンへ切替
              const isUnlocked = unlockedNoteIds?.has(f.id) === true;
              return (
                <span
                  className={`tree__lock-indicator ${isUnlocked ? 'is-unlocked' : ''}`}
                  title={
                    isUnlocked
                      ? `${t.sidebar.protectedIndicator} (解錠中)`
                      : t.sidebar.protectedIndicator
                  }
                  aria-label={
                    isUnlocked
                      ? `${t.sidebar.protectedIndicator} (解錠中)`
                      : t.sidebar.protectedIndicator
                  }
                >
                  {isUnlocked ? <UnlockSmallIcon /> : <LockSmallIcon />}
                </span>
              );
            })()}
            <button
              type="button"
              className="tree__menu-btn"
              onClick={(e) => onOpenFileMenu(f, e)}
              title={t.sidebar.moreActions}
              aria-label={t.sidebar.moreActions}
            >
              <KebabIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TreeChildrenTransition({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const [shouldRender, setShouldRender] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      let innerFrame = 0;
      const outerFrame = requestAnimationFrame(() => {
        innerFrame = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outerFrame);
        cancelAnimationFrame(innerFrame);
      };
    }

    setVisible(false);
    const timer = setTimeout(
      () => setShouldRender(false),
      TREE_CHILDREN_TRANSITION_MS,
    );
    return () => clearTimeout(timer);
  }, [open]);

  if (!shouldRender) return null;

  return (
    <div
      className={`tree__children ${visible ? 'is-open' : ''}`}
      aria-hidden={!open}
    >
      <div className="tree__children-inner">{children}</div>
    </div>
  );
}

function KebabIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8" cy="3.2" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.8" r="1.3" />
    </svg>
  );
}

// ----- メニュー項目用アイコン -----

function RenameIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 13 L3 10 L11 2 A1 1 0 0 1 12.5 2 L14 3.5 A1 1 0 0 1 14 5 L6 13 Z" />
      <path d="M9.5 3.5 L12.5 6.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4 H13.5" />
      <path d="M5 4 V2.8 a1 1 0 0 1 1 -1 h4 a1 1 0 0 1 1 1 V4" />
      <path d="M3.6 4 l0.7 9.2 a1 1 0 0 0 1 0.9 h5.4 a1 1 0 0 0 1 -0.9 L12.4 4" />
      <path d="M6.5 6.8 V12 M9.5 6.8 V12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.2" />
      <path d="M5.2 7 V4.8 a2.8 2.8 0 0 1 5.6 0 V7" />
    </svg>
  );
}

/** ゴミ箱セクションヘッダのアイコン */
function TrashSidebarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4 H13" />
      <path d="M6 4 V2.5 a0.5 0.5 0 0 1 0.5 -0.5 h3 a0.5 0.5 0 0 1 0.5 0.5 V4" />
      <path d="M4 4 v9 a1 1 0 0 0 1 1 h6 a1 1 0 0 0 1 -1 V4" />
      <path d="M7 7 V12 M9 7 V12" />
    </svg>
  );
}

/** ゴミ箱内ノート行用の小さなファイル風アイコン */
function TrashFileIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2 h6 L13 5 v9 a0.5 0.5 0 0 1 -0.5 0.5 h-8.5 a0.5 0.5 0 0 1 -0.5 -0.5 V2.5 a0.5 0.5 0 0 1 0.5 -0.5 z" />
      <path d="M10 2 v3 h3" />
    </svg>
  );
}

/** ファイル行の右端に表示する小さな錠前アイコン（塗りつぶし） */
function LockSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.2" />
      <path d="M5.2 7 V4.8 a2.8 2.8 0 0 1 5.6 0 V7" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.2" />
      <path d="M5.2 7 V4.8 a2.8 2.8 0 0 1 5.6 0" />
    </svg>
  );
}

/** ファイル行用 12px の解錠アイコン (LockSmallIcon と寸法を揃える) */
function UnlockSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.2" />
      <path d="M5.2 7 V4.8 a2.8 2.8 0 0 1 5.6 0" />
    </svg>
  );
}

/** シークレット用の目に斜線アイコン */
function SecretIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8 C 4 4.5, 6 3.5, 8 3.5 C 10 3.5, 12 4.5, 14 8 C 12 11.5, 10 12.5, 8 12.5 C 6 12.5, 4 11.5, 2 8 Z" />
      <circle cx="8" cy="8" r="2" />
      <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />
    </svg>
  );
}

/** ファイル行の右端に表示する小さなシークレットインジケータ */
function SecretSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8 C 4 4.5, 6 3.5, 8 3.5 C 10 3.5, 12 4.5, 14 8 C 12 11.5, 10 12.5, 8 12.5 C 6 12.5, 4 11.5, 2 8 Z" />
      <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />
    </svg>
  );
}

// ----- アイコン (16x16 の単純な線画 SVG) -----

/** すべて展開アイコン (20x20) — 中央の四角から上下に矢印が離れる */
function ExpandAllIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="8" height="8" rx="1.2" />
      <path d="M10 2 L7 5" />
      <path d="M10 2 L13 5" />
      <path d="M10 18 L7 15" />
      <path d="M10 18 L13 15" />
    </svg>
  );
}

/** すべて折りたたむアイコン (20x20) — 上下から中央の四角に矢印が向かう */
function CollapseAllIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="8" height="8" rx="1.2" />
      <path d="M10 5 L7 2" />
      <path d="M10 5 L13 2" />
      <path d="M10 15 L7 18" />
      <path d="M10 15 L13 18" />
    </svg>
  );
}

/** 新規メモ作成アイコン (20x20) — 角丸四角 + 斜めペン */
/** サイドバー用の虫眼鏡アイコン (20x20)。ヘッダーの他のアイコンと同サイズ */
function SearchSmallIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13 L17 17" />
    </svg>
  );
}

function NewFileIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 角丸の四角 — 右上が開いている */}
      <path d="M11 3 H5 A2 2 0 0 0 3 5 V15 A2 2 0 0 0 5 17 H15 A2 2 0 0 0 17 15 V9" />
      {/* ペンの本体（太めの斜め長方形） */}
      <rect x="11.8" y="1.2" width="3" height="10" rx="0.8" transform="rotate(45 13.3 6.2)" />
      {/* ペン先の区切り線 */}
      <line x1="8.2" y1="11" x2="9.8" y2="12.6" transform="rotate(0)" />
    </svg>
  );
}

/** ツリー行に表示する小さなフォルダアイコン (14x14) */
function FolderItemIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4.25a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

/** ツリー行に表示する小さなファイルアイコン (14x14) */
function FileItemIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 1.75h5.5L13 6.25v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z" />
      <path d="M8.5 1.75v4.5H13" />
    </svg>
  );
}

/**
 * 保存先フォルダ未設定時にサイドバーの「同期」モードに表示する案内。
 * 設定画面の「保存先」カテゴリへユーザーを誘導する。
 */
function StorageNotConfigured() {
  return (
    <div className="storage-sync storage-sync--empty">
      <div className="storage-sync__empty-icon" aria-hidden="true">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="6" rx="1.2" />
          <rect x="3" y="13" width="18" height="6" rx="1.2" />
          <line x1="17" y1="8" x2="17" y2="8.01" />
          <line x1="17" y1="16" x2="17" y2="16.01" />
        </svg>
      </div>
      <h3 className="storage-sync__empty-title">保存先が未設定です</h3>
      <p className="storage-sync__empty-desc">
        ノートを外部フォルダ（iCloud Drive 等）に保存して
        他デバイスと同期するには、設定で
        <strong>ファイル保存先フォルダ</strong>を指定してください。
      </p>
      <p className="storage-sync__empty-hint">
        設定 → <strong>保存先</strong> → 「フォルダを選択」
      </p>
    </div>
  );
}
