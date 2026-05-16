#!/usr/bin/env node
/**
 * テスト実行ラッパー。
 *
 * `better-sqlite3` は通常 `electron-rebuild` で Electron 向け (NODE_MODULE_VERSION
 * 128) にビルドされているが、Vitest はホストの Node.js (v20+ = 131 等) で動くため、
 * そのままでは `require()` が失敗する。
 *
 * この手順で解決:
 *   1. `npm rebuild better-sqlite3`  → ホスト Node 向けにリビルド
 *   2. `vitest run`                  → テスト実行
 *   3. `electron-rebuild ...`        → Electron 向けに戻す（dev/build 用）
 *
 * テストの成否によらず 3. は必ず実行する。最終的な終了コードは 2. のもの。
 */
const { spawnSync } = require('node:child_process');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  return result.status ?? 1;
}

console.log('[test] better-sqlite3 をホスト Node 向けにリビルド...');
const rebuild1 = run('npm', ['rebuild', 'better-sqlite3']);
if (rebuild1 !== 0) {
  console.error('[test] ホスト Node 向けリビルドに失敗');
  process.exit(rebuild1);
}

console.log('[test] Vitest を実行...');
const testExit = run('npx', ['vitest', 'run']);

console.log('[test] better-sqlite3 を Electron 向けに戻す...');
const rebuild2 = run('npx', [
  'electron-rebuild',
  '-f',
  '-w',
  'better-sqlite3',
]);
if (rebuild2 !== 0) {
  console.warn(
    '[test] Electron 向けリビルドに失敗。`npm install` で復元してください。',
  );
}

process.exit(testExit);
