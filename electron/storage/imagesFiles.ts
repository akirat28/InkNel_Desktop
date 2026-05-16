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
 * 画像ファイルを `userData/images/` にフラット配置で保存する。
 * ファイル名は SHA-256 ハッシュ + 拡張子で、同一バイナリは自動的に dedupe される。
 *
 * notes/ と並列に配置しているのは、フェーズ4 のストレージアダプタで
 * ノート本文と画像をまとめて1つのストレージに同期できるようにするため。
 */

/** 受け入れる拡張子（path traversal対策と兼ねた allowlist） */
const ALLOWED_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
]);

/** ファイル名の許容パターン（プロトコルハンドラ側でも使用） */
export const IMAGE_FILENAME_PATTERN = /^[a-f0-9]{64}\.[a-z0-9]{2,5}$/;

export function imagesDir(): string {
  const dir = join(getStorageRoot(), 'images');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 安全なファイル名（hash.ext のみ）からフルパスを返す。 */
export function imagePath(filename: string): string {
  const safe = basename(filename);
  if (!IMAGE_FILENAME_PATTERN.test(safe)) {
    throw new Error(`invalid image filename: ${safe}`);
  }
  return join(imagesDir(), safe);
}

/**
 * 画像バイナリを保存し、ファイル名（hash.ext）を返す。
 * 拡張子は allowlist にマッチしない場合 'bin' にフォールバック。
 */
export function saveImage(buffer: Buffer, ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  const safeExt = ALLOWED_EXTS.has(normalized) ? normalized : 'bin';
  const hash = createHash('sha256').update(buffer).digest('hex');
  const filename = `${hash}.${safeExt}`;
  const fullPath = join(imagesDir(), filename);
  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, buffer);
  }
  return filename;
}

export function imageExists(filename: string): boolean {
  const safe = basename(filename);
  if (!IMAGE_FILENAME_PATTERN.test(safe)) return false;
  return existsSync(join(imagesDir(), safe));
}

/** ファイル名 sanitize 込みで画像を削除。存在しない場合は no-op。 */
export function deleteImage(filename: string): void {
  const safe = basename(filename);
  if (!IMAGE_FILENAME_PATTERN.test(safe)) return;
  const fullPath = join(imagesDir(), safe);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
}
