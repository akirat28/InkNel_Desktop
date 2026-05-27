import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let db: Database.Database | null = null;

/**
 * SQLite データベースを初期化する。
 * 既にオープン済みなら既存のインスタンスを返す。
 */
export function initDb(): Database.Database {
  if (db) return db;

  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });

  const dbPath = join(userData, 'inknel.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      folder     TEXT NOT NULL DEFAULT '',
      protected  INTEGER NOT NULL DEFAULT 0,
      secret     INTEGER NOT NULL DEFAULT 0,
      tags       TEXT NOT NULL DEFAULT '[]',
      linked_note_ids TEXT NOT NULL DEFAULT '[]',
      body       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      /** ゴミ箱に移動された epoch ms (NULL = 通常ノート) */
      trashed_at INTEGER,
      /** サイドバーアイコンの色 (CSS 色文字列、NULL = 色なし) */
      icon_color TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_folder  ON notes(folder);
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
    /* idx_notes_trashed は trashed_at カラムが存在することを前提とするので
       マイグレーションのあとで作成する (下記参照)。 */

    CREATE TABLE IF NOT EXISTS folders (
      path       TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      /** サイドバーアイコンの色 (CSS 色文字列、NULL = 色なし) */
      icon_color TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ----- マイグレーション: 既存DBに無いカラムを追加 -----
  const cols = db
    .prepare(`PRAGMA table_info(notes)`)
    .all() as { name: string }[];
  if (!cols.find((c) => c.name === 'protected')) {
    db.exec(
      `ALTER TABLE notes ADD COLUMN protected INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!cols.find((c) => c.name === 'tags')) {
    db.exec(
      `ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`,
    );
  }
  if (!cols.find((c) => c.name === 'secret')) {
    db.exec(
      `ALTER TABLE notes ADD COLUMN secret INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!cols.find((c) => c.name === 'body')) {
    db.exec(`ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.find((c) => c.name === 'linked_note_ids')) {
    db.exec(
      `ALTER TABLE notes ADD COLUMN linked_note_ids TEXT NOT NULL DEFAULT '[]'`,
    );
  }
  if (!cols.find((c) => c.name === 'trashed_at')) {
    // ゴミ箱機能用カラム (epoch ms、null = 通常ノート)
    db.exec(`ALTER TABLE notes ADD COLUMN trashed_at INTEGER`);
  }
  if (!cols.find((c) => c.name === 'icon_color')) {
    // サイドバーアイコンの色 (CSS 色文字列、null = 色なし)
    db.exec(`ALTER TABLE notes ADD COLUMN icon_color TEXT`);
  }
  // 新規 DB / 既存 DB どちらでも trashed_at が確定したあとにインデックスを作る
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_trashed ON notes(trashed_at)`,
  );

  // folders テーブルにも icon_color を追加 (既存 DB 向け migration)
  const folderCols = db
    .prepare(`PRAGMA table_info(folders)`)
    .all() as { name: string }[];
  if (!folderCols.find((c) => c.name === 'icon_color')) {
    db.exec(`ALTER TABLE folders ADD COLUMN icon_color TEXT`);
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
