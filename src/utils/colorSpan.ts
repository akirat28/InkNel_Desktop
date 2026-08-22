/**
 * ノート本文で文字色 / 文字背景色を指定するための
 * `<span style="color:...">` 記法サポート。
 *
 * ```md
 * <span style="color:red">赤い文字</span>
 * <span style="background-color:#ffe0e0">薄い赤の背景</span>
 * <span style="color:#fff;background-color:navy">白抜き</span>
 * ```
 *
 * プレビューの MarkdownIt は `html: false` で生 HTML を無効化しており、
 * これは `dangerouslySetInnerHTML` で描画している以上、外部から来た .md
 * (クラウド同期 / インポート) に `<script>` や `onerror=` が混ざったときの
 * 防御線として維持したい。
 *
 * そのため「HTML を有効化する」のではなく、
 * **color / background-color だけを持つ span に限定した専用インラインルール**
 * を追加する方式を採る。値も厳格に検証し、少しでも想定外なら
 * マッチさせず (= 素のテキストとしてエスケープ表示) にフォールバックする。
 */
import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` */
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** `red` / `transparent` / `currentcolor` などの名前付き色 */
const NAMED_RE = /^[a-z]{3,24}$/i;
/** `rgb(...)` / `rgba(...)` / `hsl(...)` / `hsla(...)` — 中身は数値と区切りのみ */
const FUNC_RE =
  /^(?:rgba?|hsla?)\(\s*[0-9.,%\s/+-]+(?:deg\s*[0-9.,%\s/+-]*)?\)$/i;

/** 開始タグ。style 属性ひとつだけを許可する (他の属性が付いていたら不一致) */
const OPEN_RE = /^<span\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>/i;
const CLOSE_TAG = '</span>';

/** style 値として安全に出力してよい色表現か */
function isSafeColor(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 64) return false;
  return HEX_RE.test(v) || NAMED_RE.test(v) || FUNC_RE.test(v);
}

/**
 * style 属性文字列を検証し、正規化した宣言列を返す。
 * color / background-color 以外のプロパティが 1 つでも含まれていたら null
 * (= この span を色指定として扱わない)。
 */
export function normalizeColorStyle(raw: string): string | null {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const decl of raw.split(';')) {
    const text = decl.trim();
    if (!text) continue;
    const sep = text.indexOf(':');
    if (sep < 0) return null;
    const prop = text.slice(0, sep).trim().toLowerCase();
    const value = text.slice(sep + 1).trim();
    if (prop !== 'color' && prop !== 'background-color') return null;
    if (seen.has(prop)) return null;
    if (!isSafeColor(value)) return null;
    seen.add(prop);
    out.push(`${prop}:${value}`);
  }
  return out.length > 0 ? out.join(';') : null;
}

/**
 * `contentStart` から対応する `</span>` を探し、その開始位置を返す。
 * 入れ子の `<span ...>` を数えるので、ネストしていても正しい相手を返す。
 * 見つからなければ -1。
 */
function findMatchingClose(
  src: string,
  contentStart: number,
  max: number,
): number {
  let depth = 1;
  let i = contentStart;
  while (i < max) {
    if (src.charCodeAt(i) === 0x3c /* < */) {
      if (src.slice(i, i + CLOSE_TAG.length).toLowerCase() === CLOSE_TAG) {
        depth -= 1;
        if (depth === 0) return i;
        i += CLOSE_TAG.length;
        continue;
      }
      if (/^<span[\s>]/i.test(src.slice(i, i + 6))) {
        depth += 1;
        i += 5;
        continue;
      }
    }
    i += 1;
  }
  return -1;
}

/**
 * テキストに含まれる色指定 span (color / background-color のみのもの) を
 * すべて外して中身だけにする。ツールバーの「色を解除」で使う。
 * 色指定として妥当でない span や、対応する閉じタグが無いものは触らない。
 */
export function stripColorSpans(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x3c /* < */) {
      const m = OPEN_RE.exec(text.slice(i));
      if (m && normalizeColorStyle(m[1] ?? m[2] ?? '')) {
        const contentStart = i + m[0].length;
        const closeAt = findMatchingClose(text, contentStart, text.length);
        if (closeAt >= 0) {
          // 中身も再帰的に処理して入れ子の色指定を外す
          out += stripColorSpans(text.slice(contentStart, closeAt));
          i = closeAt + CLOSE_TAG.length;
          continue;
        }
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * インラインルール本体。
 * 開始タグから対応する閉じタグまでを 1 度に消費し、中身は通常のインライン
 * パーサに再帰的に処理させる (markdown-it の link ルールと同じ手法)。
 * こうすることで open / close が必ず対で出力され、不整合な HTML にならない。
 * 対応する閉じタグが無い場合はマッチしないので、素のテキストとして表示される。
 */
function colorSpanRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3c /* < */) return false;

  const m = OPEN_RE.exec(src.slice(start, state.posMax));
  if (!m) return false;

  const style = normalizeColorStyle(m[1] ?? m[2] ?? '');
  if (!style) return false;

  const contentStart = start + m[0].length;
  const contentEnd = findMatchingClose(src, contentStart, state.posMax);
  if (contentEnd < 0) return false;

  if (silent) {
    state.pos = contentEnd + CLOSE_TAG.length;
    return true;
  }

  const open = state.push('color_span_open', 'span', 1);
  open.attrSet('style', style);
  open.markup = m[0];

  // 中身を通常のインラインパーサに処理させる
  const oldPos = state.pos;
  const oldMax = state.posMax;
  state.pos = contentStart;
  state.posMax = contentEnd;
  state.md.inline.tokenize(state);
  state.pos = oldPos;
  state.posMax = oldMax;

  const close = state.push('color_span_close', 'span', -1);
  close.markup = CLOSE_TAG;

  state.pos = contentEnd + CLOSE_TAG.length;
  return true;
}

/**
 * MarkdownIt プラグイン。`md.use(colorSpanPlugin)` で有効化する。
 * autolink (`<http://...>`) / html_inline より前に差し込む。
 */
export function colorSpanPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('autolink', 'color_span', colorSpanRule);
}

/** ツールバーの文字色パレット */
export const TEXT_COLOR_PALETTE: readonly { label: string; value: string }[] = [
  { label: '赤', value: '#e74c3c' },
  { label: '朱色', value: '#ff6b35' },
  { label: 'オレンジ', value: '#f39c12' },
  { label: '黄土色', value: '#b8860b' },
  { label: '緑', value: '#27ae60' },
  { label: '深緑', value: '#1e7a4d' },
  { label: '青', value: '#3498db' },
  { label: '紺', value: '#1f4e9c' },
  { label: '紫', value: '#8e44ad' },
  { label: 'ピンク', value: '#e91e8c' },
  { label: '茶', value: '#8d5524' },
  { label: 'グレー', value: '#7f8c8d' },
  { label: '黒', value: '#000000' },
  { label: '白', value: '#ffffff' },
];

/** ツールバーの文字背景色パレット (マーカー想定で淡い色を中心に) */
export const BG_COLOR_PALETTE: readonly { label: string; value: string }[] = [
  { label: '黄色', value: 'yellow' },
  { label: '薄い黄', value: '#fff2a8' },
  { label: '薄い赤', value: '#ffe0e0' },
  { label: '薄いオレンジ', value: '#ffe6cc' },
  { label: '薄い緑', value: '#dcf5e3' },
  { label: '薄い青', value: '#dceafc' },
  { label: '薄い紫', value: '#ece0f8' },
  { label: '薄いピンク', value: '#fde0ef' },
  { label: '薄いグレー', value: '#e8e8e8' },
  { label: 'ライム', value: '#c6f68d' },
  { label: 'シアン', value: '#b8f0f0' },
  { label: '赤', value: '#e74c3c' },
  { label: '青', value: '#3498db' },
  { label: '黒', value: '#000000' },
];
