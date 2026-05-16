import { initDb } from './index';

interface FolderRow {
  path: string;
}

/** 空フォルダのパスを昇順で返す。 */
export function listFolders(): string[] {
  const db = initDb();
  const rows = db
    .prepare(`SELECT path FROM folders ORDER BY path ASC`)
    .all() as FolderRow[];
  return rows.map((r) => r.path);
}

/**
 * 空フォルダを追加する。既存の場合は no-op。
 * パスは事前に正規化済み（前後スラッシュを除いた "a/b/c" 形式）であることが前提。
 */
export function insertFolder(path: string): void {
  if (!path) return;
  const db = initDb();
  db.prepare(
    `INSERT OR IGNORE INTO folders (path, created_at) VALUES (?, ?)`,
  ).run(path, Date.now());
}

export function deleteFolder(path: string): void {
  const db = initDb();
  db.prepare(`DELETE FROM folders WHERE path = ?`).run(path);
}

/**
 * フォルダパスを書き換え、配下の全ノートと全サブフォルダを一括更新する。
 *
 * 例: oldPath="階層1", newPath="階層X"
 *   - notes.folder = "階層1"               → "階層X"
 *   - notes.folder = "階層1/サブ"          → "階層X/サブ"
 *   - notes.folder = "階層1/サブ/孫"       → "階層X/サブ/孫"
 *   - folders.path = "階層1"               → "階層X"
 *   - folders.path = "階層1/サブ"          → "階層X/サブ"
 *
 * トランザクションで原子的に実行する。
 */
export function renameFolder(oldPath: string, newPath: string): void {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const db = initDb();
  const now = Date.now();
  const prefix = oldPath + '/';
  const prefixLen = prefix.length;

  const tx = db.transaction(() => {
    // 1) notes.folder が oldPath と完全一致するもの
    db.prepare(
      `UPDATE notes SET folder = ?, updated_at = ? WHERE folder = ?`,
    ).run(newPath, now, oldPath);

    // 2) notes.folder が oldPath/ で始まるもの（サブフォルダ配下）
    const notesUnder = db
      .prepare(`SELECT id, folder FROM notes WHERE folder LIKE ?`)
      .all(prefix + '%') as { id: string; folder: string }[];
    const updateNoteStmt = db.prepare(
      `UPDATE notes SET folder = ?, updated_at = ? WHERE id = ?`,
    );
    for (const n of notesUnder) {
      const newFolder = newPath + '/' + n.folder.slice(prefixLen);
      updateNoteStmt.run(newFolder, now, n.id);
    }

    // 3) folders テーブル: oldPath と完全一致 + oldPath/ で始まるもの
    const matchingFolders = db
      .prepare(`SELECT path, created_at FROM folders WHERE path = ? OR path LIKE ?`)
      .all(oldPath, prefix + '%') as { path: string; created_at: number }[];
    const deleteFolderStmt = db.prepare(`DELETE FROM folders WHERE path = ?`);
    const insertFolderStmt = db.prepare(
      `INSERT OR IGNORE INTO folders (path, created_at) VALUES (?, ?)`,
    );
    for (const f of matchingFolders) {
      const newSubPath =
        f.path === oldPath ? newPath : newPath + '/' + f.path.slice(prefixLen);
      deleteFolderStmt.run(f.path);
      insertFolderStmt.run(newSubPath, f.created_at);
    }
  });

  tx();
}

/**
 * フォルダを配下のノート・サブフォルダごと丸ごと削除する。
 *
 * - 保護されているノートが 1 件でも含まれていたら例外を投げて中断する
 * - 該当するノート ID 一覧を返す（呼び出し元で本文ファイル (.md) を削除するため）
 */
export function deleteFolderRecursive(path: string): string[] {
  if (!path) return [];
  const db = initDb();
  const prefix = path + '/';

  // 保護されているノートをチェック
  const protectedRows = db
    .prepare(
      `SELECT id, title FROM notes WHERE (folder = ? OR folder LIKE ?) AND protected = 1`,
    )
    .all(path, prefix + '%') as { id: string; title: string }[];
  if (protectedRows.length > 0) {
    const titles = protectedRows.map((r) => r.title || '無題').join(', ');
    throw new Error(
      `保護されたノートが含まれているため削除できません: ${titles}`,
    );
  }

  const noteIds = db
    .prepare(`SELECT id FROM notes WHERE folder = ? OR folder LIKE ?`)
    .all(path, prefix + '%') as { id: string }[];
  const ids = noteIds.map((r) => r.id);

  const tx = db.transaction(() => {
    // ノートを削除
    db.prepare(`DELETE FROM notes WHERE folder = ? OR folder LIKE ?`).run(
      path,
      prefix + '%',
    );
    // 該当フォルダとサブフォルダを削除
    db.prepare(`DELETE FROM folders WHERE path = ? OR path LIKE ?`).run(
      path,
      prefix + '%',
    );
  });
  tx();

  return ids;
}
