import { useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';

interface Props {
  /** 現在のタグ一覧 */
  tags: string[];
  /** タグ一覧が変わった時に呼ばれる（追加/削除/編集すべて含む） */
  onChange: (next: string[]) => void;
}

/**
 * EditorToolbar 直下に配置するタグ入力バー。
 * カンマ区切りで複数タグを入力でき、確定したタグはバッジとして左側に並ぶ。
 *
 * 入力ルール:
 * - カンマ (`,` または `、`) を入力した瞬間、その手前の文字列が新しいタグになる
 * - Enter キーでも確定する（IME 変換中の Enter は無視）
 * - 空入力でバックスペースを押すと末尾のタグを削除
 * - 重複タグは自動的に除外される
 * - バッジ右端の `×` をクリックすると個別に削除
 */
export default function TagBar({ tags, onChange }: Props) {
  const t = useT();
  const [draft, setDraft] = useState('');
  // IME 変換中フラグ。変換中の Enter で確定しないようにする
  const [composing, setComposing] = useState(false);

  /** draft 文字列から新規タグを抽出して既存配列に追加 */
  const commit = (raw: string) => {
    // カンマで分割（半角・全角どちらも）
    const parts = raw
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;
    const merged = [...tags];
    for (const p of parts) {
      if (!merged.includes(p)) merged.push(p);
    }
    onChange(merged);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // カンマが含まれていたら、カンマで分割して確定+残りを draft に
    if (/[,、]/.test(value)) {
      const lastSep = Math.max(value.lastIndexOf(','), value.lastIndexOf('、'));
      const head = value.slice(0, lastSep);
      const tail = value.slice(lastSep + 1);
      commit(head);
      setDraft(tail);
    } else {
      setDraft(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !composing) {
      e.preventDefault();
      if (draft.trim().length > 0) {
        commit(draft);
        setDraft('');
      }
    } else if (e.key === 'Backspace' && draft.length === 0 && tags.length > 0) {
      // 空入力で BS → 末尾を削除
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  const handleBlur = () => {
    // フォーカスアウト時にも未確定 draft をコミット
    if (draft.trim().length > 0) {
      commit(draft);
      setDraft('');
    }
  };

  const removeTag = (idx: number) => {
    const next = [...tags];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div className="tag-bar" role="group" aria-label={t.tagBar.ariaLabel}>
      <span className="tag-bar__icon" aria-hidden="true">
        <TagIcon />
      </span>
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="tag-bar__badge">
          <span className="tag-bar__badge-label">{tag}</span>
          <button
            type="button"
            className="tag-bar__badge-remove"
            onClick={() => removeTag(i)}
            title={`${t.tagBar.remove}: ${tag}`}
            aria-label={`${t.tagBar.remove}: ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-bar__input"
        type="text"
        value={draft}
        placeholder={tags.length === 0 ? t.tagBar.placeholder : ''}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
      />
    </div>
  );
}

function TagIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8 L8 2 H14 V8 L8 14 Z" />
      <circle cx="11" cy="5" r="0.9" />
    </svg>
  );
}
