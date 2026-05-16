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
    title: `note ${id}`,
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
    insertNote(makeNote('n1', { title: 'タイトル' }));
    writeBody('n1', '本文です');

    pushSingleNote('icloud', 'n1');

    const syncRoot = join(iCloudRoot, 'InkNel');
    expect(existsSync(join(syncRoot, 'notes', 'n1.md'))).toBe(true);
    expect(readFileSync(join(syncRoot, 'notes', 'n1.md'), 'utf8')).toBe(
      '本文です',
    );

    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    expect(manifest.notes.n1).toBeDefined();
    expect(manifest.notes.n1.title).toBe('タイトル');
  });

  test('removeSingleNote で body と manifest エントリが消える', () => {
    insertNote(makeNote('n2'));
    writeBody('n2', 'x');
    pushSingleNote('icloud', 'n2');

    removeSingleNote('icloud', 'n2');

    const syncRoot = join(iCloudRoot, 'InkNel');
    expect(existsSync(join(syncRoot, 'notes', 'n2.md'))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    expect(manifest.notes.n2).toBeUndefined();
  });

  test('provider が none なら no-op', () => {
    insertNote(makeNote('n3'));
    writeBody('n3', 'x');
    // 例外を出さず、何も書かれない
    expect(() => pushSingleNote('none', 'n3')).not.toThrow();
    expect(existsSync(join(iCloudRoot, 'InkNel'))).toBe(false);
  });
});

describe('cloudSync 双方向同期', () => {
  test('ローカルだけに存在するノートは push される', async () => {
    insertNote(makeNote('local-only', { title: 'local' }));
    writeBody('local-only', 'local body');

    const result = await runSync('icloud');

    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    const syncRoot = join(iCloudRoot, 'InkNel');
    expect(
      existsSync(join(syncRoot, 'notes', 'local-only.md')),
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
        'cloud-only': {
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
      join(syncRoot, 'notes', 'cloud-only.md'),
      'cloud body',
      'utf8',
    );

    const result = await runSync('icloud');

    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(0);
    const pulled = getNote('cloud-only');
    expect(pulled?.title).toBe('from cloud');
    expect(readBody('cloud-only')).toBe('cloud body');
  });

  test('両方にあり同じ updated_at なら unchanged', async () => {
    insertNote(makeNote('same', { updatedAt: 5000, createdAt: 5000 }));
    writeBody('same', 'body');
    pushSingleNote('icloud', 'same');

    const result = await runSync('icloud');
    expect(result.unchanged).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
  });

  test('クラウドが新しければ pull、ローカルが新しければ push', async () => {
    // ローカル側: updatedAt=1000
    insertNote(
      makeNote('a', { updatedAt: 1000, createdAt: 1000, title: 'old' }),
    );
    writeBody('a', 'old body');
    pushSingleNote('icloud', 'a');

    // クラウド側の manifest を手動で更新して新しい updated_at に（pull 対象に）
    const syncRoot = join(iCloudRoot, 'InkNel');
    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    manifest.notes.a.updatedAt = 9999;
    manifest.notes.a.title = 'new';
    writeFileSync(
      join(syncRoot, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8',
    );
    writeFileSync(join(syncRoot, 'notes', 'a.md'), 'new body', 'utf8');

    const result = await runSync('icloud');
    expect(result.pulled).toBe(1);
    expect(getNote('a')?.title).toBe('new');
    expect(readBody('a')).toBe('new body');
  });
});

describe('checkAndSyncSingleNote', () => {
  test('クラウドに無ければ push', () => {
    insertNote(makeNote('x'));
    writeBody('x', 'body');
    const result = checkAndSyncSingleNote('icloud', 'x');
    expect(result).toBe('pushed');
  });

  test('クラウドが新しければ pull', () => {
    insertNote(makeNote('y', { updatedAt: 1000, createdAt: 1000 }));
    writeBody('y', 'local');
    pushSingleNote('icloud', 'y');

    // クラウド側の manifest を手動で新しく書き換え
    const syncRoot = join(iCloudRoot, 'InkNel');
    const manifest = JSON.parse(
      readFileSync(join(syncRoot, 'manifest.json'), 'utf8'),
    );
    manifest.notes.y.updatedAt = 99999;
    writeFileSync(
      join(syncRoot, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8',
    );
    writeFileSync(join(syncRoot, 'notes', 'y.md'), 'pulled', 'utf8');

    const result = checkAndSyncSingleNote('icloud', 'y');
    expect(result).toBe('pulled');
    expect(readBody('y')).toBe('pulled');
  });

  test('ノートが存在しなければ skip', () => {
    expect(checkAndSyncSingleNote('icloud', 'nosuch')).toBe('skip');
  });

  test('provider=none は skip', () => {
    insertNote(makeNote('z'));
    expect(checkAndSyncSingleNote('none', 'z')).toBe('skip');
  });
});
