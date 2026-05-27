import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuActionItem {
  label: string;
  /** クリック時に呼ぶ。submenu を持つ項目では省略可 (= 何もしない) */
  onClick?: () => void;
  /** 左側に表示するアイコン（SVG / 色付き ● 文字 など） */
  icon?: ReactNode;
  /** 危険な操作（削除など）は赤系のスタイルにする */
  danger?: boolean;
  /** 無効化されたアイテムはクリック不可・グレーアウト */
  disabled?: boolean;
  /**
   * 子メニュー。指定するとマウスホバーで右に展開される (OS ネイティブのサブメニュー風)。
   * クリック自体は子メニューを開閉するだけで onClick は呼ばれない (= 親項目は分岐点)。
   */
  submenu?: ContextMenuItem[];
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

const VIEWPORT_MARGIN = 6;

/**
 * `requestedX/Y` の位置にメニューを置くと viewport を超えるか測り、超える場合は
 * 反対方向に開く。例えば右下端で右クリックした場合は左上方向にメニューが伸びる。
 *
 * - anchorRight: submenu の場合 true。アンカー (親項目) の右端から開くが、右が
 *   足りなければアンカーの左端 - 自身幅 の位置 (= 左に向かって開く) に切り替える。
 *   anchorWidth は反転計算に使う (= 親項目の幅相当)。
 */
function clampWithFlip(
  requestedX: number,
  requestedY: number,
  width: number,
  height: number,
  opts: { anchorRight?: boolean; anchorWidth?: number } = {},
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = requestedX;
  let top = requestedY;
  if (opts.anchorRight && left + width + VIEWPORT_MARGIN > vw) {
    // submenu が右にはみ出す → 親項目の左側に展開
    left = requestedX - width - (opts.anchorWidth ?? 0);
  } else if (left + width + VIEWPORT_MARGIN > vw) {
    left = vw - width - VIEWPORT_MARGIN;
  }
  if (top + height + VIEWPORT_MARGIN > vh) {
    top = vh - height - VIEWPORT_MARGIN;
  }
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
  return { left, top };
}

/**
 * 任意の位置に表示する小さなポップアップメニュー。
 * document.body に portal でレンダし、メニュー外クリック / Escape で閉じる。
 * submenu 付き項目はホバーで右に子メニューを展開する。
 *
 * ウィンドウ端で右クリックした場合、サイズ測定後に反対方向 (左 / 上) に反転して
 * 自動的にメニュー全体が viewport 内に収まる位置に調整する (OS ネイティブメニュー
 * のように本物の OS ウィンドウ外には出られないが、画面内では切れずに全部見える)。
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });
  // ホバー中のサブメニュー (項目 index + アンカー要素の矩形)。
  const [submenuOpen, setSubmenuOpen] = useState<{
    index: number;
    submenu: ContextMenuItem[];
    /** 親項目の getBoundingClientRect 結果 (反転位置計算に使う) */
    anchorLeft: number;
    anchorRight: number;
    anchorTop: number;
  } | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [submenuPos, setSubmenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleSubmenuClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setSubmenuOpen(null);
      setSubmenuPos(null);
    }, 180);
  };

  // 親メニュー: マウント後にサイズを測って viewport クリップ + 反転
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const r = menuRef.current.getBoundingClientRect();
    setPos(clampWithFlip(x, y, r.width, r.height));
  }, [x, y, items]);

  // 子メニュー: マウント後にサイズを測って親項目の右側 → 入らなければ左側へ
  useLayoutEffect(() => {
    if (!submenuOpen || !submenuRef.current) {
      setSubmenuPos(null);
      return;
    }
    const r = submenuRef.current.getBoundingClientRect();
    const { left, top } = clampWithFlip(
      submenuOpen.anchorRight,
      submenuOpen.anchorTop,
      r.width,
      r.height,
      {
        anchorRight: true,
        anchorWidth: submenuOpen.anchorRight - submenuOpen.anchorLeft,
      },
    );
    setSubmenuPos({ left, top });
  }, [submenuOpen]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('.ctx-menu--submenu')
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
      clearCloseTimer();
    };
  }, [onClose]);

  return createPortal(
    <>
      <div
        ref={menuRef}
        className="ctx-menu"
        // 親メニューは初回マウント時にサイズ測定で再配置するが、レンダリング前は
        // visibility:hidden で位置のチラつきを避ける
        style={{
          left: pos.left,
          top: pos.top,
          visibility:
            pos.left === x && pos.top === y && items.length === 0
              ? 'hidden'
              : 'visible',
        }}
        role="menu"
      >
        {items.map((item, idx) => {
          if (item.separator) {
            return (
              <div key={idx} className="ctx-menu__sep" role="separator" />
            );
          }
          const hasSubmenu = !!item.submenu && item.submenu.length > 0;
          return (
            <button
              key={idx}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-haspopup={hasSubmenu ? 'menu' : undefined}
              aria-expanded={
                hasSubmenu ? submenuOpen?.index === idx : undefined
              }
              className={`ctx-menu__item ${item.danger ? 'is-danger' : ''} ${item.disabled ? 'is-disabled' : ''} ${hasSubmenu ? 'has-submenu' : ''}`}
              onMouseEnter={(e) => {
                clearCloseTimer();
                if (!hasSubmenu) {
                  if (submenuOpen) scheduleSubmenuClose();
                  return;
                }
                const r = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                setSubmenuOpen({
                  index: idx,
                  submenu: item.submenu!,
                  anchorLeft: r.left,
                  anchorRight: r.right - 2,
                  anchorTop: r.top,
                });
              }}
              onMouseLeave={() => {
                if (hasSubmenu) scheduleSubmenuClose();
              }}
              onClick={() => {
                if (item.disabled) return;
                if (hasSubmenu) return;
                item.onClick?.();
                onClose();
              }}
            >
              {item.icon && (
                <span className="ctx-menu__icon">{item.icon}</span>
              )}
              <span className="ctx-menu__label">{item.label}</span>
              {hasSubmenu && (
                <span className="ctx-menu__chevron" aria-hidden="true">
                  ▸
                </span>
              )}
            </button>
          );
        })}
      </div>
      {submenuOpen && (
        <div
          ref={submenuRef}
          className="ctx-menu ctx-menu--submenu"
          style={{
            left: submenuPos?.left ?? submenuOpen.anchorRight,
            top: submenuPos?.top ?? submenuOpen.anchorTop,
            // 測定前は不可視にしてチラつきを防ぐ
            visibility: submenuPos ? 'visible' : 'hidden',
          }}
          role="menu"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleSubmenuClose}
        >
          {submenuOpen.submenu.map((sub, sidx) => {
            if (sub.separator) {
              return (
                <div key={sidx} className="ctx-menu__sep" role="separator" />
              );
            }
            return (
              <button
                key={sidx}
                type="button"
                role="menuitem"
                disabled={sub.disabled}
                className={`ctx-menu__item ${sub.danger ? 'is-danger' : ''} ${sub.disabled ? 'is-disabled' : ''}`}
                onClick={() => {
                  if (sub.disabled) return;
                  sub.onClick?.();
                  onClose();
                }}
              >
                {sub.icon && (
                  <span className="ctx-menu__icon">{sub.icon}</span>
                )}
                <span className="ctx-menu__label">{sub.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </>,
    document.body,
  );
}
