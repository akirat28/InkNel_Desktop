import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** ピッカーの表示位置（ビューポート座標、左上） */
  x: number;
  y: number;
  /** アイコン選択時のコールバック（Unicode 文字列） */
  onSelect: (icon: string) => void;
  /** 閉じる */
  onClose: () => void;
}

interface IconCategory {
  /** 表示名（タブのツールチップ用） */
  name: string;
  /** タブに表示する短いラベル（絵文字） */
  label: string;
  /** カテゴリに含まれる絵文字一覧 */
  icons: string[];
}

const ICON_CATEGORIES: IconCategory[] = [
  {
    name: '状態',
    label: '⭐',
    icons: [
      '✅', '❌', '⚠️', '❓', '❗', '⭐', '🔥', '💡',
      '📌', '🔖', '⏰', '⏳', '🕐', '🎯', '🚩', '🔔',
    ],
  },
  {
    name: '文書',
    label: '📄',
    icons: [
      '📄', '📁', '📂', '📋', '📎', '🔗', '📊', '📈',
      '📉', '📅', '📆', '📝', '✏️', '📚', '📖', '🔍',
    ],
  },
  {
    name: '記号',
    label: '❤️',
    icons: [
      '❤️', '💔', '✨', '💯', '➕', '➖', '✖️', '➗',
      '⚪', '⚫', '🔴', '🟢', '🟡', '🔵', '🟣', '🟠',
    ],
  },
  {
    name: '顔',
    label: '😊',
    icons: [
      '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😍',
      '🤔', '🙄', '😎', '😢', '😭', '😡', '🤯', '🥳',
    ],
  },
  {
    name: '手',
    label: '👍',
    icons: [
      '👍', '👎', '👌', '✋', '✊', '🙌', '👏', '🤝',
      '✍️', '🙏', '👋', '🤚', '✌️', '🤞', '🤟', '👊',
    ],
  },
  {
    name: '矢印',
    label: '➡️',
    icons: [
      '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️',
      '🔄', '🔃', '⤴️', '⤵️', '🔼', '🔽', '◀️', '▶️',
    ],
  },
  {
    name: '動物',
    label: '🐶',
    icons: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐨', '🐯', '🦁', '🐮', '🐷', '🐵', '🐔', '🐧',
    ],
  },
  {
    name: '食事',
    label: '🍎',
    icons: [
      '🍎', '🍌', '🍇', '🍕', '🍔', '🍣', '🍱', '🍰',
      '🍩', '☕', '🍺', '🍷', '🥗', '🍜', '🍙', '🍦',
    ],
  },
  {
    name: '旅行',
    label: '✈️',
    icons: [
      '🚗', '🚕', '🚙', '🚌', '🚂', '✈️', '🚢', '🛵',
      '🚲', '🏠', '🏢', '🏫', '🏥', '⛰️', '🗻', '🌍',
    ],
  },
];

/**
 * カテゴリ別の絵文字ピッカー（吹き出し型ポップアップ）。
 * ボタンの真下に表示され、上向きの三角ポインタを CSS で描画する。
 */
export default function IconPicker({ x, y, onSelect, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
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

  const active = ICON_CATEGORIES[activeIndex];

  return createPortal(
    <div
      ref={ref}
      className="icon-picker"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="アイコン選択"
    >
      <div className="icon-picker__tabs" role="tablist">
        {ICON_CATEGORIES.map((cat, i) => (
          <button
            key={cat.name}
            type="button"
            role="tab"
            aria-selected={i === activeIndex}
            className={`icon-picker__tab ${i === activeIndex ? 'is-active' : ''}`}
            onClick={() => setActiveIndex(i)}
            title={cat.name}
            aria-label={cat.name}
          >
            <span className="icon-picker__tab-label">{cat.label}</span>
          </button>
        ))}
      </div>
      <div className="icon-picker__grid" role="grid">
        {active.icons.map((icon, i) => (
          <button
            key={i}
            type="button"
            className="icon-picker__cell"
            onClick={() => {
              onSelect(icon);
              onClose();
            }}
            title={icon}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
