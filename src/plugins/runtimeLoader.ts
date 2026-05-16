/**
 * DL されたプラグインのランタイムロード（明示インポート方式）。
 *
 * 設計:
 * - DL = ファイル保存だけ（不活性）
 * - インポート = manifest の entry .js を Blob URL で dynamic import →
 *               registry に登録 → 利用可能になる
 * - インポートは settings.importedPlugins[] に永続化される
 *
 * エクスポート関数:
 * - importPluginById(id)   ユーザーが「インポート」ボタンを押した時に呼ぶ
 * - unloadPluginById(id)   削除や un-import の時に呼ぶ
 * - loadImportedPlugins(ids)  起動時に既にインポート済みのものだけ再ロード
 *
 * 形式: 現状 .js の ES module のみサポート。.ts や .mjs は未対応。
 */

import { setRuntimePluginsRef, type RegisteredPlugin } from './registry';
import type { PluginManifest, PluginModule } from './types';

let runtimePlugins: RegisteredPlugin[] = [];
const listeners = new Set<() => void>();

/** 現在ロード済みのランタイムプラグイン */
export function getRuntimePlugins(): RegisteredPlugin[] {
  return runtimePlugins;
}

/** 変更通知の購読。返り値は解除関数 */
export function subscribeRuntimePlugins(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

// registry.getEnabledPlugins() からも見えるよう参照を渡す
setRuntimePluginsRef(getRuntimePlugins);

export interface ImportResult {
  ok: boolean;
  /** 成功時: ロードされたプラグインの id */
  id?: string;
  /** 失敗時: ユーザー向けエラーメッセージ */
  error?: string;
}

/**
 * userData/plugins/ にある全 manifest から id 一致を探し、
 * その entry .js を dynamic import して runtime に登録する。
 * 既に同じ id が登録済みなら一旦アンロードしてから再ロード。
 */
export async function importPluginById(id: string): Promise<ImportResult> {
  let manifests: Array<{ filename: string; content: unknown }>;
  try {
    manifests = await window.api.plugins.listLocal();
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  // 該当 id の manifest を探す
  const found = manifests.find((m) => {
    const c = m.content as Record<string, unknown> | null;
    return c && typeof c.id === 'string' && c.id === id;
  });
  if (!found) {
    return { ok: false, error: 'manifest が見つかりません' };
  }

  const content = found.content as Record<string, unknown>;
  const entry = typeof content.entry === 'string' ? content.entry : null;
  if (!entry) {
    return { ok: false, error: 'manifest.entry が指定されていません' };
  }
  if (!entry.toLowerCase().endsWith('.js')) {
    return {
      ok: false,
      error: `現状 .js のみサポートしています (${entry})`,
    };
  }

  // entry ファイルがローカルに存在するかだけ事前に確認する
  // （内容は読み込まずカスタムプロトコル経由で import するので不要）
  let text: string | null;
  try {
    text = await window.api.plugins.readFile(entry);
  } catch (err) {
    return { ok: false, error: `${entry} の読み込みに失敗: ${String(err)}` };
  }
  if (!text) {
    return { ok: false, error: `${entry} がローカルにありません` };
  }

  // ===== `inknel-plugin://` カスタムプロトコル経由で dynamic import =====
  // Blob URL だと base URL が無いため、entry ファイル内の相対 import
  //   (例: `from './holidays.js'`) が解決できず ES Modules 仕様で失敗する。
  // メインプロセスで登録した `inknel-plugin://<path>` プロトコルが
  // userData の plugins ディレクトリを Web 配信するので、これを base URL に
  // すれば相対 import が同じプロトコル URL に解決され、サブモジュールも
  // 自然にロードされる。
  const url = `inknel-plugin://${entry}`;
  let mod: Partial<PluginModule>;
  try {
    mod = (await import(/* @vite-ignore */ url)) as Partial<PluginModule>;
  } catch (err) {
    return {
      ok: false,
      error: `${entry} の読み込み (import) に失敗: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (
    !mod.manifest ||
    typeof mod.manifest !== 'object' ||
    typeof mod.manifest.id !== 'string'
  ) {
    return { ok: false, error: 'manifest export が不正です' };
  }
  if (mod.manifest.id !== id) {
    return {
      ok: false,
      error: `manifest id が一致しません (expected=${id}, actual=${mod.manifest.id})`,
    };
  }

  const fullManifest: PluginManifest = {
    id: mod.manifest.id,
    label:
      typeof mod.manifest.label === 'string'
        ? mod.manifest.label
        : typeof content.name === 'string'
          ? (content.name as string)
          : mod.manifest.id,
    description:
      typeof mod.manifest.description === 'string'
        ? mod.manifest.description
        : typeof content.description === 'string'
          ? (content.description as string)
          : '',
  };

  // 既存登録があれば置き換え
  runtimePlugins = runtimePlugins.filter((p) => p.id !== id);
  runtimePlugins.push({
    id,
    manifest: fullManifest,
    module: mod as PluginModule,
  });
  notify();
  return { ok: true, id };
}

/** 指定 id を runtime registry から外す */
export function unloadPluginById(id: string): void {
  const before = runtimePlugins.length;
  runtimePlugins = runtimePlugins.filter((p) => p.id !== id);
  if (runtimePlugins.length !== before) notify();
}

/**
 * 起動時の一括ロード。settings.importedPlugins に列挙された ID を順に import する。
 * 個別の失敗はログに残すだけで継続。
 */
export async function loadImportedPlugins(
  importedIds: readonly string[],
): Promise<void> {
  for (const id of importedIds) {
    const result = await importPluginById(id);
    if (!result.ok) {
      console.warn(`[plugins] import failed: ${id}`, result.error);
    }
  }
}
