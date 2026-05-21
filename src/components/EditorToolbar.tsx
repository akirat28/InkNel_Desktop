import { useMemo, useState, type RefObject } from 'react';
import type { EditorHandle } from './Editor';
import TablePicker from './TablePicker';
import IconPicker from './IconPicker';
import LinkPopover from './LinkPopover';
import TemplatePicker from './TemplatePicker';
import { formatDate } from '../utils/dateFormat';
import { listPlugins } from '../plugins/registry';
import { getRuntimePlugins } from '../plugins/runtimeLoader';
import type { PluginToolbarButton } from '../plugins/types';

interface Props {
  editorRef: RefObject<EditorHandle>;
  /** 日付挿入ボタンが使うフォーマット文字列 */
  dateFormat: string;
  /** テンプレートフォルダ名（設定から） */
  templateFolder: string;
  /**
   * 有効化されているプラグイン ID の配列。
   * 該当プラグインに対応する挿入ボタン (Mermaid / Mindmap など) の表示制御に使う。
   */
  enabledPlugins?: readonly string[];
  /** true のとき全ボタンを操作不可にする（カーソルがエディタ外） */
  disabled?: boolean;
  /**
   * テンプレートを採用した時に、テンプレートノートが持っていたタグを
   * 現在ノートのタグへマージする。未指定ならタグは引き継がない。
   */
  onApplyTemplateTags?: (tags: string[]) => void;
}

/**
 * 罫線文字（Box Drawing / ASCII +---+）で作られた表を Markdown テーブルへ変換する。
 * 対応する垂直セル区切り: `│` (U+2502) / `|`。水平/コーナー/T 字などは識別して除外。
 * 変換に失敗した（テーブル形式に見えなかった）場合は null。
 *
 * 例:
 * ```
 * ┌───┬───┐       | A | B |
 * │ A │ B │   →   |---|---|
 * ├───┼───┤       | 1 | 2 |
 * │ 1 │ 2 │
 * └───┴───┘
 * ```
 */
function boxTableToMarkdown(text: string): string | null {
  // 縦棒系
  const V_SEP_RE = /[│|]/;
  // 横罫線しか含まない（= 区切り行）判定
  // Unicode の Box Drawing 範囲 ─│┌┐└┘├┤┬┴┼ と、ASCII の + - = と空白
  const IS_SEPARATOR_LINE = /^[\s─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬+\-=]*$/;

  const lines = text.split('\n');
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    if (!V_SEP_RE.test(line)) continue; // 縦棒が無い行はスキップ
    if (IS_SEPARATOR_LINE.test(line)) continue; // 罫線のみの行はスキップ

    // `│` を優先、無ければ `|` で分割
    const sep = line.includes('│') ? '│' : '|';
    const pieces = line.split(sep).map((c) => c.trim());
    // 両端が空なら外側の │ 由来のため除去
    if (pieces.length > 0 && pieces[0] === '') pieces.shift();
    if (pieces.length > 0 && pieces[pieces.length - 1] === '') pieces.pop();
    if (pieces.length === 0) continue;
    rows.push(pieces);
  }
  if (rows.length === 0) return null;

  const cols = Math.max(...rows.map((r) => r.length));
  // 行の列数を揃える
  const norm = rows.map((r) => {
    const copy = [...r];
    while (copy.length < cols) copy.push('');
    return copy;
  });

  // Markdown 表のセル内で使えないパイプとバックスラッシュ改行をエスケープ
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const buildRow = (cells: string[]) =>
    '| ' + cells.map(esc).join(' | ') + ' |';

  const header = norm[0];
  const separator = Array.from({ length: cols }, () => '---');
  const dataRows = norm.slice(1);
  const out: string[] = [];
  out.push(buildRow(header));
  out.push(buildRow(separator));
  for (const r of dataRows) out.push(buildRow(r));
  return out.join('\n');
}

/**
 * 行 × 列の指定からマークダウンテーブルの雛形を組み立てる。
 * 1 行目はヘッダ（`列1`, `列2`, ...）+ 区切り、残りはデータ行。
 */
function buildTableMarkdown(rows: number, cols: number): string {
  const headerCells = Array.from({ length: cols }, (_, i) => `列${i + 1}`);
  const sepCells = Array.from({ length: cols }, () => '---');
  const emptyCells = Array.from({ length: cols }, () => '   ');
  const buildRow = (cells: string[]) => '| ' + cells.join(' | ') + ' |';

  const lines: string[] = [];
  lines.push(buildRow(headerCells));
  lines.push(buildRow(sepCells));
  for (let i = 0; i < Math.max(0, rows - 1); i++) {
    lines.push(buildRow(emptyCells));
  }
  return '\n' + lines.join('\n') + '\n';
}

/**
 * 編集ビュー時の上部に表示するマークダウン挿入ツールバー。
 * 編集/プレビューの切替は NoteHeader 側のセグメントトグルが担当する。
 */
export default function EditorToolbar({
  editorRef,
  dateFormat,
  templateFolder,
  enabledPlugins,
  disabled,
  onApplyTemplateTags,
}: Props) {
  const wrap = (before: string, after: string, placeholder?: string) =>
    editorRef.current?.wrap(before, after, placeholder);
  const prefix = (p: string) => editorRef.current?.prefixLine(p);
  const insert = (s: string) => editorRef.current?.insert(s);

  // ----- 有効化プラグインのツールバーボタンを収集 -----
  // バンドル版 (src/plugins/) + ランタイム版 (DL 版) を id 重複排除しつつ統合し、
  // enabledPlugins に含まれるものだけ toolbarButtons を取り出す。
  // 新規プラグインが toolbarButtons を export すれば自動的にここに出る。
  const pluginToolbarButtons = useMemo<PluginToolbarButton[]>(() => {
    if (!enabledPlugins || enabledPlugins.length === 0) return [];
    const enabledSet = new Set(enabledPlugins);
    const seen = new Set<string>();
    const all = [...listPlugins(), ...getRuntimePlugins()];
    const out: PluginToolbarButton[] = [];
    for (const p of all) {
      if (!enabledSet.has(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      const buttons = p.module.toolbarButtons;
      if (!Array.isArray(buttons)) continue;
      for (const b of buttons) {
        if (b && typeof b.id === 'string' && typeof b.icon === 'string') {
          out.push(b);
        }
      }
    }
    return out;
  }, [enabledPlugins]);

  // プラグインの onClick に渡すエディタ操作 API
  const toolbarApi = useMemo(
    () => ({
      insert: (text: string) => editorRef.current?.insert(text),
      wrap: (before: string, after: string, placeholder?: string) =>
        editorRef.current?.wrap(before, after, placeholder),
    }),
    [editorRef],
  );

  // テーブルピッカー（吹き出し型ポップアップ）の表示位置
  const [tablePickerPos, setTablePickerPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const openTablePicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // ボタン真下、ピッカー中央がボタン中央に揃うように x はボタン中心を渡す
    // （ピッカー側で transform: translateX(-50%) により中央寄せ）
    setTablePickerPos({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
    });
  };

  const handleTablePickerSelect = (rows: number, cols: number) => {
    insert(buildTableMarkdown(rows, cols));
    setTablePickerPos(null);
  };

  // アイコンピッカー（吹き出し型ポップアップ）の表示位置
  const [iconPickerPos, setIconPickerPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const openIconPicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // ボタン中央に揃うように x はボタン中心を渡す
    setIconPickerPos({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
    });
  };

  const handleIconPickerSelect = (icon: string) => {
    insert(icon);
    setIconPickerPos(null);
  };

  // リンク挿入ポップオーバー。
  // ポップオーバーを開いた瞬間のセレクション範囲 (from, to) を捕捉して保持し、
  // OK 押下時にはこの範囲を必ず置換する（フォーカス遷移などでセレクションが
  // 崩れても、選択されていたテキストが残らないようにするため）。
  const [linkPopoverState, setLinkPopoverState] = useState<{
    x: number;
    y: number;
    initialLabel: string;
    from: number;
    to: number;
  } | null>(null);

  const openLinkPopover = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const range = editorRef.current?.getSelectionRange() ?? {
      from: 0,
      to: 0,
      text: '',
    };
    setLinkPopoverState({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
      initialLabel: range.text,
      from: range.from,
      to: range.to,
    });
  };

  /** マークダウンリンクで安全に使えるよう必要最小限のサニタイズ */
  const sanitizeLabel = (s: string) =>
    s.replace(/[\r\n]+/g, ' ').replace(/\]/g, '\\]');
  const sanitizeUrl = (s: string) =>
    s.replace(/[\s]+/g, '').replace(/\)/g, '\\)');

  const handleLinkSubmit = (url: string, label: string) => {
    if (!linkPopoverState) return;
    const safeUrl = sanitizeUrl(url);
    const safeLabel = sanitizeLabel(label || url);
    const markdown = `[${safeLabel}](${safeUrl})`;
    // ポップオーバーを開いた瞬間のレンジを明示的に置換
    editorRef.current?.replaceRange(
      linkPopoverState.from,
      linkPopoverState.to,
      markdown,
    );
    setLinkPopoverState(null);
  };

  // 日付挿入: 設定で指定したフォーマットで今日の日付を挿入
  const insertDate = () => {
    const text = formatDate(new Date(), dateFormat);
    insert(text);
  };

  // 罫線テーブル → Markdown 変換: 現在の選択範囲をまとめて変換する
  const convertBoxTable = () => {
    const range = editorRef.current?.getSelectionRange();
    if (!range || range.from === range.to) {
      window.alert(
        '変換したい罫線テーブル全体を選択してから実行してください。',
      );
      return;
    }
    const converted = boxTableToMarkdown(range.text);
    if (converted === null) {
      window.alert('選択範囲を罫線テーブルとして解釈できませんでした。');
      return;
    }
    editorRef.current?.replaceRange(range.from, range.to, converted);
  };

  // テンプレートピッカー
  const [templatePickerPos, setTemplatePickerPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const openTemplatePicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTemplatePickerPos({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
    });
  };

  const handleTemplateSelect = (content: string, tags: string[]) => {
    insert(content);
    // テンプレートが持っていたタグを現在ノートのタグに合流させる。
    // 重複は呼び出し側で除去する。
    if (tags.length > 0) onApplyTemplateTags?.(tags);
    setTemplatePickerPos(null);
  };

  return (
    <div
      className={`md-toolbar ${disabled ? 'is-disabled' : ''}`}
      role="toolbar"
      aria-label="編集ツールバー"
      aria-disabled={disabled || undefined}
    >
      <div className="md-toolbar__group">
        <ToolBtn label="見出し1 (#)" onClick={() => prefix('# ')}>
          H1
        </ToolBtn>
        <ToolBtn label="見出し2 (##)" onClick={() => prefix('## ')}>
          H2
        </ToolBtn>
        <ToolBtn label="見出し3 (###)" onClick={() => prefix('### ')}>
          H3
        </ToolBtn>
        <ToolBtn label="見出し4 (####)" onClick={() => prefix('#### ')}>
          H4
        </ToolBtn>
        <ToolBtn label="見出し5 (#####)" onClick={() => prefix('##### ')}>
          H5
        </ToolBtn>
        <ToolBtn label="見出し6 (######)" onClick={() => prefix('###### ')}>
          H6
        </ToolBtn>
      </div>

      <div className="md-toolbar__divider" />

      <div className="md-toolbar__group">
        <ToolBtn label="太字 (**…**)" onClick={() => wrap('**', '**', '太字')}>
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn label="斜体 (*…*)" onClick={() => wrap('*', '*', '斜体')}>
          <em>I</em>
        </ToolBtn>
        <ToolBtn
          label="取り消し線 (~~…~~)"
          onClick={() => wrap('~~', '~~', '取り消し線')}
        >
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </ToolBtn>
        <ToolBtn
          label="インラインコード (`…`)"
          onClick={() => wrap('`', '`', 'code')}
        >
          <code>{'<>'}</code>
        </ToolBtn>
      </div>

      <div className="md-toolbar__divider" />

      <div className="md-toolbar__group">
        <ToolBtn label="箇条書き (- )" onClick={() => prefix('- ')}>
          •
        </ToolBtn>
        <ToolBtn label="番号付きリスト (1. )" onClick={() => prefix('1. ')}>
          1.
        </ToolBtn>
        <ToolBtn label="タスクリスト (- [ ])" onClick={() => prefix('- [ ] ')}>
          ☐
        </ToolBtn>
        <ToolBtn label="引用 (> )" onClick={() => prefix('> ')}>
          ❝
        </ToolBtn>
      </div>

      <div className="md-toolbar__divider" />

      <div className="md-toolbar__group">
        <ToolBtn
          label="リンクを挿入"
          onClick={openLinkPopover}
        >
          🔗
        </ToolBtn>
        <ToolBtn
          label="コードブロック (```)"
          onClick={() => wrap('\n```\n', '\n```\n', '')}
        >
          {'{ }'}
        </ToolBtn>
        <ToolBtn label="区切り線 (---)" onClick={() => insert('\n---\n')}>
          ―
        </ToolBtn>
        <ToolBtn label="テーブル" onClick={openTablePicker}>
          <TableIcon />
        </ToolBtn>
        <ToolBtn
          label="罫線テーブルをMarkdownに変換"
          onClick={convertBoxTable}
        >
          <BoxToTableIcon />
        </ToolBtn>
        <ToolBtn label="アイコン" onClick={openIconPicker}>
          <SmileyIcon />
        </ToolBtn>
        <ToolBtn label="今日の日付を挿入" onClick={insertDate}>
          <CalendarIcon />
        </ToolBtn>
        <ToolBtn label="テンプレート挿入" onClick={openTemplatePicker}>
          <TemplateIcon />
        </ToolBtn>
      </div>

      {/* ----- プラグイン由来の挿入ボタン ----- */}
      {pluginToolbarButtons.length > 0 && (
        <>
          <div className="md-toolbar__divider" />
          <div className="md-toolbar__group">
            {pluginToolbarButtons.map((btn) => (
              <ToolBtn
                key={btn.id}
                label={btn.label}
                onClick={() => btn.onClick(toolbarApi)}
              >
                <span
                  className="md-toolbar__plugin-icon"
                  dangerouslySetInnerHTML={{ __html: btn.icon }}
                  aria-hidden="true"
                />
              </ToolBtn>
            ))}
          </div>
        </>
      )}
      {tablePickerPos && (
        <TablePicker
          x={tablePickerPos.x}
          y={tablePickerPos.y}
          onSelect={handleTablePickerSelect}
          onClose={() => setTablePickerPos(null)}
        />
      )}
      {iconPickerPos && (
        <IconPicker
          x={iconPickerPos.x}
          y={iconPickerPos.y}
          onSelect={handleIconPickerSelect}
          onClose={() => setIconPickerPos(null)}
        />
      )}
      {templatePickerPos && (
        <TemplatePicker
          x={templatePickerPos.x}
          y={templatePickerPos.y}
          folderName={templateFolder}
          onSelect={handleTemplateSelect}
          onClose={() => setTemplatePickerPos(null)}
        />
      )}
      {linkPopoverState && (
        <LinkPopover
          x={linkPopoverState.x}
          y={linkPopoverState.y}
          initialLabel={linkPopoverState.initialLabel}
          onSubmit={handleLinkSubmit}
          onClose={() => setLinkPopoverState(null)}
        />
      )}
    </div>
  );
}

interface ToolBtnProps {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

function ToolBtn({ label, onClick, children }: ToolBtnProps) {
  return (
    <button
      type="button"
      className="md-toolbar__btn"
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** テーブル挿入ボタン用アイコン（3列の表を表す14x14の線画） */
function TableIcon() {
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
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <line x1="2" y1="6.3" x2="14" y2="6.3" />
      <line x1="6" y1="3" x2="6" y2="13" />
      <line x1="10" y1="3" x2="10" y2="13" />
    </svg>
  );
}

/** 日付挿入ボタン用のカレンダーアイコン (14x14) */
function CalendarIcon() {
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
      <rect x="2" y="3.2" width="12" height="10.5" rx="1.2" />
      <line x1="2" y1="6.4" x2="14" y2="6.4" />
      <line x1="5" y1="2" x2="5" y2="4.6" />
      <line x1="11" y1="2" x2="11" y2="4.6" />
    </svg>
  );
}

/** テンプレート挿入ボタン用アイコン (14x14) — ファイルに点線枠 */
function TemplateIcon() {
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
      <path d="M5 9h6" strokeDasharray="2 2" />
      <path d="M5 11.5h4" strokeDasharray="2 2" />
    </svg>
  );
}

/** 罫線→Markdown 変換ボタンのアイコン: 左右矢印で "変換" を示す (14x14) */
function BoxToTableIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="3" width="5" height="10" rx="0.6" />
      <line x1="1.5" y1="5.8" x2="6.5" y2="5.8" />
      <line x1="1.5" y1="8.6" x2="6.5" y2="8.6" />
      <path d="M8 8 h3.2 M10 6.4 L11.6 8 L10 9.6" />
      <rect x="12.5" y="4" width="2.2" height="8" rx="0.4" fill="currentColor" stroke="none" opacity="0.35" />
      <rect x="12.5" y="4" width="2.2" height="8" rx="0.4" />
    </svg>
  );
}

/** アイコンピッカー起動ボタン用のスマイリーアイコン (14x14) */
function SmileyIcon() {
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
      <circle cx="8" cy="8" r="6" />
      <circle cx="6" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
      <path d="M5.5 10 Q 8 12, 10.5 10" />
    </svg>
  );
}

