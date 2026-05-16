/**
 * 翻訳キーの「形」を表す型。各ロケールファイル (ja.ts / en.ts) は
 * この型に準拠する必要があり、キーの抜け・型の不一致は TypeScript が検出する。
 *
 * 言語を追加する時は:
 *   1. `src/i18n/locales/<code>.ts` を作成
 *   2. この `Locale` 型に準拠した翻訳オブジェクトを export
 *   3. `src/i18n/index.ts` の `LOCALES` マップに追加
 */

export type LanguageCode = 'ja' | 'en';
export type LanguageSetting = 'auto' | LanguageCode;

export interface Locale {
  code: LanguageCode;

  common: {
    save: string;
    cancel: string;
    delete: string;
    rename: string;
    create: string;
    close: string;
    open: string;
    confirm: string;
    retry: string;
    loading: string;
    empty: string;
    untitled: string;
    yes: string;
    no: string;
    enable: string;
    disable: string;
    selectedSuffix: string; // 「選択中」of provider tabs etc.
  };

  app: {
    name: string;
    tagline: string;
  };

  activity: {
    files: string;
    search: string;
    tags: string;
    history: string;
    sync: string;
    syncStorage: string; // 「保存先と同期」
    aiChat: string;
    settings: string;
    barLabel: string; // nav の aria-label
  };

  sidebar: {
    files: string;
    search: string;
    tags: string;
    history: string;
    sync: string;
    newNote: string;
    newFolder: string;
    searchPlaceholder: string;
    noResults: string;
    notes: string;
    storageUnconfigured: string;
    storageUnconfiguredHint: string;
    expandAll: string;
    collapseAll: string;
    historyClear: string;
    emptyNoNotes: string;
    moreActions: string; // 「その他の操作」(ケバブボタンのツールチップ)
    secretIndicator: string; // ファイル行のシークレットアイコンの label
    protectedIndicator: string; // 「保護中」
    menu: {
      fileRename: string; // 「名称変更」
      fileProtect: string; // 「保護」
      fileUnprotect: string; // 「保護解除」
      fileMakeSecret: string; // 「シークレットにする」
      fileUnsecret: string; // 「シークレット解除」
      fileDelete: string; // 「削除」
      folderCreateNote: string; // 「ノートの作成」
      folderRename: string; // 「名称変更」
      folderDeleteRecursive: string; // 「ディレクトリごと削除」
    };
    confirmDeleteFile: string; // 「『{{title}}』を削除しますか？」
  };

  /** 検索サイドバー */
  searchPanel: {
    placeholder: string;
    searchBtn: string;
    prompt: string; // 「キーワードを入力して検索ボタンを押してください。」
    historyHint: string; // 「↑ / ↓ で過去のキーワードを呼び出せます。」
    noResults: string;
    resultsCount: string; // 「{{count}} 件」 / 「{{count}} results」
    protectedLabel: string;
    secretLabel: string;
  };

  /** 保存先同期サイドバー */
  syncPanel: {
    hero: {
      storageLabel: string;
      scanning: string;
      synced: string;
      diffCount: string; // 「{{count}} 件の差分」
      lastSyncPrefix: string;
      lastSyncNever: string;
    };
    stat: {
      dbNotes: string;
      mdFiles: string;
      diff: string;
    };
    action: {
      syncBtn: string;
      syncing: string;
      scanBtn: string;
      scanTitle: string;
      scanAriaLabel: string;
    };
    targets: {
      writeOut: string; // 「DB → ファイル へ書き出し」
      importIn: string; // 「ファイル → DB へ取り込み」
      badgeNewer: string; // 「更新」
      badgeMissing: string; // 「新規」
    };
    help: {
      paragraph: string; // 長文の説明（フッタ）
    };
    error: {
      scanFailed: string;
      syncFailed: string;
    };
    okMessage: string; // 「書き出し {{saved}} 件 / 取り込み {{imported}} 件」
  };

  /** 画面下のステータスバー */
  footer: {
    chars: string; // 「{{count}} 文字」 / 「{{count}} chars」
    words: string; // 「{{count}} 語」 / 「{{count}} words」
  };

  tabBar: {
    close: string;
    closeAll: string;
    closeOthers: string;
    closeThis: string;
    closeToRight: string;
  };

  tagBar: {
    placeholder: string;
    remove: string;
    ariaLabel: string;
  };

  noteHeader: {
    preview: string;
    livePreview: string;
    edit: string;
    livePreviewTitle: string;
    menu: string;
    filenamePlaceholder: string;
    kebabExportPdf: string;
    kebabExportMarkdown: string;
    kebabPrint: string;
  };

  /** TabBar の「AIでノートを整形・要約」ボタンから開くメニュー */
  aiTransformMenu: {
    header: string; // 「ノートを整形」(disabled ヘッダ)
    summarizeByHeading: string; // 「見出し単位で要約」
    generateTitleFromContent: string; // 「ノートの内容からタイトル作成」
    organizeBullets: string; // 「箇条書きを整理」
    improveCodeBlocks: string; // 「コードブロックだけ改善」
    formatTables: string; // 「表だけ整形」
    convertHtmlToMarkdown: string; // 「構造を保持してMarkdownに変換」
    convertToSchedule: string; // 「メモをスケジュールに変換」
    convertToChecklist: string; // 「メモをチェックリストに変換」
    undoLast: string; // 「直前のAI整形を取り消す」(直前整形がある時だけ先頭に出る)
  };

  aiChat: {
    modeChat: string; // 「チャットモード」
    modeEdit: string; // 「編集モード」
    modeChatHint: string; // チャットモード時の hint 表示
    modeEditHint: string; // 編集モード時の hint 表示
    title: string;
    placeholder: string;
    send: string;
    sending: string;
    stop: string;
    stopTitle: string;
    hint: string;
    waitingResponse: string;
    emptyState: string;
    tokenNotSet: string;
    notLoaded: string;
    saveAsNote: string;
    savingNote: string;
    saveAsNoteTitle: string;
    saveAsNoteAria: string;
    clearChat: string;
    clearChatTitle: string;
    closeAria: string;
    closeTitle: string;
  };

  settings: {
    title: string;
    categories: {
      general: string;
      ai: string;
      codeBlock: string;
      template: string;
      protection: string;
      storage: string;
      plugins: string;
      backup: string;
      restore: string;
      reset: string;
    };
    general: {
      theme: string;
      themeDesc: string;
      themeDark: string;
      themeLight: string;
      language: string;
      languageDesc: string;
      languageAuto: string;
      fontFamily: string;
      fontFamilyDesc: string;
      fontSize: string;
      fontSizeDesc: string;
      sidebarFontFamily: string;
      sidebarFontFamilyDesc: string;
      sidebarFontSize: string;
      sidebarFontSizeDesc: string;
      dateFormat: string;
      dateFormatDesc: string;
      showInsertButtons: string;
      showInsertButtonsDesc: string;
      editorMinimap: string;
      editorMinimapDesc: string;
      historyMode: string;
      historyModeDesc: string;
      historyModeReset: string;
      historyModePersist: string;
      historyLimit: string;
      historyLimitDesc: string;
      historyLimitItem: string; // 「100 件」「1000 件」の単位
      historyModeOptionReset: string; // 「アプリ再起動でリセット」
      historyModeOptionPersist: string; // 「アプリ再起動後も保持」
      openHistory: string;
      openHistoryDesc: string;
      openHistoryAria: string;
      openHistoryLimit: string;
      openHistoryLimitDesc: string;
      fontSizeSuffix: string; // 「px」
    };
    ai: {
      provider: string;
      connection: string;
      connectionStatusSet: string;
      connectionStatusUnset: string;
      apiToken: string;
      apiTokenPlaceholder: string;
      apiTokenDesc: string;
      tokenShow: string;
      tokenHide: string;
      endpoint: string;
      endpointPlaceholder: string;
      endpointDesc: string;
      modelSection: string;
      model: string;
      modelChatgptDesc: string;
      modelDefaultDesc: string;
      modelPlaceholder: string;
      tokenSet: string; // chip on provider tab
      basePromptSection: string;
      basePromptLabel: string;
      basePromptPlaceholder: string;
      basePromptDesc: string;
    };
    codeBlock: {
      displayOptions: string;
      copyAlwaysVisible: string;
      copyAlwaysVisibleDesc: string;
      showLineNumbers: string;
      showLineNumbersDesc: string;
      syntaxHighlight: string;
      enableAll: string;
      disableAll: string;
      langSearchPlaceholder: string;
      langSearchEmpty: string;
    };
    template: {
      folder: string;
      label: string;
      desc: string;
      savedFlash: string;
    };
    protection: {
      defaultBannerTitle: string;
      defaultBannerDesc: string;
      okBannerTitle: string;
      okBannerDesc: string;
      changePassword: string;
      currentPassword: string;
      currentPasswordHint: string;
      newPassword: string;
      newPasswordHint: string;
      update: string;
      errorWrongCurrent: string;
      errorInvalidFormat: string;
      errorSameAsCurrent: string;
      okUpdated: string;
    };
    storage: {
      sectionFolder: string;
      pillCustom: string;
      pillDefault: string;
      cardTitle: string;
      cardDesc: string;
      pathConfigured: string;
      pathResolved: string;
      defaultUserdata: string;
      pathFetching: string;
      chooseFolder: string;
      resetDefault: string;
      hintNoAutoMove: string;
      sectionData: string;
      overwriteTitle: string;
      overwriteDesc: string;
      overwriteBtn: string;
      okFolderChanged: string;
      okResetDefault: string;
      okOverwriteDone: string;
      errOverwriteFailed: string;
      errChooseFailed: string;
      confirmOverwrite: string;
    };
    plugins: {
      sectionInstalled: string;
      sectionStore: string;
      catalogDesc: string;
      fetch: string;
      fetching: string;
      reload: string;
      emptyInstalled: string;
      pendingBadge: string;
      sourceBundled: string;
      sourceDownloaded: string;
      delete: string;
      deleteConfirm: string;
      deleteOk: string;
      deleteFailed: string;
      importBtn: string;
      imported: string;
      importFailed: string;
      catalogNotFound: string;
      noPluginsAvailable: string;
      downloading: string;
      download: string;
      reDownload: string;
      filesProgress: string; // "N/M ファイル取得済み"
      installSaving: string;
      installSaved: string;
      installPartial: string;
      installFailedIpc: string;
    };
    backup: {
      title: string;
      cardTitle: string;
      cardDesc: string;
      step1: string;
      step2: string;
      step3: string;
      createBtn: string;
      syncing: string;
      zipping: string;
      working: string;
      okSaved: string;
      cancelled: string;
      failed: string;
    };
    restore: {
      title: string;
      warn: string;
      cardTitle: string;
      cardDesc: string;
      step1: string;
      step2: string;
      step3: string;
      restoreBtn: string;
      extracting: string;
      rebuilding: string;
      working: string;
      confirm: string;
      okDone: string;
      failed: string;
    };
    reset: {
      title: string;
      bannerTitle: string;
      bannerDesc: string;
      willBeDeleted: string;
      willRemain: string;
      delDbNotes: string;
      delFolders: string;
      delAppSettings: string;
      delTabState: string;
      keepMdFiles: string;
      keepMedia: string;
      keepOtherDevices: string;
      keepPlugins: string;
      confirmHeading: string;
      confirmInstructions: string;
      confirmInputWord: string;
      confirmHint: string;
      executeBtn: string;
      executingBtn: string;
      confirmDialog: string;
      failed: string;
    };
  };
}
