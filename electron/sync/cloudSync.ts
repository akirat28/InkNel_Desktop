/**
 * クラウド共有（iCloud / Dropbox / Google Drive）のプロバイダ検出と
 * マニフェストベースの同期ロジック。
 *
 * 方針:
 *   - 各クラウドサービスが提供する **ローカル同期フォルダ** に直接
 *     read/write する。OAuth や API 呼び出しは使わない（OS の同期
 *     クライアントに委譲する）
 *   - 同期ルートは `<cloud-folder>/InkNel/`
 *   - マニフェスト (manifest.json) にノートのメタデータを書き、
 *     本体 Markdown は `notes/<id>.md` として保存
 *   - 起動時は localDB と manifest を比較し、`updated_at` が新しい方を
 *     他方へコピーする（バイト比較はしない）
 *   - 削除の同期は未対応（将来拡張）
 */
import { homedir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setImmediate as setImmediatePromise } from 'node:timers/promises';
import {
  getNote,
  listNotes,
  updateNoteBodyText,
  upsertNoteFromSyncWithBody,
  type NoteMeta,
} from '../db/notes';
import { readBody, writeBody } from '../storage/notesFiles';
import {
  imagesDir,
  IMAGE_FILENAME_PATTERN,
} from '../storage/imagesFiles';
import {
  attachmentsDir,
  ATTACHMENT_FILENAME_PATTERN,
} from '../storage/attachmentsFiles';

export type ShareProvider = 'none' | 'icloud' | 'dropbox' | 'gdrive';

export interface ProviderInfo {
  id: ShareProvider;
  label: string;
  /** OS の同期フォルダ。見つからなければ null */
  path: string | null;
  /** 利用可能（フォルダが検出された） */
  available: boolean;
}

/**
 * 3 つのプロバイダについてローカル同期フォルダが存在するかを返す。
 * 'none' は含まない（設定画面で "無効" は別扱い）。
 */
export function detectProviders(): ProviderInfo[] {
  const home = homedir();
  return [
    {
      id: 'icloud',
      label: 'iCloud Drive',
      ...detectICloud(home),
    },
    {
      id: 'dropbox',
      label: 'Dropbox',
      ...detectDropbox(home),
    },
    {
      id: 'gdrive',
      label: 'Google Drive',
      ...detectGoogleDrive(home),
    },
  ];
}

function detectICloud(home: string): { path: string | null; available: boolean } {
  // macOS 標準の iCloud Drive ルート
  const candidate = join(
    home,
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs',
  );
  if (existsSync(candidate)) {
    return { path: candidate, available: true };
  }
  return { path: null, available: false };
}

function detectDropbox(
  home: string,
): { path: string | null; available: boolean } {
  // Dropbox クライアントは ~/.dropbox/info.json に実パスを記録する
  const infoPath = join(home, '.dropbox', 'info.json');
  if (existsSync(infoPath)) {
    try {
      const info = JSON.parse(readFileSync(infoPath, 'utf8')) as Record<
        string,
        { path?: string }
      >;
      for (const acc of Object.values(info)) {
        if (acc?.path && existsSync(acc.path)) {
          return { path: acc.path, available: true };
        }
      }
    } catch {
      // 無効な JSON なら fallback へ
    }
  }
  // フォールバック: 定番パスを順に見る
  const candidates = [
    join(home, 'Dropbox'),
    join(home, 'Dropbox (Personal)'),
    join(home, 'Library', 'CloudStorage', 'Dropbox'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { path: c, available: true };
  }
  return { path: null, available: false };
}

function detectGoogleDrive(
  home: string,
): { path: string | null; available: boolean } {
  // macOS 13+ の Google Drive for Desktop は
  //   ~/Library/CloudStorage/GoogleDrive-<email>/<DriveFolder>/
  // にマウントされる。フォルダ名は OS の言語設定により異なる:
  //   英語: "My Drive"
  //   日本語: "マイドライブ"
  // 複数アカウントの場合は最初のものを使う。
  const csDir = join(home, 'Library', 'CloudStorage');
  if (!existsSync(csDir)) return { path: null, available: false };
  let entries: string[];
  try {
    entries = readdirSync(csDir);
  } catch {
    return { path: null, available: false };
  }
  const gd = entries.find((e) => e.startsWith('GoogleDrive-'));
  if (!gd) return { path: null, available: false };

  const gdRoot = join(csDir, gd);
  // 言語別のドライブフォルダ名候補
  const driveFolderNames = ['My Drive', 'マイドライブ', 'Mon Drive', 'Meine Ablage', 'Mi unidad'];
  for (const name of driveFolderNames) {
    const candidate = join(gdRoot, name);
    if (existsSync(candidate)) {
      return { path: candidate, available: true };
    }
  }

  // 候補に無い言語の場合: GoogleDrive-<email> 直下のディレクトリで
  // 隠しフォルダ (. 始まり) でないものを探す
  try {
    const subEntries = readdirSync(gdRoot);
    for (const sub of subEntries) {
      if (sub.startsWith('.')) continue;
      const fullPath = join(gdRoot, sub);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          return { path: fullPath, available: true };
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

  return { path: null, available: false };
}

// ----- マニフェスト I/O -----

interface SyncManifest {
  version: 1;
  lastSync: number;
  notes: Record<
    string,
    {
      title: string;
      folder: string;
      protected: boolean;
      secret: boolean;
      tags: string[];
      linkedNoteIds: string[];
      createdAt: number;
      updatedAt: number;
    }
  >;
}

const EMPTY_MANIFEST: SyncManifest = {
  version: 1,
  lastSync: 0,
  notes: {},
};

function loadManifest(manifestPath: string): SyncManifest {
  if (!existsSync(manifestPath)) return { ...EMPTY_MANIFEST, notes: {} };
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      parsed.version === 1 &&
      typeof parsed.notes === 'object'
    ) {
      return parsed as SyncManifest;
    }
  } catch {
    // 壊れているとみなして新規扱い
  }
  return { ...EMPTY_MANIFEST, notes: {} };
}

function saveManifest(manifestPath: string, manifest: SyncManifest): void {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function metaToManifestEntry(meta: NoteMeta) {
  return {
    title: meta.title,
    folder: meta.folder,
    protected: meta.protected,
    secret: meta.secret,
    tags: meta.tags,
    linkedNoteIds: meta.linkedNoteIds,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

// ----- 指定プロバイダの同期ルートを求める -----

/**
 * 指定プロバイダの同期ルート `<cloud-folder>/InkNel/` を返す。
 * プロバイダが利用不可なら null。必要ならフォルダを作成する。
 */
export function getSyncRoot(provider: ShareProvider): string | null {
  if (provider === 'none') return null;
  const providers = detectProviders();
  const found = providers.find((p) => p.id === provider);
  if (!found || !found.path) return null;
  const root = join(found.path, 'InkNel');
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(join(root, 'notes'), { recursive: true });
  } catch (err) {
    console.error(
      `[cloudSync] 同期ルート作成失敗: ${root}`,
      err,
    );
    return null;
  }
  return root;
}

// ----- 同期実行 -----

export interface SyncResult {
  pushed: number; // クラウドへ書き出した数
  pulled: number; // クラウドから取り込んだ数
  unchanged: number; // 両方同じ updated_at で変更なし
  total: number; // 関係したノート総数
  /** メディア (images + attachments) の同期件数 */
  mediaPushed: number;
  mediaPulled: number;
  lastSync: number; // 今回の同期時刻
}

/** 同期進捗イベント。`phase` に応じて UI を分岐して表示する想定。 */
export type SyncProgressEvent =
  | { phase: 'start'; total: number }
  | {
      phase: 'push';
      current: number;
      total: number;
      noteTitle: string;
    }
  | {
      phase: 'pull';
      current: number;
      total: number;
      noteTitle: string;
    }
  | {
      phase: 'skip';
      current: number;
      total: number;
      noteTitle: string;
    }
  | { phase: 'media'; kind: 'images' | 'attachments'; pushed: number; pulled: number; total: number }
  | { phase: 'finalizing'; total: number }
  | { phase: 'done'; result: SyncResult };

/**
 * 指定プロバイダのクラウドフォルダと localDB を同期する。
 * updated_at ベースで新しい方を採用する双方向同期。
 *
 * `onProgress` が渡されると、各ノート処理の前後に進捗イベントを送出する。
 * ループ内で `setImmediate` で event loop に制御を返すことで、IPC 経由で
 * renderer に届いた progress がリアルタイムで表示される。
 */
export async function runSync(
  provider: ShareProvider,
  onProgress?: (ev: SyncProgressEvent) => void,
): Promise<SyncResult> {
  const root = getSyncRoot(provider);
  if (!root) {
    throw new Error(
      '指定された共有プロバイダが利用できません。クラウドクライアントがインストールされ、フォルダが存在するか確認してください。',
    );
  }

  const manifestPath = join(root, 'manifest.json');
  const notesDir = join(root, 'notes');
  const manifest = loadManifest(manifestPath);

  const localNotes = listNotes();
  const localMap = new Map<string, NoteMeta>(
    localNotes.map((n) => [n.id, n]),
  );

  let pushed = 0;
  let pulled = 0;
  let unchanged = 0;

  const allIds = Array.from(
    new Set<string>([
      ...Object.keys(manifest.notes),
      ...localNotes.map((n) => n.id),
    ]),
  );
  const total = allIds.length;

  onProgress?.({ phase: 'start', total });
  await setImmediatePromise();

  let current = 0;
  for (const id of allIds) {
    current++;
    const local = localMap.get(id);
    const cloud = manifest.notes[id];
    const title = local?.title || cloud?.title || '(無題)';

    if (local && !cloud) {
      // ローカルにしか無い → push
      onProgress?.({ phase: 'push', current, total, noteTitle: title });
      pushNote(local, notesDir, manifest);
      pushed++;
    } else if (!local && cloud) {
      // クラウドにしか無い → pull
      onProgress?.({ phase: 'pull', current, total, noteTitle: title });
      const bodyPath = join(notesDir, `${id}.md`);
      if (existsSync(bodyPath)) {
        const body = readFileSync(bodyPath, 'utf8');
        upsertNoteFromSyncWithBody(
          {
            id,
            title: cloud.title,
            folder: cloud.folder,
            protected: cloud.protected,
            secret: cloud.secret,
            tags: cloud.tags ?? [],
            linkedNoteIds: cloud.linkedNoteIds ?? [],
            createdAt: cloud.createdAt,
            updatedAt: cloud.updatedAt,
            trashedAt: null,
          },
          body,
        );
        writeBody(id, body);
        pulled++;
      }
    } else if (local && cloud) {
      if (local.updatedAt > cloud.updatedAt) {
        onProgress?.({ phase: 'push', current, total, noteTitle: title });
        pushNote(local, notesDir, manifest);
        pushed++;
      } else if (cloud.updatedAt > local.updatedAt) {
        onProgress?.({ phase: 'pull', current, total, noteTitle: title });
        const bodyPath = join(notesDir, `${id}.md`);
        if (existsSync(bodyPath)) {
          const body = readFileSync(bodyPath, 'utf8');
          upsertNoteFromSyncWithBody(
            {
              id,
              title: cloud.title,
              folder: cloud.folder,
              protected: cloud.protected,
              secret: cloud.secret,
              tags: cloud.tags ?? [],
              linkedNoteIds: cloud.linkedNoteIds ?? [],
              createdAt: cloud.createdAt,
              updatedAt: cloud.updatedAt,
              trashedAt: null,
            },
            body,
          );
          writeBody(id, body);
          pulled++;
        }
      } else {
        onProgress?.({ phase: 'skip', current, total, noteTitle: title });
        unchanged++;
      }
    }

    // event loop に制御を返して、IPC 経由の progress イベントを renderer が
    // 受け取れるようにする
    await setImmediatePromise();
  }

  // ----- メディア同期 (images + attachments) -----
  // SHA-256 ファイル名なので、同名 = 同一内容。存在しないものだけコピー。
  const imagesResult = await syncMediaDir(
    imagesDir(),
    join(root, 'images'),
    IMAGE_FILENAME_PATTERN,
    onProgress
      ? (p, pl) =>
          onProgress({ phase: 'media', kind: 'images', ...p, total: pl })
      : undefined,
  );
  await setImmediatePromise();

  const attachResult = await syncMediaDir(
    attachmentsDir(),
    join(root, 'attachments'),
    ATTACHMENT_FILENAME_PATTERN,
    onProgress
      ? (p, pl) =>
          onProgress({ phase: 'media', kind: 'attachments', ...p, total: pl })
      : undefined,
  );
  await setImmediatePromise();

  onProgress?.({ phase: 'finalizing', total });
  manifest.lastSync = Date.now();
  saveManifest(manifestPath, manifest);

  const mediaPushed = imagesResult.pushed + attachResult.pushed;
  const mediaPulled = imagesResult.pulled + attachResult.pulled;

  const result: SyncResult = {
    pushed,
    pulled,
    unchanged,
    total,
    mediaPushed,
    mediaPulled,
    lastSync: manifest.lastSync,
  };
  onProgress?.({ phase: 'done', result });
  return result;
}

function pushNote(note: NoteMeta, notesDir: string, manifest: SyncManifest) {
  let body = '';
  try {
    body = readBody(note.id);
    updateNoteBodyText(note.id, body, { touch: false });
  } catch {
    // 本文ファイルが無い場合でもマニフェストだけ書いておく
    body = '';
  }
  writeFileSync(join(notesDir, `${note.id}.md`), body, 'utf8');
  manifest.notes[note.id] = metaToManifestEntry(note);
}

// ----- 外向け: ステータス取得 -----

export interface SyncStatus {
  provider: ShareProvider;
  available: boolean;
  path: string | null;
  lastSync: number;
  cloudNoteCount: number;
}

// ----- 個別ノートのクラウド確認 + pull -----

/**
 * 指定ノートについて PC とクラウドのタイムスタンプを比較し、
 * 新しい方を他方にコピーする（双方向の単一ノート同期）。
 * ファイル選択時にバックグラウンドで呼ばれる想定。
 *
 * @returns 'pulled' = クラウドから取得した（呼び出し元で body 再読込が必要）
 *          'pushed' = PC からクラウドへコピーした（UI 変更不要）
 *          'same'   = 同一で何もしなかった
 *          'skip'   = プロバイダ無効/検出不可等でスキップ
 */
export type SingleNoteSyncResult = 'pulled' | 'pushed' | 'same' | 'skip';

export function checkAndSyncSingleNote(
  provider: ShareProvider,
  noteId: string,
): SingleNoteSyncResult {
  if (provider === 'none') return 'skip';
  const root = getSyncRoot(provider);
  if (!root) return 'skip';

  const manifestPath = join(root, 'manifest.json');
  const notesDir = join(root, 'notes');
  const manifest = loadManifest(manifestPath);
  const cloudEntry = manifest.notes[noteId];
  const localNote = getNote(noteId);

  if (!localNote) return 'skip';

  // --- クラウドにノートが無い場合 → PC から push ---
  if (!cloudEntry) {
    pushNote(localNote, notesDir, manifest);
    saveManifest(manifestPath, manifest);
    return 'pushed';
  }

  // --- クラウドの方が新しい → pull ---
  if (cloudEntry.updatedAt > localNote.updatedAt) {
    const bodyPath = join(notesDir, `${noteId}.md`);
    if (existsSync(bodyPath)) {
      const body = readFileSync(bodyPath, 'utf8');
      upsertNoteFromSyncWithBody(
        {
          id: noteId,
          title: cloudEntry.title,
          folder: cloudEntry.folder,
          protected: cloudEntry.protected,
          secret: cloudEntry.secret,
          tags: cloudEntry.tags ?? [],
          linkedNoteIds: cloudEntry.linkedNoteIds ?? [],
          createdAt: cloudEntry.createdAt,
          updatedAt: cloudEntry.updatedAt,
          trashedAt: null,
        },
        body,
      );
      writeBody(noteId, body);
      return 'pulled';
    }
  }

  // --- PC の方が新しい → push ---
  if (localNote.updatedAt > cloudEntry.updatedAt) {
    pushNote(localNote, notesDir, manifest);
    saveManifest(manifestPath, manifest);
    return 'pushed';
  }

  // --- 同じ → 何もしない ---
  return 'same';
}

// ----- ライトスルー: 個別ノート / メディアの即時書き出し -----

/**
 * 単一ノートの body + manifest エントリをクラウドフォルダに書き出す。
 * IPC ハンドラから note mutation の直後に呼ばれる。
 * プロバイダが 'none' や検出不可なら何もしない。
 */
export function pushSingleNote(provider: ShareProvider, noteId: string): void {
  const root = getSyncRoot(provider);
  if (!root) return;
  const note = listNotes().find((n) => n.id === noteId);
  if (!note) return;

  const notesDir = join(root, 'notes');
  mkdirSync(notesDir, { recursive: true });
  const manifestPath = join(root, 'manifest.json');
  const manifest = loadManifest(manifestPath);

  // body を書き出す
  let body = '';
  try {
    body = readBody(noteId);
    updateNoteBodyText(noteId, body, { touch: false });
  } catch {
    // body ファイルが無ければ空
  }
  writeFileSync(join(notesDir, `${noteId}.md`), body, 'utf8');

  // manifest 更新
  manifest.notes[noteId] = metaToManifestEntry(note);
  manifest.lastSync = Date.now();
  saveManifest(manifestPath, manifest);
}

/**
 * 削除されたノートをクラウドフォルダから除去する。
 */
export function removeSingleNote(
  provider: ShareProvider,
  noteId: string,
): void {
  const root = getSyncRoot(provider);
  if (!root) return;

  const notePath = join(root, 'notes', `${noteId}.md`);
  if (existsSync(notePath)) {
    try {
      unlinkSync(notePath);
    } catch {
      // 削除失敗は無視
    }
  }

  const manifestPath = join(root, 'manifest.json');
  const manifest = loadManifest(manifestPath);
  delete manifest.notes[noteId];
  manifest.lastSync = Date.now();
  saveManifest(manifestPath, manifest);
}

/**
 * 単一メディアファイル（画像 / 添付）をクラウドフォルダにコピーする。
 * IPC ハンドラから save 直後に呼ばれる。
 *
 * @param kind  'images' or 'attachments'
 * @param localPath  保存済みのローカルフルパス
 * @param filename  ファイル名 (sha256.ext)
 */
export function pushSingleMedia(
  provider: ShareProvider,
  kind: 'images' | 'attachments',
  localPath: string,
  filename: string,
): void {
  const root = getSyncRoot(provider);
  if (!root) return;

  const cloudDir = join(root, kind);
  mkdirSync(cloudDir, { recursive: true });
  const dest = join(cloudDir, filename);
  if (existsSync(dest)) return; // SHA-256 同名 = 同一内容 → skip
  try {
    const data = readFileSync(localPath);
    writeFileSync(dest, data);
  } catch {
    // コピー失敗は無視（次回手動同期で拾える）
  }
}

// ----- メディアファイル（images / attachments）の同期 -----

/**
 * ローカルとクラウドの 2 つのメディアディレクトリを比較し、
 * 存在しないファイルを相互にコピーする。
 * ファイル名が SHA-256 ハッシュなので、同名 = 同一内容。
 */
async function syncMediaDir(
  localDir: string,
  cloudDir: string,
  filenamePattern: RegExp,
  onProgress?: (
    counts: { pushed: number; pulled: number },
    total: number,
  ) => void,
): Promise<{ pushed: number; pulled: number }> {
  mkdirSync(localDir, { recursive: true });
  mkdirSync(cloudDir, { recursive: true });

  let localFiles: string[];
  try {
    localFiles = readdirSync(localDir).filter((f) => filenamePattern.test(f));
  } catch {
    localFiles = [];
  }
  let cloudFiles: string[];
  try {
    cloudFiles = readdirSync(cloudDir).filter((f) => filenamePattern.test(f));
  } catch {
    cloudFiles = [];
  }

  const localSet = new Set(localFiles);
  const cloudSet = new Set(cloudFiles);

  let pushed = 0;
  let pulled = 0;

  // ローカルにしか無い → push
  for (const file of localFiles) {
    if (!cloudSet.has(file)) {
      try {
        const data = readFileSync(join(localDir, file));
        writeFileSync(join(cloudDir, file), data);
        pushed++;
      } catch {
        // コピー失敗は無視
      }
    }
  }

  // クラウドにしか無い → pull
  for (const file of cloudFiles) {
    if (!localSet.has(file)) {
      try {
        const data = readFileSync(join(cloudDir, file));
        writeFileSync(join(localDir, file), data);
        pulled++;
      } catch {
        // コピー失敗は無視
      }
    }
  }

  const total = new Set([...localFiles, ...cloudFiles]).size;
  onProgress?.({ pushed, pulled }, total);
  await setImmediatePromise();

  return { pushed, pulled };
}

export function getSyncStatus(provider: ShareProvider): SyncStatus {
  if (provider === 'none') {
    return {
      provider: 'none',
      available: false,
      path: null,
      lastSync: 0,
      cloudNoteCount: 0,
    };
  }
  const root = getSyncRoot(provider);
  if (!root) {
    return {
      provider,
      available: false,
      path: null,
      lastSync: 0,
      cloudNoteCount: 0,
    };
  }
  const manifest = loadManifest(join(root, 'manifest.json'));
  return {
    provider,
    available: true,
    path: root,
    lastSync: manifest.lastSync,
    cloudNoteCount: Object.keys(manifest.notes).length,
  };
}
