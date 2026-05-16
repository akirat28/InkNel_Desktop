/**
 * バックアップ / リストア。
 *
 * バックアップ手順:
 *   1. (UI 側で) DB ↔ MD 同期を実行して .md を最新にしておく
 *   2. ストレージルート (`getStorageRoot()`) 配下を ZIP 圧縮
 *   3. ユーザーが選んだ場所に保存
 *
 * リストア手順:
 *   1. ユーザーが ZIP を選択
 *   2. 一時ディレクトリに展開
 *   3. ストレージルート配下を入れ替え（既存の .md/画像/添付を削除して上書き）
 *   4. (UI 側で) MD → DB 取り込み同期を実行
 */

import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dialog } from 'electron';
import { getStorageRoot } from './storageRoot';

/** バックアップに含めるサブディレクトリ名 */
const BACKUP_DIRS = ['notes', 'images', 'attachments'];

/**
 * ストレージルートを ZIP 化してユーザーが選んだ場所に保存。
 * 戻り値: 保存先パス。キャンセル時は null。
 */
export async function createBackup(): Promise<{
  savedPath: string;
  fileCount: number;
} | null> {
  const root = getStorageRoot();
  if (!existsSync(root)) {
    throw new Error(`保存先フォルダが存在しません: ${root}`);
  }

  // タイムスタンプ付きファイル名: InkNel-backup-YYYYMMDD-HHmm.zip
  const now = new Date();
  const stamp =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  const defaultName = `InkNel-backup-${stamp}.zip`;

  const result = await dialog.showSaveDialog({
    title: 'バックアップ ZIP の保存先',
    defaultPath: defaultName,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return null;

  const zip = new AdmZip();
  let fileCount = 0;

  for (const dirName of BACKUP_DIRS) {
    const subDir = join(root, dirName);
    if (!existsSync(subDir)) continue;
    addDirToZip(zip, subDir, dirName);
    fileCount += countFiles(subDir);
  }

  // 既存の同名ファイルがあれば上書き（save dialog で確認済み）
  zip.writeZip(result.filePath);
  return { savedPath: result.filePath, fileCount };
}

/**
 * ZIP を選択して storage root 配下にリストア。
 * 既存の `notes/`, `images/`, `attachments/` を消してから展開する。
 *
 * 戻り値: { restoredPath, fileCount }。キャンセル時は null。
 */
export async function restoreBackup(): Promise<{
  restoredPath: string;
  fileCount: number;
} | null> {
  const root = getStorageRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  const result = await dialog.showOpenDialog({
    title: 'バックアップ ZIP を選択',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const zipPath = result.filePaths[0];

  // ZIP 妥当性確認 + 一時展開
  const tempDir = join(
    tmpdir(),
    `inknel-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tempDir, { recursive: true });
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, /* overwrite */ true);

    // 展開された中身が想定 (notes/ etc) を含むか確認
    let valid = false;
    for (const dirName of BACKUP_DIRS) {
      if (existsSync(join(tempDir, dirName))) {
        valid = true;
        break;
      }
    }
    if (!valid) {
      throw new Error(
        '選択された ZIP には notes/ images/ attachments/ のいずれも含まれていません',
      );
    }

    // 既存サブディレクトリを削除して入れ替え
    let fileCount = 0;
    for (const dirName of BACKUP_DIRS) {
      const dst = join(root, dirName);
      const src = join(tempDir, dirName);
      if (existsSync(dst)) {
        rmSync(dst, { recursive: true, force: true });
      }
      if (existsSync(src)) {
        // src を dst に rename（同一ボリュームならアトミック）
        renameOrCopy(src, dst);
        fileCount += countFiles(dst);
      }
    }

    return { restoredPath: zipPath, fileCount };
  } finally {
    // 一時ディレクトリは中身が rename で消えていることが多いが、念のため掃除
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

// ----- ヘルパ -----

/** ディレクトリを再帰的に AdmZip に追加 */
function addDirToZip(zip: AdmZip, dir: string, zipPath: string): void {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const inZip = `${zipPath}/${name}`;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      addDirToZip(zip, full, inZip);
    } else if (stat.isFile()) {
      zip.addLocalFile(full, zipPath);
    }
  }
}

/** ディレクトリ配下のファイル数を再帰カウント */
function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) count += countFiles(full);
    else count += 1;
  }
  return count;
}

/**
 * src → dst の移動。renameSync が EXDEV (別ボリューム) で失敗したら
 * 再帰コピーにフォールバック。
 */
function renameOrCopy(src: string, dst: string): void {
  try {
    // 動的 import を避けて要件最小化: Node の rename は同一ボリューム前提
    const { renameSync } = require('node:fs') as typeof import('node:fs');
    renameSync(src, dst);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'EXDEV'
    ) {
      copyDirRecursive(src, dst);
      rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

function copyDirRecursive(src: string, dst: string): void {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sFull = join(src, name);
    const dFull = join(dst, name);
    const stat = statSync(sFull);
    if (stat.isDirectory()) {
      copyDirRecursive(sFull, dFull);
    } else if (stat.isFile()) {
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      writeFileSync(dFull, readFileSync(sFull));
    }
  }
}

