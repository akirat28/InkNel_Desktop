import { useEffect, useRef, useState } from 'react';
import { useDraggable } from '../utils/useDraggable';

interface Props {
  open: boolean;
  /** 「次を検索」: カーソル以降で次のヒットへ移動。見つかったかを返す */
  onFindNext: (query: string) => boolean;
  /** 「前を検索」: カーソル以前で最後のヒットへ移動。見つかったかを返す */
  onFindPrev: (query: string) => boolean;
  onClose: () => void;
}

// ダイアログの想定サイズ（初期中央配置計算に使用）
const DIALOG_WIDTH = 440;
const DIALOG_HEIGHT = 220;

/**
 * 編集中ノートの本文を前方・後方に検索する非モーダルダイアログ。
 * - 背景はなく、エディタ操作をブロックしない
 * - ヘッダー部分をマウスドラッグで移動できる
 * - Enter で次を検索 / Shift+Enter で前を検索 / Escape で閉じる
 */
export default function FindDialog({
  open,
  onFindNext,
  onFindPrev,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const { pos, setPos, onHeaderMouseDown } = useDraggable();

  // 開いた瞬間にダイアログを画面中央へ配置（初回のみ）。
  // 2 回目以降の開閉ではユーザーが移動した位置を維持する方が親切なので、
  // 既存の pos があればそれを使い、null の場合のみ中央化する。
  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setPos((prev) =>
      prev ?? {
        x: Math.max(0, Math.round((window.innerWidth - DIALOG_WIDTH) / 2)),
        y: Math.max(0, Math.round(window.innerHeight / 3 - DIALOG_HEIGHT / 2)),
      },
    );
    setTimeout(() => {
      queryRef.current?.focus();
      queryRef.current?.select();
    }, 0);
  }, [open, setPos]);

  // Escape で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !pos) return null;

  const canSearch = query.length > 0;

  const handleNext = () => {
    if (!canSearch) return;
    const found = onFindNext(query);
    setMessage(found ? null : '該当する文字列は見つかりません');
  };

  const handlePrev = () => {
    if (!canSearch) return;
    const found = onFindPrev(query);
    setMessage(found ? null : '該当する文字列は見つかりません');
  };

  return (
    <div
      className="modal modal--find modal--floating"
      role="dialog"
      aria-modal="false"
      aria-labelledby="find-title"
      style={{ left: pos.x, top: pos.y }}
    >
      <header
        className="modal__header modal__header--draggable"
        onMouseDown={onHeaderMouseDown}
      >
        <h2 id="find-title" className="modal__title">
          検索
        </h2>
        <button
          type="button"
          className="modal__close"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      </header>

      <div className="modal__body replace-body">
        <label className="replace-body__label">
          検索
          <input
            ref={queryRef}
            className="replace-body__input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMessage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) handlePrev();
                else handleNext();
              }
            }}
            placeholder="検索したい文字列"
          />
        </label>

        {message && <p className="replace-body__message">{message}</p>}
      </div>

      <footer className="modal__footer modal__footer--replace">
        <button
          type="button"
          className="modal__btn"
          onClick={handlePrev}
          disabled={!canSearch}
        >
          前を検索
        </button>
        <button
          type="button"
          className="modal__btn modal__btn--primary"
          onClick={handleNext}
          disabled={!canSearch}
        >
          次を検索
        </button>
        <button type="button" className="modal__btn" onClick={onClose}>
          閉じる
        </button>
      </footer>
    </div>
  );
}
