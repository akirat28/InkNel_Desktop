import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuActionItem {
  label: string;
  onClick: () => void;
  /** 左側に表示するアイコン（SVG など） */
  icon?: ReactNode;
  /** 危険な操作（削除など）は赤系のスタイルにする */
  danger?: boolean;
  /** 無効化されたアイテムはクリック不可・グレーアウト */
  disabled?: boolean;
  separator?: false;
}

/** 項目間に挟む区切り線 */
export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuItem = ContextMenuActionItem | ContextMenuSeparator;

interface Props {
  /** 表示位置（ビューポート座標） */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 任意の位置に表示する小さなポップアップメニュー。
 * document.body に portal でレンダし、メニュー外クリック / Escape で閉じる。
 * 左側に三角ポインタを CSS で描画する吹き出し型。
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
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

  return createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="ctx-menu__sep" role="separator" />;
        }
        return (
          <button
            key={idx}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`ctx-menu__item ${item.danger ? 'is-danger' : ''} ${item.disabled ? 'is-disabled' : ''}`}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            {item.icon && <span className="ctx-menu__icon">{item.icon}</span>}
            <span className="ctx-menu__label">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
