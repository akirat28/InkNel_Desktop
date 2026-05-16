import { useEffect, useRef, useState } from 'react';

interface Props {
  /** エディタに表示中の生テキスト（マークダウン原文）。ミニマップは縮小プレーン表示 */
  text: string;
  /** エディタの実際のスクロール要素（CodeMirror の scrollDOM）。null なら描画スキップ */
  scrollEl: HTMLElement | null;
}

/**
 * エディタ右側に表示する VSCode 風ミニマップ。
 *
 * 実装の考え方:
 * - エディタの生テキストを `<pre>` で縮小レンダリング（行と空白を保持）
 * - スケールは `min(BASE_SCALE, minimapHeight / contentHeight)`
 *   - 文書がミニマップに収まる長さなら BASE_SCALE
 *   - 長い文書は全体が見えるよう自動的に縮小
 * - 紫色の半透明矩形が「現在表示中の領域」インジケータ
 * - ミニマップ上のどこかをクリック / ドラッグするとエディタがその位置までスクロール
 */
export default function Minimap({ text, scrollEl }: Props) {
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLPreElement | null>(null);
  const [scale, setScale] = useState(0.15);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [innerWidth, setInnerWidth] = useState(0);
  // ドラッグ中フラグ。mousemove 中に scrollTo を発火するために mousedown 時に true。
  const draggingRef = useRef(false);

  // 直近のレイアウト計測値。ハンドラから参照するため state ではなく ref で持つ。
  // - editorContentH: エディタ全体の論理高さ（scrollEl.scrollHeight）
  // - minimapContentH: ミニマップ上のスケール後の文書全体高さ（px、ミニマップ座標系）
  const metricsRef = useRef({ editorContentH: 0, minimapContentH: 0 });

  // スケールとビューポートインジケータ位置を再計算
  useEffect(() => {
    if (!scrollEl) return;
    const minimap = minimapRef.current;
    const content = contentRef.current;
    if (!minimap || !content) return;

    const BASE_SCALE = 0.15;
    const update = () => {
      const minimapH = minimap.clientHeight;
      const minimapW = minimap.clientWidth;
      // エディタの論理高さ（CodeMirror scrollDOM の scrollHeight）
      const editorContentH = scrollEl.scrollHeight;
      // ミニマップ内 <pre> の論理高さ。transform: scale は layout に影響しないため
      //  scrollHeight は scale 前の自然な高さを返す。
      const contentNaturalH = content.scrollHeight;
      if (contentNaturalH === 0 || minimapH === 0 || editorContentH === 0)
        return;
      // 縦に収まる範囲で最大 BASE_SCALE。長文では自動的に小さくする。
      const fitScale = minimapH / contentNaturalH;
      const s = Math.max(0.04, Math.min(BASE_SCALE, fitScale));
      setScale(s);
      // 内部要素の論理幅: スケール後にちょうど minimapW になるよう逆算
      setInnerWidth(minimapW / s);
      // ミニマップ上での文書全体の見かけ高さ（px、ミニマップ座標系）
      const minimapContentH = contentNaturalH * s;
      metricsRef.current = { editorContentH, minimapContentH };
      // エディタの可視範囲を「文書全体に対する比率」で算出し、ミニマップ高さに射影。
      // これによりエディタとミニマップで行高/フォントが違っていても一致する。
      const topRatio = scrollEl.scrollTop / editorContentH;
      const heightRatio = scrollEl.clientHeight / editorContentH;
      setViewport({
        top: topRatio * minimapContentH,
        height: heightRatio * minimapContentH,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    ro.observe(minimap);
    ro.observe(content);
    scrollEl.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      scrollEl.removeEventListener('scroll', update);
    };
  }, [scrollEl, text]);

  // クリック / ドラッグでエディタをスクロール
  const scrollToFromMinimapY = (clientY: number) => {
    if (!scrollEl) return;
    const minimap = minimapRef.current;
    if (!minimap) return;
    const rect = minimap.getBoundingClientRect();
    const minimapY = clientY - rect.top;
    const { editorContentH, minimapContentH } = metricsRef.current;
    if (minimapContentH <= 0 || editorContentH <= 0) return;
    // ミニマップ Y → 文書比率 → エディタ scrollTop（クリック位置を中央に持ってくる）
    const ratio = Math.max(0, Math.min(minimapY / minimapContentH, 1));
    const target = ratio * editorContentH - scrollEl.clientHeight / 2;
    const maxTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    scrollEl.scrollTop = Math.max(0, Math.min(target, maxTop));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    scrollToFromMinimapY(e.clientY);
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      scrollToFromMinimapY(ev.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={minimapRef}
      className="minimap"
      onMouseDown={handleMouseDown}
      aria-hidden="true"
    >
      <pre
        ref={contentRef}
        className="minimap__content"
        style={{
          width: innerWidth || undefined,
          transform: `scale(${scale})`,
        }}
      >
        {text}
      </pre>
      <div
        className="minimap__viewport"
        style={{
          top: viewport.top,
          height: Math.max(viewport.height, 4),
        }}
      />
    </div>
  );
}
