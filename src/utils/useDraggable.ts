import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ダイアログ等をマウスでドラッグ移動可能にするための hook。
 * 返り値:
 *   - `pos`: 現在の left/top (px)。`setPos` で任意にリセット可能（例: 表示時の初期化）
 *   - `onHeaderMouseDown`: ヘッダー要素等の `onMouseDown` に渡す
 *
 * 使い方:
 *   const { pos, setPos, onHeaderMouseDown } = useDraggable();
 *   useEffect(() => { if (open) setPos(centerPos()) }, [open]);
 *   <div style={{ left: pos?.x, top: pos?.y }}>
 *     <header onMouseDown={onHeaderMouseDown}>...</header>
 *   </div>
 */
export function useDraggable() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<
    | {
        startClientX: number;
        startClientY: number;
        origX: number;
        origY: number;
      }
    | null
  >(null);

  const onHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // 左ボタンのみ / 入力要素やボタン上では無視
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, a')) return;
      if (!pos) return;
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      e.preventDefault();
    },
    [pos],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      // 画面外に完全に逃さないよう少し余白を残す（上 / 左右は 0 まで、下は制約しない）
      const nextX = Math.max(0, d.origX + dx);
      const nextY = Math.max(0, d.origY + dy);
      setPos({ x: nextX, y: nextY });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return { pos, setPos, onHeaderMouseDown };
}
