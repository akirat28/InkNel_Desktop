import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** ポップオーバーの表示位置（ボタン中心の x、ボタン下端 y） */
  x: number;
  y: number;
  /** ラベル欄の初期値（編集ビューで選択中のテキストがあればそれを渡す） */
  initialLabel?: string;
  /** OK 押下時に呼ばれる。{ url, label } を返す（label 空ならフォールバック挙動は親で） */
  onSubmit: (url: string, label: string) => void;
  /** 閉じる（キャンセル / 外側クリック / Escape） */
  onClose: () => void;
}

/**
 * EditorToolbar のリンクボタンを押した時に表示する吹き出し型ポップオーバー。
 * URL とラベルテキストを入力し、OK で `[label](url)` をエディタへ挿入する。
 *
 * - 表示位置は親側でボタン中心の x を渡し、CSS の transform: translateX(-50%) で中央寄せ
 * - マウント時に URL 入力欄へオートフォーカス
 * - Escape / 外側クリック / Cancel ボタンで閉じる
 * - Enter で OK 実行
 */
export default function LinkPopover({
  x,
  y,
  initialLabel = '',
  onSubmit,
  onClose,
}: Props) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState(initialLabel);
  const ref = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // 外側クリック / Escape で閉じる
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

  // URL 欄にオートフォーカス
  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  const canSubmit = url.trim().length > 0;

  const handleOk = () => {
    if (!canSubmit) return;
    onSubmit(url.trim(), label.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      handleOk();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="link-popover"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="リンクを挿入"
    >
      <div className="link-popover__field">
        <label className="link-popover__label" htmlFor="link-popover-url">
          URL
        </label>
        <input
          id="link-popover-url"
          ref={urlInputRef}
          className="link-popover__input"
          type="text"
          value={url}
          placeholder="https://example.com"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="link-popover__field">
        <label className="link-popover__label" htmlFor="link-popover-label">
          表示テキスト
        </label>
        <input
          id="link-popover-label"
          className="link-popover__input"
          type="text"
          value={label}
          placeholder="（省略時は URL と同じ）"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="link-popover__actions">
        <button
          type="button"
          className="link-popover__btn link-popover__btn--cancel"
          onClick={onClose}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="link-popover__btn link-popover__btn--ok"
          onClick={handleOk}
          disabled={!canSubmit}
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
