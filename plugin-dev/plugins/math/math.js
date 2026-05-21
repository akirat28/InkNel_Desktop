/**
 * Math (TeX) プラグイン (DL 版 / ランタイムロード対応)
 *
 * ```math コードブロックを TeX 記法で記述するとブロック数式として描画する。
 * KaTeX 本体と CSS は初回プレビュー時に CDN から動的読み込みする
 * (Mermaid プラグインと同じパターン)。
 *
 * 例:
 *   ```math
 *   \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
 *   ```
 */

const KATEX_VERSION = '0.16.10';
const KATEX_JS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`;
const KATEX_CSS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

let katexPromise = null;
let cssPromise = null;

/**
 * KaTeX 公式 CSS を CDN から fetch し、<style> として head に注入する。
 *
 * 当初は <link rel="stylesheet"> で読み込んでいたが、Electron 環境では
 * file:// オリジンや mixed-content の影響で link 経由の読み込みが
 * 失敗するケースがあった (失敗時は .katex-html がフォント無しで
 * 素のテキストとして表示される)。fetch + inline style なら CORS の
 * 影響を受けず、読み込み完了を await で待ってから render できる。
 *
 * 失敗時は最低限の "katex-mathml を隠す" critical CSS だけは入れて、
 * 二重表示は防ぐ。
 */
function ensureCss() {
  if (cssPromise) return cssPromise;
  const STYLE_ID = 'inknel-math-katex-css';
  if (document.getElementById(STYLE_ID)) {
    cssPromise = Promise.resolve();
    return cssPromise;
  }
  cssPromise = (async () => {
    try {
      const res = await fetch(KATEX_CSS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cssText = await res.text();
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = cssText;
      document.head.appendChild(style);
    } catch (err) {
      console.warn('[math] KaTeX CSS load failed, using minimal fallback', err);
      // フォールバック: せめて mathml の二重表示だけは隠す
      const style = document.createElement('style');
      style.id = STYLE_ID + '-fallback';
      style.textContent = `
.katex .katex-mathml {
  position: absolute;
  clip: rect(1px, 1px, 1px, 1px);
  padding: 0;
  border: 0;
  height: 1px;
  width: 1px;
  overflow: hidden;
}
`;
      document.head.appendChild(style);
    }
  })();
  return cssPromise;
}

async function loadKatex() {
  if (!katexPromise) {
    katexPromise = import(/* @vite-ignore */ KATEX_JS).then((m) => m.default);
  }
  // CSS と JS を並行で待つ
  await Promise.all([katexPromise, ensureCss()]);
  return katexPromise;
}

function escape(s) {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export const manifest = {
  id: 'math',
  label: 'Math (TeX)',
  description:
    '```math コードブロックを TeX 記法で書くと KaTeX で数式として描画します。KaTeX 本体は初回プレビュー時に CDN から動的読み込み。',
};

export const renderFence = ({ code, lang }) => {
  if (lang.toLowerCase() !== 'math') return null;
  // 中身は空にして「KaTeX 読み込み中に raw source 文字列が見えてしまう」状態を回避。
  // 描画失敗時に source へ戻したい時は data 属性から復元する。
  return `<div class="math-block" data-math-source="${encodeURIComponent(code)}"></div>`;
};

export const renderInPreview = async (root) => {
  const blocks = root.querySelectorAll(
    '.math-block:not([data-math-rendered])',
  );
  if (blocks.length === 0) return;
  let katex;
  try {
    katex = await loadKatex();
  } catch (err) {
    for (const el of blocks) {
      if (!el.isConnected) continue;
      el.innerHTML =
        '<pre class="math-block__error">KaTeX の読み込みに失敗しました: ' +
        escape(err instanceof Error ? err.message : String(err)) +
        '</pre>';
      el.setAttribute('data-math-rendered', 'error');
    }
    return;
  }
  for (const el of blocks) {
    if (!el.isConnected) continue;
    const source = decodeURIComponent(
      el.getAttribute('data-math-source') ?? '',
    );
    try {
      // renderToString → innerHTML 代入で確実に中身を全置換する。
      // (katex.render(src, el) は環境によって既存 text ノードが残ることがあるため)
      const html = katex.renderToString(source, {
        displayMode: true,
        throwOnError: false,
        strict: 'ignore',
      });
      el.innerHTML = html;
      el.setAttribute('data-math-rendered', 'true');
    } catch (err) {
      el.innerHTML =
        '<pre class="math-block__error">数式エラー: ' +
        escape(err instanceof Error ? err.message : String(err)) +
        '</pre>';
      el.setAttribute('data-math-rendered', 'error');
    }
  }
};

export const resetInPreview = (root) => {
  root
    .querySelectorAll('.math-block[data-math-rendered]')
    .forEach((el) => {
      el.removeAttribute('data-math-rendered');
      // 再描画前に中身を空にする (source は data 属性側に保持)。
      // textContent に source を戻すと renderInPreview 完了までの一瞬
      // raw 文字列が見えてしまうので、空のままにする。
      el.innerHTML = '';
    });
};

/**
 * エディタツールバー末尾に追加されるボタン定義。
 * クリックで TeX 数式ブロックの雛形を挿入する。
 */
export const toolbarButtons = [
  {
    id: 'math-insert',
    label: '数式 (TeX) を挿入',
    // TeX 風ロゴ (T / 下げた E / 上げた X)
    icon:
      '<svg width="22" height="14" viewBox="0 0 22 14" fill="currentColor" stroke="none" aria-hidden="true">' +
      '<text x="0" y="11" font-family="Times New Roman, Times, serif" font-size="12" font-weight="700">' +
      '<tspan>T</tspan>' +
      '<tspan dy="3" font-size="11">E</tspan>' +
      '<tspan dy="-3">X</tspan>' +
      '</text>' +
      '</svg>',
    onClick({ insert }) {
      insert(
        '\n```math\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n```\n',
      );
    },
  },
];
