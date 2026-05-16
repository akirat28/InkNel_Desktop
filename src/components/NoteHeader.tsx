import { useT } from '../i18n';

type ViewKey = 'edit' | 'preview' | 'mix';

interface Props {
  /** スラッシュ区切りのパス形式ファイル名（例: "階層1/テスト1"） */
  name: string;
  view: ViewKey;
  onNameChange: (next: string) => void;
  onSelectView: (next: ViewKey) => void;
}

/**
 * ノートヘッダ: ファイル名入力 + 3-way 表示モードセグメント + ケバブメニュー。
 * モード:
 *   - preview: プレビュー全幅
 *   - mix:     左 Preview / 右 Editor の分割表示（編集が即時プレビューに反映）
 *   - edit:    エディタ全幅
 */
export default function NoteHeader({
  name,
  view,
  onNameChange,
  onSelectView,
}: Props) {
  const t = useT();
  const openKebabMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    void window.api.ui.showNoteMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
      labels: {
        exportPdf: t.noteHeader.kebabExportPdf,
        exportMarkdown: t.noteHeader.kebabExportMarkdown,
        print: t.noteHeader.kebabPrint,
      },
    });
  };

  return (
    <div className="note-header">
      <input
        className="note-header__name"
        type="text"
        value={name}
        placeholder={t.noteHeader.filenamePlaceholder}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <div className="view-toggle" role="radiogroup" aria-label={t.noteHeader.preview}>
        <button
          type="button"
          className={`view-toggle__btn ${view === 'preview' ? 'is-active' : ''}`}
          onClick={() => onSelectView('preview')}
          title={t.noteHeader.preview}
          aria-pressed={view === 'preview'}
          role="radio"
          aria-checked={view === 'preview'}
        >
          <PreviewIcon />
          <span className="view-toggle__label">{t.noteHeader.preview}</span>
        </button>
        <button
          type="button"
          className={`view-toggle__btn ${view === 'edit' ? 'is-active' : ''}`}
          onClick={() => onSelectView('edit')}
          title={t.noteHeader.edit}
          aria-pressed={view === 'edit'}
          role="radio"
          aria-checked={view === 'edit'}
        >
          <EditIcon />
          <span className="view-toggle__label">{t.noteHeader.edit}</span>
        </button>
        <button
          type="button"
          className={`view-toggle__btn ${view === 'mix' ? 'is-active' : ''}`}
          onClick={() => onSelectView('mix')}
          title={t.noteHeader.livePreviewTitle}
          aria-pressed={view === 'mix'}
          role="radio"
          aria-checked={view === 'mix'}
        >
          <MixIcon />
          <span className="view-toggle__label">{t.noteHeader.livePreview}</span>
        </button>
      </div>
      <button
        type="button"
        className="view-toggle__btn view-toggle__btn--single"
        onClick={openKebabMenu}
        title={t.noteHeader.menu}
        aria-label={t.noteHeader.menu}
        aria-haspopup="menu"
      >
        <KebabIcon />
      </button>
    </div>
  );
}

// ----- 16x16 SVGアイコン -----

function EditIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20 L4.5 16 L16.5 4 A1.4 1.4 0 0 1 18.5 4 L20 5.5 A1.4 1.4 0 0 1 20 7.5 L8 19.5 Z" />
      <path d="M14.5 6 L18 9.5" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12 C 5 6.5, 8.5 4.5, 12 4.5 C 15.5 4.5, 19 6.5, 21.5 12 C 19 17.5, 15.5 19.5, 12 19.5 C 8.5 19.5, 5 17.5, 2.5 12 Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

/** 左右分割を表すアイコン（左にプレビュー風、右にエディタ風） */
function MixIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5 L12 19" />
      {/* 左パネル: プレビュー風の横線 */}
      <path d="M6 9 L9.5 9" />
      <path d="M6 12 L9 12" />
      <path d="M6 15 L9.5 15" />
      {/* 右パネル: エディタのカーソル */}
      <path d="M15 9 L18 9" />
      <path d="M15 13 L17 13" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}
