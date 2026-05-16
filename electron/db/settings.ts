import { initDb } from './index';

interface SettingRow {
  key: string;
  value: string;
}

/** 全設定を key/value のレコードで取得する。 */
export function getAllSettings(): Record<string, string> {
  const db = initDb();
  const rows = db
    .prepare(`SELECT key, value FROM settings`)
    .all() as SettingRow[];
  const result: Record<string, string> = {};
  for (const r of rows) {
    result[r.key] = r.value;
  }
  return result;
}

/** 設定値を保存（UPSERT）。 */
export function setSetting(key: string, value: string): void {
  const db = initDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
