import { join } from 'node:path';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  promises as fsp,
} from 'node:fs';
import { getStorageRoot } from './storageRoot';
import {
  parseFrontMatter,
  serializeFrontMatter,
  type NoteFrontMatter,
} from '../utils/frontMatter';
import type { NoteMeta } from '../db/notes';

/**
 * ノート本文 (.md) を `<storageRoot>/notes/` にフラット配置で保存する。
 * `storageRoot` は既定で userData、ユーザーが設定で指定した場合はそのフォルダ。
 *
 * ディスクには **YAML front-matter 付き** で書き出すため、フォルダ階層・タグ・
 * 保護フラグといったメタ情報も `.md` 単体で完結する。これにより別端末で
 * 同じフォルダを開いた時、フォルダ階層やタグも復元できる。
 *
 * - DB の `folder` 等は仮想階層として保持されるが、ディスクの真は front-matter
 * - エディタへ渡す本文には front-matter は **含めない**（`readBody` が剥離）
 * - 書き込み API は基本 `writeNoteFile(meta, body)` を使い、meta + body を結合
 */

function notesDir(): string {
  const dir = join(getStorageRoot(), 'notes');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * ノート id として受理する UUID v1-v5 形式の正規表現。
 * `notes:read-body` / `notes:update-body` / `notes:delete` 等の IPC ハンドラは
 * Renderer から渡された id をここに通すことで、`../` や絶対パス・null byte 等の
 * path traversal を一律で塞ぐ。`notePath()` を経由しない他 API は無いため、
 * 全ノート系ファイル I/O がこのガードを共有することになる。
 */
const NOTE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notePath(id: string): string {
  if (typeof id !== 'string' || !NOTE_ID_RE.test(id)) {
    throw new Error(`Invalid note id: ${String(id).slice(0, 64)}`);
  }
  return join(notesDir(), `${id}.md`);
}

/**
 * ディスクから読み出し、front-matter があれば剥がして本文だけを返す。
 * （エディタ表示用）
 */
export function readBody(id: string): string {
  const p = notePath(id);
  if (!existsSync(p)) return '';
  const raw = readFileSync(p, 'utf-8');
  return parseFrontMatter(raw).body;
}

/**
 * ディスクから読み出し、front-matter とパース済みメタを返す。
 * （同期 / インポート用）
 */
export function readBodyWithMeta(
  id: string,
): { meta: NoteFrontMatter; body: string } {
  const p = notePath(id);
  if (!existsSync(p)) return { meta: {}, body: '' };
  const raw = readFileSync(p, 'utf-8');
  return parseFrontMatter(raw);
}

/**
 * scan 専用: ファイルの先頭バイトのみを async で読み、front-matter だけ取り出す。
 *
 * - 本文は読まないので Google Drive 等のクラウドストレージ上の "オンライン専用"
 *   ファイルでもダウンロードが軽量
 * - async I/O なので main プロセスの event loop がブロックされない
 *
 * `head` バイト数を超える長大な front-matter は想定しない（YAML 1KB 程度で十分）
 */
export async function readFrontMatterOnly(
  id: string,
  head = 8192,
): Promise<{ meta: NoteFrontMatter }> {
  const p = notePath(id);
  let fd: import('node:fs/promises').FileHandle | null = null;
  try {
    fd = await fsp.open(p, 'r');
    const buf = Buffer.alloc(head);
    const { bytesRead } = await fd.read(buf, 0, head, 0);
    const text = buf.slice(0, bytesRead).toString('utf-8');
    // 末尾が不完全な行で切れることがあるが parseFrontMatter は
    // 先頭の `---\n...\n---` ブロックを正規表現で拾うため問題ない
    const { meta } = parseFrontMatter(text);
    return { meta };
  } catch {
    return { meta: {} };
  } finally {
    if (fd) await fd.close();
  }
}

/** async 版の readBodyWithMeta（同期版は同期実行が必要な箇所のみで使用） */
export async function readBodyWithMetaAsync(
  id: string,
): Promise<{ meta: NoteFrontMatter; body: string }> {
  const p = notePath(id);
  if (!existsSync(p)) return { meta: {}, body: '' };
  const raw = await fsp.readFile(p, 'utf-8');
  return parseFrontMatter(raw);
}

/**
 * 後方互換: front-matter 無しで素の本文だけを書き出す。
 * 既存呼び出し元のため残しているが、新規コードは `writeNoteFile` を使うこと。
 */
export function writeBody(id: string, body: string): void {
  writeFileSync(notePath(id), body, 'utf-8');
}

/**
 * 推奨書き込み API: meta を front-matter 化して body の先頭に付加し、
 * `<storageRoot>/notes/<id>.md` に書き込む。
 */
export function writeNoteFile(meta: NoteMeta, body: string): void {
  const fm: NoteFrontMatter = {
    title: meta.title,
    folder: meta.folder,
    tags: meta.tags ?? [],
    linkedNoteIds: meta.linkedNoteIds ?? [],
    protected: meta.protected,
    secret: meta.secret,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    iconColor: meta.iconColor ?? null,
  };
  const full = serializeFrontMatter(fm, body);
  writeFileSync(notePath(meta.id), full, 'utf-8');
}

export function deleteBody(id: string): void {
  const p = notePath(id);
  if (existsSync(p)) unlinkSync(p);
}

/**
 * Tombstone (削除墓標) を書き出す。.md ファイルを物理削除する代わりに、
 * `deleted: true / deleted_at: N` だけの front-matter ファイルへ置き換える。
 *
 * これにより他環境 (iCloud / Dropbox 等で同じフォルダを共有しているデバイス)
 * は「この id は削除された」と認識でき、DB から自動的に消せる。物理削除
 * してしまうと相手側は「DB ある / MD 無し = 新規」と誤判定して MD を
 * 再生成 → 結果としてノートが復活してしまうバグを防ぐ。
 *
 * 一定期間 (retention) 経過後に物理削除するのは別のジョブ (purgeOldTombstones)
 * で行う想定。
 */
export function writeTombstone(id: string, deletedAt: number = Date.now()): void {
  const fm: NoteFrontMatter = {
    deleted: true,
    deletedAt,
    // 同期判定で「deletedAt と DB.updatedAt の大小」を見るときに updatedAt が
    // 揃っていると比較しやすいので同値で書き出す。
    updatedAt: deletedAt,
  };
  const full = serializeFrontMatter(fm, '');
  writeFileSync(notePath(id), full, 'utf-8');
}

/** ファイルから読んだ meta が tombstone かどうかを判定 */
export function isTombstoneMeta(meta: NoteFrontMatter | undefined | null): boolean {
  return !!meta && meta.deleted === true;
}

/**
 * 保持期間を超えた tombstone (.md ファイルで deleted=true のもの) を物理削除する。
 * 起動時など適当なタイミングで呼ぶ。retentionMs (ms) 既定: 90 日。
 * 削除したファイル id 配列を返す。
 */
export async function purgeOldTombstones(
  retentionMs: number = 90 * 24 * 60 * 60 * 1000,
): Promise<string[]> {
  const dir = notesDir();
  const purged: string[] = [];
  let files: string[] = [];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return purged;
  }
  const cutoff = Date.now() - retentionMs;
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const id = f.replace(/\.md$/, '');
    const p = join(dir, f);
    try {
      const raw = await fsp.readFile(p, 'utf-8');
      const { meta } = parseFrontMatter(raw);
      if (!isTombstoneMeta(meta)) continue;
      const ts = typeof meta.deletedAt === 'number' ? meta.deletedAt : 0;
      if (ts > 0 && ts < cutoff) {
        await fsp.unlink(p);
        purged.push(id);
      }
    } catch {
      // 壊れたファイルはスキップ
    }
  }
  return purged;
}
