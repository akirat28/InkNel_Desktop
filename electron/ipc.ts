import {
  app,
  ipcMain,
  shell,
  dialog,
  BrowserWindow,
  Menu,
  nativeTheme,
} from 'electron';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  promises as fsp,
} from 'node:fs';
import { initDb } from './db/index';
import { basename, extname, join, relative, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  listNotes,
  listTrashedNotes,
  getNote,
  insertNote,
  updateNoteMeta,
  updateNoteBodyText,
  setNoteProtected,
  setNoteSecret,
  addNoteLink,
  removeNoteLink,
  deleteNote,
  trashNote,
  restoreNote,
  emptyTrash,
  purgeOldTrash,
  searchNotes,
  upsertNoteFromSyncWithBody,
  type NoteMeta,
} from './db/notes';
import {
  listFolders,
  insertFolder,
  deleteFolder,
  deleteFolderRecursive,
  renameFolder,
} from './db/folders';
import { getAllSettings, setSetting } from './db/settings';
import {
  readBody,
  readBodyWithMeta,
  readFrontMatterOnly,
  writeNoteFile,
  deleteBody,
  writeTombstone,
  isTombstoneMeta,
} from './storage/notesFiles';
import {
  saveImage,
  imageExists,
  deleteImage,
  imagesDir,
} from './storage/imagesFiles';
import {
  saveAttachment,
  attachmentExists,
  attachmentPath,
  deleteAttachment,
  attachmentsDir,
} from './storage/attachmentsFiles';
import {
  clearStorageRootCache,
  getStorageRoot,
  STORAGE_PATH_SETTING_KEY,
} from './storage/storageRoot';
// テンプレートは notes テーブルで folder='template' のノートを利用する
import {
  checkAndSyncSingleNote,
  detectProviders,
  getSyncStatus,
  pushSingleMedia,
  pushSingleNote,
  removeSingleNote,
  runSync,
  type ShareProvider,
} from './sync/cloudSync';
import { imagePath } from './storage/imagesFiles';
import { attachmentPath as getAttachmentPath } from './storage/attachmentsFiles';
import {
  getPluginsDir,
  listLocalFiles,
  listLocalPluginManifests,
  readPluginTextFile,
  savePluginManifest,
  savePluginTextFile,
  uninstallPlugin,
} from './storage/pluginsDir';
import { createBackup, restoreBackup } from './storage/backup';

/** 画像 1 枚あたりの最大サイズ (バイト) */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
/** 添付ファイル 1 つあたりの最大サイズ (バイト) */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MB
/** AI へ送る本文の最大文字数。過大入力でアプリが固まるのを避ける。 */
const MAX_AI_INPUT_CHARS = 160_000;

/**
 * アプリの theme 設定 ('dark' | 'light' | その他) を Electron の
 * nativeTheme.themeSource に反映する。これにより OS ネイティブメニュー
 * (`Menu.popup()` 系のコンテキストメニュー / ケバブメニュー) が
 * アプリのテーマと同じ配色で表示される。
 *
 * 値:
 *   - 'light'  → ライト固定 (システムが Dark でもメニューはライト)
 *   - 'dark'   → ダーク固定
 *   - その他   → 'system' (OS 設定に追従)
 */
function applyNativeTheme(theme: string): void {
  if (theme === 'light' || theme === 'dark') {
    nativeTheme.themeSource = theme;
  } else {
    nativeTheme.themeSource = 'system';
  }
}

type AiProvider =
  | 'general'
  | 'chatgpt'
  | 'claudeCode'
  | 'copilot'
  | 'gemini';
type AiAction =
  | 'convertHtmlToMarkdown'
  | 'summarizeWhole'
  | 'generateTitleFromContent'
  | 'summarizeByHeading'
  | 'organizeBullets'
  | 'formatTables'
  | 'improveCodeBlocks'
  | 'dialectKansai'
  | 'dialectInaka'
  | 'makeQuiz';

interface AiTransformInput {
  provider: AiProvider;
  token: string;
  endpoint: string;
  model: string;
  action: AiAction;
  content: string;
}

interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AiChatAttachment {
  kind: 'image';
  name: string;
  mimeType: string;
  dataUrl: string;
}

interface AiChatInput {
  provider: AiProvider;
  token: string;
  endpoint: string;
  model: string;
  messages: AiChatMessage[];
  /** プロバイダ既定の system prompt の前に挿入するユーザー固有プロンプト */
  basePrompt?: string;
  noteContext?: {
    title: string;
    body: string;
    relatedNotes?: Array<{
      title: string;
      body: string;
    }>;
  };
  /**
   * 「編集モード」フラグ。true の時のみ、AI にノート操作ディレクティブ
   * (create_note / append_to_current_note / rewrite_current_note) の出力を
   * 許可する system プロンプトを差し込む。false（チャットモード）では普通の
   * 会話のみで、ノートには手を触れない。
   */
  allowNoteActions?: boolean;
  attachments?: AiChatAttachment[];
}

function buildAiInstruction(action: AiAction): string {
  const common =
    'あなたはMarkdownノートを整える編集者です。出力はMarkdown本文だけにしてください。説明文、前置き、コードフェンスでの全体囲みは不要です。元の情報を捏造せず、構造をできる限り保ってください。';
  switch (action) {
    case 'summarizeByHeading':
      return `${common}\nHTMLまたはMarkdownの内容を、見出し単位で要約してください。見出し階層を保持し、各見出しの下に重要点を短い箇条書きで整理してください。`;
    case 'generateTitleFromContent':
      return [
        'あなたはノートのタイトルを命名するアシスタントです。',
        '入力されたノート本文を読み、その内容を端的に表すタイトル文字列を 1 行だけ出力してください。',
        '出力規約:',
        '- 出力はタイトル文字列のみ。Markdown 記法（#, **, バッククォート等）、引用符、前置き、解説を一切含めない。',
        '- 日本語で **必ず 20 文字以内** にする。20 文字を超える案は要点を残して短縮し直すこと。',
        '- 句読点（。、）は付けない。',
        '- ファイル名としても無理が無いよう、`/` `\\` `:` `?` `*` `"` `<` `>` `|` は使わない。',
        '- 内容に固有名詞・日付があれば優先的に取り込み、識別しやすくする。',
        '- 内容が乏しい / 空に近い場合は「無題のメモ」と出力する。',
      ].join('\n');
    case 'organizeBullets':
      return `${common}\n箇条書きを読みやすく整理してください。重複を統合し、粒度をそろえ、必要なら親子関係を作ってください。見出しや本文の構造は保ってください。`;
    case 'improveCodeBlocks':
      return `${common}\nコードブロックだけを改善してください。コードの可読性、コメント、フォーマット、明らかな構文崩れを整えます。コード以外の本文は意味を変えず保持してください。`;
    case 'formatTables':
      return `${common}\n表だけをMarkdownテーブルとして整形してください。列数、見出し、セル内容を読みやすくそろえ、表以外の本文は意味を変えず保持してください。`;
    case 'convertHtmlToMarkdown':
      return `${common}\n貼り付けられたHTMLを、構造を保持したままMarkdownへ変換してください。見出し、箇条書き、コードブロック、表、リンクを適切なMarkdownにしてください。`;
    case 'summarizeWhole':
      return [
        common,
        'ノートの本文全体を読み、要点を簡潔にまとめた要約を作成してください。',
        '出力は次の規約に従ってください:',
        '- 出力は要約本文だけ。前置き・締めの文・コードフェンスでの全体囲みは入れない。',
        '- 元ノートの主旨を保持し、書かれていない事項を捏造しない。',
        '- 長さの目安は元の 20〜30% 程度。元が短い場合はそれに応じて短く。',
        '- 要点を箇条書きで列挙する構成を基本とし、複数トピックがあれば見出しでセクション分けする。',
        '- 数値・固有名詞・日付など事実情報は省略しない。',
      ].join('\n');
    case 'dialectKansai':
      // common (構造保持・捏造禁止) をそのまま使うと AI が「文体変換は情報の改変」と
      // 解釈して原文をそのまま返すことがある。専用プロンプトで「文体は積極的に変える」
      // ことを明示し、断り文や注釈を一切返さないよう強く指示する。
      return [
        'あなたは Markdown ノートの文体を関西弁 (大阪弁) に書き換える編集者です。',
        '入力された Markdown 全体を、以下のルールで関西弁に翻訳して返してください。',
        '出力規約:',
        '- 出力は変換後の Markdown 本文だけ。前置き・後置きの説明文、',
        '  「変換しました」「変換できません」等の断り文、コードフェンスでの全体囲みは付けない。',
        '- 見出し (#)・箇条書き (- や 1.)・表・コードブロック・リンクといった Markdown 記法・構造は変えない。',
        '- コードブロックの中身、URL、固有名詞、コマンド、英単語、数式は変換しない。',
        '- それ以外の地の文・敬体・常体の本文はすべて自然な関西弁 (大阪弁ベース) に書き換える。',
        '  例: 「〜です/ます」→「〜やで」「〜やねん」「〜やな」「〜してまうわ」、',
        '  「〜ではない」→「〜ちゃう」、「とても」→「めっちゃ」、「だから」→「せやから」、',
        '  「しなければならない」→「せなあかん」など。',
        '- 事実関係・固有名詞・数値・順序は変えない。情報の追加・削除はしない。',
        '- 必ず関西弁へ「変換した結果」だけを返す。拒否・説明・注釈は禁止。',
      ].join('\n');
    case 'dialectInaka':
      return [
        'あなたは Markdown ノートの文体を田舎っぽい素朴な言い回しに書き換える編集者です。',
        '入力された Markdown 全体を、文末などに「ズラ」を散りばめた田舎言葉へ変換して返してください。',
        '出力規約:',
        '- 出力は変換後の Markdown 本文だけ。前置き・後置きの説明文、',
        '  「変換しました」「変換できません」等の断り文、コードフェンスでの全体囲みは付けない。',
        '- 見出し (#)・箇条書き (- や 1.)・表・コードブロック・リンクといった Markdown 記法・構造は変えない。',
        '- コードブロックの中身、URL、固有名詞、コマンド、英単語、数式は変換しない。',
        '- それ以外の地の文の文末などに自然な形で「〜ズラ」「〜だズラ」「〜するズラ」を挿入し、',
        '  全体を古風で素朴な田舎っぽい語り口に書き換える。',
        '- すべての文末を機械的に置き換えるのではなく、読みづらくならない範囲で散らす。',
        '- 事実関係・固有名詞・数値・順序は変えない。情報の追加・削除はしない。',
        '- 必ず変換後の結果だけを返す。拒否・説明・注釈は禁止。',
      ].join('\n');
    case 'makeQuiz':
      return [
        common,
        'ノートを理解して、理解ができているかを確認する質問文を作成してください。',
        '出力は次の規約に従ってください:',
        '- 元のノート本文はそのまま冒頭から保持する。改変・削除・要約はしない。',
        '- 本文の末尾に `## 問題` という見出しを 1 つ追加する。',
        '- その下に質問を `1.` から始まる番号付きリストで並べる。',
        '- 問題数はノートの文章量・トピック数に応じて調整する',
        '  (短いノートは 2〜3 問、中程度は 4〜6 問、長いノートは 7〜10 問を目安)。',
        '- 各設問は本文中に答えの根拠がある内容に限る。本文に無い知識を問わない。',
        '- 解答は出力しない。問題文のみ列挙する。',
      ].join('\n');
  }
}

function defaultAiEndpoint(provider: AiProvider): string {
  if (provider === 'claudeCode') return 'https://api.anthropic.com/v1/messages';
  if (provider === 'chatgpt') return 'https://api.openai.com/v1/chat/completions';
  if (provider === 'gemini') {
    // Gemini はモデル名を URL パスに含めるネイティブ API を使う。
    // ここでは「モデルディレクトリ」までを既定値とし、実際の呼び出し時に
    // /{model}:generateContent や :streamGenerateContent を組み立てる。
    return 'https://generativelanguage.googleapis.com/v1beta/models';
  }
  return 'https://api.openai.com/v1/chat/completions';
}

function defaultAiModel(provider: AiProvider): string {
  if (provider === 'claudeCode') return 'claude-3-5-sonnet-latest';
  if (provider === 'chatgpt') return 'gpt-4o-mini';
  if (provider === 'gemini') return 'gemini-2.0-flash';
  return 'gpt-4o-mini';
}

function cleanAiOutput(text: string): string {
  return text
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1')
    // buildAiUserMessage で挿入する区切りタグを AI が稀にそのまま出力するケースの保険
    .replace(/<<<\/?(?:INKNEL_CONTENT|END_INKNEL_CONTENT)>>>/g, '')
    .trim();
}

/**
 * action ごとの sampling temperature。
 * 整形系 (構造保持・要約) は決定的にしたいので低め、文体変換系は揺らぎが
 * 必要なので少し高めにする。低すぎると AI が「文体を変えるのは情報改変」と
 * 判断して原文をほぼそのまま返す挙動が出る。
 */
function aiTemperatureFor(action: AiAction): number {
  if (action === 'dialectKansai' || action === 'dialectInaka') return 0.7;
  if (action === 'makeQuiz') return 0.5;
  return 0.2;
}

/**
 * AI への user メッセージを組み立てる。system プロンプトだけだと、GPT-4o-mini
 * など軽量モデルが文体変換指示を「文字どおりに従わず」原文を返すことが多い。
 * user 側にも明示的な指示を付与して、二重に押し込む。
 *
 * 区切りは三連バッククォートで囲み、AI に「ここからここまでが書き換え対象」
 * と分かるようにする。ノート本文内に裸の ``` があっても囲みが壊れないよう、
 * カスタム区切りタグを使う。
 */
function buildAiUserMessage(action: AiAction, content: string): string {
  const wrap = (instruction: string): string =>
    [
      instruction,
      '',
      '対象テキスト (この区切りの中身だけを書き換える):',
      '<<<INKNEL_CONTENT>>>',
      content,
      '<<<END_INKNEL_CONTENT>>>',
      '',
      '注意: 出力は書き換え後のテキストだけ。前置き・断り文・区切りタグ自体は出力しない。',
    ].join('\n');
  switch (action) {
    case 'dialectKansai':
      return wrap(
        'アクティブなノートのテキスト全体を関西弁 (大阪弁) に書き換えてください。Markdown 記法・見出し・箇条書き・表・コードブロックの構造は変えず、文体だけ関西弁に変えてください。コード・URL・固有名詞は変えないでください。',
      );
    case 'dialectInaka':
      return wrap(
        '次のテキスト全体に「ズラ」をつけて田舎っぽい文章に書き換えてください。Markdown 記法・見出し・箇条書き・表・コードブロックの構造は変えず、地の文の文末などに自然な形で「〜ズラ」「〜だズラ」を散らしてください。コード・URL・固有名詞は変えないでください。',
      );
    case 'makeQuiz':
      return wrap(
        '次のテキストを読み、理解度を確認する質問文を作って、テキスト末尾に `## 問題` 見出しを追加してその下に番号付きで列挙してください。元の本文は冒頭からそのまま残す。質問数は文章量に応じて 2〜10 問。',
      );
    case 'summarizeWhole':
      return wrap('次のテキストを箇条書き中心に要約してください。');
    default:
      // 整形系 (Markdown 変換・タイトル生成・見出し要約・箇条書き整理・表・コード) は
      // system プロンプトだけで十分に動くため、user は本文をそのまま渡す。
      return content;
  }
}

async function callOpenAiCompatible(
  input: AiTransformInput,
  endpoint: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      model,
      temperature: aiTemperatureFor(input.action),
      messages: [
        { role: 'system', content: buildAiInstruction(input.action) },
        { role: 'user', content: buildAiUserMessage(input.action, input.content) },
      ],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('AIから有効な応答が返りませんでした');
  }
  return cleanAiOutput(text);
}

async function callAnthropic(
  input: AiTransformInput,
  endpoint: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.token,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: aiTemperatureFor(input.action),
      system: buildAiInstruction(input.action),
      messages: [
        {
          role: 'user',
          content: buildAiUserMessage(input.action, input.content),
        },
      ],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  const parts = Array.isArray(json?.content) ? json.content : [];
  const text = parts
    .map((part: { type?: string; text?: string }) =>
      part?.type === 'text' && typeof part.text === 'string' ? part.text : '',
    )
    .join('');
  if (text.trim().length === 0) {
    throw new Error('AIから有効な応答が返りませんでした');
  }
  return cleanAiOutput(text);
}

/**
 * Gemini ネイティブ API（非ストリーミング）でノートを変換する。
 * - endpoint は「モデルディレクトリ」を渡す: 例) v1beta/models
 * - 実呼び出し URL は `{endpoint}/{model}:generateContent?key={API_KEY}`
 * - Authorization ヘッダではなく URL クエリ key で認証
 */
async function callGeminiNative(
  input: AiTransformInput,
  endpoint: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const base = endpoint.replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.token)}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildAiInstruction(input.action) }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildAiUserMessage(input.action, input.content) },
          ],
        },
      ],
      generationConfig: { temperature: aiTemperatureFor(input.action) },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  // candidates[0].content.parts[*].text を結合
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
    : '';
  if (text.trim().length === 0) {
    throw new Error('AIから有効な応答が返りませんでした');
  }
  return cleanAiOutput(text);
}

async function transformWithAi(input: AiTransformInput): Promise<string> {
  const provider = input.provider;
  validateAiConnection(input);
  const content = input.content.trim();
  if (!content) {
    throw new Error('変換する本文がありません');
  }
  if (content.length > MAX_AI_INPUT_CHARS) {
    throw new Error(
      `本文が長すぎます。${MAX_AI_INPUT_CHARS.toLocaleString('ja-JP')}文字以内にしてください。`,
    );
  }
  const endpoint = input.endpoint.trim() || defaultAiEndpoint(provider);
  const model = input.model.trim() || defaultAiModel(provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    if (provider === 'claudeCode') {
      return await callAnthropic(input, endpoint, model, controller.signal);
    }
    if (provider === 'gemini') {
      return await callGeminiNative(input, endpoint, model, controller.signal);
    }
    return await callOpenAiCompatible(input, endpoint, model, controller.signal);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AIの応答がタイムアウトしました');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function validateAiConnection(input: {
  provider: AiProvider;
  token: string;
}): void {
  if (
    input.provider !== 'general' &&
    input.provider !== 'chatgpt' &&
    input.provider !== 'claudeCode' &&
    input.provider !== 'copilot' &&
    input.provider !== 'gemini'
  ) {
    throw new Error('AIプロバイダの設定が不正です');
  }
  if (!input.token.trim()) {
    throw new Error('設定でAI接続用Tokenを入力してください');
  }
}

function buildChatSystemPrompt(input: AiChatInput): string {
  const builtin =
    'あなたはMarkdownノートアプリのAIアシスタントです。ユーザーの質問に日本語で簡潔かつ具体的に答えてください。現在開いているノートを最優先の根拠にし、連携ノートが渡された場合は補完情報として参照してください。矛盾がある場合は現在のノートを優先してください。不明な点は推測しすぎず確認してください。';
  // ----- アクションディレクティブ -----
  // ユーザーが「ノートを作って」「ノートに追記して」のような操作を依頼した場合、
  // 返信の末尾に下記の正確な形式でディレクティブを付加する。
  // アプリ側がこの形式をパースして実際の操作を行う。
  const actionInstructions = [
    '',
    '【ノート操作ディレクティブ】',
    '次のいずれかをユーザーが明確に依頼した場合に限り、自然な返信文の **末尾** に以下の形式のディレクティブを付加してください。形式は厳密に守ること（角括弧2つ、英大文字、改行位置、キー名）。',
    '',
    '1) 新しいノートを作成する場合:',
    '[[INKNEL_ACTION]]',
    'type: create_note',
    'title: <ノートタイトル（1行）>',
    'folder: <フォルダ名（省略可。未指定なら最上位）>',
    '[[BODY]]',
    '<ノート本文（Markdown、複数行可）>',
    '[[/BODY]]',
    '[[/INKNEL_ACTION]]',
    '',
    '2) 現在開いているノートの末尾に追記する場合:',
    '   - 「追記して」「足して」「末尾に〜を入れて」「〜も加えて」など、既存本文の末尾に新しい内容を加える指示に使う。',
    '[[INKNEL_ACTION]]',
    'type: append_to_current_note',
    '[[BODY]]',
    '<追記する内容（Markdown、複数行可）>',
    '[[/BODY]]',
    '[[/INKNEL_ACTION]]',
    '',
    '3) 現在開いているノートを書き換える（加筆 / 修正 / 一部削除 / 整形）場合:',
    '   - 以下のような表現が来たら、たとえ主語が省略されていても「現在開いているノートに対する修正指示」として解釈する:',
    '     ・「修正して」「内容を修正して」「直して」「書き直して」「リライトして」',
    '     ・「編集して」「整理して」「整形して」「読みやすくして」「校正して」',
    '     ・「〜を消して」「〜を削って」「要約して」「短くして」「もっと詳しく」',
    '     ・「ノートに〜を直して」「ノートの〜を消して」「ノートの〜を整理して」',
    '   - 単に「修正して」「編集して」「追記して」とだけ送られた場合でも、開いているノートが存在するなら、その文脈に従って rewrite_current_note または append_to_current_note を出すこと。確認の質問を返すのは避ける。',
    '   - 本文は **書き換え後の完成形を全文** で書く。差分や説明文ではない。',
    '   - ユーザーが部分修正だけを指示した場合も、変更箇所以外は元の本文をそのまま残した「全文」を出力すること。',
    '',
    '   【セクション指定の部分修正】',
    '   - 「〇〇のセクションを要約して置き換えて」「〇〇 の文章を直して」「〇〇 の項目を整理して」のように、',
    '     **特定の見出し（セクション）に対して指示があった場合は、そのセクションの本文だけを書き換え、他のセクション/見出しは元のまま温存**して、全文を出力する。',
    '   - セクションの範囲は Markdown の見出し (`#`〜`######`) を基準とする。指定された見出し行の直後から、',
    '     **同レベルまたは上位レベルの次の見出しが現れる直前**までを「そのセクションの本文」とみなす。',
    '     (例: `## 概要` を指定 → 次の `##` または `#` の直前までを置換対象とする。)',
    '   - 見出し行そのもの（`## 概要` 等のタイトル）は、ユーザーが「見出しごと書き換えて」と明示しない限り保持する。',
    '   - 指定された見出しが本文中に見つからない場合は、ディレクティブを出さずに自然文で「『〇〇』というセクションが見つかりませんでした」と返す。',
    '   - 見出しの曖昧マッチ (前後の空白・記号無視、大小区別なし) は許容する。複数候補がある場合のみ自然文で確認を求める。',
    '   - 部分修正の出力でも、ディレクティブは rewrite_current_note を使い、**変更後のノート全文** (見出し含む) を [[BODY]] に入れる。',
    '',
    '[[INKNEL_ACTION]]',
    'type: rewrite_current_note',
    '[[BODY]]',
    '<書き換え後のノート本文 全文（Markdown）>',
    '[[/BODY]]',
    '[[/INKNEL_ACTION]]',
    '',
    '規約:',
    '- ディレクティブは必要な時だけ。普通の質問・雑談には付けない。',
    '- ディレクティブの直前に、操作内容を一文で簡潔に伝える自然文を必ず添える（例: 「『XYZ』というノートを作成します。」「ノートを修正します。」）。',
    '- 修正/編集/追記のような指示は、開いているノートがある限り「確認」ではなく「実行」優先。すぐにディレクティブを出す。',
    '- 「修正します」「編集します」「追記します」などと宣言したら、その応答の中で必ず対応する [[INKNEL_ACTION]] ディレクティブも出力すること。宣言だけでディレクティブを出さない応答は無効。',
    '- 過去のやり取りで自分の編集が「取り消された」「元に戻された」ことが示唆されていても、ユーザーの最新の指示が「修正して」「追記して」等であれば、躊躇せず新しいディレクティブを出して再編集すること。確認質問でターンを浪費しない。',
    '- 複数の操作が必要な場合はディレクティブを複数個並べてよい。',
    '- 角括弧2つ・スラッシュ・大文字を厳守すること。',
    '- ディレクティブ本体は Markdown コードフェンス (``` ) で囲まないこと。',
    '',
    '【破壊的な依頼は受け付けない】',
    '- 以下のような「ノートとして成立しなくなる」依頼が来た場合、ディレクティブは出さず、自然文で「破壊的な操作のため実行できません」と簡潔に断ること。代替案（例: 「特定の見出しだけ削除」「別ノートに退避」など）があれば提案する。',
    '  - 「このノートを削除して」「ノートを消して」',
    '  - 「内容を全部消して」「全削除して」「空にして」',
    '  - 結果として本文が空 / ほぼ空（数文字以下）になる修正',
    '- 一方、「要約だけ削除」「特定セクションだけ削除」のような部分削除は、結果として意味のある本文が残るならば rewrite_current_note を使ってよい。',
  ].join('\n');
  // ユーザーが設定で指定したベースプロンプト（役割）。空欄なら何も挿入しない。
  const userBase = (input.basePrompt ?? '').trim();
  const baseCore = userBase ? `${userBase}\n\n${builtin}` : builtin;
  // 編集モード時のみアクションディレクティブの説明を system プロンプトに付加。
  // チャットモードでは普通の会話だけ。
  const base = input.allowNoteActions
    ? baseCore + '\n' + actionInstructions
    : baseCore;
  const context = input.noteContext;
  if (!context || (!context.title.trim() && !context.body.trim())) {
    return base;
  }
  const body = context.body.slice(0, MAX_AI_INPUT_CHARS);
  const sections = [
    `${base}\n\n現在開いているノート:\nタイトル: ${context.title || '無題'}\n\n本文:\n${body}`,
  ];
  const relatedNotes = (context.relatedNotes ?? []).filter(
    (note) => note.title.trim().length > 0 || note.body.trim().length > 0,
  );
  if (relatedNotes.length > 0) {
    const relatedText = relatedNotes
      .map((note, index) => {
        const noteBody = note.body.slice(0, 40_000);
        return `\n連携ノート ${index + 1}:\nタイトル: ${note.title || '無題'}\n本文:\n${noteBody}`;
      })
      .join('\n');
    sections.push(`参照可能な連携ノート:${relatedText}`);
  }
  return sections.join('\n').slice(0, MAX_AI_INPUT_CHARS);
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function getChatAttachments(input: AiChatInput): AiChatAttachment[] {
  return (input.attachments ?? []).filter(
    (a) =>
      a.kind === 'image' &&
      /^image\//.test(a.mimeType) &&
      a.dataUrl.startsWith('data:image/'),
  );
}

function buildOpenAiChatContent(
  text: string,
  attachments: AiChatAttachment[],
): unknown {
  if (attachments.length === 0) return text;
  return [
    { type: 'text', text },
    ...attachments.map((a) => ({
      type: 'image_url',
      image_url: { url: a.dataUrl },
    })),
  ];
}

function buildAnthropicChatContent(
  text: string,
  attachments: AiChatAttachment[],
): unknown {
  if (attachments.length === 0) return text;
  return [
    { type: 'text', text },
    ...attachments.map((a) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: a.mimeType,
        data: dataUrlToBase64(a.dataUrl),
      },
    })),
  ];
}

/**
 * Response.body から `data: ...\n\n` 形式の SSE フレームを 1 件ずつ yield する。
 * fetch が返す ReadableStream<Uint8Array> を UTF-8 デコードしてバッファし、
 * 空行で終わるイベント境界で分割する。
 */
async function* readSseEvents(
  body: NodeJS.ReadableStream | ReadableStream<Uint8Array> | null,
): AsyncGenerator<string, void, void> {
  if (!body) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const reader =
    (body as ReadableStream<Uint8Array>).getReader?.() ??
    (body as unknown as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE イベントは空行 (\n\n) で区切られる
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      yield rawEvent;
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer;
}

async function chatWithOpenAiCompatible(
  input: AiChatInput,
  endpoint: string,
  model: string,
  signal: AbortSignal,
  onChunk?: (delta: string) => void,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      stream: true,
      messages: [
        { role: 'system', content: buildChatSystemPrompt(input) },
        ...input.messages.map((m, index) => ({
          role: m.role,
          content:
            m.role === 'user' && index === input.messages.length - 1
              ? buildOpenAiChatContent(m.content, getChatAttachments(input))
              : m.content,
        })),
      ],
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const message =
      errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  let full = '';
  for await (const evt of readSseEvents(res.body)) {
    // OpenAI 互換は `data: {...}` のみ。`data: [DONE]` で終端。
    for (const line of evt.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        const delta: unknown = obj?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta;
          onChunk?.(delta);
        }
      } catch {
        // 部分 JSON / 想定外フレームは無視
      }
    }
  }
  if (full.trim().length === 0) {
    throw new Error('AIから有効な応答が返りませんでした');
  }
  return full.trim();
}

async function chatWithAnthropic(
  input: AiChatInput,
  endpoint: string,
  model: string,
  signal: AbortSignal,
  onChunk?: (delta: string) => void,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.token,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0.3,
      stream: true,
      system: buildChatSystemPrompt(input),
      messages: input.messages.map((m, index) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content:
          m.role === 'user' && index === input.messages.length - 1
            ? buildAnthropicChatContent(m.content, getChatAttachments(input))
            : m.content,
      })),
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const message =
      errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  let full = '';
  for await (const evt of readSseEvents(res.body)) {
    // Anthropic SSE は `event: <name>\ndata: {...}` 形式。
    // content_block_delta だけ拾う。
    let eventName = '';
    let dataLine = '';
    for (const line of evt.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
    }
    if (eventName !== 'content_block_delta' || !dataLine) continue;
    try {
      const obj = JSON.parse(dataLine);
      const delta: unknown = obj?.delta?.text;
      if (typeof delta === 'string' && delta.length > 0) {
        full += delta;
        onChunk?.(delta);
      }
    } catch {
      // ignore
    }
  }
  if (full.trim().length === 0) {
    throw new Error('AIから有効な応答が返りませんでした');
  }
  return full.trim();
}

/**
 * Gemini ネイティブ API でチャットを行う（ストリーミング、SSE）。
 * URL: `{endpoint}/{model}:streamGenerateContent?alt=sse&key={API_KEY}`
 * - role は user/model（assistant ではない）
 * - system プロンプトは systemInstruction フィールドで渡す
 */
async function chatWithGemini(
  input: AiChatInput,
  endpoint: string,
  model: string,
  signal: AbortSignal,
  onChunk?: (delta: string) => void,
): Promise<string> {
  const base = endpoint.replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(input.token)}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildChatSystemPrompt(input) }] },
      contents: input.messages.map((m, index) => {
        const parts: Array<unknown> = [{ text: m.content }];
        if (m.role === 'user' && index === input.messages.length - 1) {
          for (const attachment of getChatAttachments(input)) {
            parts.push({
              inlineData: {
                mimeType: attachment.mimeType,
                data: dataUrlToBase64(attachment.dataUrl),
              },
            });
          }
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      }),
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const message =
      errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  let full = '';
  for await (const evt of readSseEvents(res.body)) {
    // Gemini SSE は `data: {...}` のみ
    for (const line of evt.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload);
        const parts = obj?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p?.text === 'string' && p.text.length > 0) {
              full += p.text;
              onChunk?.(p.text);
            }
          }
        }
      } catch {
        // 部分 JSON / 想定外フレームは無視
      }
    }
  }
  if (full.trim().length === 0) {
    throw new Error('AIから有効な応答が返りませんでした');
  }
  return full.trim();
}

/** 進行中のチャット要求の AbortController を requestId で管理 */
const inflightChatControllers = new Map<string, AbortController>();

/** ユーザーが中断したかタイムアウトかを区別するため、abort reason に使う印 */
const USER_ABORT_REASON = 'user-aborted';

/**
 * HTML / プレーンテキストを「AI が読める程度のプレーンテキスト」に圧縮する。
 *   - <script>/<style>/<noscript>/<svg>/<nav>/<header>/<footer>/<aside>/<form> ブロックごと除去
 *   - <title> をタイトルとして抽出 (なければ空)
 *   - 残りの HTML タグを除去
 *   - HTML エンティティ (&amp; / &lt; / &gt; / &quot; / &#39; / &nbsp;) を復元
 *   - 空白の連続を折り畳み (改行は最大 2 連続まで)
 *   - 50KB に切り詰め
 *
 * HTML 以外 (text/plain, application/json など) はタイトル無し + 文字数制限のみ適用。
 */
function extractReadableText(
  raw: string,
  contentType: string,
): { title: string; content: string } {
  const MAX_CHARS = 50_000;
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(raw);
  if (!isHtml) {
    return { title: '', content: raw.slice(0, MAX_CHARS) };
  }
  let html = raw;
  // <title> を抽出 (除去前に取り出す)
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, ' ').trim()
    : '';
  // 不要ブロックを丸ごと除去
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // ブロック要素の終わりは改行扱い
  html = html.replace(
    /<\/(p|div|h[1-6]|li|tr|br|article|section|blockquote)[^>]*>/gi,
    '\n',
  );
  html = html.replace(/<br\s*\/?>/gi, '\n');
  // 残りのタグを除去
  html = html.replace(/<[^>]+>/g, '');
  // HTML エンティティ復元
  html = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
  // 空白圧縮
  html = html.replace(/[ \t ]+/g, ' ');
  html = html.replace(/\n[ \t]+/g, '\n');
  html = html.replace(/\n{3,}/g, '\n\n');
  html = html.trim();
  return { title, content: html.slice(0, MAX_CHARS) };
}

async function chatWithAi(
  input: AiChatInput,
  requestId?: string,
  onChunk?: (delta: string) => void,
): Promise<string> {
  validateAiConnection(input);
  if (input.messages.length === 0) {
    throw new Error('送信するメッセージがありません');
  }
  const endpoint = input.endpoint.trim() || defaultAiEndpoint(input.provider);
  const model = input.model.trim() || defaultAiModel(input.provider);
  const controller = new AbortController();
  if (requestId) {
    inflightChatControllers.set(requestId, controller);
  }
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    if (input.provider === 'claudeCode') {
      return await chatWithAnthropic(
        input,
        endpoint,
        model,
        controller.signal,
        onChunk,
      );
    }
    if (input.provider === 'gemini') {
      return await chatWithGemini(
        input,
        endpoint,
        model,
        controller.signal,
        onChunk,
      );
    }
    return await chatWithOpenAiCompatible(
      input,
      endpoint,
      model,
      controller.signal,
      onChunk,
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // ユーザー中断 vs タイムアウトの区別
      if (controller.signal.reason === USER_ABORT_REASON) {
        throw new Error('AIの処理を中断しました');
      }
      throw new Error('AIの応答がタイムアウトしました');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (requestId) inflightChatControllers.delete(requestId);
  }
}

/** 進行中のチャット要求を中断する。該当 ID が無ければ何もしない */
function abortChat(requestId: string): boolean {
  const controller = inflightChatControllers.get(requestId);
  if (!controller) return false;
  controller.abort(USER_ABORT_REASON);
  inflightChatControllers.delete(requestId);
  return true;
}

/** 現在設定されているクラウド共有プロバイダを返す（'none' なら無効） */
function getActiveShareProvider(): ShareProvider {
  const settings = getAllSettings();
  const v = settings['share.provider'];
  if (v === 'icloud' || v === 'dropbox' || v === 'gdrive') return v;
  return 'none';
}

/** 最後に同期した日時を保存する設定キー */
export const STORAGE_LAST_SYNC_KEY = 'storage.lastSync';

/** 取り込み対象として認める UUID 風ファイル名 */
const NOTE_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SyncTarget {
  id: string;
  title: string;
  reason: 'missing' | 'newer';
}

/** disk 側の tombstone (deleted) を受けて DB 側からも削除すべきノート */
export interface SyncDeleteTarget {
  id: string;
  /** disk 上の deletedAt (ms epoch) */
  deletedAt: number;
}

export interface SyncPlan {
  storageRoot: string;
  dbNoteCount: number;
  diskFileCount: number;
  lastSync: number;
  /** DB → disk へ反映すべきノート */
  dbToDiskTargets: SyncTarget[];
  /** disk → DB へ反映すべきノート */
  diskToDbTargets: SyncTarget[];
  /** disk が tombstone なので DB から削除すべきノート */
  dbDeleteTargets: SyncDeleteTarget[];
}

/**
 * DB と保存先フォルダをスキャンして同期プランを構築する。
 * `storage.lastSync` を基準に、どちらが新しいかで方向を決める。
 *
 * 最適化:
 * - **async I/O**: fs.promises を使い、main プロセスの event loop を
 *   ブロックしない（Google Drive 等クラウドストレージ対策）
 * - **mtime 先行フィルタ**: 最初に async stat だけ行い、mtime ≤ lastSync かつ
 *   DB 側も lastSync 以前なら本文を読まない（最大の高速化）
 * - **front-matter のみ read**: 変更ありと判明したファイルでも、本文ではなく
 *   先頭 8KB だけ async で読んでメタ情報を取り出す
 */
export async function buildSyncPlan(): Promise<SyncPlan> {
  const root = getStorageRoot();
  const notesDir = join(root, 'notes');
  const lastSyncRaw = getAllSettings()[STORAGE_LAST_SYNC_KEY];
  const lastSync = (() => {
    const n = parseInt(lastSyncRaw ?? '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const dbNotes = listNotes();
  const dbById = new Map<string, NoteMeta>(dbNotes.map((n) => [n.id, n]));

  // disk の .md 一覧（async）
  let diskFiles: string[] = [];
  try {
    diskFiles = (await fsp.readdir(notesDir)).filter((f) => f.endsWith('.md'));
  } catch {
    diskFiles = [];
  }

  type DiskInfo = {
    id: string;
    title: string;
    updatedAt: number;
    /** Tombstone (deleted: true) の場合の deletedAt */
    deletedAt?: number;
  };
  const diskById = new Map<string, DiskInfo>();

  // ----- Stage 1: 全ファイルを async stat（メタデータのみ、クラウドでも高速） -----
  // Google Drive 等は readFile が遅いが stat は速い
  const STAT_CONCURRENCY = 16;
  const fileInfos: Array<{
    id: string;
    file: string;
    mtime: number;
    size: number;
  }> = [];
  for (let i = 0; i < diskFiles.length; i += STAT_CONCURRENCY) {
    const batch = diskFiles.slice(i, i + STAT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (file) => {
        const id = file.replace(/\.md$/, '');
        if (!NOTE_FILENAME_RE.test(id)) return null;
        try {
          const s = await fsp.stat(join(notesDir, file));
          return {
            id,
            file,
            mtime: Math.floor(s.mtimeMs),
            size: s.size,
          };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) if (r) fileInfos.push(r);
  }

  // ----- Stage 2: 必要なファイルだけ front-matter を読む -----
  // 「不要 = mtime ≤ lastSync かつ DB 側も lastSync 以前」のものは body 読まない
  const toReadFM: Array<{
    id: string;
    file: string;
    mtime: number;
    size: number;
  }> = [];
  // Tombstone (削除墓標) は本文を持たないので極めて小さい (front-matter のみで
  // 約 50〜150 byte 程度)。他デバイスでの削除がクラウド経由で同期されて来た
  // とき、ファイルの mtime が「元デバイスの削除時刻 (= こちらの lastSync より
  // 古い)」のまま入って来るケースがあり、純粋に mtime > lastSync で高速パス
  // を抜けると tombstone を取りこぼす。サイズの小ささを補助判定として使い、
  // 小さいファイルは必ず front-matter を読みに行く。
  const TOMBSTONE_MAX_BYTES = 256;
  for (const info of fileInfos) {
    const db = dbById.get(info.id);
    const fileMaybeChanged = info.mtime > lastSync;
    const dbMaybeChanged = db && db.updatedAt > lastSync;
    const isNew = !db;
    const tombstoneSuspect = info.size <= TOMBSTONE_MAX_BYTES;

    if (
      !fileMaybeChanged &&
      !dbMaybeChanged &&
      !isNew &&
      !tombstoneSuspect
    ) {
      // 完全に同期済みのはず。本文・front-matter を読まずに、disk 側の info は
      // DB の title を流用して登録（DB→disk 方向の判定にも使われないため安全）。
      diskById.set(info.id, {
        id: info.id,
        title: db?.title ?? info.id,
        updatedAt: info.mtime,
      });
      continue;
    }

    if (!fileMaybeChanged && db && !tombstoneSuspect) {
      // disk 未変更だが DB が新しい → DB→disk 方向。disk の title は使われない
      diskById.set(info.id, {
        id: info.id,
        title: db.title,
        updatedAt: info.mtime,
      });
      continue;
    }

    // disk が新しい / もしくは未登録の新規ファイル → front-matter を読む必要あり
    toReadFM.push(info);
  }

  // 並列度制限付きで front-matter のみ async read（cloud storage 対策）
  const READ_CONCURRENCY = 8;
  for (let i = 0; i < toReadFM.length; i += READ_CONCURRENCY) {
    const batch = toReadFM.slice(i, i + READ_CONCURRENCY);
    await Promise.all(
      batch.map(async (info) => {
        try {
          const { meta } = await readFrontMatterOnly(info.id);
          const isTomb = isTombstoneMeta(meta);
          const tsUpdated = isTomb
            ? typeof meta.deletedAt === 'number' && meta.deletedAt > 0
              ? meta.deletedAt
              : 0
            : 0;
          const metaUpdated =
            typeof meta.updatedAt === 'number' && meta.updatedAt > 0
              ? meta.updatedAt
              : 0;
          const updatedAt = Math.max(metaUpdated, tsUpdated, info.mtime);
          diskById.set(info.id, {
            id: info.id,
            title: meta.title ?? (isTomb ? '(deleted)' : '取り込みノート'),
            updatedAt,
            ...(isTomb && tsUpdated > 0
              ? { deletedAt: tsUpdated }
              : {}),
          });
        } catch {
          // 壊れたファイルはスキップ
        }
      }),
    );
  }

  const allIds = new Set<string>([...dbById.keys(), ...diskById.keys()]);
  const dbToDiskTargets: SyncTarget[] = [];
  const diskToDbTargets: SyncTarget[] = [];
  const dbDeleteTargets: SyncDeleteTarget[] = [];

  for (const id of allIds) {
    const db = dbById.get(id);
    const disk = diskById.get(id);

    // ----- disk 側が tombstone のケース -----
    // (他デバイスで削除された痕跡)
    if (disk?.deletedAt != null) {
      if (!db) {
        // DB に無ければ tombstone も無視 (既に削除済み)
        continue;
      }
      if (disk.deletedAt >= db.updatedAt) {
        // disk の削除時刻が DB の更新時刻以降 → 削除を受け入れる
        dbDeleteTargets.push({ id, deletedAt: disk.deletedAt });
      } else {
        // DB の方が新しい (削除後に編集が走った) → DB を勝たせて MD 再生成
        dbToDiskTargets.push({
          id,
          title: db.title || '無題',
          reason: 'newer',
        });
      }
      continue;
    }

    if (db && !disk) {
      // ディスクに無ければ書き出し
      dbToDiskTargets.push({ id, title: db.title || '無題', reason: 'missing' });
      continue;
    }
    if (!db && disk) {
      // DB に無ければ取り込み
      diskToDbTargets.push({ id, title: disk.title, reason: 'missing' });
      continue;
    }
    if (!db || !disk) continue;

    // 双方ある場合: lastSync を基準に新しい方を採用
    const dbNewerThanLastSync = db.updatedAt > lastSync;
    const diskNewerThanLastSync = disk.updatedAt > lastSync;

    if (dbNewerThanLastSync && !diskNewerThanLastSync) {
      dbToDiskTargets.push({ id, title: db.title || '無題', reason: 'newer' });
    } else if (diskNewerThanLastSync && !dbNewerThanLastSync) {
      diskToDbTargets.push({ id, title: disk.title, reason: 'newer' });
    } else if (dbNewerThanLastSync && diskNewerThanLastSync) {
      // 両方とも最終同期以降に更新された衝突状態
      // → **更新日の新しい方** を採用する。等しい場合は内容も既に揃っている
      //   とみなし何もしない（writeNoteFile は冪等だが余計な I/O を避けるため）
      if (db.updatedAt > disk.updatedAt) {
        dbToDiskTargets.push({
          id,
          title: db.title || '無題',
          reason: 'newer',
        });
      } else if (disk.updatedAt > db.updatedAt) {
        diskToDbTargets.push({ id, title: disk.title, reason: 'newer' });
      }
      // db.updatedAt === disk.updatedAt → skip
    }
    // どちらも lastSync 以降に更新されていない → 何もしない
  }

  return {
    storageRoot: root,
    dbNoteCount: dbById.size,
    diskFileCount: diskById.size,
    lastSync,
    dbToDiskTargets,
    diskToDbTargets,
    dbDeleteTargets,
  };
}

/**
 * "a/b/c" 形式に正規化（前後スラッシュ除去・連続スラッシュ畳み込み・空セグメント除去）。
 * パストラバーサル対策として `.` / `..` セグメントとバックスラッシュを含むセグメントは除外する。
 */
export function normalizeFolderPath(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..' && !s.includes('\\'))
    .join('/');
}

export function registerIpc(): void {
  // 起動時、永続化された theme 設定をネイティブメニューにも反映する。
  // (renderer の CSS テーマだけでなく OS ネイティブメニューもアプリ設定に合わせる)
  try {
    const storedTheme = getAllSettings()['appearance.theme'];
    applyNativeTheme(typeof storedTheme === 'string' ? storedTheme : 'system');
  } catch {
    // DB 未初期化など初回起動直後はスキップ。settings:set 経由でも更新される。
  }

  ipcMain.handle('notes:list', (): NoteMeta[] => {
    return listNotes();
  });

  ipcMain.handle(
    'notes:create',
    (_e, input: { title?: string; folder?: string; body?: string }): NoteMeta => {
      const now = Date.now();
      const meta: NoteMeta = {
        id: randomUUID(),
        title: input.title?.trim() || '無題',
        folder: input.folder ?? '',
        protected: false,
        secret: false,
        tags: [],
        linkedNoteIds: [],
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
      };
      insertNote(meta, input.body ?? '');
      writeNoteFile(meta, input.body ?? '');
      // ライトスルー: クラウドフォルダにも即時書き出し
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, meta.id);
      return meta;
    },
  );

  ipcMain.handle('notes:read-body', (_e, id: string): string => {
    return readBody(id);
  });

  ipcMain.handle(
    'notes:update-meta',
    (
      _e,
      id: string,
      patch: { title?: string; folder?: string; tags?: string[] },
    ): NoteMeta => {
      const updated = updateNoteMeta(id, patch);
      // ディスク上の front-matter も最新メタで書き換え
      try {
        const body = readBody(id);
        writeNoteFile(updated, body);
      } catch (err) {
        console.warn('[notes:update-meta] disk rewrite failed:', err);
      }
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, id);
      return updated;
    },
  );

  ipcMain.handle(
    'notes:update-body',
    (_e, id: string, body: string): void => {
      const note = getNote(id);
      if (!note) throw new Error(`note not found: ${id}`);
      updateNoteBodyText(id, body);
      // body 更新後に最新の updated_at を含めて front-matter ごと書く
      const refreshed = getNote(id) ?? note;
      writeNoteFile(refreshed, body);
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, id);
    },
  );

  ipcMain.handle(
    'notes:set-protected',
    (_e, id: string, isProtected: boolean): NoteMeta => {
      const updated = setNoteProtected(id, isProtected);
      try {
        const body = readBody(id);
        writeNoteFile(updated, body);
      } catch (err) {
        console.warn('[notes:set-protected] disk rewrite failed:', err);
      }
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, id);
      return updated;
    },
  );

  ipcMain.handle(
    'notes:set-secret',
    (_e, id: string, isSecret: boolean): NoteMeta => {
      const updated = setNoteSecret(id, isSecret);
      try {
        const body = readBody(id);
        writeNoteFile(updated, body);
      } catch (err) {
        console.warn('[notes:set-secret] disk rewrite failed:', err);
      }
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, id);
      return updated;
    },
  );

  ipcMain.handle(
    'notes:add-link',
    (_e, id: string, linkedNoteId: string): NoteMeta => {
      const target = getNote(linkedNoteId);
      if (!target) throw new Error(`linked note not found: ${linkedNoteId}`);
      const updated = addNoteLink(id, linkedNoteId);
      try {
        const body = readBody(id);
        writeNoteFile(updated, body);
      } catch (err) {
        console.warn('[notes:add-link] disk rewrite failed:', err);
      }
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, id);
      return updated;
    },
  );

  ipcMain.handle(
    'notes:remove-link',
    (_e, id: string, linkedNoteId: string): NoteMeta => {
      const updated = removeNoteLink(id, linkedNoteId);
      try {
        const body = readBody(id);
        writeNoteFile(updated, body);
      } catch (err) {
        console.warn('[notes:remove-link] disk rewrite failed:', err);
      }
      const p = getActiveShareProvider();
      if (p !== 'none') pushSingleNote(p, id);
      return updated;
    },
  );

  ipcMain.handle('notes:search', (_e, query: string): NoteMeta[] => {
    return searchNotes(query);
  });

  ipcMain.handle(
    'notes:list-tags',
    (): Array<{ tag: string; notes: NoteMeta[] }> => {
      const all = listNotes();
      // タグ → ノートID集合。TagBar で明示的に設定されたタグのみ集計し、
      // 本文中の `#word` 自動検出は対象外（ユーザーが意図したタグだけを表示）。
      const tagMap = new Map<string, Set<string>>();

      const addTag = (tag: string, noteId: string) => {
        let set = tagMap.get(tag);
        if (!set) {
          set = new Set();
          tagMap.set(tag, set);
        }
        set.add(noteId);
      };

      for (const note of all) {
        for (const tag of note.tags) {
          if (tag) addTag(tag, note.id);
        }
      }

      const noteById = new Map(all.map((n) => [n.id, n] as const));
      const sortedTags = [...tagMap.keys()].sort((a, b) =>
        a.localeCompare(b, 'ja'),
      );
      return sortedTags.map((tag) => {
        const ids = tagMap.get(tag)!;
        const notes: NoteMeta[] = [];
        for (const id of ids) {
          const meta = noteById.get(id);
          if (meta) notes.push(meta);
        }
        notes.sort((a, b) => b.updatedAt - a.updatedAt);
        return { tag, notes };
      });
    },
  );

  /**
   * 削除 = ゴミ箱に移動 (trashed_at をセット)。
   * `.md` ファイル / クラウド側コピーは消すが、DB 上のレコードと body は残るので
   * 復元すれば再生できる。30 日後に purgeOldTrash で自動物理削除される。
   */
  ipcMain.handle('notes:delete', (_e, id: string): void => {
    const note = getNote(id);
    if (!note) return;
    if (note.protected) {
      throw new Error('保護されているノートは削除できません');
    }
    trashNote(id);
    // ゴミ箱送りでも MD ファイルは tombstone (deleted: true の front-matter のみ
    // のファイル) に書き換える。物理削除すると他デバイスで「DB ある / MD 無し =
    // 新規」と誤判定されてノートが復活してしまうため。DB body は restore 用に残す。
    writeTombstone(id);
    const p = getActiveShareProvider();
    if (p !== 'none') removeSingleNote(p, id);
  });

  /** ゴミ箱内ノート一覧 */
  ipcMain.handle('notes:list-trashed', (): NoteMeta[] => {
    return listTrashedNotes();
  });

  /**
   * ゴミ箱から復元 (trashed_at を NULL に戻し、DB body から .md を再書き出し)。
   * 保護ノートのパスワード確認は renderer 側で行う。
   */
  ipcMain.handle('notes:restore', (_e, id: string): NoteMeta | null => {
    const restored = restoreNote(id);
    if (!restored) return null;
    // body は DB に残してあるのでそれを使って .md を書き戻す
    try {
      const body = readBody(restored.id) || '';
      writeNoteFile(restored, body);
    } catch (err) {
      console.warn('[notes:restore] writeNoteFile failed:', err);
    }
    // クラウドへ push (共有していれば他デバイスにも反映)
    const p = getActiveShareProvider();
    if (p !== 'none') pushSingleNote(p, id);
    return restored;
  });

  /** ゴミ箱を空にする (物理削除)。削除した id 配列を返す */
  ipcMain.handle('notes:empty-trash', (): string[] => {
    const ids = emptyTrash();
    // tombstone を確実に書き出して、他デバイスへ削除を伝播させる
    for (const id of ids) {
      try {
        writeTombstone(id);
      } catch {
        /* 失敗時もループは継続 */
      }
    }
    return ids;
  });

  /**
   * ゴミ箱内で指定日数経過のノートを物理削除する (起動時に呼ぶ想定)。
   * 削除した id 配列を返す。
   */
  ipcMain.handle(
    'notes:purge-old-trash',
    (_e, daysOld: number): string[] => {
      const ids = purgeOldTrash(typeof daysOld === 'number' ? daysOld : 30);
      for (const id of ids) {
        try {
          writeTombstone(id);
        } catch {
          /* 失敗時もループは継続 */
        }
      }
      return ids;
    },
  );

  /** ゴミ箱内の単一ノートを物理削除 (UI の「完全に削除」用) */
  ipcMain.handle('notes:delete-permanent', (_e, id: string): void => {
    const note = getNote(id);
    if (!note) return;
    if (!note.trashedAt) {
      // 安全策: ゴミ箱に入っていないノートは物理削除させない
      throw new Error('ゴミ箱に入っていないノートは完全削除できません');
    }
    deleteNote(id);
    try {
      // 物理ファイルは消さず tombstone を残す。他デバイスへ削除を伝播させ、
      // かつ既存の trash 由来 tombstone を最新の deletedAt で上書きしておく。
      writeTombstone(id);
    } catch {
      /* 失敗時もループは継続 */
    }
  });

  // ----- folders -----
  ipcMain.handle('folders:list', (): string[] => {
    return listFolders();
  });

  ipcMain.handle('folders:create', (_e, path: string): void => {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return;
    insertFolder(normalized);
  });

  ipcMain.handle('folders:delete', (_e, path: string): void => {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return;
    deleteFolder(normalized);
  });

  // フォルダと配下のノート・サブフォルダをすべて削除
  ipcMain.handle(
    'folders:delete-recursive',
    (_e, path: string): { deletedCount: number } => {
      const normalized = normalizeFolderPath(path);
      if (!normalized) return { deletedCount: 0 };
      const noteIds = deleteFolderRecursive(normalized);
      const provider = getActiveShareProvider();
      // 本文 .md ファイル削除 + クラウド側のファイルも削除
      for (const id of noteIds) {
        try {
          deleteBody(id);
        } catch {
          // 失敗しても続行
        }
        if (provider !== 'none') {
          try {
            removeSingleNote(provider, id);
          } catch {
            // クラウド側削除失敗は無視（次回手動同期で整合性回復可能）
          }
        }
      }
      return { deletedCount: noteIds.length };
    },
  );

  ipcMain.handle(
    'folders:rename',
    (_e, oldPath: string, newPath: string): void => {
      const oldNorm = normalizeFolderPath(oldPath);
      const newNorm = normalizeFolderPath(newPath);
      if (!oldNorm || !newNorm) return;
      if (oldNorm === newNorm) return;

      // 影響を受けるノート ID を rename 前に確定（古い folder 値で判定）
      const affectedIds = listNotes()
        .filter(
          (n) =>
            n.folder === oldNorm || n.folder.startsWith(oldNorm + '/'),
        )
        .map((n) => n.id);

      renameFolder(oldNorm, newNorm);

      // 各ノートのディスクファイル front-matter も新しい folder で書き直す
      for (const id of affectedIds) {
        try {
          const note = getNote(id);
          if (!note) continue;
          const body = readBody(id);
          writeNoteFile(note, body);
        } catch (err) {
          console.warn(
            '[folders:rename] disk rewrite failed for',
            id,
            err,
          );
        }
      }
    },
  );

  // ----- settings -----
  ipcMain.handle('settings:getAll', (): Record<string, string> => {
    return getAllSettings();
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string): void => {
    setSetting(key, value);
    // 保存先パスが変わったら次の I/O で再解決させる
    if (key === STORAGE_PATH_SETTING_KEY) clearStorageRootCache();
    // テーマが変わったら OS ネイティブメニュー (コンテキストメニュー等) も
    // 追従させる。light/dark を nativeTheme.themeSource に反映することで、
    // ライトテーマ時に黒背景のメニューが出る問題を回避する。
    if (key === 'appearance.theme') applyNativeTheme(value);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('settings:changed');
      }
    }
  });

  ipcMain.handle('window:close-current', (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  // ----- ストレージ（ファイル保存先）操作 -----
  /** 現在解決済みのストレージルートを返す（UI 表示用） */
  ipcMain.handle('storage:get-root', (): string => getStorageRoot());

  /**
   * 保存先フォルダ選択ダイアログを開く。選ばれたパスを返し、キャンセル時は null。
   * 実際の設定保存は呼び出し元（renderer）の `settings.set('storage.path', ...)` で行う。
   */
  /**
   * アプリの DB 初期化 (ノート・フォルダのデータのみ削除):
   * 1. notes / folders テーブルだけ TRUNCATE
   * 2. WAL チェックポイント + VACUUM で DB ファイルを縮約
   * 3. アプリを再起動
   *
   * **残るもの**:
   *  - 保存先フォルダの `.md` / 画像 / 添付ファイル
   *    (共有ストレージ上のファイルを誤って削除しないため。再構築は
   *     「保存先と同期」もしくは「.md から DB を再構築」で行える)
   *  - settings テーブル (保存先パス・AI トークン・UI 設定など)
   *  - DB ファイル自体 (settings を保持するため物理削除はしない)
   *
   * 呼び出し前に renderer 側で確認 UI を出すこと（テキスト入力 "初期化" で確定）。
   */
  ipcMain.handle('app:reset-all', async (): Promise<void> => {
    // notes / folders だけを空にする。settings (ユーザー設定) と
    // 保存先のファイル群 (.md / 画像 / 添付) は意図的に残す。
    try {
      const db = initDb();
      const tx = db.transaction(() => {
        db.exec('DELETE FROM notes');
        db.exec('DELETE FROM folders');
      });
      tx();
      // WAL の内容も DB ファイルへ反映してから縮約
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // 失敗しても続行
      }
      try {
        db.exec('VACUUM');
      } catch {
        // 失敗しても続行
      }
    } catch (err) {
      console.warn('[app:reset-all] truncate failed:', err);
    }

    // 再起動 (DB の状態をクリーンに反映するため)
    app.relaunch();
    app.exit(0);
  });

  /** データに触らずアプリを再起動する (保存先変更後などに使用) */
  ipcMain.handle('app:relaunch', (): void => {
    app.relaunch();
    app.exit(0);
  });

  // ============================================================
  // リンク切れ (orphan) の画像 / 添付ファイル走査・削除
  // ============================================================
  // images/<sha256>.<ext> / attachments/<sha256>.<ext> は本文 markdown 上で
  //   `images/<hash>.<ext>` / `attachments/<hash>.<ext>` の形で参照される。
  // 全ノート本文を結合してその参照を抽出し、参照されていないファイルを
  // 「リンク切れ」と判定する。
  const collectAllBodies = (): string => {
    const parts: string[] = [];
    for (const note of listNotes()) {
      try {
        parts.push(readBody(note.id));
      } catch {
        // 単一ノート読みに失敗しても継続 (他ノートで参照されていれば OK)
      }
    }
    return parts.join('\n');
  };

  const scanOrphansInDir = (
    dir: string,
    kind: 'images' | 'attachments',
    bodies: string,
  ): Array<{ filename: string; kind: 'images' | 'attachments'; size: number }> => {
    if (!existsSync(dir)) return [];
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    const out: Array<{
      filename: string;
      kind: 'images' | 'attachments';
      size: number;
    }> = [];
    for (const name of entries) {
      // 想定形式 <sha256>.<ext> 以外は触らない (.DS_Store 等を保護)
      if (!/^[a-f0-9]{64}\.[a-z0-9]{2,5}$/i.test(name)) continue;
      const needle = `${kind}/${name}`;
      if (bodies.includes(needle)) continue;
      let size = 0;
      try {
        size = statSync(join(dir, name)).size;
      } catch {
        // size 取得失敗は 0 のまま
      }
      out.push({ filename: name, kind, size });
    }
    return out;
  };

  /** リンク切れの画像 / 添付ファイル一覧を返す (削除はしない) */
  ipcMain.handle(
    'storage:scan-orphans',
    (): Array<{
      filename: string;
      kind: 'images' | 'attachments';
      size: number;
    }> => {
      const bodies = collectAllBodies();
      const imgs = scanOrphansInDir(imagesDir(), 'images', bodies);
      const atts = scanOrphansInDir(attachmentsDir(), 'attachments', bodies);
      return [...imgs, ...atts];
    },
  );

  /**
   * 指定されたリンク切れファイル群を削除する。
   * 引数の `targets` を信用せずに、サーバ側で再走査して「現在も orphan であるか」
   * 確認してから削除する (安全のため二重チェック)。
   */
  ipcMain.handle(
    'storage:delete-orphans',
    (
      _e,
      targets: Array<{ filename: string; kind: 'images' | 'attachments' }>,
    ): { deleted: number; failed: number } => {
      if (!Array.isArray(targets) || targets.length === 0) {
        return { deleted: 0, failed: 0 };
      }
      const bodies = collectAllBodies();
      let deleted = 0;
      let failed = 0;
      for (const target of targets) {
        if (
          !target ||
          (target.kind !== 'images' && target.kind !== 'attachments')
        )
          continue;
        if (!/^[a-f0-9]{64}\.[a-z0-9]{2,5}$/i.test(target.filename)) continue;
        const needle = `${target.kind}/${target.filename}`;
        if (bodies.includes(needle)) continue; // 二重チェックで参照あり → スキップ
        const dir = target.kind === 'images' ? imagesDir() : attachmentsDir();
        const full = join(dir, target.filename);
        try {
          unlinkSync(full);
          deleted++;
        } catch (err) {
          console.warn('[storage:delete-orphans] failed for', full, err);
          failed++;
        }
      }
      return { deleted, failed };
    },
  );

  ipcMain.handle(
    'storage:choose-folder',
    async (event): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: '保存先フォルダを選択',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );

  /**
   * DB の notes / folders テーブルを空にしてから設定 `storage.path` を
   * `targetRoot` に切り替える。保存先フォルダの .md ファイル等は削除しない。
   * 再起動後は「新しい保存先 + 空の DB」状態で起動する。
   * 後で「保存先と同期」を実行すれば、新保存先の .md を DB に取り込める。
   */
  ipcMain.handle(
    'storage:reset-and-set',
    async (_e, targetRoot: string): Promise<{ newRoot: string }> => {
      if (typeof targetRoot !== 'string' || !targetRoot.trim()) {
        throw new Error('targetRoot is required');
      }
      const target = targetRoot.trim();
      if (!existsSync(target) || !statSync(target).isDirectory()) {
        throw new Error('targetRoot is not an existing directory');
      }
      try {
        const db = initDb();
        const tx = db.transaction(() => {
          db.exec('DELETE FROM notes');
          db.exec('DELETE FROM folders');
        });
        tx();
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          // 失敗しても続行
        }
      } catch (err) {
        console.warn('[storage:reset-and-set] DB clear failed:', err);
        throw err;
      }
      setSetting(STORAGE_PATH_SETTING_KEY, target);
      clearStorageRootCache();
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('settings:changed');
      }
      return { newRoot: target };
    },
  );

  /**
   * 現在の保存先 (`getStorageRoot()`) 配下の notes/ images/ attachments/ plugins/
   * を `targetRoot` にコピーしてから、設定 `storage.path` を `targetRoot` に切り替える。
   *
   * 同名ファイルは新ルート側を上書き (force: true)。コピー後に古いフォルダの
   * 中身は削除しない (ユーザーが手動でクリーンアップする想定。安全側に倒す)。
   *
   * targetRoot がそのまま現ルートと一致する場合は no-op。
   */
  ipcMain.handle(
    'storage:migrate-to',
    async (
      _e,
      targetRoot: string,
    ): Promise<{ copied: number; skipped: number; newRoot: string }> => {
      if (typeof targetRoot !== 'string' || !targetRoot.trim()) {
        throw new Error('targetRoot is required');
      }
      const target = targetRoot.trim();
      if (!existsSync(target) || !statSync(target).isDirectory()) {
        throw new Error('targetRoot is not an existing directory');
      }
      const source = getStorageRoot();
      if (source === target) {
        // 同一なら設定だけ書き換えて返す (差分なし)
        setSetting(STORAGE_PATH_SETTING_KEY, target);
        clearStorageRootCache();
        return { copied: 0, skipped: 0, newRoot: target };
      }

      const SUBDIRS = ['notes', 'images', 'attachments', 'plugins'];
      let copied = 0;
      let skipped = 0;
      for (const sub of SUBDIRS) {
        const from = join(source, sub);
        const to = join(target, sub);
        if (!existsSync(from)) {
          skipped++;
          continue;
        }
        try {
          mkdirSync(to, { recursive: true });
          // cpSync は Node 16.7+ で利用可。recursive: true でディレクトリ丸ごとコピー。
          // force: true で同名ファイルを上書き、preserveTimestamps で mtime を維持
          // (時系列ベースの sync を破壊しない)。
          cpSync(from, to, {
            recursive: true,
            force: true,
            preserveTimestamps: true,
          });
          copied++;
        } catch (err) {
          console.warn('[storage:migrate-to] failed for', sub, err);
          throw err;
        }
      }

      // 設定書き換え。clearStorageRootCache 経由で次回 I/O から新ルートが解決される。
      setSetting(STORAGE_PATH_SETTING_KEY, target);
      clearStorageRootCache();
      // 他ウィンドウにも settings 変更を通知
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('settings:changed');
      }
      return { copied, skipped, newRoot: target };
    },
  );

  /**
   * 保存先フォルダの状態をスキャンして DB と差分を返す。
   *  - dbNoteCount: DB に登録されているノート数
   *  - diskFileCount: ストレージ直下 `notes/` の .md ファイル数
   *  - missingOnDisk: DB にあるがディスク上の .md が無いノート ID
   *  - extraOnDisk: ディスクにあるが DB に無い UUID 風ファイル名
   */
  ipcMain.handle(
    'storage:scan',
    async (): Promise<{
      storageRoot: string;
      dbNoteCount: number;
      diskFileCount: number;
      lastSync: number;
      dbToDiskTargets: Array<{
        id: string;
        title: string;
        reason: 'missing' | 'newer';
      }>;
      diskToDbTargets: Array<{
        id: string;
        title: string;
        reason: 'missing' | 'newer';
      }>;
      dbDeleteTargets: Array<{ id: string; deletedAt: number }>;
    }> => {
      const plan = await buildSyncPlan();
      return {
        storageRoot: plan.storageRoot,
        dbNoteCount: plan.dbNoteCount,
        diskFileCount: plan.diskFileCount,
        lastSync: plan.lastSync,
        dbToDiskTargets: plan.dbToDiskTargets,
        diskToDbTargets: plan.diskToDbTargets,
        dbDeleteTargets: plan.dbDeleteTargets,
      };
    },
  );

  /**
   * DB の全ノートを保存先フォルダに **強制上書き** する。
   * 既存ファイルの内容を問わず、DB のメタ + 既存 body を front-matter 付きで
   * 書き直す。設定画面の「データを上書き」ボタンから呼ぶ想定。
   */
  ipcMain.handle(
    'storage:overwrite-all',
    (): { written: number; failed: number } => {
      const allNotes = listNotes();
      let written = 0;
      let failed = 0;
      for (const note of allNotes) {
        try {
          // 既存ディスク内容（front-matter 剥離済み）を保ちつつメタを最新化
          const body = readBody(note.id);
          updateNoteBodyText(note.id, body, { touch: false });
          writeNoteFile(note, body);
          written++;
        } catch (err) {
          failed++;
          console.warn(
            '[storage:overwrite-all] failed for',
            note.id,
            err,
          );
        }
      }
      return { written, failed };
    },
  );

  /**
   * DB ↔ 保存先フォルダの**タイムスタンプベース**双方向同期。
   *
   *  ルール:
   *   - 最後に同期した日時 (`storage.lastSync`) を記録しておく
   *   - DB.updated_at > lastSync かつ DB のほうが disk より新しい → 書き出し
   *   - disk の updated_at (front-matter or mtime) > lastSync かつ disk のほうが DB より新しい → 取り込み
   *   - DB / disk のどちらかに無い → 存在する側を真として書き出し / 取り込み
   *  完了後に lastSync を Date.now() に更新する。
   *
   *  戻り値: 書き出し件数 / 取り込み件数。
   */
  ipcMain.handle(
    'storage:sync',
    async (): Promise<{ saved: number; imported: number; deleted: number }> => {
      const plan = await buildSyncPlan();
      const notesDir = join(plan.storageRoot, 'notes');
      let saved = 0;
      let imported = 0;
      let deleted = 0;

      // DB → disk
      for (const target of plan.dbToDiskTargets) {
        try {
          const note = getNote(target.id);
          if (!note) continue;
          // body は既存 disk があればそれを尊重（外部編集の取り込み）、
          // 無ければ DB 側のキャッシュ本文（updateNoteBodyText で蓄積されたもの）を使う
          let body = '';
          try {
            const existing = readBodyWithMeta(target.id);
            body = existing.body;
          } catch {
            body = readBody(target.id);
          }
          updateNoteBodyText(target.id, body, { touch: false });
          writeNoteFile(note, body);
          saved++;
        } catch (err) {
          console.warn(
            '[storage:sync] write failed for',
            target.id,
            err,
          );
        }
      }

      // disk → DB
      for (const target of plan.diskToDbTargets) {
        try {
          const filePath = join(notesDir, `${target.id}.md`);
          const { meta, body } = readBodyWithMeta(target.id);
          const fallbackTitle = (() => {
            const m = body.match(/^#+\s+(.+)$/m);
            return (m?.[1] ?? '').trim() || '取り込みノート';
          })();
          // タイムスタンプ: front-matter > file mtime > now
          let diskUpdated = meta.updatedAt;
          if (typeof diskUpdated !== 'number') {
            try {
              diskUpdated = Math.floor(statSync(filePath).mtimeMs);
            } catch {
              diskUpdated = Date.now();
            }
          }
          const noteMeta = {
            id: target.id,
            title: meta.title ?? fallbackTitle,
            folder: meta.folder ?? '',
            protected: meta.protected ?? false,
            secret: meta.secret ?? false,
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            linkedNoteIds: Array.isArray(meta.linkedNoteIds)
              ? meta.linkedNoteIds
              : [],
            createdAt: meta.createdAt ?? diskUpdated,
            updatedAt: diskUpdated,
            trashedAt: null,
          };
          // 'missing' / 'newer' どちらも冪等な upsert で処理する。
          // buildSyncPlan は実行開始時点のスナップショットなので、
          // ファイル front-matter 読み込み中に他の経路（AI ノート作成等）で
          // 同じ id がインサートされていると insertNote が UNIQUE 制約で失敗する。
          upsertNoteFromSyncWithBody(noteMeta, body);
          imported++;
        } catch (err) {
          console.warn(
            '[storage:sync] import failed for',
            target.id,
            err,
          );
        }
      }

      // disk tombstone → DB から削除
      // (他環境で削除されたノートを、こちらの DB からも消す)
      for (const target of plan.dbDeleteTargets) {
        try {
          deleteNote(target.id);
          // tombstone ファイル自体は残しておく (purgeOldTombstones が retention 後に物理削除)
          deleted++;
        } catch (err) {
          console.warn(
            '[storage:sync] delete failed for',
            target.id,
            err,
          );
        }
      }

      // 同期完了時刻を保存
      setSetting(STORAGE_LAST_SYNC_KEY, String(Date.now()));

      return { saved, imported, deleted };
    },
  );

  // ----- images -----
  ipcMain.handle(
    'images:save',
    (_e, data: ArrayBuffer, ext: string): string => {
      const buf = Buffer.from(data);
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(
          `画像が大きすぎます (${Math.round(buf.byteLength / 1024 / 1024)}MB)。25MB 以下にしてください。`,
        );
      }
      const filename = saveImage(buf, ext);
      // ライトスルー: クラウドフォルダにも即時コピー
      const p = getActiveShareProvider();
      if (p !== 'none') {
        pushSingleMedia(p, 'images', imagePath(filename), filename);
      }
      return filename;
    },
  );

  ipcMain.handle(
    'images:exists',
    (_e, filename: string): boolean => {
      return imageExists(filename);
    },
  );

  // ----- attachments -----
  ipcMain.handle(
    'attachments:save',
    (_e, data: ArrayBuffer, ext: string): string => {
      const buf = Buffer.from(data);
      if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `添付ファイルが大きすぎます (${Math.round(buf.byteLength / 1024 / 1024)}MB)。100MB 以下にしてください。`,
        );
      }
      const filename = saveAttachment(buf, ext);
      // ライトスルー: クラウドフォルダにも即時コピー
      const p = getActiveShareProvider();
      if (p !== 'none') {
        pushSingleMedia(p, 'attachments', getAttachmentPath(filename), filename);
      }
      return filename;
    },
  );

  ipcMain.handle(
    'attachments:exists',
    (_e, filename: string): boolean => {
      return attachmentExists(filename);
    },
  );

  ipcMain.handle(
    'attachments:open',
    async (_e, filename: string): Promise<void> => {
      try {
        const fullPath = attachmentPath(filename); // sanitize 込み
        if (!attachmentExists(filename)) {
          throw new Error('ファイルが存在しません');
        }
        const result = await shell.openPath(fullPath);
        if (result) {
          // openPath は失敗時にエラー文字列を返す
          throw new Error(result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`添付ファイルを開けませんでした: ${msg}`);
      }
    },
  );

  // ----- shell（外部URL を既定ブラウザで開く） -----
  ipcMain.handle(
    'shell:open-external',
    async (_e, url: string): Promise<void> => {
      // 入力文字列を URL としてパースし、http/https のみを許可。
      // これで `javascript:` / `file:` / 制御文字を含む URL 等を確実に弾く。
      if (typeof url !== 'string' || url.length === 0) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      await shell.openExternal(parsed.href);
    },
  );

  /**
   * 汎用の OS ネイティブコンテキストメニュー。renderer から `items` と画面座標を
   * 渡すと、ネイティブメニュー（ウィンドウ外まではみ出せる）を popup し、
   * 選択された項目の `id` を返す。キャンセル時は null。
   *
   * 各 item は `{ id, label, enabled?, danger?, separator? }`。
   * separator: true なら区切り線（id / label は無視）。
   */
  ipcMain.handle(
    'ui:show-context-menu',
    async (
      event,
      opts: {
        position?: { x?: number; y?: number };
        items: Array<{
          id?: string;
          label?: string;
          enabled?: boolean;
          separator?: boolean;
        }>;
      },
    ): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return new Promise<string | null>((resolve) => {
        let resolved = false;
        const safeResolve = (v: string | null) => {
          if (resolved) return;
          resolved = true;
          resolve(v);
        };

        const template = (opts.items || []).map((item) => {
          if (item.separator) {
            return { type: 'separator' as const };
          }
          return {
            label: item.label ?? '',
            enabled: item.enabled !== false,
            click: () => safeResolve(item.id ?? null),
          };
        });

        const menu = Menu.buildFromTemplate(template);
        const x = opts.position?.x;
        const y = opts.position?.y;
        menu.popup({
          window: win ?? undefined,
          x: typeof x === 'number' ? Math.round(x) : undefined,
          y: typeof y === 'number' ? Math.round(y) : undefined,
          callback: () => safeResolve(null),
        });
      });
    },
  );

  // ----- NoteHeader のケバブメニュー（OS ネイティブメニュー） -----
  // Web ベースのポップアップだとウィンドウ外にはみ出せないため、
  // OS ネイティブの Menu.popup() を使う。
  ipcMain.handle(
    'ui:show-note-menu',
    async (
      event,
      position?: {
        x?: number;
        y?: number;
        labels?: {
          exportPdf?: string;
          exportMarkdown?: string;
          print?: string;
        };
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const labels = position?.labels ?? {};
      const menu = Menu.buildFromTemplate([
        {
          label: labels.exportPdf ?? 'PDF で出力',
          click: () => event.sender.send('menu:export-pdf'),
        },
        {
          label: labels.exportMarkdown ?? 'Markdown で出力',
          click: () => event.sender.send('menu:export-markdown'),
        },
        { type: 'separator' },
        {
          label: labels.print ?? '印刷',
          click: () => event.sender.send('menu:print'),
        },
      ]);
      // x/y は renderer 側で getBoundingClientRect から渡される。
      // 指定が無ければカーソル位置に開く。
      const x = position?.x;
      const y = position?.y;
      menu.popup({
        window: win ?? undefined,
        x: typeof x === 'number' ? Math.round(x) : undefined,
        y: typeof y === 'number' ? Math.round(y) : undefined,
      });
    },
  );

  // ----- ノートのエクスポート -----
  /**
   * 現在のノート本文を Markdown (.md) ファイルとして保存する。
   * Save ダイアログを開き、ユーザーが選んだ場所に書き出す。
   * @returns true なら保存成功、false ならキャンセル or 失敗
   */
  ipcMain.handle(
    'files:export-markdown',
    async (event, defaultName: string, body: string): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const safeBase =
        (typeof defaultName === 'string' && defaultName.trim()) || '無題';
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        title: 'Markdown として保存',
        defaultPath: `${safeBase}.md`,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
        ],
      });
      if (result.canceled || !result.filePath) return false;
      try {
        writeFileSync(result.filePath, body ?? '', 'utf8');
        return true;
      } catch (err) {
        console.error('[export-markdown] failed:', err);
        throw new Error(
          err instanceof Error
            ? err.message
            : 'Markdown の保存に失敗しました',
        );
      }
    },
  );

  /**
   * 現在のウィンドウの描画内容を PDF として保存する。
   * 呼び出し元 (renderer) はこの IPC を呼ぶ前に view を preview に切り替えておく。
   */
  ipcMain.handle(
    'files:export-pdf',
    async (event, defaultName: string): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return false;
      const safeBase =
        (typeof defaultName === 'string' && defaultName.trim()) || '無題';
      const result = await dialog.showSaveDialog(win, {
        title: 'PDF として保存',
        defaultPath: `${safeBase}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return false;
      try {
        // `@media print` の CSS が UI を非表示にするので、印刷 CSS を優先させる。
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          preferCSSPageSize: true,
        });
        writeFileSync(result.filePath, pdf);
        return true;
      } catch (err) {
        console.error('[export-pdf] failed:', err);
        throw new Error(
          err instanceof Error ? err.message : 'PDF の出力に失敗しました',
        );
      }
    },
  );

  // ----- media:gc（未参照メディアの GC） -----
  // 候補のうち、どのノートからも参照されていないファイルを削除する
  ipcMain.handle(
    'media:gc',
    (
      _e,
      candidates: { images: string[]; attachments: string[] },
    ): { deletedImages: string[]; deletedAttachments: string[] } => {
      const candidateImages = candidates?.images ?? [];
      const candidateAttachments = candidates?.attachments ?? [];
      if (candidateImages.length === 0 && candidateAttachments.length === 0) {
        return { deletedImages: [], deletedAttachments: [] };
      }

      // 全ノートを走査して、現在参照されている全ファイル名を集計
      const refImages = new Set<string>();
      const refAttachments = new Set<string>();
      const allNotes = listNotes();
      const imageRe = /images\/([a-f0-9]{64}\.[a-z0-9]{2,5})/gi;
      const attachmentRe = /attachments\/([a-f0-9]{64}\.[a-z0-9]{2,5})/gi;

      for (const note of allNotes) {
        try {
          const body = readBody(note.id);
          for (const m of body.matchAll(imageRe)) refImages.add(m[1]);
          for (const m of body.matchAll(attachmentRe))
            refAttachments.add(m[1]);
        } catch {
          // 読めないノートはスキップ
        }
      }

      const deletedImages: string[] = [];
      for (const filename of candidateImages) {
        if (!refImages.has(filename) && imageExists(filename)) {
          try {
            deleteImage(filename);
            deletedImages.push(filename);
          } catch {
            // 削除失敗は無視
          }
        }
      }

      const deletedAttachments: string[] = [];
      for (const filename of candidateAttachments) {
        if (!refAttachments.has(filename) && attachmentExists(filename)) {
          try {
            deleteAttachment(filename);
            deletedAttachments.push(filename);
          } catch {
            // 削除失敗は無視
          }
        }
      }

      return { deletedImages, deletedAttachments };
    },
  );

  // ----- share (クラウド同期) -----
  // ----- template -----
  // 設定 template.folder で指定されたフォルダのノートをテンプレートとして扱う
  // ----- .md ファイルのインポート -----
  // ダイアログで選択した .md ファイルを読み込み、内容と元のファイル名を返す。
  ipcMain.handle(
    'notes:import-md',
    async (event): Promise<Array<{ name: string; body: string }>> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win!, {
        title: 'Markdown ファイルの読み込み',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }
      const imported: Array<{ name: string; body: string }> = [];
      for (const filePath of result.filePaths) {
        try {
          const body = readFileSync(filePath, 'utf8');
          const name = basename(filePath, extname(filePath));
          imported.push({ name, body });
        } catch (err) {
          console.error(`[import-md] 読み込み失敗: ${filePath}`, err);
        }
      }
      return imported;
    },
  );

  // ----- ディレクトリの .md を再帰的にインポート -----
  // 選択したディレクトリ配下を再帰的に走査し、全ての .md / .markdown を返す。
  // 相対パスをサブフォルダとして保持することで、階層構造も再現できる。
  ipcMain.handle(
    'notes:import-dir',
    async (
      event,
    ): Promise<
      Array<{ name: string; body: string; subFolder: string }>
    > => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win!, {
        title: 'ディレクトリの読み込み',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }
      const rootDir = result.filePaths[0];
      const imported: Array<{
        name: string;
        body: string;
        subFolder: string;
      }> = [];

      const walk = (dir: string) => {
        let entries: import('node:fs').Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue; // 隠しファイル/隠しフォルダは除外
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (ext === '.md' || ext === '.markdown') {
              try {
                const body = readFileSync(full, 'utf8');
                const name = basename(entry.name, ext);
                // ルートからの相対サブフォルダ（スラッシュ区切り）
                const rel = relative(rootDir, dirname(full));
                const subFolder = rel
                  .split(/[\\/]/)
                  .filter((s) => s.length > 0)
                  .join('/');
                imported.push({ name, body, subFolder });
              } catch (err) {
                console.error(`[import-dir] 読み込み失敗: ${full}`, err);
              }
            }
          }
        }
      };
      walk(rootDir);
      // ルートフォルダ名を先頭に追加して返す（呼び出し元で
      // 読み込みファイル/<rootName>/<subFolder>/<note> の形にする）
      const rootName = basename(rootDir);
      return imported.map((i) => ({
        ...i,
        subFolder: i.subFolder ? `${rootName}/${i.subFolder}` : rootName,
      }));
    },
  );

  ipcMain.handle('template:list', () => {
    const settings = getAllSettings();
    const folder = settings['template.folder']?.trim() || 'template';
    const all = listNotes();
    // 最上位のフォルダのみ対応: folder が完全一致するノートだけ
    // template/aaaa → OK (folder='template')
    // test/template/aaaa → NG (folder='test/template')
    return all
      .filter((n) => n.folder === folder)
      .map((n) => ({ name: n.title || '無題', noteId: n.id }));
  });

  ipcMain.handle(
    'template:read',
    (_e, noteId: string): { body: string; tags: string[] } => {
      const body = readBody(noteId);
      const meta = getNote(noteId);
      const tags = meta?.tags ?? [];
      return { body, tags };
    },
  );

  ipcMain.handle('ai:transform', async (_e, input: AiTransformInput) => {
    try {
      return await transformWithAi(input);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'AI処理に失敗しました';
      throw new Error(`AI処理に失敗しました: ${message}`);
    }
  });

  ipcMain.handle(
    'ai:chat',
    async (event, input: AiChatInput, requestId?: string) => {
      // requestId が渡されていればストリーミングチャンクを renderer へ転送する。
      // 同じ requestId を購読している AiChatPanel 側で逐次表示される。
      const onChunk = requestId
        ? (delta: string) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chat-chunk', { requestId, delta });
            }
          }
        : undefined;
      try {
        return await chatWithAi(input, requestId, onChunk);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'AIチャットに失敗しました';
        throw new Error(`AIチャットに失敗しました: ${message}`);
      }
    },
  );

  /** 進行中の AI チャット要求を中断する。requestId は ai:chat 呼び出しと同じ値を渡す */
  ipcMain.handle('ai:abort', (_e, requestId: string): boolean => {
    if (typeof requestId !== 'string' || !requestId) return false;
    return abortChat(requestId);
  });

  /**
   * 任意の Web URL を取得して本文プレーンテキストに変換する。
   * AI チャットでユーザー入力に URL が含まれていた場合に、main 側で取得して
   * AI に「実際の本文」として渡すために使う (AI 自体は URL を読めないため)。
   *
   * 制約:
   *   - http(s) のみ受理 (file:// などはエラー)
   *   - 15 秒タイムアウト
   *   - レスポンス本文 5MB 上限
   *   - HTML は script/style/nav 等を除去して本文テキストに圧縮 (最大 50KB)
   *   - text/* / application/json はそのまま (タグ除去なし)
   *   - その他 (画像/バイナリ) はエラー
   *
   * 失敗時は { ok: false, error } で返し、呼び出し側はその旨を AI へ伝える。
   */
  ipcMain.handle(
    'web:fetch-url',
    async (
      _e,
      url: string,
    ): Promise<
      | { ok: true; url: string; title: string; content: string }
      | { ok: false; url: string; error: string }
    > => {
      if (typeof url !== 'string' || !url.trim()) {
        return { ok: false, url: String(url), error: 'URL が空です' };
      }
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        return { ok: false, url, error: 'URL の形式が不正です' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          ok: false,
          url,
          error: `${parsed.protocol} はサポートされていません`,
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(parsed.toString(), {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; InkNel/0.4) Gecko/20100101 Firefox/119.0',
            Accept:
              'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          return {
            ok: false,
            url,
            error: `HTTP ${res.status} ${res.statusText}`,
          };
        }
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        // バイナリは弾く
        if (
          contentType &&
          !contentType.includes('html') &&
          !contentType.includes('text') &&
          !contentType.includes('json') &&
          !contentType.includes('xml')
        ) {
          return {
            ok: false,
            url,
            error: `テキスト系コンテンツではありません (${contentType})`,
          };
        }
        // サイズ上限 5MB
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) {
          return {
            ok: false,
            url,
            error: `本文サイズが 5MB を超えています (${buf.byteLength} bytes)`,
          };
        }
        const rawText = new TextDecoder('utf-8').decode(buf);
        const { title, content } = extractReadableText(rawText, contentType);
        return { ok: true, url, title, content };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, url, error: '取得がタイムアウトしました (15秒)' };
        }
        return {
          ok: false,
          url,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  );

  ipcMain.handle('share:detect-providers', () => {
    return detectProviders();
  });

  ipcMain.handle('share:get-status', (_e, provider: ShareProvider) => {
    return getSyncStatus(provider);
  });

  ipcMain.handle(
    'share:check-note',
    (_e, provider: ShareProvider, noteId: string): string => {
      return checkAndSyncSingleNote(provider, noteId);
    },
  );

  ipcMain.handle('share:sync', async (event, provider: ShareProvider) => {
    // 進捗イベントを送信元の webContents に流す。
    // renderer 側は window.api.share.onProgress で購読する。
    return runSync(provider, (ev) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('share:progress', ev);
      }
    });
  });

  // ----- プラグインストア -----
  // リモートカタログ（plugins.json）から取得可能なプラグイン一覧を引き、
  // 個別の manifest をダウンロードして userData/plugins/ に保存する。
  // ランタイム実行は今のところ未対応（ファイル保存のみ）。

  /** ローカルプラグイン格納ディレクトリの絶対パス */
  ipcMain.handle('plugins:get-dir', (): string => getPluginsDir());

  /** プラグインフォルダを OS のファイルマネージャで開く */
  ipcMain.handle('plugins:open-dir', async (): Promise<void> => {
    const dir = getPluginsDir();
    await shell.openPath(dir);
  });

  /** ローカルにダウンロード済みの manifest 一覧 */
  ipcMain.handle(
    'plugins:list-local',
    (): Array<{ filename: string; content: unknown }> =>
      listLocalPluginManifests(),
  );

  /**
   * plugins ディレクトリの全ファイル名（manifest 以外も含む）。
   * UI で「ダウンロード済み」の判定に使う：manifest の files[] が
   * 全部揃っているかをチェックするため。
   */
  ipcMain.handle('plugins:list-local-files', (): string[] => listLocalFiles());

  /**
   * リモートカタログ取得。
   * URL に到達できない / JSON パース失敗 / 想定外フォーマット → 全て null を返し、
   * UI 側で「プラグインが見つかりません」を出す。
   */
  ipcMain.handle(
    'plugins:fetch-catalog',
    async (
      _e,
      url: string,
    ): Promise<{
      baseUrl: string;
      plugins: Array<{ id: string; manifest: string }>;
    } | null> => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        const json = (await res.json()) as unknown;
        if (
          !json ||
          typeof json !== 'object' ||
          !Array.isArray((json as { plugins?: unknown }).plugins)
        ) {
          return null;
        }
        const plugins = (json as { plugins: unknown[] }).plugins
          .map((p): { id: string; manifest: string } | null => {
            if (
              p &&
              typeof p === 'object' &&
              typeof (p as { id?: unknown }).id === 'string' &&
              typeof (p as { manifest?: unknown }).manifest === 'string'
            ) {
              return {
                id: (p as { id: string }).id,
                manifest: (p as { manifest: string }).manifest,
              };
            }
            return null;
          })
          .filter((p): p is { id: string; manifest: string } => p !== null);
        const baseUrl = url.replace(/\/[^/]*$/, '/');
        return { baseUrl, plugins };
      } catch {
        return null;
      }
    },
  );

  /**
   * 【開発モード専用】プロジェクト直下の `plugin-dev/plugins/plugins.json` を
   * ファイルシステムから直接読んでカタログとして返す。
   *
   * 各エントリの manifest と内容も同時に取り出して同梱する（HTTP catalog は
   * 1 段階目=catalog, 2 段階目=manifest と 2 往復するが、ローカル読み込みなら
   * 1 IPC でまとめて返した方が単純）。
   * 戻り値の rows は PreferencesModal が直接表示できる形式に揃える。
   */
  ipcMain.handle(
    'plugins:fetch-dev-catalog',
    async (): Promise<{
      baseUrl: string;
      rows: Array<{
        id: string;
        filename: string;
        manifest: unknown | null;
      }>;
    } | null> => {
      try {
        // 開発モードのカタログを「plugin-dev/plugins/plugins.json が見つかれば
        // それを使う」というファイル存在ベースの判定に変更。
        // app.isPackaged は electron-vite dev / 開発実行でも true 判定される
        // ケースがあるため、実態のあるファイルパスで判定するほうが堅実。
        const candidates = [
          // 開発実行: package.json と同じ階層に plugin-dev/ がある
          join(app.getAppPath(), 'plugin-dev/plugins'),
          // electron-vite で getAppPath が out/ 系を返す環境向けフォールバック
          join(app.getAppPath(), '..', 'plugin-dev/plugins'),
          join(app.getAppPath(), '..', '..', 'plugin-dev/plugins'),
          // プロセスのカレントディレクトリ（npm run dev 起動時はプロジェクト直下）
          join(process.cwd(), 'plugin-dev/plugins'),
        ];
        let baseDir: string | null = null;
        for (const c of candidates) {
          if (existsSync(join(c, 'plugins.json'))) {
            baseDir = c;
            break;
          }
        }
        console.log(
          '[plugins:fetch-dev-catalog]',
          'appPath=' + app.getAppPath(),
          'cwd=' + process.cwd(),
          'isPackaged=' + app.isPackaged,
          'resolved=' + (baseDir ?? '(none)'),
        );
        if (!baseDir) return null;
        const catalogPath = join(baseDir, 'plugins.json');
        if (!existsSync(catalogPath)) return null;
        const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
          plugins?: Array<{ id?: string; manifest?: string }>;
        };
        if (!catalog?.plugins || !Array.isArray(catalog.plugins)) return null;

        const rows: Array<{
          id: string;
          filename: string;
          manifest: unknown | null;
        }> = [];
        for (const p of catalog.plugins) {
          if (
            !p ||
            typeof p.id !== 'string' ||
            typeof p.manifest !== 'string'
          ) {
            continue;
          }
          const manifestPath = join(baseDir, p.manifest);
          let manifestContent: unknown = null;
          try {
            if (existsSync(manifestPath)) {
              manifestContent = JSON.parse(readFileSync(manifestPath, 'utf8'));
            }
          } catch {
            manifestContent = null;
          }
          rows.push({
            id: p.id,
            filename: p.manifest,
            manifest: manifestContent,
          });
        }
        // dev モードでは HTTP の代わりに inknel-plugin:// プロトコルが
        // plugin-dev/plugins/ を直接配信するため、baseUrl もそれに揃える
        return { baseUrl: 'inknel-plugin://', rows };
      } catch (err) {
        console.warn('[plugins:fetch-dev-catalog] failed', err);
        return null;
      }
    },
  );

  /**
   * 個別の manifest を取得（baseUrl + filename を結合）。
   * 失敗時は null（UI 側でスキップ）。
   */
  ipcMain.handle(
    'plugins:fetch-manifest',
    async (
      _e,
      baseUrl: string,
      filename: string,
    ): Promise<{ filename: string; content: unknown } | null> => {
      try {
        const url = baseUrl + filename;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        const content = (await res.json()) as unknown;
        return { filename, content };
      } catch {
        return null;
      }
    },
  );

  /**
   * manifest と、manifest.files に列挙された付属ファイルを一括ダウンロードして保存。
   *
   * 戻り値:
   *   - savedFiles: 実際に保存できたファイル名リスト（manifest 含む）
   *   - missingFiles: 取得失敗・404 等で保存できなかったファイル名リスト
   * すべて失敗した場合は null を返し、UI 側で「プラグインが見つかりません」を表示する。
   */
  ipcMain.handle(
    'plugins:install',
    async (
      _e,
      args: {
        filename: string;
        content: unknown;
        baseUrl: string;
      },
    ): Promise<{
      savedFiles: string[];
      missingFiles: string[];
    } | null> => {
      const { filename, content, baseUrl } = args;
      const savedFiles: string[] = [];
      const missingFiles: string[] = [];

      // 1) manifest を保存
      try {
        savePluginManifest(filename, content);
        savedFiles.push(filename);
      } catch (err) {
        console.warn('[plugins:install] manifest save failed:', err);
        return null;
      }

      // 2) manifest.files に列挙されているファイルをそれぞれ DL
      const filesField =
        content &&
        typeof content === 'object' &&
        Array.isArray((content as { files?: unknown }).files)
          ? ((content as { files: unknown[] }).files.filter(
              (f): f is string => typeof f === 'string',
            ))
          : [];

      // 開発モード経由の baseUrl は `inknel-plugin://` を返している。
      // Node の fetch はカスタムスキームを処理できないため、`inknel-plugin://`
      // の場合は `plugin-dev/plugins/` から直接ファイル読み出しに切り替える。
      const isDevScheme = baseUrl.startsWith('inknel-plugin://');
      const devCandidateDirs = [
        join(app.getAppPath(), 'plugin-dev/plugins'),
        join(app.getAppPath(), '..', 'plugin-dev/plugins'),
        join(app.getAppPath(), '..', '..', 'plugin-dev/plugins'),
        join(process.cwd(), 'plugin-dev/plugins'),
      ];
      let devBaseDir: string | null = null;
      if (isDevScheme) {
        for (const c of devCandidateDirs) {
          if (existsSync(c)) {
            devBaseDir = c;
            break;
          }
        }
      }

      for (const f of filesField) {
        try {
          if (isDevScheme) {
            // ローカルから直接読み込んで保存
            if (!devBaseDir) {
              missingFiles.push(f);
              continue;
            }
            const localPath = join(devBaseDir, f);
            if (!existsSync(localPath)) {
              missingFiles.push(f);
              continue;
            }
            const body = readFileSync(localPath, 'utf8');
            savePluginTextFile(f, body);
            savedFiles.push(f);
          } else {
            // HTTP からダウンロード
            const res = await fetch(baseUrl + f, { method: 'GET' });
            if (!res.ok) {
              missingFiles.push(f);
              continue;
            }
            const body = await res.text();
            savePluginTextFile(f, body);
            savedFiles.push(f);
          }
        } catch (err) {
          console.warn(`[plugins:install] file download failed: ${f}`, err);
          missingFiles.push(f);
        }
      }

      return { savedFiles, missingFiles };
    },
  );

  /**
   * プラグインの本体ファイル（.js 等）を読み出してテキストで返す。
   * 存在しない / 読めない場合は null。renderer 側はこの中身を Blob URL に
   * して dynamic import することでランタイムロードする。
   */
  ipcMain.handle(
    'plugins:read-file',
    (_e, filename: string): string | null => readPluginTextFile(filename),
  );

  /**
   * MD ファイルから DB を完全再構築する。
   *   1. notes / folders テーブルを空にする
   *   2. lastSync をリセット
   *   3. storage:sync と同じ disk→DB 取り込みロジックで全 .md を取り込む
   *
   * リストア後に呼ぶことを想定（DB 内の古いノート ID が ZIP の MD と
   * 一致しない場合に、storage:sync では古い DB エントリが残ってしまうため）。
   */
  ipcMain.handle(
    'storage:rebuild-from-md',
    async (): Promise<{ imported: number }> => {
      // 1) DB を空にする
      const dbInst = initDb();
      const tx = dbInst.transaction(() => {
        dbInst.exec('DELETE FROM notes');
        dbInst.exec('DELETE FROM folders');
      });
      tx();
      // 2) lastSync を 0 にリセット（disk 全件が「取り込み対象」になる）
      setSetting(STORAGE_LAST_SYNC_KEY, '0');

      // 3) buildSyncPlan は DB を読み直すので、空 DB + 全 disk の
      //    diskToDbTargets が返る
      const plan = await buildSyncPlan();
      const notesDir = join(plan.storageRoot, 'notes');
      let imported = 0;
      for (const target of plan.diskToDbTargets) {
        try {
          const filePath = join(notesDir, `${target.id}.md`);
          const { meta, body } = readBodyWithMeta(target.id);
          const fallbackTitle = (() => {
            const m = body.match(/^#+\s+(.+)$/m);
            return (m?.[1] ?? '').trim() || '取り込みノート';
          })();
          let diskUpdated = meta.updatedAt;
          if (typeof diskUpdated !== 'number') {
            try {
              diskUpdated = Math.floor(statSync(filePath).mtimeMs);
            } catch {
              diskUpdated = Date.now();
            }
          }
          const noteMeta = {
            id: target.id,
            title: meta.title ?? fallbackTitle,
            folder: meta.folder ?? '',
            protected: meta.protected ?? false,
            secret: meta.secret ?? false,
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            linkedNoteIds: Array.isArray(meta.linkedNoteIds)
              ? meta.linkedNoteIds
              : [],
            createdAt: meta.createdAt ?? diskUpdated,
            updatedAt: diskUpdated,
            trashedAt: null,
          };
          upsertNoteFromSyncWithBody(noteMeta, body);
          imported++;
        } catch (err) {
          console.warn(
            '[storage:rebuild-from-md] import failed for',
            target.id,
            err,
          );
        }
      }

      setSetting(STORAGE_LAST_SYNC_KEY, String(Date.now()));
      return { imported };
    },
  );

  // ----- バックアップ / リストア -----
  /**
   * 保存先フォルダ (notes / images / attachments) を ZIP 化してユーザーが
   * 選んだ場所に保存。UI 側で事前に DB↔MD 同期を済ませておくこと。
   */
  ipcMain.handle(
    'backup:create',
    async (): Promise<{ savedPath: string; fileCount: number } | null> => {
      return await createBackup();
    },
  );

  /**
   * ZIP を選択してリストア。既存の notes/ images/ attachments/ を削除して
   * 上書きする。リストア後に UI 側で MD→DB 同期を実行すること。
   */
  ipcMain.handle(
    'backup:restore',
    async (): Promise<{
      restoredPath: string;
      fileCount: number;
    } | null> => {
      return await restoreBackup();
    },
  );

  /**
   * ダウンロード済みプラグインのアンインストール:
   * manifest 本体 + manifest.files に列挙されたファイルを削除する。
   */
  ipcMain.handle(
    'plugins:uninstall',
    (_e, filename: string): { removed: string[]; failed: string[] } => {
      return uninstallPlugin(filename);
    },
  );

  // ----- バンドルプラグインのソース materialize / dematerialize ------------
  //
  // 「カレンダー」のように src/plugins/<id>/ にソースが置かれてビルド時に
  // import.meta.glob で eager 読み込みされるプラグインを、開発者操作で
  // ON/OFF できるようにする。
  //
  // - materialize: plugin-dev/plugins/<srcDir>/ の TS/TSX を src/plugins/<id>/
  //   へコピー → Vite HMR が拾い直して registry に再登録される
  // - dematerialize: src/plugins/<id>/ を丸ごと削除
  //
  // production (asar 同梱) では src/ は読み取り専用なので no-op (skipped: true)。

  /** dev モードのプロジェクトルート。production では asar 内パスになる */
  function getProjectRoot(): string {
    return app.getAppPath();
  }

  /** TS/TSX ソース置き場 → src/plugins/<id>/ にコピーするファイル拡張子 */
  const SOURCE_EXTS = ['.ts', '.tsx'];

  ipcMain.handle(
    'plugins:materialize-source',
    (
      _e,
      args: { id: string; sourceDir: string },
    ): {
      ok: boolean;
      skipped?: boolean;
      copied?: string[];
      error?: string;
    } => {
      if (app.isPackaged) {
        return { ok: false, skipped: true };
      }
      try {
        const root = getProjectRoot();
        const from = join(root, args.sourceDir);
        const to = join(root, 'src/plugins', args.id);
        if (!existsSync(from)) {
          return { ok: false, error: `source not found: ${from}` };
        }
        mkdirSync(to, { recursive: true });
        const copied: string[] = [];
        for (const name of readdirSync(from)) {
          if (!SOURCE_EXTS.some((ext) => name.endsWith(ext))) continue;
          copyFileSync(join(from, name), join(to, name));
          copied.push(name);
        }
        return { ok: true, copied };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'plugins:dematerialize-source',
    (
      _e,
      args: { id: string },
    ): { ok: boolean; skipped?: boolean; error?: string } => {
      if (app.isPackaged) {
        return { ok: false, skipped: true };
      }
      try {
        const root = getProjectRoot();
        const target = join(root, 'src/plugins', args.id);
        if (!existsSync(target)) return { ok: true };
        rmSync(target, { recursive: true, force: true });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
