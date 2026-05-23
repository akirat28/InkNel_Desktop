import { describe, test, expect } from 'vitest';
import {
  parseFrontMatter,
  serializeFrontMatter,
  type NoteFrontMatter,
} from '../electron/utils/frontMatter';

describe('parseFrontMatter', () => {
  test('front-matter 無しは meta が空、body はそのまま', () => {
    const result = parseFrontMatter('# Hello\nbody');
    expect(result.meta).toEqual({});
    expect(result.body).toBe('# Hello\nbody');
  });

  test('スカラー値を読み取る', () => {
    const raw = [
      '---',
      'title: 買い物',
      'folder: work/ideas',
      'protected: true',
      'secret: false',
      'created_at: 1712800000000',
      'updated_at: 1712850000000',
      '---',
      '',
      '# 本文',
    ].join('\n');
    const { meta, body } = parseFrontMatter(raw);
    expect(meta.title).toBe('買い物');
    expect(meta.folder).toBe('work/ideas');
    expect(meta.protected).toBe(true);
    expect(meta.secret).toBe(false);
    expect(meta.createdAt).toBe(1712800000000);
    expect(meta.updatedAt).toBe(1712850000000);
    expect(body.startsWith('# 本文')).toBe(true);
  });

  test('インラインリスト形式の tags を読む', () => {
    const raw = '---\ntags: [家事, 急ぎ, "クォート付き"]\n---\nbody';
    const { meta, body } = parseFrontMatter(raw);
    expect(meta.tags).toEqual(['家事', '急ぎ', 'クォート付き']);
    expect(body).toBe('body');
  });

  test('空の tags リストは空配列', () => {
    const raw = '---\ntags: []\n---\nbody';
    expect(parseFrontMatter(raw).meta.tags).toEqual([]);
  });

  test('ブロック形式の tags を読む', () => {
    const raw = ['---', 'tags:', '  - a', '  - "b c"', '  - 漢字', '---', 'body'].join('\n');
    expect(parseFrontMatter(raw).meta.tags).toEqual(['a', 'b c', '漢字']);
  });

  test('linked_note_ids を読む', () => {
    const raw = [
      '---',
      'linked_note_ids:',
      '  - note-a',
      '  - note-b',
      '---',
      'body',
    ].join('\n');
    expect(parseFrontMatter(raw).meta.linkedNoteIds).toEqual([
      'note-a',
      'note-b',
    ]);
  });

  test('クォートで囲まれた値はアンクォートされる', () => {
    const raw = '---\ntitle: "コロン: 含む"\nfolder: \'シングル\'\n---\n';
    const { meta } = parseFrontMatter(raw);
    expect(meta.title).toBe('コロン: 含む');
    expect(meta.folder).toBe('シングル');
  });

  test('未知のキーは無視される', () => {
    const raw = '---\nunknown_field: x\ntitle: T\n---\nbody';
    const { meta } = parseFrontMatter(raw);
    expect(meta.title).toBe('T');
    expect((meta as Record<string, unknown>).unknown_field).toBeUndefined();
  });
});

describe('serializeFrontMatter', () => {
  test('全フィールド出力', () => {
    const meta: NoteFrontMatter = {
      title: 'タイトル',
      folder: 'a/b',
      tags: ['x', 'y'],
      linkedNoteIds: ['note-a', 'note-b'],
      protected: true,
      secret: false,
      createdAt: 100,
      updatedAt: 200,
    };
    const out = serializeFrontMatter(meta, '# Body');
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('title: タイトル');
    expect(out).toContain('folder: a/b');
    expect(out).toContain('tags: [x, y]');
    expect(out).toContain('linked_note_ids: [note-a, note-b]');
    expect(out).toContain('protected: true');
    expect(out).toContain('secret: false');
    expect(out).toContain('created_at: 100');
    expect(out).toContain('updated_at: 200');
    expect(out.endsWith('# Body')).toBe(true);
  });

  test('空 tags は []', () => {
    const out = serializeFrontMatter({ tags: [] }, 'b');
    expect(out).toContain('tags: []');
  });

  test('特殊文字を含むタイトルはダブルクォートで包む', () => {
    const out = serializeFrontMatter({ title: 'コロン: あり' }, '');
    expect(out).toContain('title: "コロン: あり"');
  });

  test('bool 風の文字列はクォート', () => {
    const out = serializeFrontMatter({ title: 'true' }, '');
    expect(out).toContain('title: "true"');
  });
});

describe('ラウンドトリップ', () => {
  test('serialize → parse で同一メタが復元される', () => {
    const meta: NoteFrontMatter = {
      title: 'テスト [角括弧] と "ダブル"',
      folder: 'work/ideas/2026',
      tags: ['日本語', 'a-b', 'space here'],
      linkedNoteIds: ['note-a', 'note-b'],
      protected: false,
      secret: true,
      createdAt: 1712800000000,
      updatedAt: 1712850000000,
    };
    const body = '# Heading\n\n本文 *italic* **bold**';
    const serialized = serializeFrontMatter(meta, body);
    const { meta: back, body: backBody } = parseFrontMatter(serialized);
    expect(back).toEqual(meta);
    expect(backBody).toBe(body);
  });

  test('front-matter 無しの旧ファイルも壊れず読める', () => {
    const raw = '# 古いノート\n本文だけ';
    const { meta, body } = parseFrontMatter(raw);
    expect(meta).toEqual({});
    expect(body).toBe(raw);
  });

  test('tombstone (deleted / deleted_at) のラウンドトリップ', () => {
    const meta: NoteFrontMatter = {
      deleted: true,
      deletedAt: 1712900000000,
      updatedAt: 1712900000000,
    };
    const serialized = serializeFrontMatter(meta, '');
    expect(serialized).toMatch(/deleted:\s*true/);
    expect(serialized).toMatch(/deleted_at:\s*1712900000000/);
    const { meta: back } = parseFrontMatter(serialized);
    expect(back.deleted).toBe(true);
    expect(back.deletedAt).toBe(1712900000000);
    expect(back.updatedAt).toBe(1712900000000);
  });
});
