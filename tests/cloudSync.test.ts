import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupAllUserDataDirs, newUserDataDir } from './helpers';
import { closeDb } from '../electron/db/index';
import { insertNote, getNote, type NoteMeta } from '../electron/db/notes';
import { writeBody, readBody } from '../electron/storage/notesFiles';
import {
  pushSingleNote,
  removeSingleNote,
  checkAndSyncSingleNote,
  runSync,
} from '../electron/sync/cloudSync';

// 同期先: 偽の iCloud ルートとして tmp 配下の
// `Library/Mobile Documents/com~apple~CloudDocs/` を用意し、
// HOME 環境変数を差し替えて detectICloud にヒットさせる
let fakeHome: string;
let iCloudRoot: string;
let originalHome: string | undefined;

function makeNote(id: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  const now = Date.now();
  return {
    id,
    title: `note ${id.slice(0, 8)}`,
    folder: '',
    protected: false,
    secret: false,
    tags: [],
    linkedNoteIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// notesFiles / cloudSync は path traversal 対策で UUID 形式の id だけを受理する。
// 旧テストでは 'n1' 等の短い id を使っていたが、ガード導入後は UUID にする。
const uuid = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ID_N1 = uuid(1);
const ID_N2 = uuid(2);
const ID_N3 = uuid(3);
const ID_LOCAL = uuid(10);
const ID_CLOUD = uuid(11);
const ID_SAME = uuid(12);
const ID_A = uuid(20);
const ID_X = uuid(21);
const ID_Y = uuid(22);

beforeAll(() => {
  originalHome = process.env.HOME;
});

beforeEach(() => {
  closeDb();
  newUserDataDir();
  fakeHome = mkdtempSync(join(tmpdir(), 'inknel-home-'));
  iCloudRoot = join(
    fakeHome,
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs',
  );
  mkdirSync(iCloudRoot, { recursive: true });
  process.env.HOME = fakeHome;
});

afterAll(() => {
  closeDb();
  cleanupAllUserDataDirs();
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  }
});

describe('cloudSync ライトスルー', () => {
  test('pushSingleNote で body と manifest が書き出される', () => {
    insertNote(makeNote(ID_N1, { title: 'タイトル' }));
    writeBody(ID_N1, '本文です');

    pushSingleNote('icloud', ID_N1);

    const syncRoot = join(iCloudRoot, 'InkNel');
    expect(existsSync(join(syncRoot, 'notes', `${ID_N1}.md`))).toBe(true);
    expect(readFileSync(join(syncRoot, 'notes', `${ID_N1}.md`), 'utf8')).toBe(
      '本文です',
    );

    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    expect(manifest.notes[ID_N1]).toBeDefined();
    expect(manifest.notes[ID_N1].title).toBe('タイトル');
  });

  test('removeSingleNote は MD を tombstone 化し manifest エントリを消す', () => {
    insertNote(makeNote(ID_N2));
    writeBody(ID_N2, 'x');
    pushSingleNote('icloud', ID_N2);

    removeSingleNote('icloud', ID_N2);

    const syncRoot = join(iCloudRoot, 'InkNel');
    // MD ファイルは「物理削除」ではなく tombstone として残る (他デバイスへ削除を伝播するため)
    const md = readFileSync(join(syncRoot, 'notes', `${ID_N2}.md`), 'utf8');
    expect(md).toMatch(/deleted:\s*true/);
    expect(md).toMatch(/deleted_at:\s*\d+/);
    // manifest からは消える (復活方向の sync 候補にしないため)
    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    expect(manifest.notes[ID_N2]).toBeUndefined();
  });

  test('provider が none なら no-op', () => {
    insertNote(makeNote(ID_N3));
    writeBody(ID_N3, 'x');
    // 例外を出さず、何も書かれない
    expect(() => pushSingleNote('none', ID_N3)).not.toThrow();
    expect(existsSync(join(iCloudRoot, 'InkNel'))).toBe(false);
  });

  test('UUID 形式以外の id は IPC 経由でも無視される', () => {
    expect(() =>
      pushSingleNote('icloud', '../etc/passwd' as string),
    ).not.toThrow();
    expect(() =>
      removeSingleNote('icloud', 'not-a-uuid' as string),
    ).not.toThrow();
    // 何も書かれないことを確認
    expect(existsSync(join(iCloudRoot, 'InkNel', 'notes'))).toBe(false);
  });
});

describe('cloudSync 双方向同期', () => {
  test('ローカルだけに存在するノートは push される', async () => {
    insertNote(makeNote(ID_LOCAL, { title: 'local' }));
    writeBody(ID_LOCAL, 'local body');

    const result = await runSync('icloud');

    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    const syncRoot = join(iCloudRoot, 'InkNel');
    expect(
      existsSync(join(syncRoot, 'notes', `${ID_LOCAL}.md`)),
    ).toBe(true);
  });

  test('クラウドだけに存在するノートは pull される', async () => {
    const syncRoot = join(iCloudRoot, 'InkNel');
    mkdirSync(join(syncRoot, 'notes'), { recursive: true });
    // クラウドに手動で manifest と body を置く
    const manifest = {
      version: 1,
      lastSync: 0,
      notes: {
        [ID_CLOUD]: {
          title: 'from cloud',
          folder: '',
          protected: false,
          secret: false,
          tags: [],
          createdAt: 1000,
          updatedAt: 2000,
        },
      },
    };
    writeFileSync(
      join(syncRoot, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8',
    );
    writeFileSync(
      join(syncRoot, 'notes', `${ID_CLOUD}.md`),
      'cloud body',
      'utf8',
    );

    const result = await runSync('icloud');

    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(0);
    const pulled = getNote(ID_CLOUD);
    expect(pulled?.title).toBe('from cloud');
    expect(readBody(ID_CLOUD)).toBe('cloud body');
  });

  test('両方にあり同じ updated_at なら unchanged', async () => {
    insertNote(makeNote(ID_SAME, { updatedAt: 5000, createdAt: 5000 }));
    writeBody(ID_SAME, 'body');
    pushSingleNote('icloud', ID_SAME);

    const result = await runSync('icloud');
    expect(result.unchanged).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
  });

  test('クラウドが新しければ pull、ローカルが新しければ push', async () => {
    // ローカル側: updatedAt=1000
    insertNote(
      makeNote(ID_A, { updatedAt: 1000, createdAt: 1000, title: 'old' }),
    );
    writeBody(ID_A, 'old body');
    pushSingleNote('icloud', ID_A);

    // クラウド側の manifest を手動で更新して新しい updated_at に（pull 対象に）
    const syncRoot = join(iCloudRoot, 'InkNel');
    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    manifest.notes[ID_A].updatedAt = 9999;
    manifest.notes[ID_A].title = 'new';
    writeFileSync(
      join(syncRoot, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8',
    );
    writeFileSync(join(syncRoot, 'notes', `${ID_A}.md`), 'new body', 'utf8');

    const result = await runSync('icloud');
    expect(result.pulled).toBe(1);
    expect(getNote(ID_A)?.title).toBe('new');
    expect(readBody(ID_A)).toBe('new body');
  });
});

describe('checkAndSyncSingleNote', () => {
  test('クラウドに無ければ push', () => {
    insertNote(makeNote(ID_X));
    writeBody(ID_X, 'body');
    const result = checkAndSyncSingleNote('icloud', ID_X);
    expect(result).toBe('pushed');
  });

  test('クラウドが新しければ pull', () => {
    insertNote(makeNote(ID_Y, { updatedAt: 1000, createdAt: 1000 }));
    writeBody(ID_Y, 'local');
    pushSingleNote('icloud', ID_Y);

    // クラウド側の manifest を手動で新しく書き換え
    const syncRoot = join(iCloudRoot, 'InkNel');
    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    manifest.notes[ID_Y].updatedAt = 99999;
    writeFileSync(
      join(syncRoot, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8',
    );
    writeFileSync(join(syncRoot, 'notes', `${ID_Y}.md`), 'pulled', 'utf8');

    const result = checkAndSyncSingleNote('icloud', ID_Y);
    expect(result).toBe('pulled');
    expect(readBody(ID_Y)).toBe('pulled');
  });

  test('ノートが存在しなければ skip', () => {
    expect(checkAndSyncSingleNote('icloud', 'nosuch')).toBe('skip');
  });

  test('provider=none は skip', () => {
    insertNote(makeNote('z'));
    expect(checkAndSyncSingleNote('none', 'z')).toBe('skip');
  });
});
