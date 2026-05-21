/**
 * プラグイン共通の型定義。
 *
 * 各プラグインは `src/plugins/<id>.ts` として配置し、`manifest` を export する。
 * registry はビルド時に `import.meta.glob` でこのフォルダを列挙し、
 * manifest を持つモジュールを自動的にプラグインとして認識する。
 *
 * 重い依存（例: mermaid 本体）は **モジュール先頭で import せず**、
 * `renderInPreview()` 等の関数内で動的 import すること。さもないと
 * registry の列挙だけで全プラグインのコストが乗ってしまう。
 */

export interface PluginManifest {
  /** 一意な ID（設定キー / ファイル名と揃える） */
  id: string;
  /** 設定画面に表示する名前 */
  label: string;
  /** 設定画面に表示する説明文 */
  description: string;
}

export interface PluginRenderContext {
  /** 現在の UI テーマ。テーマ追従するプラグイン用 */
  theme: 'dark' | 'light';
  /**
   * 現在のノート本文を返す (Markdown 全文)。
   * プラグインが本文中のブロックを書き換える用途で参照する。
   * Preview からの利用前提なので毎回最新の値を返すクロージャ。
   */
  getBody?: () => string;
  /**
   * ノート本文を書き換える。引数は新しい Markdown 全文。
   * 例えばマインドマップなど「ビューで編集 → 本文反映」したいプラグインが使う。
   * Preview に onChange が渡っていない時は undefined。
   */
  setBody?: (next: string) => void;
}

export interface PluginFenceArgs {
  /** コードブロックの中身 */
  code: string;
  /** ` ```xxx ` の `xxx` 部分（小文字化前） */
  lang: string;
  /** markdown-it の escape ヘルパ */
  escapeHtml: (s: string) => string;
}

/**
 * プラグインが「設定画面のプラグインリストに表示するインライン設定 UI」を
 * 提供したい場合に実装する React コンポーネントの Props 型。
 * PreferencesModal の他パネルと同じ shape を共有して onChange 互換にする。
 */
export interface PluginSettingsProps {
  settings: import('../settings').AppSettings;
  onChange: <K extends keyof import('../settings').AppSettings>(
    key: K,
    value: import('../settings').AppSettings[K],
  ) => void;
}

/**
 * プラグインがアプリ本体のサイドバーに追加するパネル UI に渡される Props。
 * アプリ本体が「プラグイン非依存」を保つために、必要な情報・操作は
 * すべてこのインタフェースを介してプラグインに渡す。
 */
export interface PluginSidebarPanelProps {
  /** 全ノートメタデータ（既存判定や表示に利用） */
  notes: import('../global').NoteMeta[];
  /** アプリ全体の設定（プラグイン自身の設定スライスを含む可能性あり） */
  settings: import('../settings').AppSettings;
  /** 設定変更コールバック */
  onChange: <K extends keyof import('../settings').AppSettings>(
    key: K,
    value: import('../settings').AppSettings[K],
  ) => void;
  /** 指定ノート ID をエディタで開く */
  onSelectNote: (id: string) => void;
  /**
   * 新規ノートを作成して開く。
   * `tags` を渡すとホスト側で作成直後に `updateMeta` でタグを反映する。
   */
  onCreateNote: (input: {
    title?: string;
    folder?: string;
    body?: string;
    tags?: string[];
  }) => Promise<import('../global').NoteMeta>;
}

/**
 * アクティビティバーへの追加ボタン宣言。
 * `mode` はサイドバーのモード ID と一致させる（一意になるようプラグイン側で命名）。
 */
export interface PluginActivityBarItem {
  /** 一意なサイドバーモード ID (例: 'calendar') */
  mode: string;
  /** ボタンのラベル（tooltip / aria-label） */
  label: string;
  /** SVG アイコンの React コンポーネント */
  Icon: React.ComponentType;
}

/** サイドバーパネル宣言。`mode` を ActivityBarItem と揃える */
export interface PluginSidebarPanelDecl {
  mode: string;
  Component: React.ComponentType<PluginSidebarPanelProps>;
}

export interface PluginModule {
  manifest: PluginManifest;
  /**
   * 特定言語の fenced code block をプラグイン側で HTML 化したい場合に実装。
   * 該当しない言語なら null を返すと既定の fence renderer に委譲される。
   */
  renderFence?(args: PluginFenceArgs): string | null;
  /**
   * プレビュー HTML の DOM への挿入が終わった後に呼ばれる。
   * SVG への置換などをここで行う。
   */
  renderInPreview?(
    root: HTMLElement,
    ctx: PluginRenderContext,
  ): Promise<void> | void;
  /**
   * 再描画前に呼ばれる。テーマ切替や本文変更時に既存の DOM 状態を
   * 戻したい場合に実装。
   */
  resetInPreview?(root: HTMLElement): void;
  /**
   * プラグインが ON のときだけ、設定画面のプラグインリスト内に
   * インラインで描画される設定 UI（任意）。
   * 持たないプラグインではこのエリアが出ない。
   */
  SettingsComponent?: React.ComponentType<PluginSettingsProps>;
  /**
   * アクティビティバーに追加するアイコンボタン（任意）。
   * 指定したプラグインが有効化中のとき、本体のアクティビティバーに
   * 自動的に追加され、クリックでサイドバーが `mode` に切り替わる。
   */
  activityBarItem?: PluginActivityBarItem;
  /**
   * `activityBarItem.mode` と一致するサイドバーモードのパネル本体（任意）。
   * サイドバーの mode が一致したときレンダリングされる。
   */
  sidebarPanel?: PluginSidebarPanelDecl;
}
