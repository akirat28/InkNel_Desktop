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
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_folder  ON notes(folder);
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);

    CREATE TABLE IF NOT EXISTS folders (
      path       TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
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

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
