/**
 * Mindmap プラグイン (ビュー編集対応)
 *
 * ```mindmap コードブロックを横方向ツリーのマインドマップとして描画し、
 * プレビュー上でノードの追加 / 削除 / リネーム / D&D 付け替え / 拡大縮小ができる。
 *
 * 編集結果はホスト側の ctx.setBody(newMarkdown) でノート本文に書き戻す。
 *
 * 本文ソース形式 (indented bullet list):
 *   ```mindmap
 *   - 中心トピック
 *     - 枝 1
 *       - 葉 1
 *       - 葉 2
 *     - 枝 2
 *   ```
 *
 * 1 ブロック内に最大 1 つの root を想定。ルート無しなら空文字列で初期化される。
 */

const INDENT = '  '; // 2 スペース 1 階層

/* ============================================================
 * 1. パーサ / シリアライザ
 * ============================================================ */

let nextNodeId = 0;
function newId() {
  return `mm-${++nextNodeId}`;
}

/**
 * Preview の root 要素を key に、各 ` ```mindmap ` ブロック (index) の
 * pan/scale/height 等の UI 状態を保持する WeakMap。
 *
 * 背景: Preview は本文変更時に dangerouslySetInnerHTML で DOM 全体を
 * 入れ替える。.mindmap-block 要素自体が破棄されるため、blockEl の
 * dataset に保存していた状態は永続化できない。Preview の root は
 * 同一インスタンスのまま維持されるので、root を key にすれば本文編集を
 * またいで状態を保てる。WeakMap なのでノート切替で root が捨てられれば
 * 自動 GC される。
 */
const blockStatesByRoot = new WeakMap();
function getBlockState(root, index) {
  let map = blockStatesByRoot.get(root);
  if (!map) {
    map = new Map();
    blockStatesByRoot.set(root, map);
  }
  let st = map.get(index);
  if (!st) {
    st = {
      panX: 20,
      panY: 20,
      scale: 1,
      height: 480,
      initialized: false,
    };
    map.set(index, st);
  }
  return st;
}

/** 1 行の indent 階層を 2スペース基準で返す。タブは 2スペース換算。 */
function indentLevel(line) {
  const m = line.match(/^(\s*)-\s+/);
  if (!m) return -1;
  const ws = m[1].replace(/\t/g, INDENT);
  return Math.floor(ws.length / INDENT.length);
}

/** ソース文字列 → ツリー (root node)。空ソース時はデフォルトの root を返す。 */
/**
 * ブロック先頭の `<!-- key=val ... -->` をメタデータとして解釈。
 * サポートキー: panX, panY, scale, height (いずれも数値)。
 */
function parseMetadata(rawLines) {
  const meta = { panX: null, panY: null, scale: null, height: null };
  let i = 0;
  while (i < rawLines.length && !rawLines[i].trim()) i++;
  if (i >= rawLines.length) return { meta, consumed: i };
  const m = rawLines[i].match(/^\s*<!--\s*(.*?)\s*-->\s*$/);
  if (!m) return { meta, consumed: i };
  for (const pair of m[1].split(/\s+/)) {
    const [k, v] = pair.split('=');
    if (!k || v === undefined) continue;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) continue;
    if (k === 'panX') meta.panX = n;
    else if (k === 'panY') meta.panY = n;
    else if (k === 'scale') meta.scale = n;
    else if (k === 'height') meta.height = n;
  }
  return { meta, consumed: i + 1 };
}

function parseSource(src) {
  const rawLines = (src ?? '').split(/\r?\n/).map((l) => l.replace(/\t/g, INDENT));
  const { meta, consumed } = parseMetadata(rawLines);
  const lines = rawLines
    .slice(consumed)
    .filter((l) => /^\s*-\s+/.test(l));
  if (lines.length === 0) {
    return {
      tree: { id: newId(), text: '中心トピック', children: [] },
      meta,
    };
  }
  // スタック式パース
  const root = { id: newId(), text: '', children: [] };
  const stack = [{ node: root, level: -1 }];
  for (const line of lines) {
    const lv = indentLevel(line);
    const text = line.replace(/^\s*-\s+/, '').trim();
    const node = { id: newId(), text, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= lv) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, level: lv });
  }
  // 単一トップレベル要素なら、それを root として扱う (より自然)
  if (root.children.length === 1) return { tree: root.children[0], meta };
  // 複数トップレベルは仮想 root でくくる
  return { tree: { ...root, text: '中心トピック' }, meta };
}

/** ツリー → ソース文字列。meta が指定されればコメント行で先頭に挿入 */
function serializeTree(root, meta) {
  const lines = [];
  // メタデータ: デフォルトと異なる値だけ書き出す
  if (meta) {
    const parts = [];
    if (Number.isFinite(meta.panX) && Math.round(meta.panX) !== 20) {
      parts.push(`panX=${Math.round(meta.panX)}`);
    }
    if (Number.isFinite(meta.panY) && Math.round(meta.panY) !== 20) {
      parts.push(`panY=${Math.round(meta.panY)}`);
    }
    if (Number.isFinite(meta.scale) && Math.abs(meta.scale - 1) > 0.01) {
      parts.push(`scale=${meta.scale.toFixed(2)}`);
    }
    if (Number.isFinite(meta.height) && Math.round(meta.height) !== 480) {
      parts.push(`height=${Math.round(meta.height)}`);
    }
    if (parts.length > 0) {
      lines.push(`<!-- ${parts.join(' ')} -->`);
    }
  }
  function walk(node, depth) {
    const text = (node.text ?? '').trim() || '無題';
    lines.push(`${INDENT.repeat(depth)}- ${text}`);
    for (const c of node.children ?? []) walk(c, depth + 1);
  }
  walk(root, 0);
  return lines.join('\n') + '\n';
}

/** body 全文から i 番目の ```mindmap``` ブロックの中身を新ソースで置換 */
function replaceMindmapBlock(body, blockIndex, newInner) {
  const fenceRe = /```mindmap\s*\n([\s\S]*?)```/g;
  let m;
  let i = 0;
  let lastIndex = 0;
  while ((m = fenceRe.exec(body)) !== null) {
    if (i === blockIndex) {
      const before = body.slice(0, m.index);
      const after = body.slice(fenceRe.lastIndex);
      return `${before}\`\`\`mindmap\n${newInner.replace(/\n$/, '')}\n\`\`\`${after}`;
    }
    i += 1;
    lastIndex = fenceRe.lastIndex;
  }
  // ブロックが見つからなければ末尾に追記 (起こり得るが基本的に到達しない)
  return body + `\n\n\`\`\`mindmap\n${newInner}\`\`\`\n`;
}

/* ============================================================
 * 2. ツリー操作ヘルパ
 * ============================================================ */

function findNodeById(root, id, parent = null) {
  if (root.id === id) return { node: root, parent };
  for (const c of root.children ?? []) {
    const found = findNodeById(c, id, root);
    if (found) return found;
  }
  return null;
}

function removeNodeById(root, id) {
  if (root.id === id) return root; // root は削除不可
  for (const node of root.children ?? []) {
    const idx = node.children?.findIndex((c) => c.id === id) ?? -1;
    if (idx >= 0) {
      node.children.splice(idx, 1);
      return root;
    }
    removeNodeById(node, id);
  }
  const idx = root.children?.findIndex((c) => c.id === id) ?? -1;
  if (idx >= 0) root.children.splice(idx, 1);
  return root;
}

function isDescendant(node, candidateId) {
  if (node.id === candidateId) return true;
  for (const c of node.children ?? []) {
    if (isDescendant(c, candidateId)) return true;
  }
  return false;
}

/* ============================================================
 * 3. レイアウト
 *   - 横方向 (左→右) ツリー。各 depth に固定 x オフセット
 *   - y はサブツリーの "葉数" を元に重ならないよう配置
 * ============================================================ */

const NODE_W_MIN = 100;
const NODE_W_MAX = 320;
const NODE_W_DEFAULT = 140; // ghost や CSS フォールバック用
const NODE_W = NODE_W_DEFAULT;
const NODE_H = 32;
const H_GAP = 60; // depth 間の x ギャップ
const V_GAP = 12; // 葉ごとの y ギャップ
const NODE_PAD_X = 16; // ノード内パディング (左右合計)
const NODE_FONT = '12px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// canvas で文字幅を測るためのコンテキスト (シングルトン)
let _measureCtx = null;
function measureTextWidth(text) {
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = NODE_FONT;
  }
  return _measureCtx.measureText(text || '無題').width;
}
function computeNodeWidth(text) {
  const w = measureTextWidth(text) + NODE_PAD_X + 4;
  return Math.max(NODE_W_MIN, Math.min(NODE_W_MAX, Math.ceil(w)));
}

function layout(root) {
  // 各ノードに leafCount + 自分の幅を計算
  function annotate(node) {
    node._width = computeNodeWidth(node.text);
    if (!node.children || node.children.length === 0) {
      node._leaves = 1;
      return 1;
    }
    let sum = 0;
    for (const c of node.children) sum += annotate(c);
    node._leaves = sum;
    return sum;
  }
  annotate(root);

  // depth ごとの最大幅を集計 → 各 depth の x オフセットを決める
  // (= ある depth の全ノードは同じ x から始まる。幅自体は各ノード固有)
  const maxByDepth = [];
  function gatherWidth(node, depth) {
    if (maxByDepth.length <= depth) maxByDepth.push(0);
    if (node._width > maxByDepth[depth]) maxByDepth[depth] = node._width;
    for (const c of node.children ?? []) gatherWidth(c, depth + 1);
  }
  gatherWidth(root, 0);
  const colX = [0];
  for (let i = 0; i < maxByDepth.length; i++) {
    colX.push(colX[i] + maxByDepth[i] + H_GAP);
  }

  const nodes = [];
  function place(node, depth, top) {
    const height = node._leaves * (NODE_H + V_GAP);
    const x = colX[depth];
    const y = top + height / 2 - NODE_H / 2;
    nodes.push({ node, depth, x, y, width: node._width });
    let cursor = top;
    for (const c of node.children ?? []) {
      const childH = c._leaves * (NODE_H + V_GAP);
      place(c, depth + 1, cursor);
      cursor += childH;
    }
  }
  place(root, 0, 0);

  const maxDepth = nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.depth));
  // 末尾ノード分の幅 (= maxByDepth[maxDepth]) を末尾に足してから少し余白
  const totalW = colX[maxDepth] + (maxByDepth[maxDepth] || NODE_W_DEFAULT) + 20;
  const totalH = root._leaves * (NODE_H + V_GAP) + 40;
  return { nodes, totalW, totalH };
}

/* ============================================================
 * 4. レンダリング (HTML + SVG)
 * ============================================================ */

const STYLE_TAG_ID = 'inknel-mindmap-style';
function ensureStyle() {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_TAG_ID;
  style.textContent = `
.mindmap-block { position: relative; border: 1px solid var(--border, #444); border-radius: 8px; padding: 8px; margin: 12px 0; background: var(--bg-elevated, #1e1e1e); overflow: hidden; }
.mindmap-toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; user-select: none; }
.mindmap-toolbar button { height: 26px; padding: 0 10px; font-size: 12px; cursor: pointer; background: var(--bg, #2a2a2a); color: var(--fg, #eee); border: 1px solid var(--border, #555); border-radius: 4px; }
.mindmap-toolbar button:hover { background: var(--accent-soft, rgba(86,156,214,0.18)); }
.mindmap-toolbar .mindmap-zoom-label { font-size: 11px; min-width: 42px; text-align: center; color: var(--fg-muted, #aaa); }
.mindmap-canvas-wrap { position: relative; width: 100%; height: 480px; overflow: hidden; background: var(--bg, #1a1a1a); border-radius: 4px; cursor: grab; }
.mindmap-canvas-wrap.is-panning { cursor: grabbing; }
.mindmap-resize-handle { height: 8px; margin-top: 2px; background: transparent; cursor: ns-resize; display: flex; align-items: center; justify-content: center; }
.mindmap-resize-handle::before { content: ''; display: block; width: 40px; height: 4px; background: var(--border, #555); border-radius: 2px; transition: background 0.1s; }
.mindmap-resize-handle:hover::before, .mindmap-resize-handle.is-active::before { background: var(--accent, #569cd6); }
.mindmap-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.mindmap-edges { position: absolute; inset: 0; pointer-events: none; }
.mindmap-edges path { fill: none; stroke: var(--fg-muted, #888); stroke-width: 1.4; }
.mindmap-node { position: absolute; height: ${NODE_H}px; line-height: ${NODE_H - 2}px; padding: 0 8px; box-sizing: border-box; background: var(--bg-elevated, #2a2a2a); border: 1px solid var(--border, #555); border-radius: 6px; font-size: 12px; color: var(--fg, #eee); cursor: grab; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; user-select: none; transition: box-shadow 0.1s, border-color 0.1s; }
.mindmap-node[data-depth="0"] { background: var(--accent, #569cd6); color: #fff; border-color: var(--accent, #569cd6); font-weight: 600; }
.mindmap-node.is-selected { box-shadow: 0 0 0 2px var(--accent, #569cd6); border-color: var(--accent, #569cd6); }
.mindmap-node.is-dragging { opacity: 0.35; }
.mindmap-node.is-drop-target { border-color: #f5a623; box-shadow: 0 0 0 2px #f5a623; }
.mindmap-drag-ghost { position: fixed; pointer-events: none; z-index: 99999; height: ${NODE_H}px; line-height: ${NODE_H - 2}px; padding: 0 8px; box-sizing: border-box; background: var(--bg-elevated, #2a2a2a); border: 1px solid var(--accent, #569cd6); border-radius: 6px; font-size: 12px; color: var(--fg, #eee); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 6px 18px rgba(0,0,0,0.5); opacity: 0.9; transform: translate(8px, 8px); }
.mindmap-node-input { position: absolute; height: ${NODE_H}px; padding: 0 8px; box-sizing: border-box; font-size: 12px; font-family: inherit; border: 1px solid var(--accent, #569cd6); border-radius: 6px; outline: none; background: var(--bg, #1e1e1e); color: var(--fg, #eee); }
.mindmap-actions { position: absolute; display: flex; gap: 4px; }
.mindmap-actions button { width: 24px; height: 24px; padding: 0; font-size: 12px; line-height: 1; cursor: pointer; background: var(--bg-elevated, #2a2a2a); color: var(--fg, #eee); border: 1px solid var(--border, #555); border-radius: 4px; }
.mindmap-actions button:hover { background: var(--accent-soft, rgba(86,156,214,0.18)); }
.mindmap-help { margin-top: 4px; font-size: 11px; color: var(--fg-muted, #888); }
`;
  document.head.appendChild(style);
}

/** 1 ブロックの mindmap UI を構築 */
function renderMindmapBlock(blockEl, blockIndex, ctx, rootEl) {
  ensureStyle();

  // 初回ソースを data 属性から取得
  const source = decodeURIComponent(
    blockEl.getAttribute('data-mindmap-source') ?? '',
  );

  // 編集可否: ctx.setBody が無い (= 保護ノート未解錠など) なら read-only。
  // パン / ズーム / リセット など閲覧系操作は残し、ツリー変更系を全部封じる。
  const canEdit = typeof ctx?.setBody === 'function';

  // ローカル状態
  const parsed = parseSource(source);
  let tree = parsed.tree;
  // ソース内メタデータコメントから pan/scale/height を復元 (あれば WeakMap state を上書き)
  if (parsed.meta) {
    if (Number.isFinite(parsed.meta.panX)) state.panX = parsed.meta.panX;
    if (Number.isFinite(parsed.meta.panY)) state.panY = parsed.meta.panY;
    if (Number.isFinite(parsed.meta.scale)) state.scale = parsed.meta.scale;
    if (Number.isFinite(parsed.meta.height)) state.height = parsed.meta.height;
    // メタデータがあれば「初期化済み」とみなして自動フィットしない
    if (
      parsed.meta.panX != null ||
      parsed.meta.scale != null ||
      parsed.meta.height != null
    ) {
      state.initialized = true;
    }
  }
  // 状態を WeakMap (preview root を key) から取り出す。Preview の本文編集で
  // .mindmap-block 自体が DOM 再生成されてもここの値は引き継がれる。
  const state = getBlockState(rootEl, blockIndex);
  let scale = state.scale;
  // 平行移動オフセット (translate)。scroll ではなく transform で管理し、
  // 中身のサイズに関係なく自由にパンできるようにする。
  let panX = state.panX;
  let panY = state.panY;
  // 表示領域の高さ (px)。ユーザーが下端ハンドルでドラッグ変更可。
  let wrapHeight = state.height;
  let selectedId = null;
  let editingId = null;
  let dragId = null;
  let dropId = null;

  // DOM 構築
  blockEl.innerHTML = '';
  blockEl.classList.add('mindmap-block');

  const toolbar = document.createElement('div');
  toolbar.className = 'mindmap-toolbar';

  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.textContent = '−';
  zoomOut.title = '縮小';
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'mindmap-zoom-label';
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.textContent = '+';
  zoomIn.title = '拡大';
  const zoomReset = document.createElement('button');
  zoomReset.type = 'button';
  zoomReset.textContent = '100%';
  zoomReset.title = '拡大率リセット';

  const fitView = document.createElement('button');
  fitView.type = 'button';
  fitView.textContent = '全体表示';
  fitView.title = '全ノードが収まるように拡大率と位置を自動調整';

  const addChildBtn = document.createElement('button');
  addChildBtn.type = 'button';
  addChildBtn.textContent = '子ノード追加';
  const addSiblingBtn = document.createElement('button');
  addSiblingBtn.type = 'button';
  addSiblingBtn.textContent = '兄弟ノード追加';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '削除';
  // read-only モード時は編集系ボタンを丸ごと隠す (UI 上も「触れない」と分かる)
  if (!canEdit) {
    addChildBtn.style.display = 'none';
    addSiblingBtn.style.display = 'none';
    delBtn.style.display = 'none';
  }

  toolbar.append(
    zoomOut,
    zoomLabel,
    zoomIn,
    zoomReset,
    fitView,
    document.createTextNode(' '),
    addChildBtn,
    addSiblingBtn,
    delBtn,
  );
  if (!canEdit) {
    const lockedTag = document.createElement('span');
    lockedTag.textContent = '🔒 保護中 (閲覧のみ)';
    lockedTag.style.fontSize = '11px';
    lockedTag.style.color = 'var(--fg-muted, #888)';
    lockedTag.style.marginLeft = 'auto';
    toolbar.append(lockedTag);
  }

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'mindmap-canvas-wrap';
  const canvas = document.createElement('div');
  canvas.className = 'mindmap-canvas';
  const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('mindmap-edges');
  canvas.append(edges);
  canvasWrap.append(canvas);
  canvasWrap.style.height = wrapHeight + 'px';

  // 下端の高さリサイズハンドル
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'mindmap-resize-handle';
  resizeHandle.setAttribute('role', 'separator');
  resizeHandle.setAttribute('aria-orientation', 'horizontal');
  resizeHandle.title = 'ドラッグで表示領域の高さを変更';

  const help = document.createElement('div');
  help.className = 'mindmap-help';
  help.textContent =
    'ヒント: 背景ドラッグ=画面移動 / ノードドラッグ=別ノードへ付け替え (子孫には不可) / クリック=選択 / ダブルクリック=リネーム / Enter=確定 / Esc=取消';

  blockEl.append(toolbar, canvasWrap, resizeHandle, help);

  /* transform (translate + scale) を canvas へ適用 + state へ永続化 */
  function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    state.panX = panX;
    state.panY = panY;
    state.scale = scale;
  }

  /* 永続化: 現在のツリーをノート本文へ反映 */
  function commit() {
    const newSource = serializeTree(tree, {
      panX,
      panY,
      scale,
      height: wrapHeight,
    });
    if (!ctx.setBody || !ctx.getBody) {
      // 編集 API 未提供環境 (例: edit-only モード) では DOM だけ更新
      blockEl.setAttribute(
        'data-mindmap-source',
        encodeURIComponent(newSource),
      );
      return;
    }
    const body = ctx.getBody();
    const next = replaceMindmapBlock(body, blockIndex, newSource);
    ctx.setBody(next);
  }

  /* 再描画 */
  function render() {
    canvas.innerHTML = '';
    canvas.append(edges);
    const { nodes, totalW, totalH } = layout(tree);
    canvas.style.width = totalW + 'px';
    canvas.style.height = totalH + 'px';
    applyTransform();
    edges.setAttribute('width', totalW);
    edges.setAttribute('height', totalH);
    edges.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    edges.innerHTML = '';

    // エッジ (親→子)
    const positions = new Map();
    for (const n of nodes) positions.set(n.node.id, n);
    for (const n of nodes) {
      for (const c of n.node.children ?? []) {
        const child = positions.get(c.id);
        if (!child) continue;
        const x1 = n.x + n.width;
        const y1 = n.y + NODE_H / 2;
        const x2 = child.x;
        const y2 = child.y + NODE_H / 2;
        const midX = (x1 + x2) / 2;
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path',
        );
        path.setAttribute(
          'd',
          `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
        );
        edges.append(path);
      }
    }

    // ノード
    for (const n of nodes) {
      if (editingId === n.node.id) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mindmap-node-input';
        input.style.left = n.x + 'px';
        input.style.top = n.y + 'px';
        input.style.width = n.width + 'px';
        input.value = n.node.text;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            n.node.text = input.value;
            editingId = null;
            commit();
            render();
          } else if (e.key === 'Escape') {
            editingId = null;
            render();
          }
        });
        input.addEventListener('blur', () => {
          n.node.text = input.value;
          editingId = null;
          commit();
          render();
        });
        canvas.append(input);
        setTimeout(() => input.focus(), 0);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'mindmap-node';
      if (selectedId === n.node.id) el.classList.add('is-selected');
      if (dragId === n.node.id) el.classList.add('is-dragging');
      if (dropId === n.node.id) el.classList.add('is-drop-target');
      el.dataset.id = n.node.id;
      el.dataset.depth = String(n.depth);
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      el.style.width = n.width + 'px';
      el.textContent = n.node.text || '無題';
      // HTML5 ネイティブ drag は無効 (re-render で source DOM が消える問題回避)。
      // 自前の mousedown→ mousemove → mouseup ベースで実装する。
      el.draggable = false;

      if (canEdit) {
        // 編集可能: mousedown でドラッグ移動 (移動量小さければクリック=選択)、
        // ダブルクリックで rename。
        el.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          nodeMouseDown(e, n.node.id, el);
        });
        el.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          editingId = n.node.id;
          selectedId = n.node.id;
          render();
        });
      } else {
        // 保護中 (read-only): 選択ハイライトだけ反応させ、移動/編集は無効化
        el.style.cursor = 'default';
        el.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (selectedId !== n.node.id) {
            // 直接 DOM 更新で選択状態だけ反映 (render 不要)
            const prev = canvas.querySelector(
              `.mindmap-node.is-selected`,
            );
            prev?.classList.remove('is-selected');
            selectedId = n.node.id;
            el.classList.add('is-selected');
          }
        });
      }

      canvas.append(el);
    }

    zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  /* 操作ボタン */
  function addChild() {
    if (!selectedId) {
      selectedId = tree.id;
    }
    const target = findNodeById(tree, selectedId)?.node;
    if (!target) return;
    const child = { id: newId(), text: '新規ノード', children: [] };
    target.children = target.children ?? [];
    target.children.push(child);
    selectedId = child.id;
    editingId = child.id;
    commit();
    render();
  }
  function addSibling() {
    if (!selectedId || selectedId === tree.id) {
      // root の兄弟は作れないので子として
      return addChild();
    }
    const entry = findNodeById(tree, selectedId);
    if (!entry || !entry.parent) return;
    const sibling = { id: newId(), text: '新規ノード', children: [] };
    const list = entry.parent.children;
    const idx = list.indexOf(entry.node);
    list.splice(idx + 1, 0, sibling);
    selectedId = sibling.id;
    editingId = sibling.id;
    commit();
    render();
  }
  function deleteSelected() {
    if (!selectedId || selectedId === tree.id) return;
    removeNodeById(tree, selectedId);
    selectedId = null;
    commit();
    render();
  }

  addChildBtn.addEventListener('click', addChild);
  addSiblingBtn.addEventListener('click', addSibling);
  delBtn.addEventListener('click', deleteSelected);

  /* ズーム (確定ごとに commit して本文へメタデータを書き戻す) */
  function setScale(s) {
    scale = Math.max(0.3, Math.min(2.5, s));
    blockEl.dataset.mindmapScale = String(scale);
    render();
    if (canEdit) commit();
  }
  zoomOut.addEventListener('click', () => setScale(scale - 0.1));
  zoomIn.addEventListener('click', () => setScale(scale + 0.1));
  zoomReset.addEventListener('click', () => setScale(1));

  /* 全体表示: ツリー全体が viewport に収まるよう scale + pan を計算して適用。
     - 最大 1.5x までしか拡大しない (小さなマップが極端に大きくならないように)
     - 最小 0.3x (これより小さくすると読めない)
     - 余白を 24px 確保 */
  function fitToView() {
    const vw = canvasWrap.clientWidth;
    const vh = canvasWrap.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const { totalW, totalH } = layout(tree);
    if (totalW <= 0 || totalH <= 0) return;
    const margin = 24;
    const sx = (vw - margin * 2) / totalW;
    const sy = (vh - margin * 2) / totalH;
    let next = Math.min(sx, sy, 1.5);
    next = Math.max(0.3, next);
    scale = next;
    panX = (vw - totalW * scale) / 2;
    panY = (vh - totalH * scale) / 2;
    applyTransform();
    render();
  }
  fitView.addEventListener('click', fitToView);

  /* ----- 表示領域の高さリサイズハンドル -----
     下端の薄いバーを掴むと canvasWrap の高さを上下に変更できる。
     最小 200px、最大 1600px。dataset に保存して再描画後も維持。 */
  let resizeState = null;
  resizeHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeState = { startY: e.clientY, startH: wrapHeight };
    resizeHandle.classList.add('is-active');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });

  /* ----- 背景ドラッグでパン (canvas を translate で動かす) -----
     scroll ベースだと中身が viewport より小さい時に動かないため、
     transform: translate ベースで実装。スケールに関係なく自由にパン可。 */
  let panState = null;
  canvasWrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (
      t.tagName === 'BUTTON' ||
      t.tagName === 'INPUT' ||
      (typeof t.className === 'string' && t.className.includes('mindmap-node'))
    ) {
      return;
    }
    // 背景クリック (selectedId 解除) も兼ねる
    if (selectedId !== null) {
      selectedId = null;
      render();
    }
    panState = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panX,
      startPanY: panY,
    };
    canvasWrap.classList.add('is-panning');
    e.preventDefault();
  });

  /* ----- ノード mousedown → drag/click 判別 -----
     5px 動いたら drag 扱い (付け替えモード)。動かなければ click 扱い (選択)。
     drag 中は ghost 表示 + 落とせるノードを is-drop-target でハイライト。
     re-render は drop 後 (commit 後) のみ行う。 */
  let nodeDrag = null;
  function nodeMouseDown(e, id, sourceEl) {
    nodeDrag = {
      id,
      sourceEl,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
  }

  function findNodeElAt(x, y) {
    // ドラッグ中の source は pointer-events 越しに無視するため、一時的に外す
    const prevPE = nodeDrag?.sourceEl?.style.pointerEvents;
    if (nodeDrag?.sourceEl) nodeDrag.sourceEl.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(x, y);
    if (nodeDrag?.sourceEl)
      nodeDrag.sourceEl.style.pointerEvents = prevPE ?? '';
    if (!hit) return null;
    const node = hit.closest('.mindmap-node');
    if (!node || !canvas.contains(node)) return null;
    return node;
  }

  function updateDropTarget(targetEl) {
    const targetId = targetEl?.dataset.id ?? null;
    let nextDropId = null;
    if (targetId && targetId !== nodeDrag.id) {
      const dragNode = findNodeById(tree, nodeDrag.id)?.node;
      if (dragNode && !isDescendant(dragNode, targetId)) {
        nextDropId = targetId;
      }
    }
    if (nextDropId === dropId) return;
    // 直接 DOM クラスを付け外し (render を呼ばないので drag が壊れない)
    if (dropId) {
      const prev = canvas.querySelector(
        `.mindmap-node[data-id="${dropId}"]`,
      );
      prev?.classList.remove('is-drop-target');
    }
    dropId = nextDropId;
    if (dropId) {
      const next = canvas.querySelector(
        `.mindmap-node[data-id="${dropId}"]`,
      );
      next?.classList.add('is-drop-target');
    }
  }

  window.addEventListener('mousemove', (e) => {
    // 高さリサイズ中
    if (resizeState) {
      const next = resizeState.startH + (e.clientY - resizeState.startY);
      wrapHeight = Math.min(1600, Math.max(200, next));
      canvasWrap.style.height = wrapHeight + 'px';
      state.height = wrapHeight;
      return;
    }
    // パン中
    if (panState) {
      panX = panState.startPanX + (e.clientX - panState.startX);
      panY = panState.startPanY + (e.clientY - panState.startY);
      applyTransform();
      return;
    }
    // ノードドラッグ中
    if (nodeDrag) {
      const dx = e.clientX - nodeDrag.startX;
      const dy = e.clientY - nodeDrag.startY;
      if (!nodeDrag.started) {
        if (Math.hypot(dx, dy) < 5) return; // threshold 未満は drag 扱いしない
        nodeDrag.started = true;
        nodeDrag.sourceEl.classList.add('is-dragging');
        // マウスに追従するゴースト要素を作る (position: fixed + clientX/Y)
        const ghost = document.createElement('div');
        ghost.className = 'mindmap-drag-ghost';
        const dragNodeText =
          findNodeById(tree, nodeDrag.id)?.node.text || '無題';
        ghost.textContent = dragNodeText;
        // 元ノードと同じ幅を文字長から計算して適用
        ghost.style.width = computeNodeWidth(dragNodeText) + 'px';
        document.body.appendChild(ghost);
        nodeDrag.ghost = ghost;
      }
      if (nodeDrag.ghost) {
        nodeDrag.ghost.style.left = e.clientX + 'px';
        nodeDrag.ghost.style.top = e.clientY + 'px';
      }
      const targetEl = findNodeElAt(e.clientX, e.clientY);
      updateDropTarget(targetEl);
    }
  });

  window.addEventListener('mouseup', () => {
    if (resizeState) {
      const moved = resizeState.startH !== wrapHeight;
      resizeState = null;
      resizeHandle.classList.remove('is-active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 高さ変更を本文に書き戻す
      if (canEdit && moved) commit();
      return;
    }
    if (panState) {
      const moved =
        panState.startPanX !== panX || panState.startPanY !== panY;
      panState = null;
      canvasWrap.classList.remove('is-panning');
      // パン位置変更を本文に書き戻す
      if (canEdit && moved) commit();
      return;
    }
    if (nodeDrag) {
      const wasClick = !nodeDrag.started;
      const clickedId = nodeDrag.id;
      const sourceEl = nodeDrag.sourceEl;
      let willRerender = false;

      if (nodeDrag.started && dropId) {
        // 付け替え実行 → tree 変化するので render 必須
        const dragNode = findNodeById(tree, clickedId)?.node;
        const targetEntry = findNodeById(tree, dropId);
        if (
          dragNode &&
          targetEntry &&
          !isDescendant(dragNode, dropId)
        ) {
          removeNodeById(tree, clickedId);
          targetEntry.node.children = targetEntry.node.children ?? [];
          targetEntry.node.children.push(dragNode);
          commit();
          willRerender = true;
        }
      }

      // ハイライト掃除 (render を呼ばない経路でも DOM を綺麗にする)
      sourceEl.classList.remove('is-dragging');
      if (dropId) {
        const prev = canvas.querySelector(
          `.mindmap-node[data-id="${dropId}"]`,
        );
        prev?.classList.remove('is-drop-target');
        dropId = null;
      }
      // ゴースト削除
      if (nodeDrag.ghost) {
        nodeDrag.ghost.remove();
      }
      nodeDrag = null;

      if (willRerender) {
        // 付け替え後は描き直す
        render();
      } else if (wasClick) {
        // 単純クリック: render を呼ばない (呼ぶと DOM が再生成され、後続の
        // 2nd click が新 DOM 要素になって dblclick が発火しなくなる)。
        // 選択ハイライトは DOM クラスを直接書き換えるだけにする。
        if (selectedId !== clickedId) {
          if (selectedId) {
            const prev = canvas.querySelector(
              `.mindmap-node[data-id="${selectedId}"]`,
            );
            prev?.classList.remove('is-selected');
          }
          selectedId = clickedId;
          sourceEl.classList.add('is-selected');
        }
      }
    }
  });

  /* Delete/Backspace でも削除可 (フォーカス中のみ、read-only 時は無視) */
  blockEl.addEventListener('keydown', (e) => {
    if (!canEdit) return;
    if (
      editingId === null &&
      (e.key === 'Delete' || e.key === 'Backspace') &&
      selectedId
    ) {
      e.preventDefault();
      deleteSelected();
    }
  });
  blockEl.tabIndex = 0;

  applyTransform();
  render();
  // 初回マウント時 (= ノート初表示や有効化直後) だけ全体表示に自動調整。
  // commit() で本文が書き換わって renderInPreview が再実行された時は、
  // WeakMap に保存していた panX/panY/scale をそのまま使う。
  if (!state.initialized) {
    state.initialized = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitToView());
    });
  }
}

/* ============================================================
 * 5. プラグイン export
 * ============================================================ */

export const manifest = {
  id: 'mindmap',
  label: 'Mindmap',
  description:
    '```mindmap コードブロックをビューから編集可能なマインドマップとして描画します。ノードの追加/削除/リネーム、D&D付け替え、拡大縮小に対応。',
};

export const renderFence = ({ code, lang, escapeHtml }) => {
  if (lang.toLowerCase() !== 'mindmap') return null;
  // data 属性にエンコードしてそのまま埋め、renderInPreview で UI に変換
  return (
    `<div class="mindmap-block" data-mindmap-source="${encodeURIComponent(code)}">` +
    escapeHtml(code) +
    `</div>`
  );
};

export const renderInPreview = (root, ctx) => {
  const blocks = root.querySelectorAll(
    '.mindmap-block:not([data-mindmap-rendered])',
  );
  if (blocks.length === 0) return;
  let blockIndex = 0;
  for (const el of blocks) {
    try {
      renderMindmapBlock(el, blockIndex, ctx, root);
      el.setAttribute('data-mindmap-rendered', 'true');
    } catch (err) {
      console.error('[mindmap] render failed', err);
    }
    blockIndex += 1;
  }
};

export const resetInPreview = (root) => {
  root
    .querySelectorAll('.mindmap-block[data-mindmap-rendered]')
    .forEach((el) => {
      el.removeAttribute('data-mindmap-rendered');
      el.innerHTML = decodeURIComponent(
        el.getAttribute('data-mindmap-source') ?? '',
      );
    });
};

/**
 * エディタツールバー末尾に追加されるボタン定義。
 * 有効化されているとホストがツールバー末尾に自動表示する。
 */
export const toolbarButtons = [
  {
    id: 'mindmap-insert',
    label: 'マインドマップを挿入',
    icon:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="1" y="6" width="4" height="4" rx="0.8" />' +
      '<rect x="10" y="2" width="5" height="3" rx="0.6" />' +
      '<rect x="10" y="6.5" width="5" height="3" rx="0.6" />' +
      '<rect x="10" y="11" width="5" height="3" rx="0.6" />' +
      '<path d="M5 8 Q 7.5 8, 10 3.5 M 5 8 L 10 8 M 5 8 Q 7.5 8, 10 12.5" />' +
      '</svg>',
    onClick({ insert }) {
      insert(
        '\n```mindmap\n- 中心トピック\n  - 枝 1\n    - 葉 1\n    - 葉 2\n  - 枝 2\n```\n',
      );
    },
  },
];
