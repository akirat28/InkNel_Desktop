/**
 * Schedule プラグイン (タイムスケジュール、ビュー編集対応)
 *
 * ```schedule コードブロックを 1 日のタイムテーブル (0:00〜23:59) として描画する。
 * 各時間帯をクリックすると予定 (開始 / 終了 / 内容 / 場所) を入力するフォームが
 * 開き、保存すると本文の該当 ```schedule ブロックへ書き戻す (mindmap と同じ機構)。
 *
 * 本文ソース形式 (1 行 = 1 予定):
 *   ```schedule
 *   09:00-10:30 | ミーティング | オフィスA
 *   11:00-12:00 | 開発作業 |
 *   13:00-14:00 | ランチ | 渋谷
 *   ```
 *
 * - 場所は省略可 (末尾の `|` は残してよいし無くてもよい)
 * - パースに失敗した行は無視
 */

const HOUR_PX = 60; // 1 時間 = 60px (= 1 分 1px)
const TOTAL_H = 24 * HOUR_PX;
const VIEWPORT_H = 8 * HOUR_PX; // 8 時間表示
const HOUR_COL_W = 56; // 左の時間ラベル列の幅
const DEFAULT_SCROLL_HOUR = 8; // 起動時の表示位置 (8:00)

/* ============================================================
 * 1. パーサ / シリアライザ
 * ============================================================ */

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minToTime(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseLine(line) {
  const m = line
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*\|\s*([^|]*?)(?:\s*\|\s*(.*))?$/);
  if (!m) return null;
  const h1 = parseInt(m[1], 10);
  const h2 = parseInt(m[3], 10);
  if (h1 > 23 || h2 > 24) return null;
  const start = `${String(h1).padStart(2, '0')}:${m[2]}`;
  const end = `${String(h2).padStart(2, '0')}:${m[4]}`;
  if (timeToMin(end) <= timeToMin(start)) return null;
  return {
    start,
    end,
    title: (m[5] ?? '').trim(),
    location: (m[6] ?? '').trim(),
  };
}

function parseSource(src) {
  const list = [];
  for (const line of (src ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const ev = parseLine(line);
    if (ev) list.push(ev);
  }
  list.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
  return list;
}

function serialize(events) {
  return (
    events
      .map((e) => {
        const loc = e.location ? ` | ${e.location}` : ' |';
        return `${e.start}-${e.end} | ${e.title || '無題'}${loc}`;
      })
      .join('\n') + '\n'
  );
}

function replaceScheduleBlock(body, blockIndex, newInner) {
  const fenceRe = /```schedule\s*\n([\s\S]*?)```/g;
  let m;
  let i = 0;
  while ((m = fenceRe.exec(body)) !== null) {
    if (i === blockIndex) {
      const before = body.slice(0, m.index);
      const after = body.slice(fenceRe.lastIndex);
      return `${before}\`\`\`schedule\n${newInner.replace(/\n$/, '')}\n\`\`\`${after}`;
    }
    i += 1;
  }
  return body + `\n\n\`\`\`schedule\n${newInner}\`\`\`\n`;
}

/* ============================================================
 * 2. ブロックごとの UI 状態保持 (mindmap と同じ WeakMap パターン)
 * ============================================================ */

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
      scrollTop: DEFAULT_SCROLL_HOUR * HOUR_PX,
      initialized: false,
    };
    map.set(index, st);
  }
  return st;
}

/* ============================================================
 * 2.5 レーン割り当て (重なる予定の横並び表示)
 *
 * 開始時刻でソートしたイベントを左から走査し、各イベントを「直前の
 * 予定と重ならない最も左のレーン」に割り当てる。さらに「クラスター」
 * (時間が連続的に被っている範囲) ごとに最大レーン数を計算し、その
 * クラスター内のイベントは均等幅で並ぶようにする。
 * ============================================================ */

function assignLanes(events) {
  const indexed = events.map((ev, idx) => ({
    ev,
    idx,
    startMin: timeToMin(ev.start),
    endMin: timeToMin(ev.end),
    lane: 0,
    totalLanes: 1,
  }));
  // 念のため startMin 順に処理 (events は既にソート済の想定だが防御)
  indexed.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  let i = 0;
  while (i < indexed.length) {
    const cluster = [indexed[i]];
    let clusterEnd = indexed[i].endMin;
    let j = i + 1;
    while (j < indexed.length && indexed[j].startMin < clusterEnd) {
      cluster.push(indexed[j]);
      if (indexed[j].endMin > clusterEnd) clusterEnd = indexed[j].endMin;
      j += 1;
    }
    // クラスター内でレーン割り当て (greedy)
    const laneEnds = []; // laneEnds[k] = そのレーンの最後の終了 min
    for (const p of cluster) {
      let assigned = -1;
      for (let k = 0; k < laneEnds.length; k++) {
        if (laneEnds[k] <= p.startMin) {
          laneEnds[k] = p.endMin;
          assigned = k;
          break;
        }
      }
      if (assigned === -1) {
        laneEnds.push(p.endMin);
        assigned = laneEnds.length - 1;
      }
      p.lane = assigned;
    }
    const total = laneEnds.length;
    for (const p of cluster) p.totalLanes = total;
    i = j;
  }
  // 元の events 配列の idx 順に戻して呼び出し側が扱いやすくする
  return indexed.sort((a, b) => a.idx - b.idx);
}

/* ============================================================
 * 2.6 カスタム TimePicker (時 + 分 の 2 つの select)
 * ============================================================ */

function createTimePicker(initial) {
  const wrap = document.createElement('div');
  wrap.className = 'schedule-timepicker';
  const hSel = document.createElement('select');
  hSel.className = 'schedule-timepicker__h';
  hSel.setAttribute('aria-label', '時');
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option');
    opt.value = String(h).padStart(2, '0');
    opt.textContent = String(h).padStart(2, '0');
    hSel.append(opt);
  }
  const sep = document.createElement('span');
  sep.className = 'schedule-timepicker__sep';
  sep.textContent = ':';
  const mSel = document.createElement('select');
  mSel.className = 'schedule-timepicker__m';
  mSel.setAttribute('aria-label', '分');
  // 5 分刻みのプリセット
  for (let m = 0; m < 60; m += 5) {
    const opt = document.createElement('option');
    opt.value = String(m).padStart(2, '0');
    opt.textContent = String(m).padStart(2, '0');
    mSel.append(opt);
  }

  function setValue(v) {
    const [h, m] = (v || '00:00').split(':');
    const hi = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
    const mi = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
    hSel.value = String(hi).padStart(2, '0');
    // 5 分刻みでないなら最寄り 5 分にスナップ。元の値は失われるがフォームで明示。
    const snapped = Math.round(mi / 5) * 5 % 60;
    const snappedStr = String(snapped).padStart(2, '0');
    // option に存在することを保証
    if (![...mSel.options].some((o) => o.value === snappedStr)) {
      const opt = document.createElement('option');
      opt.value = snappedStr;
      opt.textContent = snappedStr;
      mSel.append(opt);
    }
    mSel.value = snappedStr;
  }
  setValue(initial);

  wrap.append(hSel, sep, mSel);
  return {
    el: wrap,
    getValue: () => `${hSel.value}:${mSel.value}`,
    setValue,
    focus: () => hSel.focus(),
  };
}

/* ============================================================
 * 3. スタイル
 * ============================================================ */

const STYLE_TAG_ID = 'inknel-schedule-style';
function ensureStyle() {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_TAG_ID;
  style.textContent = `
.schedule-block { position: relative; border: 1px solid var(--border, #444); border-radius: 8px; padding: 8px; margin: 12px 0; background: var(--bg-elevated, #1e1e1e); }
.schedule-toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; user-select: none; }
.schedule-toolbar button { height: 26px; padding: 0 10px; font-size: 12px; cursor: pointer; background: var(--bg, #2a2a2a); color: var(--fg, #eee); border: 1px solid var(--border, #555); border-radius: 4px; }
.schedule-toolbar button:hover { background: var(--accent-soft, rgba(86,156,214,0.18)); }
.schedule-toolbar .schedule-label { flex: 1; font-size: 12px; color: var(--fg-muted, #aaa); }
.schedule-viewport { position: relative; height: ${VIEWPORT_H}px; overflow-y: auto; overflow-x: hidden; background: var(--bg, #1a1a1a); border: 1px solid var(--border, #444); border-radius: 4px; }
.schedule-canvas { position: relative; height: ${TOTAL_H}px; width: 100%; }
.schedule-hour-row { position: absolute; left: 0; right: 0; height: ${HOUR_PX}px; border-bottom: 1px solid var(--border, #444); display: flex; }
.schedule-hour-label { width: ${HOUR_COL_W}px; flex-shrink: 0; padding: 2px 8px 0 8px; font-size: 11px; color: var(--fg-muted, #888); text-align: right; box-sizing: border-box; border-right: 1px solid var(--border, #444); }
.schedule-hour-grid { flex: 1; position: relative; cursor: pointer; }
.schedule-hour-grid:hover { background: var(--accent-soft-2, rgba(86,156,214,0.06)); }
.schedule-hour-grid::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-bottom: 1px dashed var(--border, #333); opacity: 0.5; }
.schedule-events { position: absolute; left: ${HOUR_COL_W + 1}px; right: 0; top: 0; bottom: 0; pointer-events: none; }
.schedule-event { position: absolute; padding: 4px 8px; background: var(--accent, #569cd6); color: #fff; border-radius: 4px; font-size: 12px; line-height: 1.35; cursor: grab; overflow: hidden; pointer-events: auto; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: filter 0.1s; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.15); user-select: none; }
.schedule-event.is-dragging { opacity: 0.75; z-index: 10; box-shadow: 0 4px 14px rgba(0,0,0,0.5); cursor: grabbing; }
/* 下端のリサイズハンドル。掴んで上下に動かすと終了時刻を変更できる */
.schedule-event__resize { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: ns-resize; background: linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.18)); border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
.schedule-event__resize:hover, .schedule-event__resize.is-active { background: rgba(0,0,0,0.35); }
.schedule-event:hover { filter: brightness(1.1); }
.schedule-event__time { font-size: 10px; opacity: 0.85; }
.schedule-event__title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.schedule-event__location { font-size: 10px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.schedule-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; border-radius: 8px; }
.schedule-form { background: var(--bg-elevated, #2a2a2a); border: 1px solid var(--border, #555); border-radius: 8px; padding: 16px; min-width: 320px; max-width: 90%; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.schedule-form h4 { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--fg, #eee); }
.schedule-form-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; margin-bottom: 8px; align-items: center; }
.schedule-form-row label { font-size: 12px; color: var(--fg-muted, #aaa); }
.schedule-form-row input { width: 100%; height: 28px; padding: 0 8px; background: var(--bg, #1e1e1e); color: var(--fg, #eee); border: 1px solid var(--border, #555); border-radius: 4px; font-family: inherit; font-size: 12px; outline: none; box-sizing: border-box; }
.schedule-form-row input:focus { border-color: var(--accent, #569cd6); }
.schedule-time-range { display: flex; gap: 8px; align-items: center; }
/* カスタム TimePicker: 時 / 分 を 2 つの select として並べる */
.schedule-timepicker { display: inline-flex; align-items: center; gap: 4px; background: var(--bg, #1e1e1e); border: 1px solid var(--border, #555); border-radius: 4px; padding: 2px 6px; }
.schedule-timepicker:focus-within { border-color: var(--accent, #569cd6); }
.schedule-timepicker select { background: transparent; color: var(--fg, #eee); border: none; outline: none; font-family: inherit; font-size: 13px; padding: 4px 2px; cursor: pointer; appearance: none; -webkit-appearance: none; text-align: center; }
.schedule-timepicker select::-ms-expand { display: none; }
.schedule-timepicker__sep { color: var(--fg-muted, #888); font-weight: 600; }
.schedule-timepicker__h { width: 38px; }
.schedule-timepicker__m { width: 38px; }
.schedule-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.schedule-form-actions button { height: 30px; padding: 0 14px; border-radius: 4px; font-size: 12px; cursor: pointer; font-family: inherit; }
.schedule-btn-primary { background: var(--accent, #569cd6); color: #fff; border: 1px solid var(--accent, #569cd6); }
.schedule-btn-primary:hover { filter: brightness(1.1); }
.schedule-btn-secondary { background: transparent; color: var(--fg, #eee); border: 1px solid var(--border, #555); }
.schedule-btn-secondary:hover { background: rgba(255,255,255,0.05); }
.schedule-btn-danger { background: transparent; color: #ff6b6b; border: 1px solid #ff6b6b; }
.schedule-btn-danger:hover { background: rgba(255,107,107,0.1); }
[data-theme='light'] .schedule-event { color: #fff; }
[data-theme='light'] .schedule-overlay { background: rgba(0,0,0,0.4); }
`;
  document.head.appendChild(style);
}

/* ============================================================
 * 4. レンダリング
 * ============================================================ */

function renderScheduleBlock(blockEl, blockIndex, ctx, rootEl) {
  ensureStyle();

  const source = decodeURIComponent(
    blockEl.getAttribute('data-schedule-source') ?? '',
  );
  let events = parseSource(source);
  const state = getBlockState(rootEl, blockIndex);

  // 編集可否: ctx.setBody が無い時は read-only
  const canEdit = typeof ctx?.setBody === 'function';

  blockEl.innerHTML = '';
  blockEl.classList.add('schedule-block');

  // ----- ツールバー -----
  const toolbar = document.createElement('div');
  toolbar.className = 'schedule-toolbar';
  const label = document.createElement('span');
  label.className = 'schedule-label';
  label.textContent = `タイムスケジュール (${events.length} 件) — クリック/ドラッグで編集、下端でリサイズ`;
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ 予定追加';
  if (!canEdit) addBtn.style.display = 'none';
  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.textContent = '8:00へ';
  todayBtn.title = '8 時の位置までスクロール';
  toolbar.append(label, todayBtn, addBtn);

  // ----- ビューポート & キャンバス -----
  const viewport = document.createElement('div');
  viewport.className = 'schedule-viewport';
  const canvas = document.createElement('div');
  canvas.className = 'schedule-canvas';
  viewport.append(canvas);

  // 24 時間ぶんの行を生成 (時間ラベル + クリック領域)
  for (let h = 0; h < 24; h++) {
    const row = document.createElement('div');
    row.className = 'schedule-hour-row';
    row.style.top = h * HOUR_PX + 'px';
    const hourLabel = document.createElement('div');
    hourLabel.className = 'schedule-hour-label';
    hourLabel.textContent = `${String(h).padStart(2, '0')}:00`;
    const grid = document.createElement('div');
    grid.className = 'schedule-hour-grid';
    if (canEdit) {
      grid.addEventListener('click', (e) => {
        // クリック位置から開始分を推定 (上半分=00分、下半分=30分)
        const rect = grid.getBoundingClientRect();
        const inHourY = e.clientY - rect.top;
        const startMin = h * 60 + (inHourY > HOUR_PX / 2 ? 30 : 0);
        openForm({
          mode: 'add',
          start: minToTime(startMin),
          end: minToTime(startMin + 60),
          title: '',
          location: '',
        });
      });
    } else {
      grid.style.cursor = 'default';
    }
    row.append(hourLabel, grid);
    canvas.append(row);
  }

  // 予定ブロック (イベント)
  const eventsLayer = document.createElement('div');
  eventsLayer.className = 'schedule-events';
  canvas.append(eventsLayer);

  function renderEvents() {
    eventsLayer.innerHTML = '';
    label.textContent = `タイムスケジュール (${events.length} 件) — クリック/ドラッグで編集、下端でリサイズ`;
    // 重なり検出 → レーン割り当て (横並び表示用)
    const placed = assignLanes(events);
    // events と placed は idx で対応。元の events 順序を維持しつつ lane/totalLanes だけ取り出す
    events.forEach((ev, idx) => {
      const p = placed[idx];
      const startMin = timeToMin(ev.start);
      const endMin = timeToMin(ev.end);
      const top = startMin;
      const height = Math.max(20, endMin - startMin);
      const el = document.createElement('div');
      el.className = 'schedule-event';
      el.style.top = top + 'px';
      el.style.height = height + 'px';
      // レーン配置: 単独なら全幅、重なりがあれば等幅で横並び
      const total = p?.totalLanes || 1;
      const lane = p?.lane || 0;
      // 親 events レイヤー内で計算 (左右に 4px のマージン)
      const widthPercent = 100 / total;
      const leftPercent = lane * widthPercent;
      el.style.left = `calc(${leftPercent}% + 4px)`;
      el.style.width = `calc(${widthPercent}% - 8px)`;
      const timeStr = `${ev.start}–${ev.end}`;
      const titleStr = ev.title || '無題';
      const locStr = ev.location ? ` @ ${ev.location}` : '';
      el.innerHTML =
        `<div class="schedule-event__time">${escapeHtml(timeStr)}</div>` +
        `<div class="schedule-event__title">${escapeHtml(titleStr)}</div>` +
        (locStr
          ? `<div class="schedule-event__location">${escapeHtml(locStr)}</div>`
          : '');
      if (canEdit) {
        // 下端のリサイズハンドル
        const handle = document.createElement('div');
        handle.className = 'schedule-event__resize';
        handle.title = 'ドラッグで終了時刻を変更';
        el.append(handle);

        // body 全体: ドラッグで移動 / 移動量小さければクリック扱いで編集フォーム
        el.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          // リサイズハンドル上は別経路で処理 (stopPropagation してあるのでここに来ない想定だが念のため)
          if (e.target === handle) return;
          e.preventDefault();
          startEventDrag(e, idx, el, 'move');
        });
        handle.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          startEventDrag(e, idx, el, 'resize');
        });
      } else {
        el.style.cursor = 'default';
      }
      eventsLayer.append(el);
    });
  }

  /* ----- ドラッグ移動 / 下端リサイズ -----
     5 分刻みでスナップ。閾値 4px 未満なら click 扱いで編集フォームを開く。
     ドラッグ中は当該要素の top / height を直接更新し、commit/再レンダリングは
     mouseup 後にのみ実行する (re-render 中にドラッグ要素が破棄される問題を回避)。 */
  function startEventDrag(e, idx, el, mode) {
    const ev = events[idx];
    const session = {
      mode,
      idx,
      el,
      startY: e.clientY,
      origStart: timeToMin(ev.start),
      origEnd: timeToMin(ev.end),
      newStart: timeToMin(ev.start),
      newEnd: timeToMin(ev.end),
      moved: false,
    };
    document.body.style.userSelect = 'none';
    if (mode === 'move') {
      document.body.style.cursor = 'grabbing';
    } else {
      document.body.style.cursor = 'ns-resize';
    }

    const onMove = (e2) => {
      const dy = e2.clientY - session.startY;
      if (!session.moved && Math.abs(dy) < 4) return;
      if (!session.moved) {
        session.moved = true;
        if (mode === 'move') el.classList.add('is-dragging');
      }
      // 5 分刻みスナップ (1 分 = 1px)
      const dmin = Math.round(dy / 5) * 5;
      let ns, ne;
      if (mode === 'move') {
        ns = session.origStart + dmin;
        ne = session.origEnd + dmin;
        const duration = session.origEnd - session.origStart;
        // 0:00〜24:00 をはみ出さないようクランプ
        if (ns < 0) {
          ns = 0;
          ne = duration;
        }
        if (ne > 24 * 60) {
          ne = 24 * 60;
          ns = ne - duration;
        }
      } else {
        ns = session.origStart;
        // 最低 15 分 (終了は開始の 15 分後以降)
        ne = Math.max(session.origStart + 15, session.origEnd + dmin);
        if (ne > 24 * 60) ne = 24 * 60;
      }
      session.newStart = ns;
      session.newEnd = ne;
      el.style.top = ns + 'px';
      el.style.height = ne - ns + 'px';
      // ライブで時刻表示も更新
      const timeEl = el.querySelector('.schedule-event__time');
      if (timeEl) {
        timeEl.textContent = `${minToTime(ns)}–${minToTime(ne)}`;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      el.classList.remove('is-dragging');

      if (session.moved) {
        // 反映して再レンダリング (レーン再計算含む)
        events[session.idx] = {
          ...events[session.idx],
          start: minToTime(session.newStart),
          end: minToTime(session.newEnd),
        };
        events.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
        commit();
        renderEvents();
      } else {
        // クリック扱い → 編集フォームを開く
        const ev2 = events[session.idx];
        openForm({
          mode: 'edit',
          index: session.idx,
          start: ev2.start,
          end: ev2.end,
          title: ev2.title,
          location: ev2.location,
        });
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ----- フォームダイアログ (追加 / 編集) -----
  function openForm(initial) {
    const overlay = document.createElement('div');
    overlay.className = 'schedule-overlay';
    const form = document.createElement('div');
    form.className = 'schedule-form';

    const heading = document.createElement('h4');
    heading.textContent = initial.mode === 'edit' ? '予定を編集' : '予定を追加';

    // 開始 - 終了 (カスタム TimePicker)
    const timeRow = document.createElement('div');
    timeRow.className = 'schedule-form-row';
    const timeLabel = document.createElement('label');
    timeLabel.textContent = '時間';
    const timeWrap = document.createElement('div');
    timeWrap.className = 'schedule-time-range';
    const startPicker = createTimePicker(initial.start);
    const endPicker = createTimePicker(initial.end);
    const dash = document.createElement('span');
    dash.textContent = '〜';
    dash.style.color = 'var(--fg-muted, #aaa)';
    timeWrap.append(startPicker.el, dash, endPicker.el);
    timeRow.append(timeLabel, timeWrap);

    // 内容
    const titleRow = document.createElement('div');
    titleRow.className = 'schedule-form-row';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = '内容';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = '例: ミーティング';
    titleInput.value = initial.title;
    titleRow.append(titleLabel, titleInput);

    // 場所
    const locRow = document.createElement('div');
    locRow.className = 'schedule-form-row';
    const locLabel = document.createElement('label');
    locLabel.textContent = '場所';
    const locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.placeholder = '例: 渋谷オフィス';
    locInput.value = initial.location;
    locRow.append(locLabel, locInput);

    // アクション
    const actions = document.createElement('div');
    actions.className = 'schedule-form-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'schedule-btn-secondary';
    cancelBtn.textContent = 'キャンセル';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'schedule-btn-primary';
    saveBtn.textContent = '保存';
    let delBtn = null;
    if (initial.mode === 'edit') {
      delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'schedule-btn-danger';
      delBtn.textContent = '削除';
      actions.append(delBtn);
    }
    actions.append(cancelBtn, saveBtn);

    form.append(heading, timeRow, titleRow, locRow, actions);
    overlay.append(form);
    blockEl.append(overlay);

    setTimeout(() => titleInput.focus(), 0);

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        events.splice(initial.index, 1);
        commit();
        renderEvents();
        close();
      });
    }
    const save = () => {
      const s = startPicker.getValue();
      const e2 = endPicker.getValue();
      if (timeToMin(e2) <= timeToMin(s)) {
        alert('終了時刻は開始時刻より後である必要があります');
        return;
      }
      const ev = {
        start: s,
        end: e2,
        title: titleInput.value.trim() || '無題',
        location: locInput.value.trim(),
      };
      if (initial.mode === 'edit') {
        events[initial.index] = ev;
      } else {
        events.push(ev);
      }
      events.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
      commit();
      renderEvents();
      close();
    };
    saveBtn.addEventListener('click', save);
    // Enter で保存、Esc で閉じる
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        close();
      }
    });
  }

  // ----- ボディ書き戻し -----
  function commit() {
    const src = serialize(events);
    if (!ctx?.setBody || !ctx?.getBody) {
      blockEl.setAttribute(
        'data-schedule-source',
        encodeURIComponent(src),
      );
      return;
    }
    const body = ctx.getBody();
    const next = replaceScheduleBlock(body, blockIndex, src);
    ctx.setBody(next);
  }

  addBtn.addEventListener('click', () => {
    openForm({
      mode: 'add',
      start: '09:00',
      end: '10:00',
      title: '',
      location: '',
    });
  });
  todayBtn.addEventListener('click', () => {
    viewport.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_PX;
  });

  // ----- 組み立て -----
  blockEl.append(toolbar, viewport);
  renderEvents();

  // ----- スクロール位置の保持 -----
  viewport.scrollTop = state.scrollTop;
  viewport.addEventListener('scroll', () => {
    state.scrollTop = viewport.scrollTop;
  });
  if (!state.initialized) {
    state.initialized = true;
    viewport.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_PX;
    state.scrollTop = viewport.scrollTop;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
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

/* ============================================================
 * 5. プラグイン export
 * ============================================================ */

export const manifest = {
  id: 'schedule',
  label: 'Schedule',
  description:
    '```schedule コードブロックを 1 日のタイムスケジュールとして描画 / 編集。クリックで予定 (開始 / 終了 / 内容 / 場所) を追加、編集、削除できます。',
};

export const renderFence = ({ code, lang }) => {
  if (lang.toLowerCase() !== 'schedule') return null;
  return `<div class="schedule-block" data-schedule-source="${encodeURIComponent(code)}"></div>`;
};

export const renderInPreview = (root, ctx) => {
  const blocks = root.querySelectorAll(
    '.schedule-block:not([data-schedule-rendered])',
  );
  if (blocks.length === 0) return;
  let blockIndex = 0;
  for (const el of blocks) {
    try {
      renderScheduleBlock(el, blockIndex, ctx, root);
      el.setAttribute('data-schedule-rendered', 'true');
    } catch (err) {
      console.error('[schedule] render failed', err);
    }
    blockIndex += 1;
  }
};

export const resetInPreview = (root) => {
  root
    .querySelectorAll('.schedule-block[data-schedule-rendered]')
    .forEach((el) => {
      el.removeAttribute('data-schedule-rendered');
      el.innerHTML = '';
    });
};

/**
 * エディタツールバー末尾に追加されるボタン定義。
 * クリックで空の schedule ブロックの雛形を挿入する。
 */
export const toolbarButtons = [
  {
    id: 'schedule-insert',
    label: 'タイムスケジュールを挿入',
    icon:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="2" y="3" width="12" height="11" rx="1.5" />' +
      '<line x1="2" y1="6.5" x2="14" y2="6.5" />' +
      '<line x1="6" y1="2" x2="6" y2="4.5" />' +
      '<line x1="10" y1="2" x2="10" y2="4.5" />' +
      '<rect x="4" y="8" width="6" height="1.5" rx="0.3" fill="currentColor" stroke="none" opacity="0.6" />' +
      '<rect x="4" y="11" width="4" height="1.5" rx="0.3" fill="currentColor" stroke="none" opacity="0.6" />' +
      '</svg>',
    onClick({ insert }) {
      insert(
        '\n```schedule\n09:00-10:00 | ミーティング | オフィス\n13:00-14:00 | 開発作業 |\n```\n',
      );
    },
  },
];
