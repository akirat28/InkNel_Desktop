import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

// vi.hoisted で作ったオブジェクトをモックファクトリから参照する。
// hoisted 変数は export できないので、ここでクロージャに閉じ込める。
const _state = vi.hoisted(() => ({ userDataDir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => _state.userDataDir,
  },
  ipcMain: { handle: () => {} },
  shell: { openExternal: async () => {}, openPath: async () => '' },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  BrowserWindow: { fromWebContents: () => null },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { on: () => {}, removeListener: () => {}, invoke: async () => {} },
}));

const createdDirs: string[] = [];

/** 新しい tmp ディレクトリを `userData` として割り当て、絶対パスを返す。 */
export function newUserDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inknel-test-'));
  createdDirs.push(dir);
  _state.userDataDir = dir;
  return dir;
}

/** これまでに作った全 tmp ディレクトリを削除する（afterAll で呼ぶ）。 */
export function cleanupAllUserDataDirs(): void {
  for (const d of createdDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
