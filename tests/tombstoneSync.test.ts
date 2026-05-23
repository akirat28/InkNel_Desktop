/**
 * Tombstone (削除墓標) 同期シナリオの統合テスト。
 *
 * クロスデバイス削除伝播のバグ:
 *   - Device A がノートを削除 → DB から消える、MD を物理削除
 *   - Device B (= 共有フォルダを介して同じ MD を見ている別環境) は
 *     「DB にある / MD 無し」 = 新規と誤判定して MD を再生成
 *   - Device A が次の sync で MD を取り込み → ノート復活
 *
 * Tombstone 方式の修正:
 *   - 削除時に MD を unlink せず `deleted: true / deleted_at: N` の front-matter
 *     だけを持つスタブで上書き
 *   - sync では disk tombstone を見て DB から該当ノートも消す
 *   - 一定期間 (既定 90 日) 経過後に物理削除
 *
 * ここではテストプロセス内で「Device A → Device B」の流れを再現する。
 * 1 プロセス内に DB は 1 つしか無いので、Device B の挙動は switchToDevice で
 * 「DB ハンドル close + 新規 userDataDir + storage.path を共有フォルダに向ける」
 * という形で模擬する。
 *
 * 注意: buildSyncPlan は UUID 形式のファイル名しか拾わない (NOTE_FILENAME_RE) ので
 * テスト ID も UUID で固定する。
 */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupAllUserDataDirs, newUserDataDir } from './helpers';
import { closeDb, initDb } from '../electron/db/index';
import {
  insertNote,
  listNotes,
  getNote,
  deleteNote,
  type NoteMeta,
} from '../electron/db/notes';
import { setSetting } from '../electron/db/settings';
import {
  writeNoteFile,
  writeTombstone,
  isTombstoneMeta,
  readBodyWithMeta,
} from '../electron/storage/notesFiles';
import { buildSyncPlan, STORAGE_LAST_SYNC_KEY } from '../electron/ipc';
import {
  clearStorageRootCache,
  STORAGE_PATH_SETTING_KEY,
} from '../electron/storage/storageRoot';

// UUID 形式 (NOTE_FILENAME_RE にマッチする)
const ID_SOLO = '11111111-1111-4111-8111-111111111111';
const ID_SHARED = '22222222-2222-4222-8222-222222222222';
const ID_CONFLICT = '33333333-3333-4333-8333-333333333333';
const ID_FASTPATH = '44444444-4444-4444-8444-444444444444';
const ID_ORPHAN = '55555555-5555-4555-8555-555555555555';
const ID_NORMAL = '66666666-6666-4666-8666-666666666666';

const sharedRoots: string[] = [];

function newSharedFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inknel-shared-'));
  sharedRoots.push(dir);
  return dir;
}

function makeNote(id: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  const now = Date.now();
  return {
    id,
    title: `ノート ${id.slice(0, 8)}`,
    folder: '',
    protected: false,
    secret: false,
    tags: [],
    linkedNoteIds: [],
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    ...overrides,
  };
}

/** Device の userData (DB) を新規に切り替え、共有フォルダを storage.path に設定する */
function switchToDevice(sharedFolder: string): void {
  // 既存 DB ハンドルを閉じる (singleton が古い tmp dir を掴んだままになるのを防ぐ)
  try {
    closeDb();
  } catch {
    // 初回呼び出しでは何も無いので無視
  }
  newUserDataDir();
  clearStorageRootCache();
  initDb();
  setSetting(STORAGE_PATH_SETTING_KEY, sharedFolder);
  clearStorageRootCache();
}

beforeEach(() => {
  // 各テストの先頭で必ず switchToDevice が呼ばれるが、安全側として
  // 前テストの DB ハンドルもここでクローズしておく。
  try {
    closeDb();
  } catch {
    // ignore
  }
  newUserDataDir();
  clearStorageRootCache();
});

afterAll(() => {
  cleanupAllUserDataDirs();
  for (const d of sharedRoots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('tombstone sync シナリオ', () => {
  test('単一デバイス: 削除 → tombstone が残り、sync で復活しない', async () => {
    const shared = newSharedFolder();
    switchToDevice(shared);

    // 1) ノート作成・MD 書き出し
    const note = makeNote(ID_SOLO);
    insertNote(note);
    writeNoteFile(note, '# 本文\nbody');

    // 2) 初回 sync (lastSync を進める)
    setSetting(STORAGE_LAST_SYNC_KEY, String(Date.now()));

    // 3) ノート削除 (writeTombstone + deleteNote の組み合わせを模擬)
    writeTombstone(ID_SOLO);
    deleteNote(ID_SOLO);

    // 4) 再 sync: DB は対象なし / disk は tombstone → 何も起こらない
    const plan = await buildSyncPlan();
    expect(plan.diskToDbTargets).toEqual([]);
    expect(plan.dbDeleteTargets).toEqual([]);
    expect(plan.dbToDiskTargets).toEqual([]);

    // tombstone は保持されている
    const { meta } = readBodyWithMeta(ID_SOLO);
    expect(isTombstoneMeta(meta)).toBe(true);
  });

  test('Device A 削除 → 共有フォルダ経由で Device B が DB から削除する', async () => {
    const shared = newSharedFolder();

    // === Device A: ノート作成 → 削除 → tombstone を共有に残す ===
    switchToDevice(shared);
    const noteA = makeNote(ID_SHARED, { title: '共有ノート' });
    insertNote(noteA);
    writeNoteFile(noteA, '# 共有\nshared body');
    setSetting(STORAGE_LAST_SYNC_KEY, String(Date.now()));
    // A が削除
    writeTombstone(ID_SHARED);
    deleteNote(ID_SHARED);

    // === Device B: 同じ共有フォルダ。DB にはまだ同じ id が居る ===
    switchToDevice(shared);
    insertNote(noteA); // B 上にも同じノートが居る状態を再現
    setSetting(STORAGE_LAST_SYNC_KEY, String(noteA.updatedAt - 1000)); // tombstone より前

    const plan = await buildSyncPlan();
    // tombstone を検出して DB 削除候補に上げる
    expect(plan.dbDeleteTargets.map((t) => t.id)).toEqual([ID_SHARED]);
    // 同 id を取り込みや書き出しに重複して上げない
    expect(plan.diskToDbTargets.find((t) => t.id === ID_SHARED)).toBeUndefined();
    expect(plan.dbToDiskTargets.find((t) => t.id === ID_SHARED)).toBeUndefined();

    // 実際に DB から消えることも確認 (sync 実行を模擬)
    for (const t of plan.dbDeleteTargets) deleteNote(t.id);
    expect(getNote(ID_SHARED)).toBeNull();
  });

  test('DB の方が tombstone より新しい場合は DB 編集が勝ち、MD を再生成', async () => {
    const shared = newSharedFolder();

    // Device A が古い時刻で削除 (tombstone)
    switchToDevice(shared);
    const baseTime = Date.now() - 1000 * 60 * 60; // 1 時間前
    writeTombstone(ID_CONFLICT, baseTime);

    // Device B は tombstone より後の時刻でノートを編集している
    switchToDevice(shared);
    const newer = makeNote(ID_CONFLICT, {
      title: '生きてるノート',
      updatedAt: baseTime + 1000 * 60, // 1 分後
      createdAt: baseTime - 1000,
    });
    insertNote(newer);
    setSetting(STORAGE_LAST_SYNC_KEY, String(baseTime - 1000 * 10));

    const plan = await buildSyncPlan();
    // DB の編集が tombstone より新しい → 削除ではなく書き出しに回る
    expect(plan.dbDeleteTargets).toEqual([]);
    expect(plan.dbToDiskTargets.map((t) => t.id)).toContain(ID_CONFLICT);
  });

  test('小サイズ tombstone は mtime が古くても高速パスをすり抜けず検出される', async () => {
    const shared = newSharedFolder();

    // Device B: DB に「古い」ノートを保持 (DB.updatedAt が tombstone より前)
    switchToDevice(shared);
    const baseTime = Date.now() - 1000 * 60 * 60 * 24 * 7; // 7 日前
    const note = makeNote(ID_FASTPATH, {
      title: 'old-note',
      createdAt: baseTime,
      updatedAt: baseTime,
    });
    insertNote(note);
    // 共有フォルダ上の MD を tombstone で上書き (= 他デバイスから降りて来た想定)。
    // deletedAt は DB.updatedAt より「後」にする (= tombstone 勝ち)。
    const tsDeletedAt = baseTime + 1000 * 60; // baseTime の 1 分後
    writeTombstone(ID_FASTPATH, tsDeletedAt);
    // lastSync を「未来」に設定して fileMaybeChanged=false を強制
    // (= mtime ≤ lastSync。サイズ判定が無ければ高速パスで取りこぼされる)
    setSetting(STORAGE_LAST_SYNC_KEY, String(Date.now() + 1000 * 60 * 60));

    const plan = await buildSyncPlan();
    // 小サイズ補助判定によって tombstone が拾われ、DB 削除候補に乗る
    expect(plan.dbDeleteTargets.map((t) => t.id)).toEqual([ID_FASTPATH]);
  });

  test('disk に tombstone だけで DB に対応無し → 何もしない (取り込み回避)', async () => {
    const shared = newSharedFolder();
    switchToDevice(shared);

    writeTombstone(ID_ORPHAN);
    setSetting(STORAGE_LAST_SYNC_KEY, '0');

    const plan = await buildSyncPlan();
    // 「DB に無い disk あり」だが tombstone なので取り込みも削除も無し
    expect(plan.diskToDbTargets).toEqual([]);
    expect(plan.dbDeleteTargets).toEqual([]);
    expect(plan.dbToDiskTargets).toEqual([]);
    // ファイル自体はまだ残っている (purgeOldTombstones が retention 後に消す)
    const stillThere = existsSync(join(shared, 'notes', `${ID_ORPHAN}.md`));
    expect(stillThere).toBe(true);
  });

  test('通常ノートのみの環境では tombstone が無いので従来通り取り込む', async () => {
    const shared = newSharedFolder();

    // Device A: 普通にノート作成
    switchToDevice(shared);
    const note = makeNote(ID_NORMAL, { title: 'A のノート' });
    insertNote(note);
    writeNoteFile(note, '# A\nbody');
    setSetting(STORAGE_LAST_SYNC_KEY, String(Date.now()));

    // Device B: DB 空。共有から取り込みするはず
    switchToDevice(shared);
    setSetting(STORAGE_LAST_SYNC_KEY, '0');
    expect(listNotes()).toEqual([]);

    const plan = await buildSyncPlan();
    expect(plan.diskToDbTargets.map((t) => t.id)).toEqual([ID_NORMAL]);
    expect(plan.dbDeleteTargets).toEqual([]);
  });
});
