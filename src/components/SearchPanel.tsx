import { useEffect, useRef, useState } from 'react';
import type { NoteMeta } from '../global';
import { useT } from '../i18n';

interface Props {
  /** クエリを検索して結果を返す（メインプロセス IPC） */
  onSearch: (query: string) => Promise<NoteMeta[]>;
  /** 結果クリック時のセレクト */
  onSelect: (id: string) => void;
  /** ハイライト用の現在のアクティブノート */
  activeId: string | null;
  /** 検索キーワードの履歴（新しい順） */
  history: string[];
  /** 検索実行時に履歴に追加する */
  onAddHistory: (query: string) => void;
}

export default function SearchPanel({
  onSearch,
  onSelect,
  activeId,
  history,
  onAddHistory,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NoteMeta[] | null>(null);
  const [busy, setBusy] = useState(false);

  // 矢印キーで履歴をたどる際のインデックス
  // -1: 履歴未選択（ユーザーが入力中、または初期状態）
  //  0: 最新の履歴
  //  1+: それより古い履歴
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  // ↑キー押下時に保存する「現在のドラフト」（↓で先頭まで戻った時に復元）
  const draftRef = useRef<string>('');

  const inputRef = useRef<HTMLInputElement>(null);

  // 表示時に入力欄へフォーカス
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setBusy(true);
    try {
      const list = await onSearch(trimmed);
      setResults(list);
      onAddHistory(trimmed);
      // 検索完了後は履歴インデックスをリセット
      setHistoryIndex(-1);
      draftRef.current = '';
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch();
      return;
    }

    if (e.key === 'ArrowUp') {
      // 1つ古い履歴へ
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIndex === -1) {
        // 履歴に入る瞬間に現在のドラフトを退避
        draftRef.current = query;
      }
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next !== historyIndex) {
        setHistoryIndex(next);
        setQuery(history[next]);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      // 1つ新しい履歴へ
      if (historyIndex === -1) return; // 既に最新（ドラフト）
      e.preventDefault();
      const next = historyIndex - 1;
      if (next === -1) {
        // 先頭まで戻ったらドラフトを復元
        setHistoryIndex(-1);
        setQuery(draftRef.current);
      } else {
        setHistoryIndex(next);
        setQuery(history[next]);
      }
      return;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // ユーザーが手入力したら履歴ナビ状態をリセット
    setQuery(e.target.value);
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      draftRef.current = '';
    }
  };

  return (
    <div className="search-panel">
      <div className="search-panel__form">
        <input
          ref={inputRef}
          className="search-panel__input"
          type="search"
          value={query}
          placeholder={t.searchPanel.placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="search-panel__btn"
          onClick={() => void runSearch()}
          disabled={busy || query.trim().length === 0}
        >
          {t.searchPanel.searchBtn}
        </button>
      </div>

      <div className="search-panel__results">
        {results === null ? (
          <p className="search-panel__hint">
            {t.searchPanel.prompt}
            {history.length > 0 && (
              <>
                <br />
                <span className="search-panel__hint-sub">
                  {t.searchPanel.historyHint}
                </span>
              </>
            )}
          </p>
        ) : results.length === 0 ? (
          <p className="search-panel__hint">{t.searchPanel.noResults}</p>
        ) : (
          <>
            <p className="search-panel__count">
              {t.searchPanel.resultsCount.replace(
                '{{count}}',
                String(results.length),
              )}
            </p>
            <ul className="search-panel__list">
              {results.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`search-panel__item ${activeId === note.id ? 'is-active' : ''}`}
                    onClick={() => onSelect(note.id)}
                  >
                    <span className="search-panel__item-row">
                      <span className="search-panel__item-title">
                        {note.title || t.common.untitled}
                      </span>
                      {note.protected && (
                        <span
                          className="search-panel__lock"
                          title={t.searchPanel.protectedLabel}
                          aria-label={t.searchPanel.protectedLabel}
                        >
                          <SmallLockIcon />
                        </span>
                      )}
                    </span>
                    {note.folder && (
                      <span className="search-panel__item-folder">
                        {note.folder}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function SmallLockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.2" />
      <path d="M5.2 7 V4.8 a2.8 2.8 0 0 1 5.6 0 V7" />
    </svg>
  );
}
