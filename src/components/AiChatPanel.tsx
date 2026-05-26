import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import MarkdownIt from 'markdown-it';
import {
  AI_PROVIDER_OPTIONS,
  getActiveAiSettings,
  type AppSettings,
} from '../settings';
import { useT } from '../i18n';
import type { NoteMeta } from '../global';
import { extractPdfText } from '../utils/pdfText';

interface Props {
  onClose: () => void;
  settings: AppSettings;
  noteTitle: string;
  noteBody: string;
  /** 現在開いているノートの ID。未選択時は null。append アクションの宛先 */
  activeId: string | null;
  linkedNotes: Pick<NoteMeta, 'id' | 'title'>[];
  width: number;
  /**
   * 折りたたみ表示。true のとき width 0 へアニメーションして見えなくする
   * （サイドバーと同じ挙動）。コンテンツは常時マウントされる。
   */
  collapsed?: boolean;
  /**
   * 幅リサイズ中フラグ。true の間は width のトランジションを切って
   * ドラッグ操作にダイレクトに追従させる。
   */
  resizing?: boolean;
  onNoteCreated?: (note: NoteMeta) => void;
  /**
   * 現在開いているノートの末尾に AI の指示で追記する。App 側の body state
   * を介して保存と同期される。
   */
  onAppendToCurrentNote?: (content: string) => void;
  /**
   * 現在開いているノートの本文を、AI が生成した完成形で書き換える。
   * 破壊的（結果が空 / ほぼ空）と判定された場合は呼ばれない。
   */
  onRewriteCurrentNote?: (newBody: string) => void;
  /**
   * 直前にこのノートで使っていたチャット状態。ノートを切り替えた時に
   * App 側の Map から取り出して渡される。null/undefined ならまっさらな
   * 状態で初期化する。
   *
   * ノートごとに独立したチャットを実現するために、App は本コンポーネントを
   * `key={activeId}` で再マウントする。その上でこの props を初期化に使う。
   */
  initialState?: PersistedChatState;
  /**
   * 永続化対象の state が変わるたびに呼ばれる。App 側で
   * `Map<noteId, PersistedChatState>` に保存し、ノート再選択時の復元に使う。
   */
  onStateChange?: (state: PersistedChatState) => void;
}

/**
 * ノートごとに保存しておきたいチャット状態。busy / streaming など、
 * セッション中だけ意味を持つ揮発状態は含まない。
 */
export interface PersistedChatState {
  draft: string;
  chatMode: 'chat' | 'edit';
  messages: ChatMessage[];
  attachments: AiChatAttachment[];
  pendingNote: { title: string; folder: string } | null;
  /** 入力履歴 (シェル風の ↑↓ ナビ) */
  history: string[];
  inputHeight: number;
}

// ===== AI ノート操作ディレクティブ =====
// AI 応答に埋め込まれた `[[INKNEL_ACTION]] ... [[/INKNEL_ACTION]]` ブロックを
// パース・実行する。形式は ipc.ts の buildChatSystemPrompt で AI に指示。
type NoteAction =
  | { kind: 'create'; title: string; folder: string; body: string }
  | { kind: 'append'; content: string }
  | { kind: 'rewrite'; body: string };

/**
 * rewrite_current_note の安全ガード。AI が「全削除」相当の本文を返した場合に
 * 実行を拒否する。AI 側にも破壊的依頼を拒むよう指示しているが、念のため
 * クライアント側で最終チェックする。
 *
 * - 結果本文が空 / 空白のみ → 破壊的
 * - 元本文が 100 文字以上あったのに、結果が 10 文字未満 → 破壊的
 * - その他は許可（部分削除・大幅短縮は通す）
 */
function isDestructiveRewrite(original: string, next: string): boolean {
  const o = original.trim();
  const n = next.trim();
  if (n.length === 0) return true;
  if (o.length >= 100 && n.length < 10) return true;
  return false;
}

const ACTION_BLOCK_RE =
  /\[\[INKNEL_ACTION\]\][\s\S]*?\[\[\/INKNEL_ACTION\]\]/g;

/** 応答テキストからアクションディレクティブを抽出 */
function parseNoteActions(text: string): NoteAction[] {
  const actions: NoteAction[] = [];
  const matches = text.match(ACTION_BLOCK_RE);
  if (!matches) return actions;
  for (const raw of matches) {
    const block = raw
      .replace(/^\[\[INKNEL_ACTION\]\]/, '')
      .replace(/\[\[\/INKNEL_ACTION\]\]$/, '');
    // ヘッダ (key: value 行群) と [[BODY]]...[[/BODY]] を分離
    const bodyStart = block.indexOf('[[BODY]]');
    let header = block;
    let body = '';
    if (bodyStart >= 0) {
      header = block.slice(0, bodyStart);
      const afterBody = bodyStart + '[[BODY]]'.length;
      const bodyEnd = block.indexOf('[[/BODY]]', afterBody);
      body = block.slice(afterBody, bodyEnd >= 0 ? bodyEnd : undefined);
      body = body.replace(/^\r?\n+/, '').replace(/\r?\n+$/, '');
    }
    const fields: Record<string, string> = {};
    for (const line of header.split(/\r?\n/)) {
      const ci = line.indexOf(':');
      if (ci < 0) continue;
      const key = line.slice(0, ci).trim();
      const value = line.slice(ci + 1).trim();
      if (key) fields[key] = value;
    }
    const type = fields.type;
    if (type === 'create_note') {
      actions.push({
        kind: 'create',
        title: fields.title || '',
        folder: fields.folder || '',
        body,
      });
    } else if (type === 'append_to_current_note') {
      actions.push({ kind: 'append', content: body });
    } else if (type === 'rewrite_current_note') {
      actions.push({ kind: 'rewrite', body });
    }
  }
  return actions;
}

/**
 * 表示用テキストから（部分的な）ディレクティブを取り除く。
 * - 完全な `[[INKNEL_ACTION]]...[[/INKNEL_ACTION]]` ブロックは削除
 * - ストリーミング途中で末尾だけ開いて閉じていないブロックも非表示にする
 * - `[[`〜`[[INKNEL_ACTION` のような部分マーカーも末尾なら隠す
 */
function stripActionsForDisplay(text: string): string {
  let out = text.replace(ACTION_BLOCK_RE, '');
  const openIdx = out.lastIndexOf('[[INKNEL_ACTION]]');
  if (openIdx >= 0 && out.indexOf('[[/INKNEL_ACTION]]', openIdx) === -1) {
    out = out.slice(0, openIdx);
  }
  const partialIdx = out.search(/\[\[[A-Z_/]*$/);
  if (partialIdx >= 0) {
    out = out.slice(0, partialIdx);
  }
  return out.replace(/\s+$/, '');
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /**
   * 編集モードでこの応答がノート (append / rewrite) を変更した場合の
   * 直前スナップショット。「戻す」ボタンが押された / チャットが進んだら
   * クリア (undefined) して非表示にする。
   */
  undo?: {
    noteId: string;
    previousBody: string;
  };
  /**
   * 「戻す」が実行されたことを UI 上だけ示すためのフラグ。
   * text 本体には影響を与えず、AI に履歴として送信される際にも
   * この情報は含めない (含めると AI が「前の編集は取り消されたから
   * 今回はやらない方が良い」と推測してしまうため)。
   */
  wasUndone?: boolean;
}

interface AiChatAttachment {
  id: string;
  name: string;
  kind: 'pdf' | 'image' | 'text';
  mimeType: string;
  size: number;
  text?: string;
  dataUrl?: string;
}

/**
 * テキストとして読める拡張子の判定。MIME type が text/* なら無条件 OK。
 * MIME が空 / application/octet-stream で来るケースに備え、拡張子も見る。
 * バイナリ系の .pdf / .png / .jpg はここに含めない (別経路で処理する)。
 */
const TEXT_FILE_EXT_RE =
  /\.(txt|md|markdown|log|json|csv|tsv|ya?ml|toml|ini|conf|html?|xml|svg|js|jsx|mjs|cjs|ts|tsx|css|scss|less|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|cpp|cc|h|hpp|cs|php|lua|sql|env|gitignore|gitattributes|editorconfig|rst|tex)$/i;
function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  // application/json, application/xml なども text として扱う
  if (file.type === 'application/json') return true;
  if (file.type === 'application/xml') return true;
  if (file.type === 'application/x-yaml') return true;
  if (file.type === 'application/javascript') return true;
  return TEXT_FILE_EXT_RE.test(file.name);
}

/** テキスト添付の上限サイズ (バイト)。これを超えると先頭だけ読んで注記する。 */
const MAX_TEXT_ATTACHMENT_BYTES = 1 * 1024 * 1024; // 1MB

function getActiveModelName(settings: AppSettings): string {
  const m = getActiveAiSettings(settings).model.trim();
  if (m) return m;
  if (settings.aiProvider === 'claudeCode') return 'claude-3-5-sonnet-latest';
  return 'gpt-4o-mini';
}

/** 現在のAIプロバイダの表示用ラベル（一般的なAI / ChatGPT / ClaudeCode / Copilot） */
function getActiveProviderLabel(settings: AppSettings): string {
  const opt = AI_PROVIDER_OPTIONS.find((o) => o.value === settings.aiProvider);
  return opt?.label ?? settings.aiProvider;
}

/**
 * 文字列から http(s) URL を抽出して重複排除した配列で返す。
 * 末尾の句読点 (、。, .) や閉じ括弧は URL に含めない。
 * AI 送信前のテキストから「fetch すべき URL」を拾うために使う。
 */
function extractUrls(text: string): string[] {
  // [^\s<>"'`)\]] で空白や閉じ記号を境界とする。改行/コードフェンスもここで区切る。
  const re = /https?:\/\/[^\s<>"'`)\]、。]+/g;
  const matches = text.match(re);
  if (!matches) return [];
  // 末尾の記号を取り除いてから重複排除
  const cleaned = matches.map((u) => u.replace(/[.,;:!?]+$/, ''));
  return Array.from(new Set(cleaned));
}

/** AI会話保存用のノートタイトル: ローカル時刻で YYYY-MM-DD HH:mm:ss */
function formatNowForNoteTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** チャットメッセージ列を Markdown 文書に変換 */
function buildMarkdownFromMessages(
  messages: { role: 'user' | 'assistant'; text: string }[],
  modelName: string,
  sourceNoteTitle: string,
): string {
  const lines: string[] = [];
  lines.push(`# AI会話 ${formatNowForNoteTitle()}`);
  lines.push('');
  lines.push(`- LLM: ${modelName}`);
  if (sourceNoteTitle.trim()) {
    lines.push(`- 元ノート: ${sourceNoteTitle}`);
  }
  lines.push('');
  for (const m of messages) {
    lines.push(m.role === 'user' ? '## ユーザー' : '## アシスタント');
    lines.push('');
    lines.push(m.text);
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function makeLocalId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function buildAttachmentContext(attachments: AiChatAttachment[]): string {
  // PDF / TEXT 系の中身を AI に投げる文脈テキストとして組み立て。
  // 画像は別経路 (chat input の attachments パラメータ) で送られるためここでは含めない。
  const sections = attachments
    .filter((a) => a.kind === 'pdf' || a.kind === 'text')
    .map((a) => {
      const text = a.text?.trim();
      const label = a.kind === 'pdf' ? 'PDF' : 'TEXT';
      const fallback =
        a.kind === 'pdf'
          ? '(PDFからテキストを抽出できませんでした)'
          : '(テキストの読み込みに失敗しました)';
      return [
        `--- ${label}: ${a.name} (${formatBytes(a.size)}) ---`,
        text || fallback,
      ].join('\n');
    });
  if (sections.length === 0) return '';
  return [
    '=== ドロップされたファイルの内容 (InkNelには保存せず、このチャット内だけで参照) ===',
    ...sections,
    '=== ファイル内容ここまで ===',
    '回答では上記ファイル内容を根拠として扱ってください。',
  ].join('\n\n');
}

export default function AiChatPanel({
  onClose,
  settings,
  noteTitle,
  noteBody,
  activeId,
  linkedNotes,
  width,
  collapsed = false,
  resizing = false,
  onNoteCreated,
  onAppendToCurrentNote,
  onRewriteCurrentNote,
  initialState,
  onStateChange,
}: Props) {
  const t = useT();
  const [draft, setDraft] = useState(initialState?.draft ?? '');
  // チャットモード: 普通の会話のみ。ノートには触らない。
  // 編集モード: AI に create_note / append_to_current_note / rewrite_current_note
  //   ディレクティブの出力を許可し、応答からパースして実行する。
  const [chatMode, setChatMode] = useState<'chat' | 'edit'>(
    initialState?.chatMode ?? 'chat',
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialState?.messages ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<AiChatAttachment[]>(
    initialState?.attachments ?? [],
  );
  const [isDragOver, setIsDragOver] = useState(false);
  // ノート化処理中フラグ（多重送信を防止）
  const [savingNote, setSavingNote] = useState(false);
  // メッセージリスト DOM への参照。新着メッセージや AI ストリーミング更新時に
  // 自動で最下部までスクロールするのに使う。
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // ユーザーが手動でスクロールアップして読み返している間は自動スクロールを抑止する。
  // 初期値 true (=最下部追従モード)。スクロール位置が最下部から 80px 以上離れたら
  // false に切り替わり、再び最下部付近に戻したら true に戻る。
  const isPinnedToBottomRef = useRef(true);
  // ノート化の確認モーダル状態。null なら非表示。
  // フォルダ名・タイトルは編集可能で、ユーザーが確認/修正してから「作成」を押す。
  const [pendingNote, setPendingNote] = useState<{
    title: string;
    folder: string;
  } | null>(initialState?.pendingNote ?? null);
  // 送信中の AI 要求 ID。停止ボタンから ai.abort(reqId) で中断するために保持。
  const inflightRequestIdRef = useRef<string | null>(null);

  // ----- 入力履歴ナビゲーション（↑↓キーで過去入力を呼び戻す、シェル風） -----
  // - historyRef: 送信済みの入力（chronological, 古い順）
  // - historyIndexRef: -1 = 通常編集中 / 0..len-1 = 履歴閲覧中の位置
  // - draftBufferRef: 履歴に入る直前の編集中テキストを保持し、↓ で抜けた時に復元
  const historyRef = useRef<string[]>(initialState?.history ?? []);
  const historyIndexRef = useRef<number>(-1);
  const draftBufferRef = useRef<string>('');
  const HISTORY_MAX = 100;

  const handleArrowHistory = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const pos = el.selectionStart ?? 0;
    if (e.key === 'ArrowUp') {
      // カーソルより前に改行が無い = 1 行目にいる時だけ履歴へ
      const before = el.value.slice(0, pos);
      if (before.includes('\n')) return false;
      if (historyRef.current.length === 0) return false;
      if (historyIndexRef.current === -1) {
        // 履歴モードに入る: 現在の draft を退避
        draftBufferRef.current = el.value;
        historyIndexRef.current = historyRef.current.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      } else {
        return true; // これ以上古いものは無い: イベントは消化する
      }
      e.preventDefault();
      setDraft(historyRef.current[historyIndexRef.current]);
      return true;
    }
    if (e.key === 'ArrowDown') {
      const after = el.value.slice(pos);
      if (after.includes('\n')) return false;
      if (historyIndexRef.current === -1) return false; // 履歴モードでなければ通常動作
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current += 1;
        e.preventDefault();
        setDraft(historyRef.current[historyIndexRef.current]);
      } else {
        // 履歴の末尾を超えたら退避していた draft に戻る
        historyIndexRef.current = -1;
        e.preventDefault();
        setDraft(draftBufferRef.current);
        draftBufferRef.current = '';
      }
      return true;
    }
    return false;
  };

  // ----- 入力ボックスの高さ調整（上端のグリップを掴んでドラッグ） -----
  // ブラウザ既定の右下リサイズハンドルは使わず、テキスト領域の真上に
  // 専用のつまみを配置。ドラッグ中は body にカーソル / select 無効化のクラスを付与。
  const INPUT_MIN_H = 64;
  const INPUT_MAX_H = 360;
  const [inputHeight, setInputHeight] = useState(initialState?.inputHeight ?? 96);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startH: inputHeight };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const ref = resizeRef.current;
      if (!ref) return;
      // 上方向ドラッグ (clientY が小さくなる) で高さを増やす
      const delta = ref.startY - ev.clientY;
      const next = Math.min(
        INPUT_MAX_H,
        Math.max(INPUT_MIN_H, ref.startH + delta),
      );
      setInputHeight(next);
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ノートごとに独立したチャット状態を実現するため、App 側に Map で持って
  // もらう。state が変わるたびに最新スナップショットを通知し、ノート切り替え
  // (本コンポーネントの再マウント) や、後でピン留めタブを再選択した時の
  // 復元に使う。history は ref で管理しているが、送信時に必ず messages も
  // 更新されるので、その際に最新値ごと通知される。
  useEffect(() => {
    onStateChange?.({
      draft,
      chatMode,
      messages,
      attachments,
      pendingNote,
      history: historyRef.current.slice(),
      inputHeight,
    });
  }, [
    draft,
    chatMode,
    messages,
    attachments,
    pendingNote,
    inputHeight,
    onStateChange,
  ]);

  // AI 応答の Markdown を HTML に変換するための markdown-it インスタンス。
  // - html: false で生 HTML を弾き、AI 出力に紛れ込んだスクリプト等の XSS を防止
  // - linkify: URL を自動リンク化
  // - breaks: 改行を <br> に（チャット風の見た目）
  const md = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        breaks: true,
      }),
    [],
  );

  /**
   * 「戻す」ボタンの押下: AI が直前に行ったノート編集を元に戻す。
   * undo スナップショットの previousBody を rewrite で再書き込みし、
   * undo を消費したので当該メッセージの undo フィールドを undefined にする。
   * (チャットが進んだ時点で undo は自動的に消えるため、ここでは
   *  自分のメッセージだけクリアすれば十分。)
   */
  const handleUndoEdit = (messageId: string) => {
    const target = messages.find((m) => m.id === messageId);
    if (!target?.undo) return;
    const snapshot = target.undo;
    // 現在開いているノートが当時と違うなら、戻し対象のノートが既に切り替わっている。
    if (activeId !== snapshot.noteId) {
      setMessages((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text:
            '戻す対象のノートが現在開かれていません。元に戻すには対象ノートを開いてください。',
        },
      ]);
      return;
    }
    onRewriteCurrentNote?.(snapshot.previousBody);
    setMessages((current) =>
      current.map((m) =>
        m.id === messageId
          ? {
              ...m,
              undo: undefined,
              // wasUndone は UI 専用フラグ。text は壊さない (= AI には注記が
              // 送信されないので「次の指示」を素直に解釈してくれる)。
              wasUndone: true,
            }
          : m,
      ),
    );
  };

  const handleSubmit = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || busy) return;
    const aiActive = getActiveAiSettings(settings);
    if (!aiActive.token.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: t.aiChat.tokenNotSet,
        },
      ]);
      return;
    }
    if (typeof window.api?.ai?.chat !== 'function') {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text:
            t.aiChat.notLoaded,
        },
      ]);
      return;
    }
    const now = Date.now();
    const visibleUserText =
      attachments.length > 0
        ? [
            text || '添付ファイルを参照してください。',
            '',
            ...attachments.map(
              (a) =>
                `[添付: ${a.kind === 'pdf' ? 'PDF' : '画像'}] ${a.name} (${formatBytes(a.size)})`,
            ),
          ].join('\n')
        : text;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: `u-${now}`, role: 'user', text: visibleUserText },
    ];
    setMessages(nextMessages);
    // 履歴に追加（直前と同じ内容は重複追加しない）
    const hist = historyRef.current;
    if (text && hist[hist.length - 1] !== text) {
      hist.push(text);
      if (hist.length > HISTORY_MAX) hist.splice(0, hist.length - HISTORY_MAX);
    }
    historyIndexRef.current = -1;
    draftBufferRef.current = '';
    setDraft('');
    setBusy(true);
    // 停止ボタンから中断できるように、要求 ID を生成して ref に保持
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `chat-${crypto.randomUUID()}`
        : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    inflightRequestIdRef.current = requestId;
    // ストリーミングで AI からデルタが届くたびに追記するプレースホルダ。
    // 受信途中でも UI に都度反映されるよう、空テキストの assistant メッセージを
    // 先に積んでおき、`ai:chat-chunk` の delta を append していく。
    // ただし AI が末尾に付けるノート操作ディレクティブは UI に出さない
    // （ストリーミング中の部分一致 / 完全一致いずれも非表示）。
    const placeholderId = `a-${requestId}`;
    // 新しい応答が始まる時点で、過去メッセージに残っている undo は
    // 「戻せる対象」ではなくなる (チャットが進んだ = 戻し操作が破壊的に
    // 中間状態を作ってしまう) ので一括クリアして「戻す」ボタンを消す。
    setMessages((current) => [
      ...current.map((m) => (m.undo ? { ...m, undo: undefined } : m)),
      { id: placeholderId, role: 'assistant', text: '' },
    ]);
    // ディレクティブを正確にパースするために raw 蓄積も保持
    let rawAccum = '';
    const unsubscribeChunk = window.api.ai.onChatChunk(({
      requestId: incomingId,
      delta,
    }) => {
      if (incomingId !== requestId || !delta) return;
      rawAccum += delta;
      const visible = stripActionsForDisplay(rawAccum);
      setMessages((current) =>
        current.map((m) =>
          m.id === placeholderId ? { ...m, text: visible } : m,
        ),
      );
    });
    try {
      const relatedNotes = await Promise.all(
        linkedNotes.map(async (note) => ({
          title: note.title || '無題',
          body: await window.api.notes.readBody(note.id),
        })),
      );
      // ===== ユーザー入力中の URL を実際に取得して AI に渡す =====
      // AI 自体は URL を読めないため、main 側で fetch して本文を取り出し、
      // 「添付された URL の本文」として user メッセージに同梱する。
      // これがないと AI は URL 文字列だけ見て、ノート本文や履歴を頼りに
      // 推測してしまい「指定 URL ではなく前回内容を要約する」現象が起きる。
      const detectedUrls = extractUrls(text);
      let augmentedLastUserContent = text || '添付ファイルを参照してください。';
      if (detectedUrls.length > 0) {
        // 取得中は placeholder を進捗表示に切り替えてユーザーへフィードバック。
        // ai:chat-chunk が来始めたら rawAccum に上書きされる想定だが、
        // チャンクが来る前にも何か見えている方が UX としてよい。
        setMessages((current) =>
          current.map((m) =>
            m.id === placeholderId
              ? {
                  ...m,
                  text: `📡 URL を取得中… (${detectedUrls.length} 件)`,
                }
              : m,
          ),
        );
        const fetched = await Promise.all(
          detectedUrls.map((u) => window.api.web.fetchUrl(u)),
        );
        // チャンクで上書きされるよう一旦空に戻す
        setMessages((current) =>
          current.map((m) =>
            m.id === placeholderId ? { ...m, text: '' } : m,
          ),
        );
        const sections: string[] = [text, ''];
        sections.push('=== 添付された URL の本文 (main process で取得済み) ===');
        for (const r of fetched) {
          sections.push('');
          sections.push(`--- ${r.url} ---`);
          if (r.ok) {
            if (r.title) sections.push(`タイトル: ${r.title}`);
            sections.push('');
            sections.push(r.content);
          } else {
            sections.push(`(取得失敗: ${r.error})`);
          }
        }
        sections.push('');
        sections.push('=== URL 本文ここまで ===');
        sections.push('');
        sections.push(
          '※ 上記「添付された URL の本文」は実際にネット越しに取得した最新の内容です。回答は必ずこの本文を根拠としてください。以前の会話や開いているノートの内容に引きずられず、上記の URL の内容を優先して要約・回答してください。',
        );
        augmentedLastUserContent = sections.join('\n');
      }
      const attachmentContext = buildAttachmentContext(attachments);
      if (attachmentContext) {
        augmentedLastUserContent = [
          augmentedLastUserContent,
          '',
          attachmentContext,
        ].join('\n');
      }
      // basePrompt は空文字なら送らない（main 側でも trim チェックしている）
      const basePrompt = aiActive.basePrompt.trim();
      const allowNoteActions = chatMode === 'edit';
      // ===== 履歴トリミング =====
      // モードに応じてユーザー指定のターン数 (= user+assistant ペア数) で
      // 履歴を絞り込む。長セッションでのコスト爆発と、古い応答による
      // 判断揺らぎを抑える。最新のユーザーメッセージは必ず含まれる。
      const turnLimit =
        chatMode === 'edit'
          ? settings.aiEditHistoryTurns
          : settings.aiChatHistoryTurns;
      const messageLimit = Math.max(2, turnLimit * 2);
      const trimmedMessages =
        nextMessages.length > messageLimit
          ? nextMessages.slice(-messageLimit)
          : nextMessages;
      const response = await window.api.ai.chat(
        {
          provider: settings.aiProvider,
          token: aiActive.token,
          endpoint: aiActive.endpoint,
          model: aiActive.model,
          messages: trimmedMessages.map((m, i) => ({
            role: m.role,
            content:
              i === trimmedMessages.length - 1
                ? augmentedLastUserContent
                : m.text,
          })),
          ...(basePrompt ? { basePrompt } : {}),
          noteContext: {
            title: noteTitle,
            body: noteBody,
            relatedNotes,
          },
          attachments: attachments
            .filter((a) => a.kind === 'image' && a.dataUrl)
            .map((a) => ({
              kind: 'image' as const,
              name: a.name,
              mimeType: a.mimeType,
              dataUrl: a.dataUrl!,
            })),
          allowNoteActions,
        },
        requestId,
      );
      // 最終結果でディレクティブをパース・実行し、表示テキストはストリップ済みに更新。
      const finalRaw = response || rawAccum;
      // 編集モードでなければディレクティブは無視（誤検出があってもノートに触らない）
      const actions = allowNoteActions ? parseNoteActions(finalRaw) : [];
      const visibleText =
        stripActionsForDisplay(finalRaw) ||
        (actions.length > 0 ? '（操作を実行しました）' : '');
      setMessages((current) =>
        current.map((m) =>
          m.id === placeholderId ? { ...m, text: visibleText } : m,
        ),
      );
      // ディレクティブ実行（失敗はチャットにエラー注記として残す）
      // undo 用の直前スナップショット: AI が編集を行った場合のみセット
      const snapshotBodyForUndo = noteBody;
      const snapshotNoteIdForUndo = activeId;
      let didEditCurrentNote = false;
      for (const action of actions) {
        try {
          if (action.kind === 'create') {
            const created = await window.api.notes.create({
              title: action.title || 'AIで作成したノート',
              folder: action.folder || undefined,
              body: action.body,
            });
            onNoteCreated?.(created);
          } else if (action.kind === 'append') {
            if (!activeId) {
              setMessages((current) => [
                ...current,
                {
                  id: `e-${Date.now()}`,
                  role: 'assistant',
                  text: '追記対象のノートが選択されていません。',
                },
              ]);
              continue;
            }
            onAppendToCurrentNote?.(action.content);
            didEditCurrentNote = true;
          } else if (action.kind === 'rewrite') {
            if (!activeId) {
              setMessages((current) => [
                ...current,
                {
                  id: `e-${Date.now()}`,
                  role: 'assistant',
                  text: '書き換え対象のノートが選択されていません。',
                },
              ]);
              continue;
            }
            if (isDestructiveRewrite(noteBody, action.body)) {
              // ノートとして成立しない結果は拒否（ガード）
              setMessages((current) => [
                ...current,
                {
                  id: `e-${Date.now()}`,
                  role: 'assistant',
                  text:
                    '破壊的な変更（本文がほぼ空になる書き換え）のため実行を取り消しました。',
                },
              ]);
              continue;
            }
            onRewriteCurrentNote?.(action.body);
            didEditCurrentNote = true;
          }
        } catch (actionErr) {
          const msg =
            actionErr instanceof Error ? actionErr.message : String(actionErr);
          setMessages((current) => [
            ...current,
            {
              id: `e-${Date.now()}`,
              role: 'assistant',
              text: `ノート操作に失敗しました: ${msg}`,
            },
          ]);
        }
      }
      // 実際にノートを編集したときだけ、この応答メッセージに undo
      // スナップショットを attach する。activeId は実行前のものを使う。
      if (didEditCurrentNote && snapshotNoteIdForUndo) {
        setMessages((current) =>
          current.map((m) =>
            m.id === placeholderId
              ? {
                  ...m,
                  undo: {
                    noteId: snapshotNoteIdForUndo,
                    previousBody: snapshotBodyForUndo,
                  },
                }
              : m,
          ),
        );
      }
    } catch (err) {
      // 失敗時はプレースホルダをエラーメッセージで置き換える。
      const errText = err instanceof Error ? err.message : String(err);
      setMessages((current) =>
        current.map((m) =>
          m.id === placeholderId
            ? { ...m, id: `e-${Date.now()}`, text: errText }
            : m,
        ),
      );
    } finally {
      unsubscribeChunk();
      inflightRequestIdRef.current = null;
      setBusy(false);
    }
  };

  /**
   * メッセージリストの最下部への自動スクロール。
   * messages 配列が更新されるたび (新規メッセージ追加・ストリーミング delta 追記
   * のどちらでも setMessages 経由で配列参照が変わるため) に発火する。
   * ユーザーが過去のやり取りを読み返すために上方向にスクロールしている間は
   * isPinnedToBottomRef が false になっているので押し戻さない。
   */
  useEffect(() => {
    if (!isPinnedToBottomRef.current) return;
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /**
   * メッセージリストのスクロールイベントハンドラ。
   * 最下部付近 (80px 以内) にいるかどうかで isPinnedToBottomRef を切り替え、
   * 「ユーザーが読み返し中なら自動スクロールしない / 戻ってきたらまた追従する」
   * を実現する。
   */
  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom < 80;
  };

  /**
   * 「ノートに変換」ボタンの初動。保存場所とタイトルをユーザーに確認させるため、
   * 実際の作成は handleConfirmCreateNote 側で実行する。
   * ここでは事前バリデーション (会話の有無 / API の存在) と、確認モーダル
   * (pendingNote) の初期値セットだけ行う。
   */
  const handleSaveAsNote = () => {
    if (savingNote) return;
    if (messages.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: '保存する会話がありません。',
        },
      ]);
      return;
    }
    if (typeof window.api?.notes?.create !== 'function') {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text:
            'ノート作成 API が読み込まれていません。アプリを再起動してください。',
        },
      ]);
      return;
    }
    // 確認モーダルを表示。タイトル/フォルダは編集可能なので、必要に応じて変更可能。
    // フォルダ名は設定 (AI > 共通設定 > ノート保存先フォルダ) を優先し、空なら 'AIノート'。
    setPendingNote({
      title: formatNowForNoteTitle(),
      folder: settings.aiNoteFolder?.trim() || 'AIノート',
    });
  };

  /** 確認モーダルでキャンセルした時の処理。 */
  const handleCancelCreateNote = () => {
    setPendingNote(null);
  };

  /**
   * 確認モーダルで「作成」を押した時の本処理。
   * pendingNote のタイトル/フォルダで実際にノートを生成する。
   * 空タイトル/空フォルダは既定値にフォールバック。
   */
  const handleConfirmCreateNote = async () => {
    if (savingNote || !pendingNote) return;
    const title = pendingNote.title.trim() || formatNowForNoteTitle();
    const folder =
      pendingNote.folder.trim() ||
      settings.aiNoteFolder?.trim() ||
      'AIノート';
    setPendingNote(null);
    setSavingNote(true);
    try {
      const body = buildMarkdownFromMessages(
        messages.map((m) => ({ role: m.role, text: m.text })),
        getActiveModelName(settings),
        noteTitle,
      );
      const created = await window.api.notes.create({
        title,
        folder,
        body,
      });
      onNoteCreated?.(created);
      setMessages((prev) => [
        ...prev,
        {
          id: `n-${Date.now()}`,
          role: 'assistant',
          text: `**ノートを作成しました**: \`${folder}/${created.title}\``,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text:
            'ノートの作成に失敗しました: ' +
            (err instanceof Error ? err.message : String(err)),
        },
      ]);
    } finally {
      setSavingNote(false);
    }
  };

  /** 現在のチャット履歴をすべて消去する。AI 送信中は無効。 */
  const handleClearChat = () => {
    if (busy) return;
    if (messages.length === 0) return;
    if (!window.confirm('現在のチャット履歴をすべて削除しますか?')) return;
    setMessages([]);
    setDraft('');
    setAttachments([]);
    historyIndexRef.current = -1;
    draftBufferRef.current = '';
  };

  const addDroppedFiles = async (files: FileList | File[]) => {
    const dropped = Array.from(files);
    if (dropped.length === 0) return;
    const supported = dropped.filter(
      (file) =>
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf') ||
        isTextFile(file),
    );
    const unsupportedCount = dropped.length - supported.length;
    if (unsupportedCount > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeLocalId('e'),
          role: 'assistant',
          text: `未対応のファイル ${unsupportedCount} 件をスキップしました。画像 / PDF / テキストファイルをドロップしてください。`,
        },
      ]);
    }
    for (const file of supported) {
      try {
        const isPdf =
          file.type === 'application/pdf' ||
          file.name.toLowerCase().endsWith('.pdf');
        const isImage = file.type.startsWith('image/') && !isPdf;
        if (isPdf) {
          const buffer = await file.arrayBuffer();
          const text = await extractPdfText(buffer);
          setAttachments((prev) => [
            ...prev,
            {
              id: makeLocalId('att'),
              name: file.name,
              kind: 'pdf',
              mimeType: 'application/pdf',
              size: file.size,
              text,
            },
          ]);
        } else if (isImage) {
          const buffer = await file.arrayBuffer();
          const mimeType = file.type || 'image/png';
          setAttachments((prev) => [
            ...prev,
            {
              id: makeLocalId('att'),
              name: file.name,
              kind: 'image',
              mimeType,
              size: file.size,
              dataUrl: arrayBufferToDataUrl(buffer, mimeType),
            },
          ]);
        } else {
          // テキストファイル: そのまま文字列で読み込む。
          // 大きすぎる場合は先頭だけを採用してチャット末尾に注記を追加する。
          let text = await file.text();
          let truncated = false;
          if (text.length > MAX_TEXT_ATTACHMENT_BYTES) {
            text = text.slice(0, MAX_TEXT_ATTACHMENT_BYTES);
            truncated = true;
          }
          if (truncated) {
            text +=
              `\n\n[…ファイルが ${formatBytes(MAX_TEXT_ATTACHMENT_BYTES)} を超えたため、先頭部分のみ取り込みました]`;
          }
          setAttachments((prev) => [
            ...prev,
            {
              id: makeLocalId('att'),
              name: file.name,
              kind: 'text',
              mimeType: file.type || 'text/plain',
              size: file.size,
              text,
            },
          ]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev,
          {
            id: makeLocalId('e'),
            role: 'assistant',
            text: `${file.name} の読み込みに失敗しました: ${message}`,
          },
        ]);
      }
    }
  };

  /** 進行中の AI 要求を中断する。busy 状態は ai.chat() の例外経由で解除される */
  const handleStop = () => {
    const id = inflightRequestIdRef.current;
    if (!id || typeof window.api?.ai?.abort !== 'function') return;
    void window.api.ai.abort(id);
  };

  return (
    <aside
      className={`ai-chat ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={t.aiChat.title}
      aria-hidden={collapsed}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        void addDroppedFiles(e.dataTransfer.files);
      }}
      // リサイズドラッグ中は width のトランジションを切ってカーソルへ即時追従させる
      // CSS 変数で子要素 (.ai-chat__message / .ai-chat__input) のフォントサイズを
      // 設定 (設定 > AI > 共通設定) から動的に上書きする。
      style={
        {
          width: collapsed ? 0 : width,
          transition: resizing ? 'none' : undefined,
          '--ai-chat-msg-font-size': `${settings.aiChatFontSize}px`,
          '--ai-chat-input-font-size': `${settings.aiInputFontSize}px`,
        } as CSSProperties
      }
    >
      {/* 折りたたみ中もコンテンツが横方向に潰れて再フローしないよう、
          内側コンテナで実幅を保持する（サイドバーと同じパターン）。 */}
      <div className="ai-chat__inner" style={{ width }}>
      <header className="ai-chat__header">
        <h2 className="ai-chat__title">{t.aiChat.title}</h2>
        <button
          type="button"
          className="ai-chat__save-note"
          onClick={handleSaveAsNote}
          disabled={savingNote || messages.length === 0 || pendingNote !== null}
          title={t.aiChat.saveAsNoteTitle}
          aria-label={t.aiChat.saveAsNoteAria}
        >
          {savingNote ? t.aiChat.savingNote : t.aiChat.saveAsNote}
        </button>
        <button
          type="button"
          className="ai-chat__clear"
          onClick={handleClearChat}
          disabled={busy || messages.length === 0}
          title={t.aiChat.clearChatTitle}
          aria-label={t.aiChat.clearChat}
        >
          {t.aiChat.clearChat}
        </button>
        <button
          type="button"
          className="ai-chat__close"
          onClick={onClose}
          aria-label={t.aiChat.closeAria}
          title={t.aiChat.closeTitle}
        >
          ×
        </button>
      </header>
      <div
        className="ai-chat__messages"
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
      >
        {messages.length === 0 ? (
          <p className="ai-chat__empty">{t.aiChat.emptyState}</p>
        ) : (
          messages.map((message) =>
            message.role === 'assistant' ? (
              // AI 応答は Markdown としてレンダリング
              <div key={message.id} className="ai-chat__message-block">
                <div
                  className="ai-chat__message ai-chat__message--assistant ai-chat__message--md"
                  dangerouslySetInnerHTML={{
                    __html: md.render(message.text),
                  }}
                />
                {message.undo && (
                  <div className="ai-chat__undo-row">
                    <button
                      type="button"
                      className="ai-chat__undo-btn"
                      onClick={() => handleUndoEdit(message.id)}
                      title="直前のノート編集を取り消す"
                    >
                      ↶ 戻す
                    </button>
                  </div>
                )}
                {message.wasUndone && (
                  <div
                    className="ai-chat__undo-row ai-chat__undo-row--done"
                    aria-label="編集を取り消しました"
                  >
                    <span className="ai-chat__undo-note">
                      ↶ 編集を取り消して元に戻しました
                    </span>
                  </div>
                )}
              </div>
            ) : (
              // ユーザー入力はプレーンテキスト（pre-wrap で改行保持）
              <div
                key={message.id}
                className="ai-chat__message ai-chat__message--user"
              >
                {message.text}
              </div>
            ),
          )
        )}
        {busy && messages[messages.length - 1]?.text === '' && (
          <div
            className="ai-chat__message ai-chat__message--assistant ai-chat__thinking"
            role="status"
            aria-label={t.aiChat.waitingResponse}
          >
            {/* 思考中インジケータ: 3 つのドットが順番に跳ねる (iMessage 風)。
                animation-delay を 0 / 0.16 / 0.32s ずらして波打つように見せる。 */}
            <span className="ai-chat__thinking-dot" />
            <span className="ai-chat__thinking-dot" />
            <span className="ai-chat__thinking-dot" />
          </div>
        )}
      </div>
      <div className="ai-chat__composer">
        {attachments.length > 0 && (
          <div className="ai-chat__attachments" aria-label="AI添付ファイル">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="ai-chat__attachment">
                <span className="ai-chat__attachment-name">
                  {attachment.kind === 'pdf'
                    ? 'PDF'
                    : attachment.kind === 'image'
                      ? '画像'
                      : 'テキスト'}
                  : {attachment.name}
                </span>
                <span className="ai-chat__attachment-size">
                  {formatBytes(attachment.size)}
                </span>
                <button
                  type="button"
                  className="ai-chat__attachment-remove"
                  onClick={() =>
                    setAttachments((prev) =>
                      prev.filter((a) => a.id !== attachment.id),
                    )
                  }
                  aria-label={`${attachment.name} をAI添付から外す`}
                  title="添付から外す"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div
          className="ai-chat__mode-toggle"
          role="radiogroup"
          aria-label={t.aiChat.modeChat + ' / ' + t.aiChat.modeEdit}
        >
          <button
            type="button"
            className={`ai-chat__mode-btn ${chatMode === 'chat' ? 'is-active' : ''}`}
            onClick={() => setChatMode('chat')}
            role="radio"
            aria-checked={chatMode === 'chat'}
          >
            {t.aiChat.modeChat}
          </button>
          <button
            type="button"
            className={`ai-chat__mode-btn ${chatMode === 'edit' ? 'is-active' : ''}`}
            onClick={() => setChatMode('edit')}
            role="radio"
            aria-checked={chatMode === 'edit'}
          >
            {t.aiChat.modeEdit}
          </button>
        </div>
        <p className="ai-chat__hint" aria-live="polite">
          {chatMode === 'edit' ? t.aiChat.modeEditHint : t.aiChat.modeChatHint}
        </p>
        <div
          className="ai-chat__input-resizer"
          onMouseDown={handleResizerMouseDown}
          role="separator"
          aria-orientation="horizontal"
        >
          <span className="ai-chat__input-resizer-grip" aria-hidden="true" />
        </div>
        <textarea
          className="ai-chat__input"
          value={draft}
          style={{ height: inputHeight }}
          placeholder={t.aiChat.placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            // ユーザーがキー入力で変更したら履歴閲覧モードから抜ける
            if (historyIndexRef.current !== -1) {
              historyIndexRef.current = -1;
              draftBufferRef.current = '';
            }
          }}
          onKeyDown={(e) => {
            // IME 変換中の Enter は無視（確定キーと衝突しないよう）
            if (e.nativeEvent.isComposing || e.key === 'Process') return;
            // ↑↓ で過去入力ナビゲーション（1 行目で ↑、最終行で ↓ のみ反応）
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              if (handleArrowHistory(e)) return;
            }
            // Enter のみ → 送信。Shift+Enter は通常の改行（preventDefault しない）
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
              return;
            }
            // Escape → 進行中の AI 処理を中断
            if (e.key === 'Escape' && busy) {
              e.preventDefault();
              handleStop();
            }
          }}
        />
        <div className="ai-chat__composer-actions">
          <span className="ai-chat__model" aria-label="現在のAIとモデル">
            AI: {getActiveProviderLabel(settings)} / Model:{' '}
            {getActiveModelName(settings)}
          </span>
          <div className="ai-chat__composer-buttons">
            <button
              type="button"
              className="ai-chat__send"
              onClick={() => void handleSubmit()}
              disabled={(draft.trim().length === 0 && attachments.length === 0) || busy}
            >
              {busy ? t.aiChat.sending : t.aiChat.send}
            </button>
            <button
              type="button"
              className="ai-chat__stop"
              onClick={handleStop}
              disabled={!busy}
              title={t.aiChat.stopTitle}
              aria-label={t.aiChat.stop}
            >
              {t.aiChat.stop}
            </button>
          </div>
        </div>
      </div>
      </div>{/* ai-chat__inner */}
      {isDragOver && (
        <div className="ai-chat__drop-overlay" aria-hidden="true">
          PDFまたは画像をAIチャットに添付
        </div>
      )}
      {pendingNote && (
        <div
          className="modal__backdrop"
          onClick={handleCancelCreateNote}
          role="presentation"
        >
          <div
            className="modal modal--ai-note-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-note-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal--ai-note-confirm__inner">
              <h3
                id="ai-note-confirm-title"
                className="modal--ai-note-confirm__title"
              >
                {t.aiChat.confirmCreateNoteTitle}
              </h3>
              <p className="modal--ai-note-confirm__desc">
                {t.aiChat.confirmCreateNoteDesc}
              </p>
              <label className="modal--ai-note-confirm__row">
                <span className="modal--ai-note-confirm__label">
                  {t.aiChat.confirmCreateNoteFolder}
                </span>
                <input
                  type="text"
                  className="modal--ai-note-confirm__input"
                  value={pendingNote.folder}
                  onChange={(e) =>
                    setPendingNote((prev) =>
                      prev ? { ...prev, folder: e.target.value } : prev,
                    )
                  }
                  autoFocus
                />
              </label>
              <label className="modal--ai-note-confirm__row">
                <span className="modal--ai-note-confirm__label">
                  {t.aiChat.confirmCreateNoteNoteTitle}
                </span>
                <input
                  type="text"
                  className="modal--ai-note-confirm__input"
                  value={pendingNote.title}
                  onChange={(e) =>
                    setPendingNote((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev,
                    )
                  }
                />
              </label>
              <div className="modal--ai-note-confirm__actions">
                <button
                  type="button"
                  className="modal--ai-note-confirm__btn modal--ai-note-confirm__btn--secondary"
                  onClick={handleCancelCreateNote}
                >
                  {t.aiChat.confirmCreateNoteCancel}
                </button>
                <button
                  type="button"
                  className="modal--ai-note-confirm__btn modal--ai-note-confirm__btn--primary"
                  onClick={() => void handleConfirmCreateNote()}
                >
                  {t.aiChat.confirmCreateNoteOk}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
