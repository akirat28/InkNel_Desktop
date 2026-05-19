import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  name: string;
  keys: string[];
  onClose: () => void;
  onRename: (name: string) => void;
  onSetToF1: () => void;
  onDelete: () => void;
}

export default function SavedMacroDialog({
  open,
  name,
  keys,
  onClose,
  onRename,
  onSetToF1,
  onDelete,
}: Props) {
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (open) {
      setValue(name);
      setMessage('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const canRename = value.trim().length > 0 && value.trim() !== name;

  const handleRename = () => {
    if (!canRename) return;
    onRename(value);
    setMessage('保存しました。');
  };

  const handleSetToF1 = () => {
    onSetToF1();
    setMessage('F1キーにセットしました。');
  };

  return (
    <div className="modal__backdrop" onClick={onClose} role="presentation">
      <div
        className="modal modal--macro-keys"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-macro-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="saved-macro-title" className="modal__title">
            保存済みマクロ
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

        <div className="modal__body macro-keys">
          <section className="macro-keys__section">
            <div className="macro-keys__save">
              <input
                className="macro-keys__input"
                type="text"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setMessage('');
                }}
                aria-label="マクロ名"
              />
              <button
                type="button"
                className="modal__btn modal__btn--primary"
                onClick={handleRename}
                disabled={!canRename}
              >
                保存
              </button>
            </div>

            {message && (
              <p className="macro-keys__saved-message" role="status">
                {message}
              </p>
            )}

            {keys.length === 0 ? (
              <p className="modal__placeholder">記録したキーはありません。</p>
            ) : (
              <ol className="macro-keys__list">
                {keys.map((key, index) => (
                  <li className="macro-keys__item" key={`${index}-${key}`}>
                    <span className="macro-keys__index">{index + 1}</span>
                    <code className="macro-keys__key">{key}</code>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <footer className="modal__footer">
          <button type="button" className="modal__btn" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="modal__btn" onClick={onDelete}>
            このマクロを削除
          </button>
          <button
            type="button"
            className="modal__btn modal__btn--primary"
            onClick={handleSetToF1}
          >
            このマクロをF1キーにセット
          </button>
        </footer>
      </div>
    </div>
  );
}
