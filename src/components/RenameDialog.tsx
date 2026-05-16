import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  /** 編集対象の現在の名前（パス形式） */
  initialName: string;
  onClose: () => void;
  onSubmit: (newName: string) => void;
}

/**
 * ファイル名（パス形式）を編集するモーダルダイアログ。
 * Enter で送信、Escape で閉じる。空名はボタン disabled。
 */
export default function RenameDialog({
  open,
  initialName,
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  // 開いた時に初期値リセット + フォーカス + 全選択
  useEffect(() => {
    if (open) {
      setValue(initialName);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [open, initialName]);

  // ESC で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(value);
  };

  return (
    <div
      className="modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal modal--rename"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="rename-title" className="modal__title">
            名称変更
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

        <div className="modal__body rename-body">
          <p className="rename-body__desc">
            ファイル名を入力してください。スラッシュ区切りで階層を指定できます。
          </p>
          <input
            ref={inputRef}
            className="rename-body__input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder="例: 階層1/テスト1"
          />
        </div>

        <footer className="modal__footer">
          <button type="button" className="modal__btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="modal__btn modal__btn--primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
