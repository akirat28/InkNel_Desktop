import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TemplateEntry } from '../global';

interface Props {
  /** ピッカーの表示位置（ボタン中心の x、ボタン下端 y） */
  x: number;
  y: number;
  /** 設定で指定されたテンプレートフォルダ名（空メッセージ表示用） */
  folderName: string;
  /**
   * テンプレート選択時のコールバック。
   * テンプレートノートの本文 + タグが渡される。タグは採用先ノートへ
   * マージされる想定（呼び出し側で merge）。
   */
  onSelect: (content: string, tags: string[]) => void;
  /** 閉じる */
  onClose: () => void;
}

/**
 * EditorToolbar のテンプレートボタンを押したときに表示する吹き出し型ピッカー。
 * 設定で指定されたフォルダ配下のノートを一覧し、選択すると本文を挿入する。
 */
export default function TemplatePicker({ x, y, folderName, onSelect, onClose }: Props) {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  // テンプレート一覧を取得
  useEffect(() => {
    let cancelled = false;
    void window.api.template.list().then((list) => {
      if (!cancelled) {
        setTemplates(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleSelect = async (entry: TemplateEntry) => {
    const { body, tags } = await window.api.template.read(entry.noteId);
    onSelect(body, tags);
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="template-picker"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="テンプレート選択"
    >
      <div className="template-picker__header">テンプレート</div>
      <div className="template-picker__list">
        {loading ? (
          <div className="template-picker__empty">読み込み中…</div>
        ) : templates.length === 0 ? (
          <div className="template-picker__empty">
            テンプレートがありません
            <br />
            <small>
              サイドバーで {folderName}/ フォルダに
              ノートを作成すると表示されます
            </small>
          </div>
        ) : (
          templates.map((t) => (
            <button
              key={t.noteId}
              type="button"
              className="template-picker__item"
              onClick={() => void handleSelect(t)}
            >
              <span className="template-picker__icon">
                <TemplateFileIcon />
              </span>
              <span className="template-picker__name">{t.name}</span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}

function TemplateFileIcon() {
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
      <path d="M5 9h6M5 11.5h4" />
    </svg>
  );
}
