import { useEffect, useRef, useState } from 'react';
import { useDraggable } from '../utils/useDraggable';

interface Props {
  open: boolean;
  /** 「次を検索」: カーソル以降で次のヒットへ移動 */
  onFindNext: (query: string) => boolean;
  /** 「置換」: 現在の選択が query と一致していれば置換し、次のヒットへ */
  onReplaceCurrent: (query: string, replacement: string) => boolean;
  /** 「すべて置換」: 全ての一致を一括置換。置換件数を返す */
  onReplaceAll: (query: string, replacement: string) => number;
  onClose: () => void;
}

const DIALOG_WIDTH = 440;
const DIALOG_HEIGHT = 280;

/**
 * 編集中ノートの本文に対する検索・置換を行う非モーダルダイアログ。
 * - ヘッダーをマウスドラッグで移動可能
 * - 背景はなくエディタ操作をブロックしない
 * - Escape で閉じる
 */
export default function ReplaceDialog({
  open,
  onFindNext,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const { pos, setPos, onHeaderMouseDown } = useDraggable();

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

  const handleFindNext = () => {
    if (!canSearch) return;
    const found = onFindNext(query);
    setMessage(found ? null : '該当する文字列は見つかりません');
  };

  const handleReplaceOnce = () => {
    if (!canSearch) return;
    const didReplace = onReplaceCurrent(query, replacement);
    if (didReplace) {
      setMessage('1 件置換しました');
      const next = onFindNext(query);
      if (!next) setMessage('1 件置換しました（他に一致はありません）');
    } else {
      const found = onFindNext(query);
      setMessage(
        found
          ? 'まず「置換」をもう一度押すと置換されます'
          : '該当する文字列は見つかりません',
      );
    }
  };

  const handleReplaceAll = () => {
    if (!canSearch) return;
    const count = onReplaceAll(query, replacement);
    setMessage(
      count > 0
        ? `${count} 件を一括置換しました`
        : '該当する文字列は見つかりません',
    );
  };

  return (
    <div
      className="modal modal--replace modal--floating"
      role="dialog"
      aria-modal="false"
      aria-labelledby="replace-title"
      style={{ left: pos.x, top: pos.y }}
    >
      <header
        className="modal__header modal__header--draggable"
        onMouseDown={onHeaderMouseDown}
      >
        <h2 id="replace-title" className="modal__title">
          置換
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
              if (e.key === 'Enter') handleFindNext();
            }}
            placeholder="置換元の文字列"
          />
        </label>

        <label className="replace-body__label">
          置換
          <input
            className="replace-body__input"
            type="text"
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
              setMessage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleReplaceOnce();
            }}
            placeholder="置換後の文字列（空欄で削除）"
          />
        </label>

        {message && <p className="replace-body__message">{message}</p>}
      </div>

      <footer className="modal__footer modal__footer--replace">
        <button
          type="button"
          className="modal__btn"
          onClick={handleFindNext}
          disabled={!canSearch}
        >
          次を検索
        </button>
        <button
          type="button"
          className="modal__btn"
          onClick={handleReplaceOnce}
          disabled={!canSearch}
        >
          置換
        </button>
        <button
          type="button"
          className="modal__btn modal__btn--primary"
          onClick={handleReplaceAll}
          disabled={!canSearch}
        >
          すべて置換
        </button>
        <button type="button" className="modal__btn" onClick={onClose}>
          閉じる
        </button>
      </footer>
    </div>
  );
}
