import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TEXT_COLOR_PALETTE, BG_COLOR_PALETTE } from '../utils/colorSpan';

interface Props {
  /** ピッカーの表示位置（ビューポート座標。x はボタン中心） */
  x: number;
  y: number;
  /** 文字色か文字背景色か */
  mode: 'text' | 'background';
  /** 色決定時のコールバック（CSS の色値） */
  onSelect: (color: string) => void;
  /** 「色を解除」押下時。選択範囲の span を外す */
  onClear: () => void;
  /** 閉じる */
  onClose: () => void;
}

/**
 * 文字色 / 文字背景色を選ぶ吹き出し型ピッカー。
 * パレットから選ぶか、カラーピッカーで任意の色を指定できる。
 */
export default function ColorPicker({
  x,
  y,
  mode,
  onSelect,
  onClear,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const palette = mode === 'text' ? TEXT_COLOR_PALETTE : BG_COLOR_PALETTE;
  const [custom, setCustom] = useState(
    mode === 'text' ? '#e74c3c' : '#fff2a8',
  );

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

  const title = mode === 'text' ? '文字色' : '文字背景色';

  return createPortal(
    <div
      ref={ref}
      className="color-picker"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label={title}
      // ボタン同様、エディタのフォーカス/選択範囲を失わないようにする
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="color-picker__title">{title}</div>
      <div className="color-picker__grid">
        {palette.map((c) => (
          <button
            key={c.value}
            type="button"
            className="color-picker__swatch"
            style={{ background: c.value }}
            title={`${c.label} (${c.value})`}
            aria-label={`${c.label} ${c.value}`}
            onClick={() => onSelect(c.value)}
          />
        ))}
      </div>
      <div className="color-picker__custom">
        <input
          type="color"
          className="color-picker__input"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          title="任意の色を選ぶ"
          aria-label="任意の色を選ぶ"
        />
        <span className="color-picker__code">{custom}</span>
        <button
          type="button"
          className="color-picker__apply"
          onClick={() => onSelect(custom)}
        >
          適用
        </button>
      </div>
      <button type="button" className="color-picker__clear" onClick={onClear}>
        色を解除
      </button>
    </div>,
    document.body,
  );
}
