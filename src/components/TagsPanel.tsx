import { useEffect, useState } from 'react';
import type { NoteMeta } from '../global';

interface Props {
  /** 現在選択中のノート ID（一覧でのアクティブハイライト用） */
  activeId: string | null;
  /** 子のノート行を押した時のコールバック */
  onSelect: (id: string) => void;
}

interface TagEntry {
  tag: string;
  notes: NoteMeta[];
}

/**
 * サイドバーのタグ表示モード。
 * マウント時に main プロセスから全タグ一覧を取得し、
 * 各タグをクリックするとアコーディオンで配下ノートを展開する。
 */
export default function TagsPanel({ activeId, onSelect }: Props) {
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // 展開状態（タグ名 -> bool）。デフォルトは折りたたみ
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.api.notes
      .listTags()
      .then((list) => {
        if (cancelled) return;
        setTags(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTags([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (tag: string) =>
    setExpanded((prev) => ({ ...prev, [tag]: !prev[tag] }));

  if (loading) {
    return <div className="sidebar__empty">読み込み中...</div>;
  }

  if (tags.length === 0) {
    return (
      <div className="sidebar__empty">
        （タグはありません）
        <br />
        本文に <code>#タグ名</code> と書くと表示されます
      </div>
    );
  }

  return (
    <div className="tags-panel">
      <ul className="tags-list" role="tree">
        {tags.map(({ tag, notes }) => {
          const open = expanded[tag] === true;
          return (
            <li
              key={tag}
              className="tags-list__item"
              role="treeitem"
              aria-expanded={open}
            >
              <button
                type="button"
                className="tags-list__row"
                onClick={() => toggle(tag)}
              >
                <span className="tree__chevron">{open ? '▼' : '▶'}</span>
                <span className="tags-list__icon">
                  <TagSmallIcon />
                </span>
                <span className="tags-list__label">#{tag}</span>
                <span className="tags-list__count">{notes.length}</span>
              </button>
              {open && (
                <ul className="tags-list__children" role="group">
                  {notes.map((n) => {
                    const active = activeId === n.id;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`tree__row tree__file ${active ? 'is-active' : ''}`}
                          onClick={() => onSelect(n.id)}
                          style={{ paddingLeft: 32 }}
                        >
                          <span className="tree__icon">
                            <FileItemIcon />
                          </span>
                          <span className="tree__label">
                            {n.title || '無題'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** タグ行のアイコン (14x14) */
function TagSmallIcon() {
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

/** タグ配下のノート行用ファイルアイコン (14x14) */
function FileItemIcon() {
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
      <path d="M3 1.75h5.5L13 6.25v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z" />
      <path d="M8.5 1.75v4.5H13" />
    </svg>
  );
}
