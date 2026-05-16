import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { cleanupAllUserDataDirs, newUserDataDir } from './helpers';
import { closeDb } from '../electron/db/index';
import {
  insertNote,
  getNote,
  listNotes,
  updateNoteMeta,
  setNoteProtected,
  setNoteSecret,
  addNoteLink,
  removeNoteLink,
  touchNote,
  updateNoteBodyText,
  searchNotes,
  deleteNote,
  upsertNoteFromSync,
  upsertNoteFromSyncWithBody,
  type NoteMeta,
} from '../electron/db/notes';
import {
  insertFolder,
  listFolders,
  deleteFolder,
  renameFolder,
  deleteFolderRecursive,
} from '../electron/db/folders';
import { getAllSettings, setSetting } from '../electron/db/settings';

function makeNote(id: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  const now = Date.now();
  return {
    id,
    title: `note ${id}`,
    folder: '',
    protected: false,
    secret: false,
    tags: [],
    linkedNoteIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  closeDb();
  newUserDataDir();
});

afterAll(() => {
  closeDb();
  cleanupAllUserDataDirs();
});

describe('notes DB', () => {
  test('insert + getNote', () => {
    const note = makeNote('n1', { title: 'hello' });
    insertNote(note);
    const got = getNote('n1');
    expect(got?.title).toBe('hello');
    expect(got?.protected).toBe(false);
    expect(got?.tags).toEqual([]);
  });

  test('listNotes は updated_at 降順', () => {
    insertNote(makeNote('a', { updatedAt: 100 }));
    insertNote(makeNote('b', { updatedAt: 300 }));
    insertNote(makeNote('c', { updatedAt: 200 }));
    const list = listNotes();
    expect(list.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  test('updateNoteMeta は updated_at を更新する', () => {
    insertNote(makeNote('n1', { updatedAt: 1000 }));
    const updated = updateNoteMeta('n1', { title: 'new title' });
    expect(updated.title).toBe('new title');
    expect(updated.updatedAt).toBeGreaterThan(1000);
  });

  test('setNoteProtected は protected と updated_at を更新', () => {
    insertNote(makeNote('n1', { protected: false, updatedAt: 1000 }));
    const before = getNote('n1')!;
    const updated = setNoteProtected('n1', true);
    expect(updated.protected).toBe(true);
    expect(updated.updatedAt).toBeGreaterThan(before.updatedAt);
    // DB 側でも反映されていること
    expect(getNote('n1')?.protected).toBe(true);
    expect(getNote('n1')?.updatedAt).toBe(updated.updatedAt);
  });

  test('setNoteSecret は secret と updated_at を更新', () => {
    insertNote(makeNote('n1', { secret: false, updatedAt: 1000 }));
    const updated = setNoteSecret('n1', true);
    expect(updated.secret).toBe(true);
    expect(updated.updatedAt).toBeGreaterThan(1000);
    expect(getNote('n1')?.secret).toBe(true);
  });

  test('ノート連携は重複と自己参照を除いて保存・解除できる', () => {
    insertNote(makeNote('base'));
    insertNote(makeNote('linked'));

    const linked = addNoteLink('base', 'linked');
    expect(linked.linkedNoteIds).toEqual(['linked']);
    expect(addNoteLink('base', 'linked').linkedNoteIds).toEqual(['linked']);
    expect(addNoteLink('base', 'base').linkedNoteIds).toEqual(['linked']);

    const removed = removeNoteLink('base', 'linked');
    expect(removed.linkedNoteIds).toEqual([]);
  });

  test('touchNote は updated_at のみ更新', () => {
    insertNote(makeNote('n1', { updatedAt: 1000 }));
    touchNote('n1');
    const got = getNote('n1')!;
    expect(got.updatedAt).toBeGreaterThan(1000);
  });

  test('updateNoteBodyText は本文をDB検索対象として更新する', () => {
    insertNote(makeNote('n1', { title: 'タイトル' }), '古い本文');
    updateNoteBodyText('n1', '検索できる本文');

    const result = searchNotes('検索できる');

    expect(result.map((n) => n.id)).toEqual(['n1']);
  });

  test('searchNotes はタイトル一致を本文一致より優先する', () => {
    insertNote(makeNote('body-hit', { title: 'zzz', updatedAt: 300 }), 'alpha');
    insertNote(makeNote('title-hit', { title: 'alpha', updatedAt: 100 }), '');

    const result = searchNotes('alpha');

    expect(result.map((n) => n.id)).toEqual(['title-hit', 'body-hit']);
  });

  test('deleteNote で削除', () => {
    insertNote(makeNote('n1'));
    deleteNote('n1');
    expect(getNote('n1')).toBeNull();
  });

  test('upsertNoteFromSync は updated_at を保持する', () => {
    const meta = makeNote('sync-1', { updatedAt: 12345, createdAt: 10000 });
    upsertNoteFromSync(meta);
    const got = getNote('sync-1')!;
    expect(got.updatedAt).toBe(12345);
    expect(got.createdAt).toBe(10000);
  });

  test('upsertNoteFromSyncWithBody は本文も検索対象として保存する', () => {
    const meta = makeNote('sync-body', { updatedAt: 12345, createdAt: 10000 });
    upsertNoteFromSyncWithBody(meta, 'クラウド本文');

    expect(searchNotes('クラウド本文').map((n) => n.id)).toEqual(['sync-body']);
  });

  test('タグは JSON 配列で保存・復元される', () => {
    insertNote(makeNote('t1', { tags: ['foo', 'bar', '日本語'] }));
    expect(getNote('t1')?.tags).toEqual(['foo', 'bar', '日本語']);
  });
});

describe('folders DB', () => {
  test('insertFolder + listFolders', () => {
    insertFolder('a');
    insertFolder('a/b');
    insertFolder('c');
    expect(listFolders()).toEqual(['a', 'a/b', 'c']);
  });

  test('deleteFolder は単一パスだけ削除', () => {
    insertFolder('x');
    insertFolder('x/y');
    deleteFolder('x');
    expect(listFolders()).toEqual(['x/y']);
  });

  test('renameFolder はサブフォルダと配下ノートも更新', () => {
    insertFolder('old');
    insertFolder('old/sub');
    insertNote(makeNote('n1', { folder: 'old' }));
    insertNote(makeNote('n2', { folder: 'old/sub' }));
    insertNote(makeNote('n3', { folder: 'other' }));

    renameFolder('old', 'new');

    expect(listFolders().sort()).toEqual(['new', 'new/sub']);
    expect(getNote('n1')?.folder).toBe('new');
    expect(getNote('n2')?.folder).toBe('new/sub');
    expect(getNote('n3')?.folder).toBe('other');
  });

  test('deleteFolderRecursive は配下ノートの id を返す', () => {
    insertFolder('drop');
    insertFolder('drop/deep');
    insertNote(makeNote('a', { folder: 'drop' }));
    insertNote(makeNote('b', { folder: 'drop/deep' }));
    insertNote(makeNote('c', { folder: 'keep' }));

    const ids = deleteFolderRecursive('drop');

    expect(ids.sort()).toEqual(['a', 'b']);
    expect(listFolders()).toEqual([]);
    expect(getNote('a')).toBeNull();
    expect(getNote('b')).toBeNull();
    expect(getNote('c')).not.toBeNull();
  });

  test('保護ノートがあると deleteFolderRecursive は例外', () => {
    insertFolder('locked');
    insertNote(makeNote('p', { folder: 'locked', protected: true }));
    expect(() => deleteFolderRecursive('locked')).toThrow();
    // ロールバック確認: ノートもフォルダも残っている
    expect(getNote('p')).not.toBeNull();
    expect(listFolders()).toEqual(['locked']);
  });
});

describe('settings DB', () => {
  test('set → getAll のラウンドトリップ', () => {
    setSetting('foo', 'bar');
    setSetting('num', '42');
    const all = getAllSettings();
    expect(all.foo).toBe('bar');
    expect(all.num).toBe('42');
  });

  test('同じキーへの再保存で上書き', () => {
    setSetting('k', 'v1');
    setSetting('k', 'v2');
    expect(getAllSettings().k).toBe('v2');
  });
});
