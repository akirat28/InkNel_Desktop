import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Theme } from '../settings';
import { generatePdfThumbnail } from '../utils/pdfThumbnail';
import Minimap from './Minimap';

interface Props {
  value: string;
  onChange: (next: string) => void;
  theme: Theme;
  /** エディタのフォーカス変化を通知（true = focused / false = blurred） */
  onFocusChange?: (focused: boolean) => void;
  /**
   * スクロール時に呼ばれる。MIX モードのスクロール同期用。
   * scrollDOM 要素を渡すので、scrollTop/scrollHeight/clientHeight を直接読める。
   */
  onScroll?: (scrollEl: HTMLElement) => void;
  /** エディタ右側にミニマップを表示するか */
  showMinimap?: boolean;
}

/** テーマ名 → CodeMirror のテーマ extension。light は extension なし（デフォルト白）。 */
function themeExtension(theme: Theme): Extension {
  return theme === 'dark' ? oneDark : [];
}

/**
 * カーソル位置がコードブロック内（フェンス ``` / インデント / インラインコード）
 * かどうかを syntax tree で判定する。
 */
function isInsideCodeBlock(view: EditorView): boolean {
  const state = view.state;
  const pos = state.selection.main.head;
  const tree = syntaxTree(state);
  let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
    pos,
    -1,
  );
  while (node) {
    const name = node.name;
    if (
      name === 'FencedCode' ||
      name === 'CodeBlock' ||
      name === 'CodeText' ||
      name === 'InlineCode'
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * コードブロック内で Tab を押したらインデント（タブ文字を挿入）し、
 * Shift-Tab で行頭インデントを 1 段戻す。コードブロック外では false を返して
 * Tab のデフォルト動作（フォーカス移動）に委ねる。
 *
 * 複数行選択時は各行頭にタブを追加（Shift-Tab は各行頭から削る）。
 */
function tabInCodeBlockCommand(view: EditorView): boolean {
  if (!isInsideCodeBlock(view)) return false;
  const state = view.state;
  const { from, to } = state.selection.main;
  // 複数行選択: 各行頭に \t を追加
  if (from !== to) {
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    if (startLine !== endLine) {
      const changes = [];
      for (let n = startLine; n <= endLine; n++) {
        const line = state.doc.line(n);
        changes.push({ from: line.from, insert: '\t' });
      }
      view.dispatch({
        changes,
        selection: {
          anchor: from + 1,
          head: to + (endLine - startLine + 1),
        },
        userEvent: 'input.indent',
      });
      return true;
    }
  }
  // 単一カーソル / 単一行内選択: 選択を \t に置換
  view.dispatch({
    changes: { from, to, insert: '\t' },
    selection: { anchor: from + 1 },
    userEvent: 'input.indent',
  });
  return true;
}

function shiftTabInCodeBlockCommand(view: EditorView): boolean {
  if (!isInsideCodeBlock(view)) return false;
  const state = view.state;
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(to).number;
  const changes: Array<{ from: number; to: number }> = [];
  let removedBeforeFrom = 0;
  let removedTotal = 0;
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n);
    const head = state.doc.sliceString(line.from, Math.min(line.to, line.from + 1));
    if (head === '\t') {
      changes.push({ from: line.from, to: line.from + 1 });
      if (line.from < from) removedBeforeFrom++;
      removedTotal++;
    } else if (state.doc.sliceString(line.from, Math.min(line.to, line.from + 2)).startsWith('  ')) {
      // 2 スペースを 1 段とみなして削る
      changes.push({ from: line.from, to: line.from + 2 });
      if (line.from < from) removedBeforeFrom += 2;
      removedTotal += 2;
    }
  }
  if (changes.length === 0) return true; // ノーオペでも Tab のデフォルトは抑止
  view.dispatch({
    changes,
    selection: {
      anchor: Math.max(from - removedBeforeFrom, 0),
      head: Math.max(to - removedTotal, 0),
    },
    userEvent: 'delete.dedent',
  });
  return true;
}

/** 受け付ける画像 MIME プレフィックスと拡張子マップ */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** 添付ファイルとして受け付ける拡張子 */
const ATTACHMENT_EXTS = new Set(['pdf', 'zip', 'lzh', 'lha', '7z']);

/** ファイル名から拡張子を抽出（'.' なし、小文字）。失敗時は空文字 */
function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : '';
}

/** 画像ドロップ時に挿入するマークダウン文字列を組み立てる */
function buildImageMarkdown(altRaw: string, filename: string): string {
  // alt テキストには ] や \n を含めない
  const alt = altRaw.replace(/[\[\]\n\r]/g, '').trim() || '画像';
  return `![${alt}](images/${filename})`;
}

/** 添付ファイルドロップ時に挿入するマークダウンリンクを組み立てる */
function buildAttachmentMarkdown(nameRaw: string, filename: string): string {
  const text = nameRaw.replace(/[\[\]\n\r]/g, '').trim() || 'ファイル';
  return `[${text}](attachments/${filename})`;
}

/**
 * サムネイル画像付きの添付リンクマークダウンを組み立てる。
 * `[![alt](images/thumb)](attachments/file)` のネスト構造で、
 * プレビューでは画像入りリンクとして描画される。
 */
function buildThumbAttachmentMarkdown(
  nameRaw: string,
  attachmentFilename: string,
  thumbFilename: string,
): string {
  const text = nameRaw.replace(/[\[\]\n\r]/g, '').trim() || 'ファイル';
  return `[![${text}](images/${thumbFilename})](attachments/${attachmentFilename})`;
}

/** ファイルを画像 / 添付 / 不明 に分類 */
type FileKind = 'image' | 'attachment' | 'unknown';
function classifyFile(file: File): FileKind {
  if (file.type.startsWith('image/')) return 'image';
  const ext = extFromName(file.name);
  if (ATTACHMENT_EXTS.has(ext)) return 'attachment';
  return 'unknown';
}

/**
 * ドロップされたファイル群（画像 / 添付）を順次保存し、
 * エディタの指定位置にマークダウンを挿入する。
 * 順序を保つため `Promise.all` ではなく逐次処理。
 *
 * PDF の場合は pdfjs-dist で 1 ページ目のサムネイル PNG を生成し、
 * 画像入りリンク（`[![](images/...)](attachments/...)`）として挿入する。
 */
async function handleFileDrop(
  view: EditorView,
  files: File[],
  pos: number,
): Promise<void> {
  const insertions: string[] = [];
  for (const file of files) {
    try {
      const kind = classifyFile(file);
      if (kind === 'unknown') continue;

      const buffer = await file.arrayBuffer();
      if (kind === 'image') {
        const ext =
          extFromName(file.name) || MIME_TO_EXT[file.type] || 'bin';
        const filename = await window.api.images.save(buffer, ext);
        insertions.push(buildImageMarkdown(file.name, filename));
        continue;
      }

      // 添付ファイル（attachment）
      const ext = extFromName(file.name) || 'bin';
      const filename = await window.api.attachments.save(buffer, ext);

      // PDF の場合はサムネイル生成を試みる
      if (ext === 'pdf') {
        const thumbBuffer = await generatePdfThumbnail(buffer, {
          maxWidth: 240,
        });
        if (thumbBuffer) {
          const thumbFilename = await window.api.images.save(
            thumbBuffer,
            'png',
          );
          insertions.push(
            buildThumbAttachmentMarkdown(file.name, filename, thumbFilename),
          );
          continue;
        }
        // サムネイル生成失敗 → 通常の添付リンクにフォールバック
      }

      insertions.push(buildAttachmentMarkdown(file.name, filename));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'ファイルの保存に失敗しました';
      window.alert(`「${file.name}」の保存に失敗しました\n${msg}`);
    }
  }
  if (insertions.length === 0) return;
  // 改行2つで区切って一括挿入
  const insertText = insertions.join('\n\n') + '\n';
  // view が destroy されている可能性をチェック
  if (!view.dom.isConnected) return;
  view.dispatch({
    changes: { from: pos, to: pos, insert: insertText },
    selection: { anchor: pos + insertText.length },
  });
  view.focus();
}

/** EditorToolbar 等から CodeMirror に対して操作するためのコマンド群。 */
export interface EditorHandle {
  /** カーソル位置に文字列を挿入し、挿入後の末尾にカーソルを移動。 */
  insert(text: string): void;
  /**
   * 選択範囲を before / after で囲む。
   * 選択が空の場合は placeholder を挿入し、その範囲を新しい選択にする。
   */
  wrap(before: string, after: string, placeholder?: string): void;
  /** 選択行（複数行可）の各行頭に prefix を追加。 */
  prefixLine(prefix: string): void;
  /** 現在の選択範囲のテキストを返す（未選択時は空文字）。 */
  getSelection(): string;
  /** 現在の選択範囲の {from, to, text} を返す。未選択時は from === to。 */
  getSelectionRange(): { from: number; to: number; text: string };
  /** 指定範囲を text で置換し、末尾にカーソルを移動。 */
  replaceRange(from: number, to: number, text: string): void;
  /**
   * カーソル位置以降で最初に一致する位置を探し、選択状態にしてスクロールする。
   * 末尾まで到達して見つからなければ先頭から再検索（ラップアラウンド）。
   * `caseSensitive=false` で大文字小文字を無視した検索。
   * 見つからない場合は null を返し、選択は変更しない。
   */
  findNext(
    query: string,
    options?: { caseSensitive?: boolean },
  ): { from: number; to: number } | null;
  /**
   * カーソル位置より前方で最後の一致を探して選択。
   * 見つからなければ末尾から逆方向で再検索（ラップアラウンド）。
   */
  findPrev(
    query: string,
    options?: { caseSensitive?: boolean },
  ): { from: number; to: number } | null;
  /**
   * 現在の選択範囲が query と一致していれば置換し、次の一致へ進む。
   * 一致していない場合は次の一致を選ぶだけ（= findNext 相当）。
   * 返り値は「置換が行われたか」。
   */
  replaceCurrent(
    query: string,
    replacement: string,
    options?: { caseSensitive?: boolean },
  ): boolean;
  /** query に一致する全箇所を replacement で置換し、置換件数を返す。 */
  replaceAll(
    query: string,
    replacement: string,
    options?: { caseSensitive?: boolean },
  ): number;
  focus(): void;
  /**
   * CodeMirror が実際にスクロールしている DOM 要素を返す。
   * MIX モードのスクロール同期で使用する。マウント前は null。
   */
  getScrollElement(): HTMLElement | null;
}

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, onChange, theme, onFocusChange, onScroll, showMinimap },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  // CodeMirror の scrollDOM。mount 直後に setState することで Minimap の
  // useEffect (scrollEl deps) が反応できるようにする。
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);

  // 初回マウント時にのみ EditorView を生成
  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;

    const focusHandlers = EditorView.domEventHandlers({
      focus: () => {
        onFocusChangeRef.current?.(true);
        return false;
      },
      blur: () => {
        onFocusChangeRef.current?.(false);
        return false;
      },
    });

    const dragHandlers = EditorView.domEventHandlers({
      dragenter: (event) => {
        if (event.dataTransfer?.types.includes('Files')) {
          host.classList.add('is-dragover');
        }
      },
      dragover: (event) => {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          host.classList.add('is-dragover');
          return true;
        }
        return false;
      },
      dragleave: (event) => {
        // 子要素間の遷移を無視するため、host から外に出た時のみ解除
        if (
          event.relatedTarget instanceof Node &&
          host.contains(event.relatedTarget)
        ) {
          return;
        }
        host.classList.remove('is-dragover');
      },
      drop: (event, view) => {
        host.classList.remove('is-dragover');
        // 画像 or 添付ファイル のいずれかを受け入れる
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (f) => classifyFile(f) !== 'unknown',
        );
        if (files.length === 0) return false;
        event.preventDefault();
        // ドロップ位置を決定（範囲外なら現在のカーソル）
        const pos =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
          view.state.selection.main.head;
        void handleFileDrop(view, files, pos);
        return true;
      },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([
          // コードブロック内でのみ Tab/Shift-Tab を有効化。外側では preventDefault
          // しないので従来通りフォーカス移動になる。
          { key: 'Tab', run: tabInCodeBlockCommand },
          { key: 'Shift-Tab', run: shiftTabInCodeBlockCommand },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown(),
        themeCompartmentRef.current.of(themeExtension(theme)),
        EditorView.lineWrapping,
        focusHandlers,
        dragHandlers,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    // CodeMirror の実スクロール要素 (.cm-scroller) に scroll を直接購読する。
    // App 側で querySelector で探したりするとタイミング依存になるので、
    // ここでアタッチしてコンポーネント自身のライフサイクルに合わせる。
    const scrollDom = view.scrollDOM;
    const scrollHandler = () => {
      onScrollRef.current?.(scrollDom);
    };
    scrollDom.addEventListener('scroll', scrollHandler, { passive: true });
    // Minimap が scrollEl を参照できるよう state で持っておく。
    setScrollHost(scrollDom);

    return () => {
      scrollDom.removeEventListener('scroll', scrollHandler);
      view.destroy();
      viewRef.current = null;
      setScrollHost(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme prop が変わったら Compartment を reconfigure
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(themeExtension(theme)),
    });
  }, [theme]);

  // 外部から value が変わったとき（ファイル切替時等）に同期
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // ----- ツールバーから呼ぶコマンドを公開 -----
  useImperativeHandle(
    ref,
    () => ({
      insert(text: string) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },

      wrap(before: string, after: string, placeholder = '') {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selectedText = view.state.sliceDoc(from, to);
        const inner = selectedText || placeholder;
        const insertText = before + inner + after;
        view.dispatch({
          changes: { from, to, insert: insertText },
          selection: {
            anchor: from + before.length,
            head: from + before.length + inner.length,
          },
        });
        view.focus();
      },

      prefixLine(prefix: string) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const startLine = view.state.doc.lineAt(from);
        const endLine = view.state.doc.lineAt(to);
        const changes: { from: number; insert: string }[] = [];
        for (let n = startLine.number; n <= endLine.number; n++) {
          const line = view.state.doc.line(n);
          changes.push({ from: line.from, insert: prefix });
        }
        // 単一行操作の場合は prefix の直後にカーソルを置く
        // （挿入直後にすぐ見出し/リスト本文を入力できるようにするため）。
        // 複数行選択の場合は CodeMirror デフォルトの選択範囲マッピングに任せる。
        if (startLine.number === endLine.number) {
          view.dispatch({
            changes,
            selection: { anchor: startLine.from + prefix.length },
          });
        } else {
          view.dispatch({ changes });
        }
        view.focus();
      },

      getSelection() {
        const view = viewRef.current;
        if (!view) return '';
        const { from, to } = view.state.selection.main;
        if (from === to) return '';
        return view.state.sliceDoc(from, to);
      },

      getSelectionRange() {
        const view = viewRef.current;
        if (!view) return { from: 0, to: 0, text: '' };
        const { from, to } = view.state.selection.main;
        return {
          from,
          to,
          text: from === to ? '' : view.state.sliceDoc(from, to),
        };
      },

      replaceRange(from: number, to: number, text: string) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },

      findNext(query, options) {
        const view = viewRef.current;
        if (!view || !query) return null;
        const doc = view.state.doc.toString();
        const caseSensitive = options?.caseSensitive ?? false;
        const haystack = caseSensitive ? doc : doc.toLowerCase();
        const needle = caseSensitive ? query : query.toLowerCase();
        const startPos = view.state.selection.main.to;
        let idx = haystack.indexOf(needle, startPos);
        if (idx < 0) {
          // ラップアラウンド
          idx = haystack.indexOf(needle);
        }
        if (idx < 0) return null;
        const from = idx;
        const to = idx + query.length;
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: true,
        });
        view.focus();
        return { from, to };
      },

      findPrev(query, options) {
        const view = viewRef.current;
        if (!view || !query) return null;
        const doc = view.state.doc.toString();
        const caseSensitive = options?.caseSensitive ?? false;
        const haystack = caseSensitive ? doc : doc.toLowerCase();
        const needle = caseSensitive ? query : query.toLowerCase();
        // カーソル位置より前までで最後の一致を探す
        const startPos = view.state.selection.main.from;
        const searchBefore = haystack.slice(0, startPos);
        let idx = searchBefore.lastIndexOf(needle);
        if (idx < 0) {
          // ラップアラウンド: 末尾から逆方向
          idx = haystack.lastIndexOf(needle);
        }
        if (idx < 0) return null;
        const from = idx;
        const to = idx + query.length;
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: true,
        });
        view.focus();
        return { from, to };
      },

      replaceCurrent(query, replacement, options) {
        const view = viewRef.current;
        if (!view || !query) return false;
        const caseSensitive = options?.caseSensitive ?? false;
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        const isMatch = caseSensitive
          ? selected === query
          : selected.toLowerCase() === query.toLowerCase();
        if (isMatch) {
          view.dispatch({
            changes: { from, to, insert: replacement },
            selection: { anchor: from + replacement.length },
            scrollIntoView: true,
          });
          view.focus();
          // 次の一致にも移動させる
          const handle = viewRef.current;
          if (handle) {
            // ダイアログ側で改めて findNext を呼んでもらう想定にするため
            // ここでは次検索を自動実行しない
          }
          return true;
        }
        return false;
      },

      replaceAll(query, replacement, options) {
        const view = viewRef.current;
        if (!view || !query) return 0;
        const caseSensitive = options?.caseSensitive ?? false;
        const doc = view.state.doc.toString();
        const haystack = caseSensitive ? doc : doc.toLowerCase();
        const needle = caseSensitive ? query : query.toLowerCase();
        const changes: { from: number; to: number; insert: string }[] = [];
        let idx = 0;
        while (idx < haystack.length) {
          const found = haystack.indexOf(needle, idx);
          if (found < 0) break;
          changes.push({
            from: found,
            to: found + query.length,
            insert: replacement,
          });
          idx = found + query.length;
          if (query.length === 0) break; // 無限ループ防止
        }
        if (changes.length === 0) return 0;
        view.dispatch({ changes });
        view.focus();
        return changes.length;
      },

      focus() {
        viewRef.current?.focus();
      },

      getScrollElement() {
        return viewRef.current?.scrollDOM ?? null;
      },
    }),
    [],
  );

  return (
    <div className="editor-pane">
      <div ref={hostRef} className="editor" />
      {showMinimap && <Minimap text={value} scrollEl={scrollHost} />}
    </div>
  );
});

export default Editor;
