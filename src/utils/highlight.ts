/**
 * シンタックスハイライト用のユーティリティ。
 * highlight.js のコアに、サポートしたい言語だけを明示的に登録する
 * （バンドルサイズを抑えるため `lib/core` を使う）。
 *
 * `SUPPORTED_HIGHLIGHT_LANGS` がアプリ全体での「サポート対象言語の唯一の真実」。
 * 設定画面の選択肢、Preview の言語解決、すべてここから生成する。
 */

import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

export interface HighlightLang {
  /** アプリ内部での識別子（hljs に登録する canonical 名） */
  id: string;
  /** 設定画面に表示する人間向けラベル */
  label: string;
  /**
   * ユーザーが ```xxx と書いたときに id にマップされる別名。
   * 大文字小文字は無視。id 自身もここに含める。
   */
  aliases: string[];
}

/** 設定画面で選択でき、Preview で実際に色付けされる言語の一覧 */
export const SUPPORTED_HIGHLIGHT_LANGS: HighlightLang[] = [
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'javascript', 'mjs', 'cjs'] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'typescript'] },
  { id: 'python', label: 'Python', aliases: ['py', 'python'] },
  { id: 'ruby', label: 'Ruby', aliases: ['rb', 'ruby'] },
  { id: 'go', label: 'Go', aliases: ['go', 'golang'] },
  { id: 'rust', label: 'Rust', aliases: ['rs', 'rust'] },
  { id: 'java', label: 'Java', aliases: ['java'] },
  { id: 'c', label: 'C', aliases: ['c', 'h'] },
  { id: 'cpp', label: 'C++', aliases: ['cpp', 'c++', 'cc', 'cxx', 'hpp'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'csharp', 'c#'] },
  { id: 'php', label: 'PHP', aliases: ['php'] },
  { id: 'swift', label: 'Swift', aliases: ['swift'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kotlin'] },
  { id: 'bash', label: 'Shell / Bash / sh', aliases: ['sh', 'bash', 'shell', 'zsh'] },
  { id: 'sql', label: 'SQL', aliases: ['sql'] },
  { id: 'json', label: 'JSON', aliases: ['json'] },
  { id: 'yaml', label: 'YAML', aliases: ['yaml', 'yml'] },
  { id: 'xml', label: 'HTML / XML', aliases: ['html', 'xml', 'svg', 'xhtml'] },
  { id: 'css', label: 'CSS', aliases: ['css'] },
  { id: 'scss', label: 'Sass / SCSS', aliases: ['scss', 'sass', 'less'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md', 'markdown', 'mkd'] },
  { id: 'dockerfile', label: 'Dockerfile', aliases: ['dockerfile', 'docker'] },
];

// hljs に各言語を登録（バンドル時にのみ実行）
const languageModules: Record<string, unknown> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const lang of SUPPORTED_HIGHLIGHT_LANGS) {
  const mod = languageModules[lang.id];
  if (mod) {
    // hljs の型が複雑なので any キャストで吸収
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hljs.registerLanguage(lang.id, mod as any);
  }
}

/** alias → canonical id の高速参照テーブル（小文字キー） */
const aliasToId = new Map<string, string>();
for (const lang of SUPPORTED_HIGHLIGHT_LANGS) {
  for (const alias of lang.aliases) {
    aliasToId.set(alias.toLowerCase(), lang.id);
  }
}

/**
 * fence の info 文字列（例: "js" "TypeScript" "c++"）からサポート対象 id を返す。
 * 一致するものが無ければ null。
 */
export function resolveHighlightLangId(info: string | undefined): string | null {
  if (!info) return null;
  const key = info.trim().toLowerCase().split(/\s+/)[0];
  if (!key) return null;
  return aliasToId.get(key) ?? null;
}

/**
 * 指定言語でコードをハイライトして HTML 文字列を返す。
 * 失敗時は null（呼び出し元で escape したプレーンレンダリングにフォールバック）。
 */
export function highlightCode(code: string, langId: string): string | null {
  try {
    return hljs.highlight(code, { language: langId, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

/** デフォルトで有効化する言語（=サポート全部） */
export const DEFAULT_ENABLED_HIGHLIGHT_LANGS: string[] =
  SUPPORTED_HIGHLIGHT_LANGS.map((l) => l.id);
