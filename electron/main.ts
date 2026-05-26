import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDb, closeDb } from './db/index';
import { getAllSettings, setSetting } from './db/settings';
import { purgeOldTrash } from './db/notes';
import { purgeOldTombstones } from './storage/notesFiles';
import { registerIpc } from './ipc';
import {
  registerInknelImagePrivileged,
  handleInknelImageProtocol,
} from './protocol/inknelImage';
import {
  registerInknelPluginPrivileged,
  handleInknelPluginProtocol,
} from './protocol/inknelPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

const APP_NAME = 'InkNel';

/**
 * 開発実行かどうかの判定。
 *
 * 注意: `app.isPackaged` だけでは判定できない。electron-vite で `npm run dev`
 * を走らせても、起動方法によっては `app.isPackaged === true` と評価される
 * ケースが確認されているため、環境変数 `ELECTRON_RENDERER_URL` でも判定する。
 * これは electron-vite が dev server URL を渡してきた時にだけセットされるため、
 * 確実に dev mode の指標になる。
 *
 * いずれか dev を示せば isDev = true（OR 連結）。
 */
const isDev =
  !app.isPackaged || !!process.env['ELECTRON_RENDERER_URL'];

function isJapaneseSystemLocale(): boolean {
  return app.getLocale().toLowerCase().startsWith('ja');
}

/**
 * 指定 BrowserWindow に対し、本番時のみ DevTools を開くキーボード
 * ショートカット (Cmd+Opt+I / Ctrl+Shift+I / F12) を抑制するハンドラを設定。
 * `webPreferences.devTools = false` だけだと、Menu / プログラム呼び出しは
 * 防げるが before-input-event を握っておくと「キーが押されたら何も起きない」
 * というユーザーから見て自然な振る舞いになる。
 */
function attachBlockDevToolsShortcut(win: BrowserWindow): void {
  if (isDev) return; // 開発では何もしない（DevTools 自由に開ける）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const isMacShortcut = input.meta && input.alt && key === 'i';
    const isWinShortcut = input.control && input.shift && key === 'i';
    const isF12 = key === 'f12';
    if (isMacShortcut || isWinShortcut || isF12) {
      event.preventDefault();
    }
  });
}

/**
 * Renderer 内で発生する navigation を全部 main プロセス側で握り、
 * 「外部 URL は OS 既定ブラウザに逃がす / それ以外は無視」に統一する。
 *
 * これをやらないと:
 *  - `<a href="https://attacker/" target="_blank">` クリックで Electron が
 *    新規 BrowserWindow を開く (sandbox なしなので preload API が漏れる)
 *  - `location.href = 'https://attacker/'` 等で **同一 BrowserWindow** が
 *    攻撃者制御サイトに置き換わる。renderer から `window.api.*` を全て叩ける
 *
 * 自身の origin (file:// or dev http://localhost) 内の navigation は
 * SPA 内遷移として許可する。それ以外は preventDefault + shell.openExternal。
 */
function hardenWindowNavigation(win: BrowserWindow): void {
  const isSafeExternalUrl = (urlStr: string): boolean => {
    try {
      const u = new URL(urlStr);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, urlStr) => {
    const currentUrlStr = win.webContents.getURL();
    if (urlStr === currentUrlStr) return;
    try {
      const next = new URL(urlStr);
      const current = new URL(currentUrlStr);
      // 同一 origin (= 自身の SPA 内ルート遷移) なら許可
      if (next.origin === current.origin && next.protocol === current.protocol) {
        return;
      }
    } catch {
      // パースできないなら拒否
    }
    event.preventDefault();
    if (isSafeExternalUrl(urlStr)) {
      void shell.openExternal(urlStr);
    }
  });

  // will-frame-navigate でも同じガード (iframe 経由の遷移)
  win.webContents.on('will-frame-navigate', (event) => {
    const urlStr = event.url;
    const currentUrlStr = win.webContents.getURL();
    if (urlStr === currentUrlStr) return;
    try {
      const next = new URL(urlStr);
      const current = new URL(currentUrlStr);
      if (next.origin === current.origin && next.protocol === current.protocol) {
        return;
      }
    } catch {
      // 拒否
    }
    event.preventDefault();
    if (isSafeExternalUrl(urlStr)) {
      void shell.openExternal(urlStr);
    }
  });
}

// ヘルプメニューから開く公式ホームページ URL
const HOMEPAGE_URL = 'https://inknel.ary-ap.com/';
// バージョン情報 JSON の URL（下記スキーマを想定）:
//   {
//     "version": "0.1.8",
//     "downloads": {
//       "mac": "https://inknel.ary-ap.com/downloads/InkNel-0.1.8-arm64.dmg",
//       "win": "https://inknel.ary-ap.com/downloads/InkNel-0.1.8-win.zip"
//     }
//   }
const VERSION_JSON_URL = 'https://inknel.ary-ap.com/version.json';

interface VersionInfo {
  version: string;
  downloads?: {
    mac?: string;
    win?: string;
  };
}

// macOS のアプリメニュー名はバンドルの CFBundleName から決まるが、
// 開発中（unpackaged）は app.setName() を whenReady より前に呼ぶことで上書きできる。
app.setName(APP_NAME);

// inknel-image:// カスタムプロトコルの特権登録（whenReady より前に呼ぶ必要あり）
registerInknelImagePrivileged();
// inknel-plugin:// 同上（プラグインの ES モジュール配信用）
registerInknelPluginPrivileged();

// ----- 単一インスタンスロック -----
// 2つ目の起動を試みた場合は既存ウィンドウをフォーカスして自分は終了する。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let preferencesWindow: BrowserWindow | null = null;
let savedMacroMenuItems: Array<{ id: string; name: string }> = [];

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

/** セマンティックバージョン文字列 "x.y.z" の比較。a > b なら正、a < b なら負。 */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 公式サイトの version.json から最新バージョンを取得して現在のバージョンと比較し、
 * 新しいバージョンがあれば OS に応じたダウンロードリンクを提示する。
 */
async function checkForUpdates(): Promise<void> {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const showBox = (opts: Electron.MessageBoxOptions) =>
    parent
      ? dialog.showMessageBox(parent, opts)
      : dialog.showMessageBox(opts);
  const current = app.getVersion();
  try {
    const response = await net.fetch(VERSION_JSON_URL, {
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as VersionInfo;
    if (typeof data?.version !== 'string') {
      throw new Error('version.json の形式が不正です');
    }
    const latest = data.version;

    if (compareVersion(current, latest) >= 0) {
      await showBox({
        type: 'info',
        title: 'バージョン確認',
        message: '最新です',
        detail: `現在のバージョン: ${current}\n公開中の最新: ${latest}`,
        buttons: ['OK'],
        defaultId: 0,
      });
      return;
    }

    // OS に応じたダウンロード URL を選ぶ（無ければホームページへフォールバック）
    const platformKey: 'mac' | 'win' =
      process.platform === 'darwin' ? 'mac' : 'win';
    const downloadUrl = data.downloads?.[platformKey] ?? HOMEPAGE_URL;

    const result = await showBox({
      type: 'info',
      title: '新しいバージョンがあります',
      message: `新しいバージョン ${latest} が公開されています。`,
      detail:
        `現在のバージョン: ${current}\n` +
        `最新バージョン: ${latest}\n\n` +
        `ダウンロード先:\n${downloadUrl}`,
      buttons: ['ダウンロード', 'キャンセル'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      await shell.openExternal(downloadUrl);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await showBox({
      type: 'error',
      title: 'バージョン確認に失敗しました',
      message: 'バージョン情報を取得できませんでした。',
      detail: `${msg}\nインターネット接続をご確認のうえ、再度お試しください。`,
      buttons: ['OK'],
    });
  }
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' as const, label: `${APP_NAME} について` },
              {
                label: '設定...',
                accelerator: 'CmdOrCtrl+,',
                click: () => openPreferencesWindow(),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `${APP_NAME} を隠す` },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `${APP_NAME} を終了` },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'ファイル',
      submenu: [
        ...(isMac
          ? []
          : ([
              {
                label: '設定...',
                accelerator: 'CmdOrCtrl+,',
                click: () => openPreferencesWindow(),
              },
              { type: 'separator' as const },
            ] as MenuItemConstructorOptions[])),
        {
          label: 'メモの作成',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer('menu:create-note'),
        },
        { type: 'separator' as const },
        {
          label: 'ファイルの読み込み...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToRenderer('menu:import-md'),
        },
        {
          label: 'ディレクトリの読み込み...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendToRenderer('menu:import-dir'),
        },
        { type: 'separator' as const },
        {
          label: '印刷...',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendToRenderer('menu:print'),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: '検索...',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToRenderer('menu:find'),
        },
        {
          label: '置換...',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendToRenderer('menu:replace'),
        },
      ],
    },
    {
      label: '表示',
      submenu: [
        // リロード系は ⌘R / ⌘⇧R を編集機能（検索/置換）に譲るため
        // role ではなく click ハンドラで独自に構成し、F5 系に割り当てる。
        {
          label: '再読み込み',
          accelerator: 'F5',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reload();
            }
          },
        },
        {
          label: '強制再読み込み',
          accelerator: 'Shift+F5',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reloadIgnoringCache();
            }
          },
        },
        // 本番ではメニューからも DevTools を開けないように隠す
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: isJapaneseSystemLocale() ? 'マクロ' : 'Macro',
      submenu: [
        {
          label: 'キャプチャ実行',
          accelerator: 'F1',
          click: () => sendToRenderer('menu:macro-play'),
        },
        {
          label: 'キーキャプチャ開始',
          accelerator: 'F2',
          click: () => sendToRenderer('menu:macro-start'),
        },
        {
          label: 'キーキャプチャ終了',
          accelerator: 'F3',
          click: () => sendToRenderer('menu:macro-stop'),
        },
        { type: 'separator' },
        {
          label: 'マクロの保存と名前',
          click: () => sendToRenderer('menu:macro-show'),
        },
        ...(savedMacroMenuItems.length > 0
          ? ([
              { type: 'separator' as const },
              ...savedMacroMenuItems.map((macro, index) => ({
                label: `${index + 1}.${macro.name}`,
                click: () => sendToRenderer('menu:macro-select', macro.id),
              })),
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help',
      label: 'ヘルプ',
      submenu: [
        {
          label: 'バージョンアップ確認',
          click: () => {
            void checkForUpdates();
          },
        },
        {
          label: 'InkNel ホームページ',
          click: () => {
            void shell.openExternal(HOMEPAGE_URL);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ----- ウィンドウ状態の保存/復元 -----

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1200, height: 800 };
const DEFAULT_PREFERENCES_BOUNDS: WindowBounds = { width: 780, height: 560 };

function loadWindowBounds(): { bounds: WindowBounds; maximized: boolean } {
  const settings = getAllSettings();
  const raw = settings['window.bounds'];
  let bounds: WindowBounds = DEFAULT_BOUNDS;
  if (raw) {
    try {
      const obj = JSON.parse(raw) as Partial<WindowBounds>;
      if (
        typeof obj.width === 'number' &&
        typeof obj.height === 'number' &&
        obj.width >= 400 &&
        obj.height >= 300
      ) {
        bounds = {
          x: typeof obj.x === 'number' ? obj.x : undefined,
          y: typeof obj.y === 'number' ? obj.y : undefined,
          width: obj.width,
          height: obj.height,
        };
      }
    } catch {
      // 不正な JSON は無視
    }
  }

  // 復元位置が現在のディスプレイ範囲外なら無視
  if (bounds.x !== undefined && bounds.y !== undefined) {
    const displays = screen.getAllDisplays();
    const inside = displays.some((d) => {
      const a = d.workArea;
      return (
        bounds.x! >= a.x &&
        bounds.y! >= a.y &&
        bounds.x! + bounds.width <= a.x + a.width &&
        bounds.y! + bounds.height <= a.y + a.height
      );
    });
    if (!inside) {
      bounds = { width: bounds.width, height: bounds.height };
    }
  }

  const maximized = settings['window.maximized'] === 'true';
  return { bounds, maximized };
}

function saveWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  // 最大化/最小化/フルスクリーン中は bounds を上書きしない
  if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) {
    setSetting('window.maximized', win.isMaximized() ? 'true' : 'false');
    return;
  }
  const b = win.getBounds();
  setSetting(
    'window.bounds',
    JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }),
  );
  setSetting('window.maximized', 'false');
}

function loadPreferencesBounds(): WindowBounds {
  const settings = getAllSettings();
  const raw = settings['preferences.bounds'];
  let bounds = DEFAULT_PREFERENCES_BOUNDS;
  if (raw) {
    try {
      const obj = JSON.parse(raw) as Partial<WindowBounds>;
      if (
        typeof obj.width === 'number' &&
        typeof obj.height === 'number' &&
        obj.width >= 560 &&
        obj.height >= 360
      ) {
        bounds = {
          x: typeof obj.x === 'number' ? obj.x : undefined,
          y: typeof obj.y === 'number' ? obj.y : undefined,
          width: obj.width,
          height: obj.height,
        };
      }
    } catch {
      // 不正な JSON は無視
    }
  }
  return bounds;
}

function savePreferencesBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  const b = win.getBounds();
  setSetting(
    'preferences.bounds',
    JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }),
  );
}

/**
 * 起動時にネイティブの BrowserWindow が描画する初期下地色を、保存済みの
 * テーマ設定から先読みして返す。レンダラ側 CSS の `--bg` / `--bg-elevated`
 * と揃えておくことで、レンダラの初回描画前に白フラッシュが見えるのを防ぐ。
 *
 * `role`:
 *  - 'main'     → `--bg`        （アプリ全体の地色）
 *  - 'elevated' → `--bg-elevated`（モーダル / 設定ウィンドウの地色）
 */
function getInitialBackgroundColor(role: 'main' | 'elevated'): string {
  const raw = getAllSettings()['appearance.theme'];
  const isLight = raw === 'light'; // 'dark' / undefined / 不正値はすべて dark 既定
  if (role === 'elevated') return isLight ? '#f3f3f3' : '#252526';
  return isLight ? '#ffffff' : '#1e1e1e';
}

function openPreferencesWindow(): void {
  if (preferencesWindow && !preferencesWindow.isDestroyed()) {
    preferencesWindow.show();
    preferencesWindow.focus();
    return;
  }

  const bounds = loadPreferencesBounds();
  const backgroundColor = getInitialBackgroundColor('elevated');
  preferencesWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 560,
    minHeight: 360,
    title: '設定',
    // 白フラッシュ防止: CSS が乗る前から OS ウィンドウ自体を背景色で塗る
    show: false,
    backgroundColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 本番では DevTools 自体を無効化（プログラム / メニュー両方の経路を塞ぐ）
      devTools: isDev,
    },
  });
  attachBlockDevToolsShortcut(preferencesWindow);
  hardenWindowNavigation(preferencesWindow);
  // renderer が描画可能になったタイミングで表示
  preferencesWindow.once('ready-to-show', () => {
    if (preferencesWindow && !preferencesWindow.isDestroyed()) {
      preferencesWindow.show();
    }
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (preferencesWindow) savePreferencesBounds(preferencesWindow);
    }, 300);
  };
  preferencesWindow.on('resize', scheduleSave);
  preferencesWindow.on('move', scheduleSave);
  preferencesWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (preferencesWindow) savePreferencesBounds(preferencesWindow);
  });
  preferencesWindow.on('closed', () => {
    preferencesWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    preferencesWindow.loadURL(`${devUrl}#/preferences`);
  } else {
    preferencesWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'preferences',
    });
  }
}

function createWindow(): void {
  const { bounds, maximized } = loadWindowBounds();
  const backgroundColor = getInitialBackgroundColor('main');

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    title: APP_NAME,
    // 白フラッシュ防止: 設定テーマに合わせた色で塗っておく
    show: false,
    backgroundColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 本番では DevTools 自体を無効化（プログラム / メニュー両方の経路を塞ぐ）
      devTools: isDev,
    },
  });
  attachBlockDevToolsShortcut(mainWindow);
  hardenWindowNavigation(mainWindow);
  // ready-to-show で初期表示。maximize は show 前に呼んでも反映されるが、
  // show() の中で表示するほうがチラつきがない。
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (maximized) mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // resize / move を 300ms デバウンスで保存
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (mainWindow) saveWindowBounds(mainWindow);
    }, 300);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('maximize', scheduleSave);
  mainWindow.on('unmaximize', scheduleSave);

  mainWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (mainWindow) saveWindowBounds(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // メインウィンドウが閉じられたら、開いている設定ウィンドウも一緒に閉じる。
    // close() ではなく destroy() を使い、設定側で beforeunload を握っていても
    // 強制終了させる（メイン無しで設定だけ残るのを避ける）。
    if (preferencesWindow && !preferencesWindow.isDestroyed()) {
      preferencesWindow.destroy();
    }
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  initDb();
  // 起動時にゴミ箱内で 30 日経過したノートを物理削除する。
  // .md / 共有コピーはゴミ箱送り時点で削除済み。ここでは DB レコードを除去するだけ。
  try {
    const ids = purgeOldTrash(30);
    if (ids.length > 0) {
      console.log(`[trash] purged ${ids.length} note(s) older than 30 days`);
    }
  } catch (err) {
    console.warn('[trash] startup purge failed:', err);
  }
  // 保存先 notes/ 配下の tombstone (削除墓標) を 90 日経過後に物理削除する。
  // 削除直後の MD は他デバイスへの削除伝播のため残すが、無期限には残さない。
  purgeOldTombstones()
    .then((ids) => {
      if (ids.length > 0) {
        console.log(`[tombstone] purged ${ids.length} old tombstone(s)`);
      }
    })
    .catch((err) => {
      console.warn('[tombstone] startup purge failed:', err);
    });
  handleInknelImageProtocol();
  handleInknelPluginProtocol();
  registerIpc();
  ipcMain.handle('preferences:open-window', () => openPreferencesWindow());
  ipcMain.on(
    'macro:saved-list',
    (_event, macros: Array<{ id: string; name: string }>) => {
      savedMacroMenuItems = Array.isArray(macros)
        ? macros
            .filter(
              (macro) =>
                macro &&
                typeof macro.id === 'string' &&
                typeof macro.name === 'string',
            )
            .slice(0, 10)
        : [];
      buildAppMenu();
    },
  );
  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  closeDb();
});
