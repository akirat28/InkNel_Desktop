/**
 * i18n エントリポイント。
 *
 * 使い方:
 *   1. App.tsx で `<LocaleProvider language={settings.language}>...</LocaleProvider>` で全体を包む
 *   2. コンポーネント内で `const t = useT();` → `t.settings.title` のように参照
 *
 * 言語追加手順:
 *   - `locales/<code>.ts` を作成して Locale を export
 *   - 下の LOCALES マップに登録
 *   - types.ts の LanguageCode に追加
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import en from './locales/en';
import ja from './locales/ja';
import type { LanguageCode, LanguageSetting, Locale } from './types';

export type { LanguageCode, LanguageSetting, Locale } from './types';

/** 利用可能なロケール一覧。新言語追加時はここに登録 */
export const LOCALES: Record<LanguageCode, Locale> = {
  ja,
  en,
};

/** デフォルト言語: 対応外 OS 言語の fallback 先 */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** ロケール選択肢（設定 UI 用） */
export const LANGUAGE_OPTIONS: Array<{
  value: LanguageSetting;
  /** ロケール内蔵のラベル（リテラル）— 設定 UI で表示 */
  nativeLabel: string;
}> = [
  { value: 'auto', nativeLabel: 'System default / システムに合わせる' },
  { value: 'ja', nativeLabel: '日本語' },
  { value: 'en', nativeLabel: 'English' },
];

/**
 * navigator.language ( 例: 'ja-JP', 'en-US' ) から
 * 対応言語コードを取り出す。未対応なら DEFAULT_LANGUAGE。
 */
export function detectOsLanguage(): LanguageCode {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  const tags: string[] = [];
  if (Array.isArray(navigator.languages)) {
    for (const t of navigator.languages) if (typeof t === 'string') tags.push(t);
  }
  if (typeof navigator.language === 'string') tags.push(navigator.language);
  for (const tag of tags) {
    const prefix = tag.toLowerCase().split('-')[0];
    if (prefix === 'ja') return 'ja';
    if (prefix === 'en') return 'en';
  }
  return DEFAULT_LANGUAGE;
}

/** LanguageSetting を実ロケールに解決 */
export function resolveLocale(setting: LanguageSetting): Locale {
  const code = setting === 'auto' ? detectOsLanguage() : setting;
  return LOCALES[code] ?? LOCALES[DEFAULT_LANGUAGE];
}

// ----- React Context -----

const LocaleContext = createContext<Locale>(LOCALES[DEFAULT_LANGUAGE]);

interface LocaleProviderProps {
  language: LanguageSetting;
  children: ReactNode;
}

/** ルートで設定の language を受けてロケールを解決し Context に流す */
export function LocaleProvider({
  language,
  children,
}: LocaleProviderProps): ReactNode {
  const value = useMemo(() => resolveLocale(language), [language]);
  return createElement(LocaleContext.Provider, { value }, children);
}

/** コンポーネントで `const t = useT(); t.settings.title` のように使う */
export function useT(): Locale {
  return useContext(LocaleContext);
}
