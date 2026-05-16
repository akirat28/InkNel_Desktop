import { join, basename } from 'node:path';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { getStorageRoot } from './storageRoot';

/**
 * 添付ファイル（PDF / ZIP / LZH / LHA / 7z など）を `userData/attachments/` に
 * フラット配置で保存する。
 *
 * - ファイル名は SHA-256 ハッシュ + 拡張子で、同一バイナリは自動 dedupe
 * - 画像は `imagesFiles.ts` 側、それ以外（リンク表示するもの）はこちら
 */

/** 受け入れる拡張子（path traversal対策と兼ねた allowlist） */
const ALLOWED_EXTS = new Set([
  'pdf',
  'zip',
  'lzh',
  'lha',
  '7z',
]);

/** ファイル名の許容パターン（IPC ハンドラ側でも使用） */
export const ATTACHMENT_FILENAME_PATTERN = /^[a-f0-9]{64}\.[a-z0-9]{2,5}$/;

export function attachmentsDir(): string {
  const dir = join(getStorageRoot(), 'attachments');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 安全なファイル名（hash.ext のみ）からフルパスを返す。 */
export function attachmentPath(filename: string): string {
  const safe = basename(filename);
  if (!ATTACHMENT_FILENAME_PATTERN.test(safe)) {
    throw new Error(`invalid attachment filename: ${safe}`);
  }
  return join(attachmentsDir(), safe);
}

/**
 * 添付ファイルバイナリを保存し、ファイル名（hash.ext）を返す。
 * 拡張子は allowlist にマッチしない場合 'bin' にフォールバック。
 */
export function saveAttachment(buffer: Buffer, ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  const safeExt = ALLOWED_EXTS.has(normalized) ? normalized : 'bin';
  const hash = createHash('sha256').update(buffer).digest('hex');
  const filename = `${hash}.${safeExt}`;
  const fullPath = join(attachmentsDir(), filename);
  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, buffer);
  }
  return filename;
}

export function attachmentExists(filename: string): boolean {
  const safe = basename(filename);
  if (!ATTACHMENT_FILENAME_PATTERN.test(safe)) return false;
  return existsSync(join(attachmentsDir(), safe));
}

/** ファイル名 sanitize 込みで添付ファイルを削除。存在しない場合は no-op。 */
export function deleteAttachment(filename: string): void {
  const safe = basename(filename);
  if (!ATTACHMENT_FILENAME_PATTERN.test(safe)) return;
  const fullPath = join(attachmentsDir(), safe);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
}
