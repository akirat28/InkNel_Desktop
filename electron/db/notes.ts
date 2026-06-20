import { initDb } from './index';

export interface NoteMeta {
  id: string;
  title: string;
  folder: string;
  protected: boolean;
  /** シークレット（クリック表示時にもパスワードを要求する） */
  secret: boolean;
  /** ノートに紐づくタグ（バッジ表示用、本文中の #word とは別のメタデータ） */
  tags: string[];
  /** このノートから連携しているノートID一覧 */
  linkedNoteIds: string[];
  createdAt: number;
  updatedAt: number;
  /** ゴミ箱に移動された epoch ms (null = 通常ノート) */
  trashedAt: number | null;
  /**
   * サイドバーのファイルアイコンに着色する CSS 色文字列 (例: '#FF3B30')。
   * null は「色なし (現在の文字色フォールバック)」。
   */
  iconColor: string | null;
}

interface NoteRow {
  id: string;
  title: string;
  folder: string;
  protected: number;
  secret: number;
  tags: string;
  linked_note_ids: string;
  body: string;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
  icon_color: string | null;
}

function parseStringArray(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((s) => typeof s === 'string')) {
      return arr;
    }
  } catch {
    // 不正な JSON は空配列扱い
  }
  return [];
}

function rowToMeta(row: NoteRow): NoteMeta {
  return {
    id: row.id,
    title: row.title,
    folder: row.folder,
    protected: row.protected !== 0,
    secret: row.secret !== 0,
    tags: parseStringArray(row.tags),
    linkedNoteIds: parseStringArray(row.linked_note_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    iconColor: row.icon_color ?? null,
  };
}

/** 通常ノート一覧 (ゴミ箱に入っているものは除外) */
export function listNotes(): NoteMeta[] {
  const db = initDb();
  const rows = db
    .prepare(
      `SELECT id, title, folder, protected, secret, tags, linked_note_ids, body, created_at, updated_at, trashed_at, icon_color
         FROM notes
        WHERE trashed_at IS NULL
        ORDER BY updated_at DESC`,
    )
    .all() as NoteRow[];
  return rows.map(rowToMeta);
}

/** ゴミ箱内のノート一覧 (削除日が新しい順) */
export function listTrashedNotes(): NoteMeta[] {
  const db = initDb();
  const rows = db
    .prepare(
      `SELECT id, title, folder, protected, secret, tags, linked_note_ids, body, created_at, updated_at, trashed_at, icon_color
         FROM notes
        WHERE trashed_at IS NOT NULL
        ORDER BY trashed_at DESC`,
    )
    .all() as NoteRow[];
  return rows.map(rowToMeta);
}

export function getNote(id: string): NoteMeta | null {
  const db = initDb();
  const row = db
    .prepare(
      `SELECT id, title, folder, protected, secret, tags, linked_note_ids, body, created_at, updated_at, trashed_at, icon_color FROM notes WHERE id = ?`,
    )
    .get(id) as NoteRow | undefined;
  return row ? rowToMeta(row) : null;
}

/**
 * ノート本文 (body) だけを DB から直接返す。表示用の高速パス。
 * クラウド (Google Drive 等) 上の `.md` を読みに行かず、ローカル SQLite の
 * write-through キャッシュから即座に取得する。行が無ければ null。
 */
export function getNoteBody(id: string): string | null {
  const db = initDb();
  const row = db
    .prepare(`SELECT body FROM notes WHERE id = ?`)
    .get(id) as { body: string } | undefined;
  return row ? row.body : null;
}

export function insertNote(meta: NoteMeta, body = ''): void {
  const db = initDb();
  db.prepare(
    `INSERT INTO notes (id, title, folder, protected, secret, tags, linked_note_ids, body, created_at, updated_at, icon_color)
     VALUES (@id, @title, @folder, @protectedInt, @secretInt, @tagsJson, @linkedNoteIdsJson, @bodyText, @createdAt, @updatedAt, @iconColorVal)`,
  ).run({
    ...meta,
    protectedInt: meta.protected ? 1 : 0,
    secretInt: meta.secret ? 1 : 0,
    tagsJson: JSON.stringify(meta.tags ?? []),
    linkedNoteIdsJson: JSON.stringify(meta.linkedNoteIds ?? []),
    bodyText: body,
    iconColorVal: meta.iconColor ?? null,
  });
}

/**
 * ノートのアイコンカラーだけを更新する。色は CSS 色文字列、null で「色なし」。
 * updated_at は触らない (色変更は「ノート内容の変更」ではないため、modified date を保つ)。
 */
export function setNoteIconColor(
  id: string,
  iconColor: string | null,
): NoteMeta | null {
  const db = initDb();
  db.prepare(`UPDATE notes SET icon_color = ? WHERE id = ?`).run(iconColor, id);
  return getNote(id);
}

export function updateNoteMeta(
  id: string,
  patch: { title?: string; folder?: string; tags?: string[] },
): NoteMeta {
  const db = initDb();
  const current = getNote(id);
  if (!current) throw new Error(`note not found: ${id}`);
  const next: NoteMeta = {
    ...current,
    title: patch.title ?? current.title,
    folder: patch.folder ?? current.folder,
    tags: patch.tags ?? current.tags,
    linkedNoteIds: current.linkedNoteIds,
    updatedAt: Date.now(),
  };
  db.prepare(
    `UPDATE notes
        SET title = @title,
            folder = @folder,
            tags = @tagsJson,
            updated_at = @updatedAt
      WHERE id = @id`,
  ).run({
    ...next,
    tagsJson: JSON.stringify(next.tags),
  });
  return next;
}

export function setNoteProtected(id: string, isProtected: boolean): NoteMeta {
  const db = initDb();
  const current = getNote(id);
  if (!current) throw new Error(`note not found: ${id}`);
  const updatedAt = Date.now();
  db.prepare(
    `UPDATE notes SET protected = ?, updated_at = ? WHERE id = ?`,
  ).run(isProtected ? 1 : 0, updatedAt, id);
  return { ...current, protected: isProtected, updatedAt };
}

export function setNoteSecret(id: string, isSecret: boolean): NoteMeta {
  const db = initDb();
  const current = getNote(id);
  if (!current) throw new Error(`note not found: ${id}`);
  const updatedAt = Date.now();
  db.prepare(
    `UPDATE notes SET secret = ?, updated_at = ? WHERE id = ?`,
  ).run(isSecret ? 1 : 0, updatedAt, id);
  return { ...current, secret: isSecret, updatedAt };
}

export function setNoteLinks(id: string, linkedNoteIds: string[]): NoteMeta {
  const db = initDb();
  const current = getNote(id);
  if (!current) throw new Error(`note not found: ${id}`);
  const ownIdFiltered = linkedNoteIds.filter((linkedId) => linkedId !== id);
  const deduped = Array.from(new Set(ownIdFiltered));
  const updatedAt = Date.now();
  db.prepare(
    `UPDATE notes SET linked_note_ids = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(deduped), updatedAt, id);
  return { ...current, linkedNoteIds: deduped, updatedAt };
}

export function addNoteLink(id: string, linkedNoteId: string): NoteMeta {
  const current = getNote(id);
  if (!current) throw new Error(`note not found: ${id}`);
  if (id === linkedNoteId) return current;
  return setNoteLinks(id, [...current.linkedNoteIds, linkedNoteId]);
}

export function removeNoteLink(id: string, linkedNoteId: string): NoteMeta {
  const current = getNote(id);
  if (!current) throw new Error(`note not found: ${id}`);
  return setNoteLinks(
    id,
    current.linkedNoteIds.filter((x) => x !== linkedNoteId),
  );
}

export function touchNote(id: string): void {
  const db = initDb();
  db.prepare(`UPDATE notes SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function updateNoteBodyText(
  id: string,
  body: string,
  options: { touch?: boolean } = {},
): void {
  const db = initDb();
  if (options.touch === false) {
    db.prepare(`UPDATE notes SET body = ? WHERE id = ?`).run(body, id);
    return;
  }
  db.prepare(`UPDATE notes SET body = ?, updated_at = ? WHERE id = ?`).run(
    body,
    Date.now(),
    id,
  );
}

export function searchNotes(query: string): NoteMeta[] {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.toLowerCase()}%`;
  const db = initDb();
  const rows = db
    .prepare(
      `SELECT id, title, folder, protected, secret, tags, linked_note_ids, body, created_at, updated_at, trashed_at, icon_color,
              CASE WHEN lower(title) LIKE @like THEN 0 ELSE 1 END AS rank
         FROM notes
        WHERE trashed_at IS NULL
          AND (lower(title) LIKE @like OR lower(body) LIKE @like)
        ORDER BY rank ASC, updated_at DESC`,
    )
    .all({ like }) as (NoteRow & { rank: number })[];
  return rows.map(rowToMeta);
}

export function deleteNote(id: string): void {
  const db = initDb();
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
}

/**
 * ゴミ箱に移動 (trashed_at をセット)。ノート自体は残るので復元可能。
 * 通常の「削除」フローはこちらを使う。
 */
export function trashNote(id: string): NoteMeta | null {
  const db = initDb();
  const current = getNote(id);
  if (!current) return null;
  const trashedAt = Date.now();
  db.prepare(`UPDATE notes SET trashed_at = ? WHERE id = ?`).run(
    trashedAt,
    id,
  );
  return { ...current, trashedAt };
}

/** ゴミ箱から復元 (trashed_at を NULL に戻す) */
export function restoreNote(id: string): NoteMeta | null {
  const db = initDb();
  const current = getNote(id);
  if (!current) return null;
  db.prepare(`UPDATE notes SET trashed_at = NULL WHERE id = ?`).run(id);
  return { ...current, trashedAt: null };
}

/** ゴミ箱内のノートをすべて物理削除し、削除した id 配列を返す */
export function emptyTrash(): string[] {
  const db = initDb();
  const rows = db
    .prepare(`SELECT id FROM notes WHERE trashed_at IS NOT NULL`)
    .all() as { id: string }[];
  const ids = rows.map((r) => r.id);
  db.prepare(`DELETE FROM notes WHERE trashed_at IS NOT NULL`).run();
  return ids;
}

/**
 * 指定日数以上前にゴミ箱に入ったノートを物理削除し、id 配列を返す。
 * 起動時に呼び出して 30 日経過のものを自動削除する用途。
 */
export function purgeOldTrash(daysOld: number): string[] {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const db = initDb();
  const rows = db
    .prepare(
      `SELECT id FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?`,
    )
    .all(cutoff) as { id: string }[];
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    db.prepare(
      `DELETE FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?`,
    ).run(cutoff);
  }
  return ids;
}

/**
 * 共有同期からの upsert。既存レコードの全フィールドを与えられた meta で
 * 上書きする（updated_at / created_at もそのまま保存する点が通常の
 * updateNoteMeta との違い）。新規ならそのまま insertNote。
 *
 * タイムスタンプを加工せず保存することで、次回同期時にクラウド側との
 * 比較が正しく行える。
 */
export function upsertNoteFromSync(meta: NoteMeta): void {
  const db = initDb();
  const existing = getNote(meta.id);
  if (existing) {
    db.prepare(
      `UPDATE notes
          SET title = @title,
              folder = @folder,
              protected = @protectedInt,
              secret = @secretInt,
              tags = @tagsJson,
              linked_note_ids = @linkedNoteIdsJson,
              created_at = @createdAt,
              updated_at = @updatedAt
        WHERE id = @id`,
    ).run({
      ...meta,
      protectedInt: meta.protected ? 1 : 0,
      secretInt: meta.secret ? 1 : 0,
      tagsJson: JSON.stringify(meta.tags ?? []),
      linkedNoteIdsJson: JSON.stringify(meta.linkedNoteIds ?? []),
    });
  } else {
    insertNote(meta);
  }
}

export function upsertNoteFromSyncWithBody(meta: NoteMeta, body: string): void {
  const db = initDb();
  const existing = getNote(meta.id);
  if (existing) {
    db.prepare(
      `UPDATE notes
          SET title = @title,
              folder = @folder,
              protected = @protectedInt,
              secret = @secretInt,
              tags = @tagsJson,
              linked_note_ids = @linkedNoteIdsJson,
              body = @bodyText,
              created_at = @createdAt,
              updated_at = @updatedAt
        WHERE id = @id`,
    ).run({
      ...meta,
      protectedInt: meta.protected ? 1 : 0,
      secretInt: meta.secret ? 1 : 0,
      tagsJson: JSON.stringify(meta.tags ?? []),
      linkedNoteIdsJson: JSON.stringify(meta.linkedNoteIds ?? []),
      bodyText: body,
    });
  } else {
    insertNote(meta, body);
  }
}
