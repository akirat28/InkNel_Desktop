import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getStorageRoot } from './storageRoot';

/**
 * フォルダのアイコン色を共有ディスク経由で他デバイスへ同期するための
 * `<storageRoot>/folders.json` を読み書きする。
 *
 * フォルダ自体はファイルシステム上のサブディレクトリではなくノートの
 * front-matter `folder:` 仮想階層なので、色情報を載せられる固有ファイルが
 * 存在しない。そこで storage root 直下に小さな JSON を 1 つだけ置いて
 * 「フォルダパス → 色」を保持する。
 *
 * - キーは正規化済みのフォルダパス (例: "work/projects")
 * - 値は CSS 色文字列 (例: "#FF3B30") または null (= 色なしへ戻された)
 *   null も保存するのは「他デバイスで設定した色を空に戻した」を伝播するため
 */

const FILENAME = 'folders.json';

interface FoldersFileData {
  version: number;
  iconColors: Record<string, string | null>;
}

function filePath(): string {
  return join(getStorageRoot(), FILENAME);
}

/**
 * 共有 folders.json を読み込む。ファイル無し / JSON 壊れている場合は空 Map。
 * 同期処理から繰り返し呼ばれるので失敗しても例外を投げない。
 */
export function readFolderColors(): Record<string, string | null> {
  const p = filePath();
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, 'utf-8');
    const json = JSON.parse(raw) as Partial<FoldersFileData>;
    if (!json || typeof json !== 'object' || !json.iconColors) return {};
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(json.iconColors)) {
      if (typeof k !== 'string') continue;
      if (v === null || typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * `iconColors` 全体を folders.json に書き出す。
 * 部分更新ではなく全置換なので、呼び出し側で merge してから渡すこと。
 */
export function writeFolderColors(
  iconColors: Record<string, string | null>,
): void {
  const data: FoldersFileData = { version: 1, iconColors };
  writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf-8');
}
