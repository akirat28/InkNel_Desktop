import { contextBridge, ipcRenderer } from 'electron';
import type { NoteMeta } from './db/notes';

export type { NoteMeta };

contextBridge.exposeInMainWorld('api', {
  /** メインプロセスの「設定」メニュー押下を購読する。返り値は購読解除関数。 */
  onOpenPreferences(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:open-preferences', handler);
    return () => ipcRenderer.removeListener('menu:open-preferences', handler);
  },

  openPreferencesWindow(): Promise<void> {
    return ipcRenderer.invoke('preferences:open-window');
  },

  closeCurrentWindow(): Promise<void> {
    return ipcRenderer.invoke('window:close-current');
  },

  onSettingsChanged(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },

  /** メインプロセスの「印刷」メニュー押下を購読する。返り値は購読解除関数。 */
  onPrint(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:print', handler);
    return () => ipcRenderer.removeListener('menu:print', handler);
  },

  /** メインプロセスの「メモの作成」メニュー押下を購読する */
  onCreateNote(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:create-note', handler);
    return () => ipcRenderer.removeListener('menu:create-note', handler);
  },

  /** メインプロセスの「検索」メニュー押下を購読する */
  onFind(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:find', handler);
    return () => ipcRenderer.removeListener('menu:find', handler);
  },

  /** メインプロセスの「置換」メニュー押下を購読する */
  onReplace(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:replace', handler);
    return () => ipcRenderer.removeListener('menu:replace', handler);
  },

  /** メインプロセスの「ファイルの読み込み」メニュー押下を購読する */
  onImportMd(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:import-md', handler);
    return () => ipcRenderer.removeListener('menu:import-md', handler);
  },

  /** メインプロセスの「ディレクトリの読み込み」メニュー押下を購読する */
  onImportDir(callback: () => void): () => void {
    const handler = () => callback();
    ipcRenderer.on('menu:import-dir', handler);
    return () => ipcRenderer.removeListener('menu:import-dir', handler);
  },

  notes: {
    list(): Promise<NoteMeta[]> {
      return ipcRenderer.invoke('notes:list');
    },
    create(input: {
      title?: string;
      folder?: string;
      body?: string;
    }): Promise<NoteMeta> {
      return ipcRenderer.invoke('notes:create', input);
    },
    readBody(id: string): Promise<string> {
      return ipcRenderer.invoke('notes:read-body', id);
    },
    updateMeta(
      id: string,
      patch: { title?: string; folder?: string; tags?: string[] },
    ): Promise<NoteMeta> {
      return ipcRenderer.invoke('notes:update-meta', id, patch);
    },
    updateBody(id: string, body: string): Promise<void> {
      return ipcRenderer.invoke('notes:update-body', id, body);
    },
    setProtected(id: string, isProtected: boolean): Promise<NoteMeta> {
      return ipcRenderer.invoke('notes:set-protected', id, isProtected);
    },
    setSecret(id: string, isSecret: boolean): Promise<NoteMeta> {
      return ipcRenderer.invoke('notes:set-secret', id, isSecret);
    },
    addLink(id: string, linkedNoteId: string): Promise<NoteMeta> {
      return ipcRenderer.invoke('notes:add-link', id, linkedNoteId);
    },
    removeLink(id: string, linkedNoteId: string): Promise<NoteMeta> {
      return ipcRenderer.invoke('notes:remove-link', id, linkedNoteId);
    },
    search(query: string): Promise<NoteMeta[]> {
      return ipcRenderer.invoke('notes:search', query);
    },
    listTags(): Promise<Array<{ tag: string; notes: NoteMeta[] }>> {
      return ipcRenderer.invoke('notes:list-tags');
    },
    /** ダイアログで選んだ .md ファイルの中身を読み込んで返す */
    importMd(): Promise<Array<{ name: string; body: string }>> {
      return ipcRenderer.invoke('notes:import-md');
    },
    /** ダイアログで選んだディレクトリ配下の .md を再帰的に読み込んで返す */
    importDir(): Promise<
      Array<{ name: string; body: string; subFolder: string }>
    > {
      return ipcRenderer.invoke('notes:import-dir');
    },
    delete(id: string): Promise<void> {
      return ipcRenderer.invoke('notes:delete', id);
    },
  },

  folders: {
    list(): Promise<string[]> {
      return ipcRenderer.invoke('folders:list');
    },
    create(path: string): Promise<void> {
      return ipcRenderer.invoke('folders:create', path);
    },
    delete(path: string): Promise<void> {
      return ipcRenderer.invoke('folders:delete', path);
    },
    deleteRecursive(path: string): Promise<{ deletedCount: number }> {
      return ipcRenderer.invoke('folders:delete-recursive', path);
    },
    rename(oldPath: string, newPath: string): Promise<void> {
      return ipcRenderer.invoke('folders:rename', oldPath, newPath);
    },
  },

  settings: {
    getAll(): Promise<Record<string, string>> {
      return ipcRenderer.invoke('settings:getAll');
    },
    set(key: string, value: string): Promise<void> {
      return ipcRenderer.invoke('settings:set', key, value);
    },
  },

  images: {
    save(data: ArrayBuffer, ext: string): Promise<string> {
      return ipcRenderer.invoke('images:save', data, ext);
    },
    exists(filename: string): Promise<boolean> {
      return ipcRenderer.invoke('images:exists', filename);
    },
  },

  attachments: {
    save(data: ArrayBuffer, ext: string): Promise<string> {
      return ipcRenderer.invoke('attachments:save', data, ext);
    },
    exists(filename: string): Promise<boolean> {
      return ipcRenderer.invoke('attachments:exists', filename);
    },
    open(filename: string): Promise<void> {
      return ipcRenderer.invoke('attachments:open', filename);
    },
  },

  shell: {
    openExternal(url: string): Promise<void> {
      return ipcRenderer.invoke('shell:open-external', url);
    },
  },

  files: {
    /** 現在のノート本文を Markdown としてエクスポート */
    exportMarkdown(defaultName: string, body: string): Promise<boolean> {
      return ipcRenderer.invoke('files:export-markdown', defaultName, body);
    },
    /** 現在のウィンドウ描画を PDF としてエクスポート */
    exportPdf(defaultName: string): Promise<boolean> {
      return ipcRenderer.invoke('files:export-pdf', defaultName);
    },
  },

  app: {
    /**
     * アプリの完全初期化（DB / 保存先のファイル全削除 + 再起動）。
     * 破壊的なので呼び出し元で必ず確認を取ること。
     */
    resetAll(): Promise<void> {
      return ipcRenderer.invoke('app:reset-all');
    },
  },

  backup: {
    /** 保存先フォルダを ZIP 化してユーザー選択の場所に保存 */
    create(): Promise<{ savedPath: string; fileCount: number } | null> {
      return ipcRenderer.invoke('backup:create');
    },
    /** ZIP を選択してリストア。既存ファイル群は上書きされる */
    restore(): Promise<{ restoredPath: string; fileCount: number } | null> {
      return ipcRenderer.invoke('backup:restore');
    },
  },

  storage: {
    /** 現在ファイルが保存されている実際のルートパスを返す */
    getRoot(): Promise<string> {
      return ipcRenderer.invoke('storage:get-root');
    },
    /** 保存先フォルダ選択ダイアログを開く。選択されたパス、または null */
    chooseFolder(): Promise<string | null> {
      return ipcRenderer.invoke('storage:choose-folder');
    },
    /** 保存先と DB の差分をスキャンして返す（タイムスタンプベース） */
    scan(): Promise<{
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
    }> {
      return ipcRenderer.invoke('storage:scan');
    },
    /** DB ↔ disk の双方向同期を実行し、件数を返す */
    sync(): Promise<{ saved: number; imported: number }> {
      return ipcRenderer.invoke('storage:sync');
    },
    /** DB の全ノートを保存先フォルダに強制上書き */
    overwriteAll(): Promise<{ written: number; failed: number }> {
      return ipcRenderer.invoke('storage:overwrite-all');
    },
    /**
     * 保存先の .md ファイルから DB を完全再構築する。
     * 既存の notes / folders テーブルを破棄してから取り込む。
     * リストア後に呼ぶことを想定。
     */
    rebuildFromMd(): Promise<{ imported: number }> {
      return ipcRenderer.invoke('storage:rebuild-from-md');
    },
  },

  ui: {
    /**
     * 任意のコンテキストメニューを OS ネイティブで表示する。
     * `items` の click された項目の id を返す。キャンセル時は null。
     */
    showContextMenu(opts: {
      position?: { x: number; y: number };
      items: Array<{
        id?: string;
        label?: string;
        enabled?: boolean;
        separator?: boolean;
      }>;
    }): Promise<string | null> {
      return ipcRenderer.invoke('ui:show-context-menu', opts);
    },
    /**
     * NoteHeader のケバブボタンから OS ネイティブのメニューを表示する。
     * ネイティブなのでウィンドウ外にもはみ出せる。
     */
    showNoteMenu(position: {
      x: number;
      y: number;
      labels?: {
        exportPdf?: string;
        exportMarkdown?: string;
        print?: string;
      };
    }): Promise<void> {
      return ipcRenderer.invoke('ui:show-note-menu', position);
    },
    /** メニュー「PDF で出力」が選ばれたら呼ばれる購読 API */
    onExportPdf(callback: () => void): () => void {
      const handler = () => callback();
      ipcRenderer.on('menu:export-pdf', handler);
      return () => ipcRenderer.removeListener('menu:export-pdf', handler);
    },
    /** メニュー「Markdown で出力」が選ばれたら呼ばれる購読 API */
    onExportMarkdown(callback: () => void): () => void {
      const handler = () => callback();
      ipcRenderer.on('menu:export-markdown', handler);
      return () =>
        ipcRenderer.removeListener('menu:export-markdown', handler);
    },
  },

  media: {
    /** 候補のうち、どのノートからも参照されていないファイルを削除 */
    gc(candidates: {
      images: string[];
      attachments: string[];
    }): Promise<{ deletedImages: string[]; deletedAttachments: string[] }> {
      return ipcRenderer.invoke('media:gc', candidates);
    },
  },

  template: {
    /** folder='template' のノート一覧を返す */
    list(): Promise<Array<{ name: string; noteId: string }>> {
      return ipcRenderer.invoke('template:list');
    },
    /**
     * 指定ノートの本文 + タグを返す（テンプレートとして挿入用）。
     * タグはテンプレート採用時に現在ノートのタグへマージされる。
     */
    read(noteId: string): Promise<{ body: string; tags: string[] }> {
      return ipcRenderer.invoke('template:read', noteId);
    },
  },

  ai: {
    transform(input: {
      provider: 'general' | 'chatgpt' | 'claudeCode' | 'copilot' | 'gemini';
      token: string;
      endpoint: string;
      model: string;
      action:
        | 'summarizeByHeading'
        | 'organizeBullets'
        | 'improveCodeBlocks'
        | 'formatTables'
        | 'convertHtmlToMarkdown'
        | 'convertToSchedule';
      content: string;
    }): Promise<string> {
      return ipcRenderer.invoke('ai:transform', input);
    },
    chat(
      input: {
        provider: 'general' | 'chatgpt' | 'claudeCode' | 'copilot' | 'gemini';
        token: string;
        endpoint: string;
        model: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        basePrompt?: string;
        noteContext?: {
          title: string;
          body: string;
          relatedNotes?: Array<{
            title: string;
            body: string;
          }>;
        };
        attachments?: Array<{
          kind: 'image';
          name: string;
          mimeType: string;
          dataUrl: string;
        }>;
        allowNoteActions?: boolean;
      },
      requestId?: string,
    ): Promise<string> {
      return ipcRenderer.invoke('ai:chat', input, requestId);
    },
    /** 進行中の chat() を中断する。requestId は chat() 呼び出し時と同じ値を渡す */
    abort(requestId: string): Promise<boolean> {
      return ipcRenderer.invoke('ai:abort', requestId);
    },
    /**
     * チャットの逐次レスポンス（ストリーミング）を購読する。
     * 戻り値は購読解除関数。requestId 単位で必要に応じてフィルタすること。
     */
    onChatChunk(
      callback: (payload: { requestId: string; delta: string }) => void,
    ): () => void {
      const handler = (
        _e: unknown,
        payload: { requestId: string; delta: string },
      ) => callback(payload);
      ipcRenderer.on('ai:chat-chunk', handler);
      return () => ipcRenderer.removeListener('ai:chat-chunk', handler);
    },
  },

  web: {
    /**
     * 任意の http(s) URL を取得して本文プレーンテキストに変換する。
     * AI チャットでユーザー入力に URL が含まれていた場合、送信前にこれで
     * 内容を取得し、AI に「実際の本文」として渡すために使う。
     */
    fetchUrl(
      url: string,
    ): Promise<
      | { ok: true; url: string; title: string; content: string }
      | { ok: false; url: string; error: string }
    > {
      return ipcRenderer.invoke('web:fetch-url', url);
    },
  },

  share: {
    /** iCloud / Dropbox / Google Drive の利用可否を返す */
    detectProviders(): Promise<
      Array<{
        id: 'icloud' | 'dropbox' | 'gdrive';
        label: string;
        path: string | null;
        available: boolean;
      }>
    > {
      return ipcRenderer.invoke('share:detect-providers');
    },
    /** 指定プロバイダの現在の同期状態を返す */
    getStatus(
      provider: 'none' | 'icloud' | 'dropbox' | 'gdrive',
    ): Promise<{
      provider: 'none' | 'icloud' | 'dropbox' | 'gdrive';
      available: boolean;
      path: string | null;
      lastSync: number;
      cloudNoteCount: number;
    }> {
      return ipcRenderer.invoke('share:get-status', provider);
    },
    /**
     * 指定ノートについて PC とクラウドのタイムスタンプを比較し双方向同期。
     * 戻り値: 'pulled' | 'pushed' | 'same' | 'skip'
     */
    checkNote(
      provider: 'none' | 'icloud' | 'dropbox' | 'gdrive',
      noteId: string,
    ): Promise<'pulled' | 'pushed' | 'same' | 'skip'> {
      return ipcRenderer.invoke('share:check-note', provider, noteId);
    },
    /** クラウドと双方向同期を実行。成功時に結果を返す */
    sync(
      provider: 'none' | 'icloud' | 'dropbox' | 'gdrive',
    ): Promise<{
      pushed: number;
      pulled: number;
      unchanged: number;
      total: number;
      lastSync: number;
    }> {
      return ipcRenderer.invoke('share:sync', provider);
    },
    /** 同期中の進捗イベントを購読。返り値は購読解除関数 */
    onProgress(callback: (ev: unknown) => void): () => void {
      const handler = (_: unknown, ev: unknown) => callback(ev);
      ipcRenderer.on('share:progress', handler);
      return () => ipcRenderer.removeListener('share:progress', handler);
    },
  },

  plugins: {
    /** ローカルプラグイン格納ディレクトリの絶対パス */
    getDir(): Promise<string> {
      return ipcRenderer.invoke('plugins:get-dir');
    },
    /** OS のファイルマネージャでプラグインフォルダを開く */
    openDir(): Promise<void> {
      return ipcRenderer.invoke('plugins:open-dir');
    },
    /** ダウンロード済み manifest 一覧 */
    listLocal(): Promise<Array<{ filename: string; content: unknown }>> {
      return ipcRenderer.invoke('plugins:list-local');
    },
    /** plugins ディレクトリの全ファイル名（DL 状態判定用） */
    listLocalFiles(): Promise<string[]> {
      return ipcRenderer.invoke('plugins:list-local-files');
    },
    /** プラグイン本体ファイル(.js 等)の中身をテキストで返す */
    readFile(filename: string): Promise<string | null> {
      return ipcRenderer.invoke('plugins:read-file', filename);
    },
    /** リモートカタログを取得。失敗時は null（UI 側で「見つかりません」表示） */
    fetchCatalog(url: string): Promise<{
      baseUrl: string;
      plugins: Array<{ id: string; manifest: string }>;
    } | null> {
      return ipcRenderer.invoke('plugins:fetch-catalog', url);
    },
    /** 個別 manifest を取得（baseUrl + filename） */
    fetchManifest(
      baseUrl: string,
      filename: string,
    ): Promise<{ filename: string; content: unknown } | null> {
      return ipcRenderer.invoke('plugins:fetch-manifest', baseUrl, filename);
    },
    /**
     * 【開発モード専用】`plugin-dev/plugins/` 配下のカタログを
     * ファイルシステムから直接読んで、各プラグインの manifest 込みで返す。
     * production パッケージでは null を返す。
     */
    fetchDevCatalog(): Promise<{
      baseUrl: string;
      rows: Array<{
        id: string;
        filename: string;
        manifest: unknown | null;
      }>;
    } | null> {
      return ipcRenderer.invoke('plugins:fetch-dev-catalog');
    },
    /**
     * manifest + manifest.files で列挙された付属ファイルを一括 DL して保存。
     * baseUrl は fetch-catalog の戻り値の baseUrl をそのまま渡す。
     */
    install(args: {
      filename: string;
      content: unknown;
      baseUrl: string;
    }): Promise<{
      savedFiles: string[];
      missingFiles: string[];
    } | null> {
      return ipcRenderer.invoke('plugins:install', args);
    },
    /**
     * 指定 manifest をアンインストール（manifest + 付属ファイルを削除）。
     */
    uninstall(filename: string): Promise<{
      removed: string[];
      failed: string[];
    }> {
      return ipcRenderer.invoke('plugins:uninstall', filename);
    },
    /**
     * バンドル版プラグインのソースを `plugin-dev/plugins/<sourceDir>/` から
     * `src/plugins/<id>/` へ展開する（dev モード時のみ）。
     * production パッケージでは `skipped: true` が返る。
     */
    materializeSource(args: {
      id: string;
      sourceDir: string;
    }): Promise<{
      ok: boolean;
      skipped?: boolean;
      copied?: string[];
      error?: string;
    }> {
      return ipcRenderer.invoke('plugins:materialize-source', args);
    },
    /**
     * `src/plugins/<id>/` を丸ごと削除する（dev モード時のみ）。
     * production パッケージでは `skipped: true`。
     */
    dematerializeSource(args: {
      id: string;
    }): Promise<{
      ok: boolean;
      skipped?: boolean;
      error?: string;
    }> {
      return ipcRenderer.invoke('plugins:dematerialize-source', args);
    },
  },
});
