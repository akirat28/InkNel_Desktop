/**
 * プラグインレジストリ。
 *
 * `src/plugins/` 配下の `.ts` ファイルをビルド時に Vite の
 * `import.meta.glob` で列挙し、`manifest` を export しているモジュール
 * だけをプラグインとして登録する。
 *
 * この仕組みにより:
 * - プラグインファイルを追加 → 設定画面のトグルが自動で増える
 * - プラグインファイルを削除 → 設定画面から消え、未使用 ID は無視される
 * - `src/plugins/` が空でもアプリは動作する（リストが空になるだけ）
 *
 * 各プラグインは重い依存をモジュール先頭で import しないこと。
 * （registry はモジュールを eager に評価するため）
 */

import type { PluginManifest, PluginModule } from './types';

export interface RegisteredPlugin {
  id: string;
  manifest: PluginManifest;
  module: PluginModule;
}

// Vite: ビルド時に同フォルダの .ts / .tsx を列挙。registry.ts / types.ts /
// runtimeLoader.ts はプラグイン本体ではないので除外する（circular import 防止も兼ねる）。
// .tsx を含めるのは React コンポーネントを SettingsComponent として export する
// プラグイン (例: calendar) のため。
// サブディレクトリ (`./<id>/index.ts(x)`) も拾うことで、
// 複数ファイルから成るプラグインをディレクトリ単位でまとめられる (例: ./calendar/)。
const rawModules = import.meta.glob<Record<string, unknown>>(
  [
    './*.ts',
    './*.tsx',
    './*/index.ts',
    './*/index.tsx',
    '!./registry.ts',
    '!./types.ts',
    '!./runtimeLoader.ts',
  ],
  { eager: true },
);

const REGISTRY: RegisteredPlugin[] = [];
for (const [, mod] of Object.entries(rawModules)) {
  const candidate = mod as Partial<PluginModule>;
  const manifest = candidate.manifest;
  if (
    manifest &&
    typeof manifest === 'object' &&
    typeof manifest.id === 'string' &&
    typeof manifest.label === 'string'
  ) {
    REGISTRY.push({
      id: manifest.id,
      manifest,
      module: candidate as PluginModule,
    });
  }
}

REGISTRY.sort((a, b) => a.manifest.label.localeCompare(b.manifest.label));

/** 検出されたプラグインの一覧（バンドル版のみ） */
export function listPlugins(): RegisteredPlugin[] {
  return REGISTRY;
}

/**
 * バンドル + ランタイムロード済みのプラグインから enabledIds に含まれるものを返す。
 * 同一 id が両方にある場合は **bundled が優先**（実行可能コードがあるため）。
 */
export function getEnabledPlugins(
  enabledIds: readonly string[],
): RegisteredPlugin[] {
  const set = new Set(enabledIds);
  // 動的 import を避けたいので、registry → runtimeLoader の参照を遅延させる
  const runtime: RegisteredPlugin[] =
    typeof getRuntimePluginsRef === 'function' ? getRuntimePluginsRef() : [];
  const seen = new Set<string>();
  const result: RegisteredPlugin[] = [];
  for (const p of REGISTRY) {
    if (set.has(p.id) && !seen.has(p.id)) {
      result.push(p);
      seen.add(p.id);
    }
  }
  for (const p of runtime) {
    if (set.has(p.id) && !seen.has(p.id)) {
      result.push(p);
      seen.add(p.id);
    }
  }
  return result;
}

/**
 * runtimeLoader 側で実装が後から登録される（循環 import を避けるため）。
 * App 起動時に `setRuntimePluginsRef` を介して関数参照を渡す。
 */
let getRuntimePluginsRef: (() => RegisteredPlugin[]) | null = null;
export function setRuntimePluginsRef(
  fn: () => RegisteredPlugin[],
): void {
  getRuntimePluginsRef = fn;
}
