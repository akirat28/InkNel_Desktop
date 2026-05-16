import { useMemo } from 'react';
import type { NoteMeta } from '../global';

/** 開封履歴の 1 エントリ */
export interface HistoryEntry {
  noteId: string;
  openedAt: number;
}

interface Props {
  /** 履歴（新しい順） */
  entries: HistoryEntry[];
  /** 現在の全ノート（タイトル参照に使う） */
  notes: NoteMeta[];
  /** 現在選択中のノート（ハイライト用） */
  activeId: string | null;
  /** ノート行クリック時 */
  onSelect: (id: string) => void;
  /** 「履歴をクリア」押下時 */
  onClear: () => void;
}

/** 日時を YYYY-MM-DD HH:mm に整形 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * サイドバーの履歴モード。
 * 開いたノートを新しい順に並べる。タイトルは現在の notes 一覧から解決。
 * 既に削除されたノート ID はスキップして表示しない。
 */
export default function HistoryPanel({
  entries,
  notes,
  activeId,
  onSelect,
  onClear,
}: Props) {
  // ノート ID → メタの索引
  const noteById = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  // 存在するノートだけを残す
  const visible = useMemo(
    () => entries.filter((e) => noteById.has(e.noteId)),
    [entries, noteById],
  );

  if (visible.length === 0) {
    return (
      <div className="sidebar__empty">
        （開いたノートの履歴はまだありません）
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-panel__toolbar">
        <span className="history-panel__count">{visible.length} 件</span>
        <button
          type="button"
          className="history-panel__clear"
          onClick={onClear}
          title="履歴をすべて削除"
        >
          クリア
        </button>
      </div>
      <ul className="history-panel__list">
        {visible.map((entry) => {
          const meta = noteById.get(entry.noteId)!;
          const isActive = activeId === entry.noteId;
          return (
            <li key={`${entry.noteId}-${entry.openedAt}`}>
              <button
                type="button"
                className={`history-panel__item ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelect(entry.noteId)}
                title={meta.title || '無題'}
              >
                <span className="history-panel__title">
                  {meta.title || '無題'}
                </span>
                <span className="history-panel__time">
                  {formatTime(entry.openedAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
