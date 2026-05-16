import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import {
  cleanupAllUserDataDirs,
  newUserDataDir,
} from './helpers';
import {
  saveImage,
  imageExists,
  imagePath,
  deleteImage,
  IMAGE_FILENAME_PATTERN,
} from '../electron/storage/imagesFiles';
import {
  saveAttachment,
  attachmentExists,
  attachmentPath,
  deleteAttachment,
  ATTACHMENT_FILENAME_PATTERN,
} from '../electron/storage/attachmentsFiles';
import {
  readBody,
  writeBody,
  deleteBody,
} from '../electron/storage/notesFiles';

beforeEach(() => {
  newUserDataDir();
});

afterAll(() => {
  cleanupAllUserDataDirs();
});

describe('imagesFiles', () => {
  test('saveImage は sha256.ext 形式のファイル名を返す', () => {
    const buf = Buffer.from('hello world');
    const name = saveImage(buf, 'png');
    expect(name).toMatch(IMAGE_FILENAME_PATTERN);
    expect(name.endsWith('.png')).toBe(true);
    expect(existsSync(imagePath(name))).toBe(true);
  });

  test('同じバイナリは dedupe され同じファイル名になる', () => {
    const buf = Buffer.from('same content');
    const a = saveImage(buf, 'png');
    const b = saveImage(buf, 'png');
    expect(a).toBe(b);
  });

  test('異なるバイナリは別のファイル名になる', () => {
    const a = saveImage(Buffer.from('a'), 'png');
    const b = saveImage(Buffer.from('b'), 'png');
    expect(a).not.toBe(b);
  });

  test('allowlist 外の拡張子は .bin にフォールバック', () => {
    const name = saveImage(Buffer.from('x'), 'exe');
    expect(name.endsWith('.bin')).toBe(true);
  });

  test('拡張子の . プレフィックスを許容する', () => {
    const name = saveImage(Buffer.from('x'), '.JPG');
    expect(name.endsWith('.jpg')).toBe(true);
  });

  test('不正なファイル名は imagePath で例外', () => {
    expect(() => imagePath('../../../etc/passwd')).toThrow();
    expect(() => imagePath('notahash.png')).toThrow();
  });

  test('imageExists は存在しないファイル名で false', () => {
    expect(imageExists('nosuch.png')).toBe(false);
    expect(imageExists('../escape.png')).toBe(false);
  });

  test('deleteImage は冪等（存在しないファイル名でも例外を出さない）', () => {
    const name = saveImage(Buffer.from('delete me'), 'png');
    deleteImage(name);
    expect(imageExists(name)).toBe(false);
    // 再度呼んでも例外を出さない
    expect(() => deleteImage(name)).not.toThrow();
    // 不正名も no-op
    expect(() => deleteImage('bad/name.png')).not.toThrow();
  });
});

describe('attachmentsFiles', () => {
  test('saveAttachment は sha256.ext 形式を返す', () => {
    const name = saveAttachment(Buffer.from('pdf data'), 'pdf');
    expect(name).toMatch(ATTACHMENT_FILENAME_PATTERN);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  test('allowlist 外の拡張子は .bin にフォールバック', () => {
    const name = saveAttachment(Buffer.from('x'), 'exe');
    expect(name.endsWith('.bin')).toBe(true);
  });

  test('attachmentPath は不正ファイル名で例外', () => {
    expect(() => attachmentPath('../../escape.pdf')).toThrow();
  });

  test('保存したファイルが消せる', () => {
    const name = saveAttachment(Buffer.from('z'), 'zip');
    expect(attachmentExists(name)).toBe(true);
    deleteAttachment(name);
    expect(attachmentExists(name)).toBe(false);
  });
});

describe('notesFiles', () => {
  test('writeBody / readBody のラウンドトリップ', () => {
    writeBody('note-1', '# Hello\nbody');
    expect(readBody('note-1')).toBe('# Hello\nbody');
  });

  test('存在しないノートの readBody は空文字列', () => {
    expect(readBody('nosuch')).toBe('');
  });

  test('deleteBody は冪等', () => {
    writeBody('note-x', 'x');
    deleteBody('note-x');
    expect(readBody('note-x')).toBe('');
    // 2 回目も例外なし
    expect(() => deleteBody('note-x')).not.toThrow();
  });

});
