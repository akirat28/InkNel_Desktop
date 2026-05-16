import { useEffect, useRef, useState } from 'react';
import PinInput, { type PinInputHandle } from './PinInput';

interface Props {
  open: boolean;
  onClose: () => void;
  /** true を返すと正解、false でエラー表示 */
  onSubmit: (password: string) => boolean;
  /** ダイアログ本文の説明文（用途に応じて差し替え可能） */
  description?: string;
  /** OK ボタンのラベル（既定: "解錠"） */
  submitLabel?: string;
}

const DEFAULT_DESCRIPTION =
  'このノートは保護されています。編集するには4桁のパスワードを入力してください。';

/**
 * 保護されたノートを編集ビューで開くための4桁パスワード入力ダイアログ。
 * Enter で送信、Escape で閉じる。
 */
export default function PasswordDialog({
  open,
  onClose,
  onSubmit,
  description = DEFAULT_DESCRIPTION,
  submitLabel = '解錠',
}: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<PinInputHandle>(null);

  // 開いた直後にリセット + フォーカス
  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
      // 描画後にフォーカス
      setTimeout(() => pinRef.current?.focus(), 0);
    }
  }, [open]);

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

  const handleChange = (next: string) => {
    setValue(next);
    setError(null);
  };

  const handleSubmit = () => {
    if (value.length !== 4) {
      setError('パスワードは4桁の数字です');
      return;
    }
    const ok = onSubmit(value);
    if (!ok) {
      setError('パスワードが正しくありません');
      setValue('');
      pinRef.current?.reset();
    }
  };

  return (
    <div
      className="modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal modal--password"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="password-title" className="modal__title">
            パスワード入力
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

        <div className="modal__body password-body">
          <p className="password-body__desc">{description}</p>
          <PinInput
            ref={pinRef}
            value={value}
            onChange={handleChange}
            onEnter={handleSubmit}
            onComplete={() => {
              // 4桁入力完了時に自動送信はせず Enter を待つ。必要なら有効化可能。
            }}
            ariaLabel="パスワード"
          />
          {error && <p className="password-body__error">{error}</p>}
        </div>

        <footer className="modal__footer">
          <button type="button" className="modal__btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="modal__btn modal__btn--primary"
            onClick={handleSubmit}
          >
            {submitLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
