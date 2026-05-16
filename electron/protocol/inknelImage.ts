import { protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import { imagePath, IMAGE_FILENAME_PATTERN } from '../storage/imagesFiles';

/**
 * `inknel-image://<filename>` カスタムプロトコル。
 *
 * - registerInknelImagePrivileged() は app.whenReady() より「前」に呼ぶこと。
 * - handleInknelImageProtocol() は whenReady の後に呼ぶこと。
 *
 * Renderer の <img src="inknel-image://abc.png"> が
 * メインプロセスを経由して userData/images/abc.png を返す。
 */

export const INKNEL_IMAGE_SCHEME = 'inknel-image';

/** 必ず app.whenReady() より前に呼ぶ。 */
export function registerInknelImagePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: INKNEL_IMAGE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

/** app.whenReady() の後に呼ぶ。 */
export function handleInknelImageProtocol(): void {
  protocol.handle(INKNEL_IMAGE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // inknel-image://<filename> 形式と inknel-image://host/<filename> の両方に対応
      const raw = decodeURIComponent(
        url.hostname || url.pathname.replace(/^\//, ''),
      );
      const filename = basename(raw);

      // sanitize: hash.ext パターン以外は拒否
      if (!IMAGE_FILENAME_PATTERN.test(filename)) {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }

      const fullPath = imagePath(filename);
      return await net.fetch(pathToFileURL(fullPath).toString());
    } catch {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
  });
}
