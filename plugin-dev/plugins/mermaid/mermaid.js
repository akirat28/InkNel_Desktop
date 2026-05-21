/**
 * Mermaid プラグイン (DL 版 / ランタイムロード対応)
 *
 * このファイルは InkNel のプラグインローダによって、
 *   userData/plugins/mermaid.js
 * から Blob URL 経由で動的 import される。
 *
 * mermaid 本体は CDN から動的 import するので、配布ファイルは小さい。
 * 初回プレビュー時にだけ CDN から ~600KB をダウンロードして以降キャッシュ。
 */

const MERMAID_CDN =
  'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

let mermaidPromise = null;
/**
 * mermaid.render() は内部で document.body に一時要素を挿入して D3 で測定する。
 * 同時に複数走らせると内部状態が競合し
 *   "Could not find a suitable point for the given distance"
 * を投げることがあるので、プロセス全体で 1 本のキューに直列化する。
 */
let renderQueue = Promise.resolve();
/**
 * Date.now() ベースの ID は同一ミリ秒内に Preview が再 mount された場合に
 * 衝突しうる。`#dmermaid-XXX` を共用すると mermaid の内部キャッシュにヒット
 * して描画が壊れる（D3 が前回の壊れたパス計算を再利用する）ことがあるので、
 * モジュールスコープのモノトニックカウンタで一意性を保証する。
 */
let nextRenderId = 0;

async function loadMermaid(theme) {
  if (!mermaidPromise) {
    mermaidPromise = import(MERMAID_CDN).then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  // ビュー切替の度に Preview が再 mount されるが、mermaid の内部状態は
  // モジュールに残ったままになる。状態の不整合（D3 が「前回の描画ターン」
  // 由来の参照を引きずって `getPointAtLength` が 0 長 path を返す等）を
  // 避けるため毎回 initialize() を呼ぶ。idempotent。
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    // strict は iframe sandbox を毎回作るためコスト/タイミング不安定。
    // loose だと描画速度・安定性が改善する（ノート本文は信頼できる前提）。
    securityLevel: 'loose',
    fontFamily:
      'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  });
  return mermaid;
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

/** 次フレームまで待つ (RAF 2 回でレイアウト/スタイル計算の完了を待つ) */
function waitForFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

/**
 * Mermaid 内部 (D3) はフォント未ロードや非同期レイアウト中に
 * `getPointAtLength()` 等が 0 長 path を返し
 *   "Could not find a suitable point for the given distance"
 * を投げることがある。RAF を挟んで 1 回だけ再試行する。
 */
async function renderWithRetry(mermaid, baseId, source) {
  try {
    return await mermaid.render(baseId, source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/suitable point|getBBox|getPointAtLength/i.test(msg)) {
      throw err;
    }
    // レイアウト/フォント関係の一時的エラー → 残骸を掃除して次フレーム再試行
    cleanupMermaidLeftovers(baseId);
    await waitForFrame();
    return await mermaid.render(`${baseId}-r`, source);
  }
}

/** mermaid.render() をキューに繋げて直列実行する */
function enqueueRender(mermaid, id, source) {
  const next = renderQueue.then(() => renderWithRetry(mermaid, id, source));
  // 失敗もキューに残してフロー継続させる
  renderQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export const manifest = {
  id: 'mermaid',
  label: 'Mermaid',
  description:
    '```mermaid コードブロックを、シーケンス図 / フローチャート / ER 図 / ガントチャート等として描画します。Mermaid 本体は初回プレビュー時に CDN から動的に読み込みます。',
};

export const renderFence = ({ code, lang, escapeHtml }) => {
  if (lang.toLowerCase() !== 'mermaid') return null;
  return (
    `<div class="mermaid-block" data-mermaid-source="${encodeURIComponent(code)}">` +
    escapeHtml(code) +
    `</div>`
  );
};

export const renderInPreview = async (root, { theme }) => {
  const blocks = root.querySelectorAll(
    '.mermaid-block:not([data-mermaid-rendered])',
  );
  if (blocks.length === 0) return;

  const mermaid = await loadMermaid(theme);

  // フォント未確定だと D3 が text 幅を 0 と計算してしまい、エッジパス長が
  // 0 になり "Could not find a suitable point" を投げることがある。
  // フォント読み込み完了とレイアウト確定を待つ。
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch {
    // 一部環境で document.fonts が無い場合は無視
  }
  await waitForFrame();

  // 並列描画は mermaid v11 で内部状態の競合を引き起こすことがあるため、
  //  逐次 (for...of + await) に変更する。さらにモジュール全体でも
  //  enqueueRender でキュー直列化することで、複数 Preview インスタンスや
  //  ビュー切替直後の再描画と競合しないようにする。
  for (const el of blocks) {
    const source = decodeURIComponent(
      el.getAttribute('data-mermaid-source') ?? '',
    );
    // モジュールスコープのモノトニックカウンタで一意 ID。
    //  Date.now() ベースだと再 mount 時の衝突で前回の描画キャッシュを
    //  引き継いで失敗することがあった。
    const id = `mermaid-${++nextRenderId}`;
    try {
      const { svg, bindFunctions } = await enqueueRender(mermaid, id, source);
      // この描画ターン中に DOM から切り離されていた場合（ビュー切替で
      //   Preview がアンマウントされた等）は何もしない
      if (!el.isConnected) continue;
      el.innerHTML = svg;
      bindFunctions?.(el);
      el.setAttribute('data-mermaid-rendered', 'true');
    } catch (err) {
      if (!el.isConnected) continue;
      const msg = err instanceof Error ? err.message : String(err);
      el.innerHTML =
        `<pre class="mermaid-block__error">Mermaid 描画エラー: ` +
        `${escape(msg)}</pre>`;
      el.setAttribute('data-mermaid-rendered', 'error');
    } finally {
      // mermaid v11 は構文エラー時に document.body 直下へ
      // 「Syntax error in text / mermaid version …」を含む一時要素を
      // 残すことがあるため、ここで明示的に除去する。
      cleanupMermaidLeftovers(id);
    }
  }
  // 取りこぼし対策: ID で特定できなかった残骸（mermaid 内部で生成された
  // 別 ID の error SVG / tooltip 等）も最後にまとめて掃除する
  cleanupMermaidLeftovers();
};

/**
 * mermaid.render() が document.body 直下に残す一時要素を除去。
 * id を渡せばその id に紐づくものだけ、未指定なら mermaid 関連すべてを掃除する。
 */
function cleanupMermaidLeftovers(id) {
  const selectors = id
    ? [
        `body > #d${id}`,
        `body > #${id}`,
        `body > svg#${id}`,
        `body > #d${id}-r`,
        `body > #${id}-r`,
        `body > svg#${id}-r`,
      ]
    : [
        'body > div[id^="dmermaid-"]',
        'body > svg[id^="mermaid-"]',
        'body > .mermaidTooltip',
        'body > .mermaid',
      ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((n) => {
      if (n.parentElement === document.body) n.remove();
    });
  }
}

export const resetInPreview = (root) => {
  root
    .querySelectorAll('.mermaid-block[data-mermaid-rendered]')
    .forEach((el) => {
      el.removeAttribute('data-mermaid-rendered');
      const source = decodeURIComponent(
        el.getAttribute('data-mermaid-source') ?? '',
      );
      el.textContent = source;
    });
};

/**
 * エディタツールバー末尾に追加されるボタン定義。
 * 有効化されているとホストがツールバー末尾に自動表示する。
 */
export const toolbarButtons = [
  {
    id: 'mermaid-insert',
    label: 'Mermaid 図を挿入',
    icon:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="1" y="3" width="5" height="3.5" rx="0.6" />' +
      '<rect x="10" y="3" width="5" height="3.5" rx="0.6" />' +
      '<rect x="5.5" y="9.5" width="5" height="3.5" rx="0.6" />' +
      '<path d="M3.5 6.5 L 6.5 9.5 M 12.5 6.5 L 9.5 9.5" />' +
      '</svg>',
    onClick({ insert }) {
      insert(
        '\n```mermaid\nflowchart LR\n  A[開始] --> B{条件}\n  B -->|Yes| C[処理1]\n  B -->|No| D[処理2]\n```\n',
      );
    },
  },
];
