import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** ピッカーの表示位置（ビューポート座標、左上） */
  x: number;
  y: number;
  /** サイズ選択時のコールバック */
  onSelect: (rows: number, cols: number) => void;
  /** 閉じる */
  onClose: () => void;
}

const MAX_ROWS = 8;
const MAX_COLS = 8;

/**
 * Word/Google Docs 風のテーブルサイズピッカー。
 * 吹き出し型のポップアップで、グリッド上にマウスを移動して
 * 行 × 列を選択し、クリックでそのサイズのテーブルを挿入する。
 */
export default function TablePicker({ x, y, onSelect, onClose }: Props) {
  const [hover, setHover] = useState<{ row: number; col: number }>({
    row: 1,
    col: 1,
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleSelect = () => {
    onSelect(hover.row, hover.col);
  };

  // グリッド要素を生成
  const rows: React.ReactElement[] = [];
  for (let r = 1; r <= MAX_ROWS; r++) {
    const cells: React.ReactElement[] = [];
    for (let c = 1; c <= MAX_COLS; c++) {
      const active = r <= hover.row && c <= hover.col;
      cells.push(
        <div
          key={c}
          className={`table-picker__cell ${active ? 'is-active' : ''}`}
          onMouseEnter={() => setHover({ row: r, col: c })}
          onClick={handleSelect}
          role="gridcell"
          aria-label={`${r}行 × ${c}列`}
        />,
      );
    }
    rows.push(
      <div key={r} className="table-picker__row">
        {cells}
      </div>,
    );
  }

  return createPortal(
    <div
      ref={ref}
      className="table-picker"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="テーブルサイズ"
    >
      <div className="table-picker__grid" role="grid">
        {rows}
      </div>
      <div className="table-picker__label">
        {hover.row} 行 × {hover.col} 列
      </div>
    </div>,
    document.body,
  );
}
