/**
 * ノート本文 / 画像 / 添付ファイルを書き出すルートディレクトリを返す。
 *
 * 優先順位:
 *   1. settings.storage.path にユーザーが指定した有効なディレクトリパス
 *   2. なければ `app.getPath('userData')` （従来挙動）
 *
 * 値はキャッシュして毎回 SQLite を引かないようにする。設定変更時は
 * `clearStorageRootCache()` を呼び出してキャッシュを破棄する。
 */
import { app } from 'electron';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { getAllSettings } from '../db/settings';

let cached: string | null = null;

export const STORAGE_PATH_SETTING_KEY = 'storage.path';

export function getStorageRoot(): string {
  if (cached) return cached;
  try {
    const settings = getAllSettings();
    const custom = (settings[STORAGE_PATH_SETTING_KEY] || '').trim();
    if (custom) {
      try {
        if (existsSync(custom) && statSync(custom).isDirectory()) {
          mkdirSync(custom, { recursive: true });
          cached = custom;
          return custom;
        }
      } catch {
        // 無効なパスなら fallthrough して既定の userData
      }
    }
  } catch {
    // 設定 DB が未初期化等のエラー時は既定にフォールバック
  }
  cached = app.getPath('userData');
  return cached;
}

export function clearStorageRootCache(): void {
  cached = null;
}
