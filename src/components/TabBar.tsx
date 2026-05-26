import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NoteMeta } from '../global';
import { buildPath } from '../utils/notePath';
import { useT } from '../i18n';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

interface Props {
  openTabIds: string[];
  activeId: string | null;
  notes: NoteMeta[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** 複数タブを一括で閉じる（右クリックメニュー経由） */
  onCloseMany: (ids: string[]) => void;
  /**
   * 右クリックメニューの「ノートの削除」から呼ばれる。
   * TabBar 側で確認モーダルを出してから呼び出すため、
   * 受け側は問答無用で削除して構わない。
   */
  onDeleteNote: (id: string) => void;
  /** タブの並び替え（ドラッグ&ドロップ経由）。新しい順序を受け取る */
  onReorder: (nextIds: string[]) => void;
  onSummarizeClick: (position: { x: number; y: number }) => void;
  onToggleAiChat: () => void;
  summarizeDisabled: boolean;
  summarizeBusy: boolean;
  aiChatOpen: boolean;
  aiEnabled: boolean;
  /**
   * 明示的にピン留めされたタブ ID の一覧。📍 はこれに含まれるタブだけ表示する。
   * 旧モデルは「preview tab 以外すべて 📍」だったため、タブクリックなどで
   * 一時的にピンが消える問題があった。新モデルではここに入ったら閉じるまで永続。
   */
  pinnedTabIds: readonly string[];
  /** 📍 表示の有効化フラグ（preview-tab モードが活きている時に true） */
  pinIndicatorEnabled: boolean;
  /**
   * タブをダブルクリックされた時に「ピン留め」する。既にピン留め済みでも
   * 何もしない (idempotent)。解除は右クリックメニュー等の別操作で行う。
   */
  onPinTab?: (id: string) => void;
}

/** 1 回のクリックで横スクロールする量 (px) */
const SCROLL_STEP = 200;

/**
 * メイン領域の最上部に表示するタブバー。
 * タブが横幅を超えてあふれた場合は、スクロールバーの代わりに
 * 左右端の `<<` `>>` ボタンで横スクロールする UI を提供する。
 *
 * 右クリックでタブ個別メニュー:
 *   - このタブを閉じる
 *   - 他を閉じる
 *   - すべてのタブを閉じる
 *   - 右のタブをすべて閉じる
 */
export default function TabBar({
  openTabIds,
  activeId,
  notes,
  onSelect,
  onClose,
  onCloseMany,
  onDeleteNote,
  onReorder,
  onSummarizeClick,
  onToggleAiChat,
  summarizeDisabled,
  summarizeBusy,
  aiChatOpen,
  aiEnabled,
  pinnedTabIds,
  pinIndicatorEnabled,
  onPinTab,
}: Props) {
  const t = useT();
  // 右クリックメニューの表示位置 + 対象タブ ID
  const [menu, setMenu] = useState<
    { x: number; y: number; tabId: string } | null
  >(null);

  // ノート削除確認モーダル: 開いていれば削除対象 ID を保持
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ----- ドラッグ&ドロップでの並び替え -----
  // 現在ドラッグ中のタブ ID。re-render を避けるため ref で保持。
  const draggingIdRef = useRef<string | null>(null);
  // ドロップ先プレビュー用: どのタブの「前/後」に挿入するか
  const [dropTarget, setDropTarget] = useState<
    | { id: string; side: 'before' | 'after' }
    | null
  >(null);

  const resetDrag = () => {
    draggingIdRef.current = null;
    setDropTarget(null);
  };

  // スクロール可能か（左/右）
  const listRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = listRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
  };

  // タブ数やウィンドウ幅が変わったらスクロール状態を再計算
  useLayoutEffect(() => {
    updateScrollState();
  }, [openTabIds.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener('scroll', onScroll, { passive: true });
    // ResizeObserver でタブリスト自身の幅変化に追従
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, []);

  // アクティブタブが表示領域外にあれば自動でスクロールして見えるようにする
  useLayoutEffect(() => {
    if (!activeId) return;
    const el = listRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"]`,
    );
    if (!target) return;
    const elRect = el.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    if (tRect.left < elRect.left) {
      el.scrollBy({ left: tRect.left - elRect.left - 8, behavior: 'smooth' });
    } else if (tRect.right > elRect.right) {
      el.scrollBy({ left: tRect.right - elRect.right + 8, behavior: 'smooth' });
    }
  }, [activeId]);

  if (openTabIds.length === 0) return null;

  const scrollBy = (delta: number) => {
    listRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, tabId: id });
  };

  const closeMenu = () => setMenu(null);

  const menuItems: ContextMenuItem[] = menu
    ? (() => {
        const idx = openTabIds.indexOf(menu.tabId);
        const rightIds = idx >= 0 ? openTabIds.slice(idx + 1) : [];
        const otherIds = openTabIds.filter((x) => x !== menu.tabId);
        const targetId = menu.tabId;
        return [
          {
            label: t.tabBar.closeThis,
            onClick: () => onClose(targetId),
          },
          {
            label: t.tabBar.closeToRight,
            disabled: rightIds.length === 0,
            onClick: () => onCloseMany(rightIds),
          },
          {
            label: t.tabBar.closeOthers,
            disabled: otherIds.length === 0,
            onClick: () => onCloseMany(otherIds),
          },
          {
            label: t.tabBar.closeAll,
            onClick: () => onCloseMany([...openTabIds]),
          },
          { separator: true },
          {
            label: t.tabBar.deleteThis,
            danger: true,
            // クリック直後に確認モーダルを開く
            // (ContextMenu はクリックで自動的に閉じる)
            onClick: () => setDeleteConfirm(targetId),
          },
        ];
      })()
    : [];

  // 確認モーダルが対象とするノートのタイトル
  const deleteTargetTitle = deleteConfirm
    ? notes.find((n) => n.id === deleteConfirm)?.title || '無題'
    : '';

  const showScrollControls = canScrollLeft || canScrollRight;

  const openSummarizeMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSummarizeClick({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
    });
  };

  return (
    <>
      <div className="tab-bar">
        {showScrollControls && (
          <button
            type="button"
            className="tab-bar__nav tab-bar__nav--left"
            onClick={() => scrollBy(-SCROLL_STEP)}
            disabled={!canScrollLeft}
            aria-label="タブを左へスクロール"
            title="タブを左へスクロール"
          >
            <ChevronLeftIcon />
            <ChevronLeftIcon />
          </button>
        )}
        <div className="tab-bar__list" role="tablist" ref={listRef}>
          {openTabIds.map((id) => {
            const meta = notes.find((n) => n.id === id);
            const title = meta?.title || '無題';
            const fullPath = meta
              ? buildPath(meta.folder, meta.title)
              : title;
            const isActive = id === activeId;
            // 📍 表示: pinIndicatorEnabled 有効 && pinnedTabIds に含まれる時のみ。
            // ピン状態はホスト (App.tsx) 側で明示的に管理されており、ここでは
            // ルックアップだけ行う。タブクリックや preview スワップで一時的に
            // ピンが消えないよう、previewTabId は判定から除外。
            const isPinned =
              pinIndicatorEnabled && pinnedTabIds.includes(id);
            const isDragging = draggingIdRef.current === id;
            const dropLeft =
              dropTarget?.id === id && dropTarget.side === 'before';
            const dropRight =
              dropTarget?.id === id && dropTarget.side === 'after';
            return (
              <div
                key={id}
                data-tab-id={id}
                className={
                  'tab' +
                  (isActive ? ' tab--active' : '') +
                  (isDragging ? ' tab--dragging' : '') +
                  (dropLeft ? ' tab--drop-before' : '') +
                  (dropRight ? ' tab--drop-after' : '')
                }
                role="tab"
                aria-selected={isActive}
                title={fullPath}
                draggable
                onMouseDown={(e) => {
                  // ミドルクリックで閉じる
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(id);
                  } else if (e.button === 0 && !isActive) {
                    onSelect(id);
                  }
                }}
                onDoubleClick={(e) => {
                  // ダブルクリックで「ピン留め」を立てる (idempotent: 既に
                  // ピン留め済みなら no-op)。プレビュータブ → 固定タブへの
                  // 昇格と同じ意味付け。
                  e.preventDefault();
                  if (!onPinTab) return;
                  if (pinnedTabIds.includes(id)) return;
                  onPinTab(id);
                }}
                onContextMenu={(e) => handleContextMenu(e, id)}
                onDragStart={(e) => {
                  draggingIdRef.current = id;
                  e.dataTransfer.effectAllowed = 'move';
                  // ドラッグ中のゴースト画像のために最低限のペイロードを設定
                  e.dataTransfer.setData('text/plain', id);
                }}
                onDragOver={(e) => {
                  const fromId = draggingIdRef.current;
                  if (!fromId || fromId === id) return;
                  e.preventDefault(); // drop を許可
                  e.dataTransfer.dropEffect = 'move';
                  // マウス X がタブ中央より左なら「前に挿入」、右なら「後ろに挿入」
                  const rect = e.currentTarget.getBoundingClientRect();
                  const side =
                    e.clientX < rect.left + rect.width / 2
                      ? 'before'
                      : 'after';
                  setDropTarget((prev) =>
                    prev?.id === id && prev.side === side
                      ? prev
                      : { id, side },
                  );
                }}
                onDragLeave={(e) => {
                  // タブ外に出た時だけクリア（子要素との行き来で誤発火しないよう判定）
                  if (
                    e.relatedTarget instanceof Node &&
                    e.currentTarget.contains(e.relatedTarget)
                  ) {
                    return;
                  }
                  setDropTarget((prev) => (prev?.id === id ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromId = draggingIdRef.current;
                  if (!fromId || fromId === id) {
                    resetDrag();
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const side =
                    e.clientX < rect.left + rect.width / 2
                      ? 'before'
                      : 'after';
                  // 並び順を組み立てる
                  const without = openTabIds.filter((x) => x !== fromId);
                  const targetIdx = without.indexOf(id);
                  if (targetIdx < 0) {
                    resetDrag();
                    return;
                  }
                  const insertAt =
                    side === 'before' ? targetIdx : targetIdx + 1;
                  const next = [
                    ...without.slice(0, insertAt),
                    fromId,
                    ...without.slice(insertAt),
                  ];
                  onReorder(next);
                  resetDrag();
                }}
                onDragEnd={() => {
                  resetDrag();
                }}
              >
                {isPinned && (
                  <span
                    className="tab__pin"
                    title="固定タブ(編集 or ダブルクリック)"
                    aria-label="固定"
                  >
                    <PinIcon />
                  </span>
                )}
                <span className="tab__title">{title}</span>
                <button
                  type="button"
                  className="tab__close"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(id);
                  }}
                  aria-label="タブを閉じる"
                  title="タブを閉じる"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        {showScrollControls && (
          <button
            type="button"
            className="tab-bar__nav tab-bar__nav--right"
            onClick={() => scrollBy(SCROLL_STEP)}
            disabled={!canScrollRight}
            aria-label="タブを右へスクロール"
            title="タブを右へスクロール"
          >
            <ChevronRightIcon />
            <ChevronRightIcon />
          </button>
        )}
        {aiEnabled && (
          <div className="tab-bar__actions" aria-label="AI操作">
            <span className="tab-bar__actions-label">AI</span>
            <button
              type="button"
              className="tab-bar__action-btn tab-bar__action-btn--icon"
              onClick={openSummarizeMenu}
              disabled={summarizeDisabled || summarizeBusy}
              title="AIでノートを整形・要約"
              aria-label="要約"
              aria-busy={summarizeBusy}
            >
              {summarizeBusy ? <SpinnerIcon /> : <SummarizeIcon />}
            </button>
            <button
              type="button"
              className={`tab-bar__action-btn tab-bar__action-btn--icon ${aiChatOpen ? 'is-active' : ''}`}
              onClick={onToggleAiChat}
              title="AIチャットを開閉"
              aria-label="AIチャット"
              aria-pressed={aiChatOpen}
            >
              <AiChatIcon />
            </button>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={closeMenu}
        />
      )}
      {deleteConfirm && (
        <DeleteNoteConfirm
          title={deleteTargetTitle}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => {
            const id = deleteConfirm;
            setDeleteConfirm(null);
            onDeleteNote(id);
          }}
        />
      )}
    </>
  );
}

/**
 * 「ノートの削除」確認モーダル。
 * 中央にダイアログを描画し、Esc / 外側クリック / キャンセルで閉じる。
 * 「削除」ボタンは赤色で強調し、誤操作を防ぐ。
 */
function DeleteNoteConfirm({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Escape キーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-note-title"
      onClick={onCancel}
    >
      <div
        className="modal modal--delete-note"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal--delete-note__inner">
          <h3
            className="modal--delete-note__title"
            id="delete-note-title"
          >
            ノートを削除しますか?
          </h3>
          <p className="modal--delete-note__body">
            「<strong>{title}</strong>」を完全に削除します。
            <br />
            <span className="modal--delete-note__warning">
              この操作は元に戻せません。
            </span>
          </p>
          <div className="modal--delete-note__actions">
            <button
              type="button"
              className="modal--delete-note__btn modal--delete-note__btn--secondary"
              onClick={onCancel}
              autoFocus
            >
              キャンセル
            </button>
            <button
              type="button"
              className="modal--delete-note__btn modal--delete-note__btn--danger"
              onClick={onConfirm}
            >
              削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 「固定タブ」マーカー用の画鋲アイコン。
 * Lucide 風の側面押しピンシルエットで、塗りつぶし＋アウトラインの
 * ハイブリッド描画にしてタブバーで存在感を出す。色は CSS 側で赤系を指定。
 */
function PinIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 針 (頭部から下に伸びる) */}
      <path d="M12 17v5" fill="none" strokeWidth="2" />
      {/* 押しピン本体: ヘッド+ディスク+軸根本のシルエット */}
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="10"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="10"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/**
 * 要約アイコン: テキスト行が圧縮される様子（長 → 短）+ 右上に AI スパークル。
 * 「AI が長い本文を凝縮して要約する」という意味を視覚化。
 */
function SummarizeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* テキスト行（上ほど長く、下ほど短く = 圧縮されていくイメージ） */}
      <line x1="3" y1="7" x2="17" y2="7" />
      <line x1="3" y1="11" x2="14" y2="11" />
      <line x1="3" y1="15" x2="11" y2="15" />
      <line x1="3" y1="19" x2="8" y2="19" />
      {/* 右上の AI スパークル */}
      <path
        d="M19 4 L19.7 6 L21.7 6.7 L19.7 7.4 L19 9.4 L18.3 7.4 L16.3 6.7 L18.3 6 Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/**
 * 処理中スピナー。CSS アニメーションで回転（既存 `.activity__icon--spinning` を流用）。
 */
function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="activity__icon--spinning"
    >
      {/* 円弧（3/4 周） */}
      <path d="M12 3 a9 9 0 1 0 9 9" />
    </svg>
  );
}

/**
 * AI チャットアイコン: 吹き出し（チャット）+ 中の 4 点スパークル（AI）。
 * Apple Intelligence / Gemini 等で定着している sparkle = AI のメタファーと、
 * speech bubble = チャットを組み合わせた視覚記号。
 */
function AiChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 吹き出し（左下にしっぽ） */}
      <path d="M5 4 H19 A2 2 0 0 1 21 6 V15 A2 2 0 0 1 19 17 H10 L6 21 V17 H5 A2 2 0 0 1 3 15 V6 A2 2 0 0 1 5 4 Z" />
      {/* 中央のスパークル（AI 表現） */}
      <path
        d="M12 7.5 L12.9 10.1 L15.5 11 L12.9 11.9 L12 14.5 L11.1 11.9 L8.5 11 L11.1 10.1 Z"
        fill="currentColor"
        stroke="none"
      />
      {/* 右上の小さなサブスパークル（生成的な雰囲気） */}
      <path
        d="M17 6 L17.4 7 L18.4 7.4 L17.4 7.8 L17 8.8 L16.6 7.8 L15.6 7.4 L16.6 7 Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
