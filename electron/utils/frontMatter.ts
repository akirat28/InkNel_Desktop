/**
 * Markdown ノートに YAML front-matter を埋め込んでメタ情報をディスクに残す。
 *
 * 形式:
 * ```
 * ---
 * title: 買い物リスト
 * folder: work/ideas
 * tags: [家事, 急ぎ]
 * protected: false
 * secret: false
 * linked_note_ids: [uuid-a, uuid-b]
 * created_at: 1712800000000
 * updated_at: 1712850000000
 * ---
 *
 * # 本文...
 * ```
 *
 * iOS 版と PC 版で同じ書式を読み書きすることで、フォルダ階層・タグ・
 * 保護フラグまで端末間で完全同期できる。
 *
 * 軽量な手書きパーサーで、`title / folder / protected / secret / created_at /
 * updated_at` のスカラーと、`tags / linked_note_ids` の単純なリスト（`[a, b, c]` または
 * 行頭 `- a` 形式）のみを扱う。一般的な YAML の全機能は対応しない。
 */

export interface NoteFrontMatter {
  title?: string;
  folder?: string;
  protected?: boolean;
  secret?: boolean;
  tags?: string[];
  linkedNoteIds?: string[];
  createdAt?: number;
  updatedAt?: number;
  /**
   * Tombstone (削除墓標) フラグ。true なら本ファイルは「削除済みノート」を
   * 表すスタブで、本文は空。クロスデバイス同期で「他環境で削除された」を
   * 伝播するために使う (物理的に .md を unlink すると相手環境が「DB ある /
   * MD 無し = 新規」と誤判定して再生成 → 復活してしまうため)。
   */
  deleted?: boolean;
  /** Tombstone がいつ作られたか (ms epoch) */
  deletedAt?: number;
}

// 閉じ `---` の後の改行と、続く空行（区切りの慣例）を 1 行ぶんまで吸収する。
// `(?:\r?\n)?` で空行があれば 1 つだけ消費し、本文が `# Heading` から始まるようにする。
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n(?:\r?\n)?/;

/**
 * 本文先頭の `---\n...\n---` を切り出してメタとボディを返す。
 * front-matter が無ければ `meta = {}` で全体を body として返す。
 */
export function parseFrontMatter(raw: string): {
  meta: NoteFrontMatter;
  body: string;
} {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { meta: {}, body: raw ?? '' };
  }
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) return { meta: {}, body: raw };

  const yamlBlock = match[1];
  const body = raw.slice(match[0].length);
  const meta = parseMiniYaml(yamlBlock);
  return { meta, body };
}

/**
 * meta + body を front-matter 付き Markdown 文字列に整形する。
 * 主要フィールドのみシリアライズし、未指定 (undefined) は出力しない。
 */
export function serializeFrontMatter(
  meta: NoteFrontMatter,
  body: string,
): string {
  const lines: string[] = ['---'];
  if (meta.title !== undefined) lines.push(`title: ${escapeYaml(meta.title)}`);
  if (meta.folder !== undefined)
    lines.push(`folder: ${escapeYaml(meta.folder)}`);
  if (meta.tags !== undefined) {
    if (meta.tags.length === 0) {
      lines.push('tags: []');
    } else {
      lines.push(
        `tags: [${meta.tags.map((t) => escapeYaml(t)).join(', ')}]`,
      );
    }
  }
  if (meta.linkedNoteIds !== undefined) {
    if (meta.linkedNoteIds.length === 0) {
      lines.push('linked_note_ids: []');
    } else {
      lines.push(
        `linked_note_ids: [${meta.linkedNoteIds.map((id) => escapeYaml(id)).join(', ')}]`,
      );
    }
  }
  if (meta.protected !== undefined)
    lines.push(`protected: ${meta.protected ? 'true' : 'false'}`);
  if (meta.secret !== undefined)
    lines.push(`secret: ${meta.secret ? 'true' : 'false'}`);
  if (meta.createdAt !== undefined)
    lines.push(`created_at: ${meta.createdAt}`);
  if (meta.updatedAt !== undefined)
    lines.push(`updated_at: ${meta.updatedAt}`);
  if (meta.deleted !== undefined)
    lines.push(`deleted: ${meta.deleted ? 'true' : 'false'}`);
  if (meta.deletedAt !== undefined)
    lines.push(`deleted_at: ${meta.deletedAt}`);
  lines.push('---');
  // 本文との間に必ず 1 空行を入れる（先頭が空行で始まっていれば追加しない）
  const sep = body.startsWith('\n') ? '' : '\n';
  return lines.join('\n') + '\n' + sep + body;
}

/**
 * 軽量な YAML パーサー。本仕様で必要な範囲のみサポート。
 * - スカラー: `key: value`（クォート任意）
 * - bool: `true / false`（小文字）
 * - 数値: 整数のみ
 * - 配列インライン: `tags: [a, b, c]`
 * - 配列ブロック:
 *     tags:
 *       - a
 *       - b
 */
function parseMiniYaml(yaml: string): NoteFrontMatter {
  const meta: NoteFrontMatter = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) {
      i++;
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (key === 'tags' || key === 'linked_note_ids' || key === 'linkedNoteIds') {
      // インライン形式 [a, b, c]
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1).trim();
        const arr = inner.length === 0
          ? []
          : inner.split(',').map((s) => unquote(s.trim())).filter((s) => s.length > 0);
        if (key === 'tags') meta.tags = arr;
        else meta.linkedNoteIds = arr;
        i++;
        continue;
      }
      // ブロック形式: 後続の `- xxx` を集める
      if (rawValue.length === 0) {
        const collected: string[] = [];
        i++;
        while (i < lines.length) {
          const sub = lines[i];
          const subTrim = sub.trim();
          if (subTrim.startsWith('- ')) {
            collected.push(unquote(subTrim.slice(2).trim()));
            i++;
            continue;
          }
          if (subTrim.length === 0) {
            i++;
            continue;
          }
          break;
        }
        if (key === 'tags') meta.tags = collected;
        else meta.linkedNoteIds = collected;
        continue;
      }
      // 単一値（保険）
      if (key === 'tags') meta.tags = [unquote(rawValue)];
      else meta.linkedNoteIds = [unquote(rawValue)];
      i++;
      continue;
    }

    const value = unquote(rawValue);
    switch (key) {
      case 'title':
        meta.title = value;
        break;
      case 'folder':
        meta.folder = value;
        break;
      case 'protected':
        meta.protected = value === 'true';
        break;
      case 'secret':
        meta.secret = value === 'true';
        break;
      case 'created_at':
      case 'createdAt': {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) meta.createdAt = n;
        break;
      }
      case 'updated_at':
      case 'updatedAt': {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) meta.updatedAt = n;
        break;
      }
      case 'deleted':
        meta.deleted = value === 'true';
        break;
      case 'deleted_at':
      case 'deletedAt': {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) meta.deletedAt = n;
        break;
      }
      default:
        // 未知のキーは無視
        break;
    }
    i++;
  }
  return meta;
}

/** YAML 値の前後クォートを除去する（"x" / 'x' / x のいずれにも対応） */
function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
  }
  return s;
}

/**
 * YAML 値の出力時エスケープ。フラット文字列は基本クォート不要だが、
 * 含まれる文字によっては YAML 上で曖昧になるので必要に応じてダブルクォートで包む。
 */
function escapeYaml(s: string): string {
  if (s.length === 0) return '""';
  // 制御文字 / コロン / # / ブラケット / 引用符 / 行頭の特殊記号 などはクォート
  if (/[:#\[\]{},'"\n\r]/.test(s) || /^[!&*|>%@`-]/.test(s) || /^\s|\s$/.test(s)) {
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  // bool / null と紛らわしい裸の文字列もクォート
  if (
    s === 'true' ||
    s === 'false' ||
    s === 'null' ||
    s === 'yes' ||
    s === 'no'
  ) {
    return `"${s}"`;
  }
  return s;
}
