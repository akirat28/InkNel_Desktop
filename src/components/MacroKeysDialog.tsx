import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  keys: string[];
  onClose: () => void;
  onSave: (name: string) => void;
}

export default function MacroKeysDialog({
  open,
  keys,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setSavedMessage('');
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

  const canSave = keys.length > 0 && name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave(name);
    setSavedMessage('保存しました。');
  };

  return (
    <div className="modal__backdrop" onClick={onClose} role="presentation">
      <div
        className="modal modal--macro-keys"
        role="dialog"
        aria-modal="true"
        aria-labelledby="macro-keys-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="macro-keys-title" className="modal__title">
            マクロの保存と名前
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
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSavedMessage('');
                }}
                placeholder="マクロ名"
                aria-label="マクロ名"
              />
              <button
                type="button"
                className="modal__btn modal__btn--primary"
                onClick={handleSave}
                disabled={!canSave}
              >
                保存
              </button>
            </div>
            {savedMessage && (
              <p className="macro-keys__saved-message" role="status">
                {savedMessage}
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
        </footer>
      </div>
    </div>
  );
}
