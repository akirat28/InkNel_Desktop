import { describe, test, expect } from 'vitest';
import './helpers'; // electron のモックをロード
import { normalizeFolderPath } from '../electron/ipc';

describe('normalizeFolderPath', () => {
  test('通常パスはそのまま', () => {
    expect(normalizeFolderPath('a/b/c')).toBe('a/b/c');
  });

  test('前後スラッシュと連続スラッシュを畳み込む', () => {
    expect(normalizeFolderPath('/a//b/c/')).toBe('a/b/c');
  });

  test('空文字列は空文字列', () => {
    expect(normalizeFolderPath('')).toBe('');
    expect(normalizeFolderPath('   ')).toBe('');
    expect(normalizeFolderPath('///')).toBe('');
  });

  test('各セグメントの前後空白を除去する', () => {
    expect(normalizeFolderPath(' a / b / c ')).toBe('a/b/c');
  });

  test('`.` / `..` セグメントを除外する（パストラバーサル対策）', () => {
    expect(normalizeFolderPath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizeFolderPath('a/../b')).toBe('a/b');
    expect(normalizeFolderPath('./a/./b')).toBe('a/b');
    expect(normalizeFolderPath('../..')).toBe('');
  });

  test('バックスラッシュを含むセグメントを除外する', () => {
    // `/` 区切りで分割 → バックスラッシュを含むセグメントは丸ごと除外
    expect(normalizeFolderPath('a\\b/c')).toBe('c');
    // バックスラッシュ混じりの 1 セグメントは全除外 → 空文字列
    expect(normalizeFolderPath('..\\..\\etc')).toBe('');
    expect(normalizeFolderPath('foo/bar\\baz/qux')).toBe('foo/qux');
  });

  test('非文字列入力は空文字列を返す', () => {
    // @ts-expect-error 意図的に不正な型を渡す
    expect(normalizeFolderPath(null)).toBe('');
    // @ts-expect-error
    expect(normalizeFolderPath(undefined)).toBe('');
    // @ts-expect-error
    expect(normalizeFolderPath(123)).toBe('');
  });

  test('日本語パスもそのまま通る', () => {
    expect(normalizeFolderPath('階層1/サブ/孫')).toBe('階層1/サブ/孫');
  });
});
