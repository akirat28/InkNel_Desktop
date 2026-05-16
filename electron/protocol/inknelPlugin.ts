/**
 * `inknel-plugin://<path>` カスタムプロトコル。
 *
 * ランタイムロードされるプラグイン JS が
 *   import x from './other.js'
 * のような相対 import を持っている場合、`Blob URL` 経由で dynamic import
 * すると base URL が無いため解決に失敗する。
 *
 * このプロトコルは userData の plugins ディレクトリを Web 配信し、
 *   inknel-plugin://calendar/calendar.js
 * のように **サブディレクトリ構造のままパスで取得** できるようにする。
 * Renderer は `import('inknel-plugin://calendar/calendar.js')` を呼ぶだけで、
 * 内部の相対 import (`./holidays.js` 等) は同じプロトコル URL に解決される。
 *
 * 必ず以下の順で呼ぶこと:
 *   - registerInknelPluginPrivileged() … app.whenReady() より「前」
 *   - handleInknelPluginProtocol()     … app.whenReady() より「後」
 */

import { app, protocol } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { getPluginsDir } from '../storage/pluginsDir';
import { getAllSettings } from '../db/settings';

export const INKNEL_PLUGIN_SCHEME = 'inknel-plugin';

/** 必ず app.whenReady() より前に呼ぶ。 */
export function registerInknelPluginPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: INKNEL_PLUGIN_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        // ES Module として import するため
        codeCache: true,
      },
    },
  ]);
}

/**
 * パス安全性チェック。`..` を含むパス traversal を拒否し、相対パスのみ許可。
 */
function isSafePath(p: string): boolean {
  if (!p) return false;
  if (p.includes('\0')) return false;
  // パス正規化したあとに `..` が残るならディレクトリトラバーサル
  const normalized = normalize(p);
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/') || normalized.startsWith('\\')) return false;
  return true;
}

/** app.whenReady() の後に呼ぶ。 */
export function handleInknelPluginProtocol(): void {
  console.log('[inknel-plugin] protocol handler registered');
  protocol.handle(INKNEL_PLUGIN_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      console.log('[inknel-plugin] request:', request.url);
      // inknel-plugin://<path> 形式と inknel-plugin://host/<path> の両方に対応。
      // ホスト名部分（最初の '/' まで）と pathname を結合して相対パスを作る。
      const host = url.hostname;
      const rest = url.pathname.replace(/^\//, '');
      const raw = decodeURIComponent(host ? `${host}/${rest}` : rest).replace(
        /^\/+/,
        '',
      );

      if (!isSafePath(raw)) {
        return new Response(null, { status: 400, statusText: 'Bad Path' });
      }

      // ===== 開発モード分岐 =====
      // - 通常 (開発モード OFF): userData/plugins/ から読み出す。
      //   sanitizeFilename と整合する `_` フラット名にマップ。
      // - 開発モード ON: プロジェクト直下 `plugin-dev/plugins/` を
      //   サブディレクトリ構造のまま直接配信。ダウンロード不要で
      //   `plugin-dev/plugins/<id>/<file>.js` を編集 → Cmd+R で即反映。
      //
      // 注: app.isPackaged は electron-vite 実行時にも true 評価される
      // ケースがあるため判定から外し、`plugin.devMode` 設定のみで判定する。
      // plugin-dev/plugins が見つからなければ自動的に通常モードへフォールバック。
      const devModeRequested =
        getAllSettings()['plugin.devMode'] === 'true';
      const devCandidates = [
        join(app.getAppPath(), 'plugin-dev/plugins'),
        join(app.getAppPath(), '..', 'plugin-dev/plugins'),
        join(app.getAppPath(), '..', '..', 'plugin-dev/plugins'),
        join(process.cwd(), 'plugin-dev/plugins'),
      ];
      let devBase: string | null = null;
      if (devModeRequested) {
        for (const c of devCandidates) {
          if (existsSync(c)) {
            devBase = c;
            break;
          }
        }
      }
      const devMode = devBase !== null;
      const baseDir = devMode ? devBase! : getPluginsDir();
      const fullPath = devMode
        ? join(baseDir, raw)
        : join(
            baseDir,
            // 通常モード: `/` → `_` 変換 + 許可文字フィルタで sanitize と一致
            raw.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_'),
          );
      console.log(
        '[inknel-plugin] devMode=' + devMode,
        'baseDir=' + baseDir,
        'fullPath=' + fullPath,
      );
      // 念のため: 正規化後も base ディレクトリ配下にあることを確認
      if (!normalize(fullPath).startsWith(normalize(baseDir))) {
        console.warn('[inknel-plugin] forbidden path:', fullPath);
        return new Response(null, { status: 403, statusText: 'Forbidden' });
      }
      if (!existsSync(fullPath)) {
        console.warn('[inknel-plugin] not found:', fullPath);
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }
      const body = readFileSync(fullPath);
      // .js / .mjs は JavaScript として返す（ES Module として import 可能）
      const isJs = /\.(?:m?js|cjs)$/i.test(fullPath);
      const isJson = /\.json$/i.test(fullPath);
      const headers: Record<string, string> = {
        'Content-Type': isJs
          ? 'application/javascript; charset=utf-8'
          : isJson
            ? 'application/json; charset=utf-8'
            : 'application/octet-stream',
        'Cache-Control': 'no-cache',
        // dynamic import の CORS チェック対策（カスタムスキームは
        // クロスオリジン扱いされることがあるため明示的に許可しておく）
        'Access-Control-Allow-Origin': '*',
      };
      console.log(
        '[inknel-plugin] serve:',
        fullPath,
        '(' + body.byteLength + ' bytes)',
      );
      return new Response(body, { status: 200, headers });
    } catch (err) {
      console.error('[inknel-plugin protocol] error:', err);
      return new Response(null, { status: 500, statusText: 'Internal Error' });
    }
  });
}
