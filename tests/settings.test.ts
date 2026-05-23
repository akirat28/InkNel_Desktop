import { describe, test, expect } from 'vitest';
import {
  parseSettings,
  settingToRecord,
  DEFAULT_SETTINGS,
  isValidProtectionPassword,
  type AppSettings,
} from '../src/settings';

describe('parseSettings', () => {
  test('空レコードからはすべて既定値を返す', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  test('既知の値を正しくパースする', () => {
    const parsed = parseSettings({
      'appearance.theme': 'light',
      'appearance.fontFamily': 'serif',
      'appearance.fontSize': '18',
      'editor.showInsertButtons': 'false',
      'protection.password': '9999',
      'search.historyLimit': '1000',
      'ui.sidebarWidth': '300',
      'share.provider': 'icloud',
      'template.folder': 'my-template',
    });
    expect(parsed.theme).toBe('light');
    expect(parsed.fontFamily).toBe('serif');
    expect(parsed.fontSize).toBe(18);
    expect(parsed.showInsertButtons).toBe(false);
    expect(parsed.protectionPassword).toBe('9999');
    expect(parsed.searchHistoryLimit).toBe(1000);
    expect(parsed.sidebarWidth).toBe(320);
    expect(parsed.shareProvider).toBe('icloud');
    expect(parsed.templateFolder).toBe('my-template');
  });

  test('不正な値は既定値にフォールバック', () => {
    const parsed = parseSettings({
      'appearance.theme': 'rainbow',
      'appearance.fontSize': '999',
      'protection.password': 'abcd',
      'share.provider': 'aws',
      'ui.sidebarWidth': 'not a number',
    });
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(parsed.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(parsed.protectionPassword).toBe(DEFAULT_SETTINGS.protectionPassword);
    expect(parsed.shareProvider).toBe(DEFAULT_SETTINGS.shareProvider);
    expect(parsed.sidebarWidth).toBe(DEFAULT_SETTINGS.sidebarWidth);
  });

  test('sidebarWidth は min/max にクランプされる', () => {
    expect(parseSettings({ 'ui.sidebarWidth': '10' }).sidebarWidth).toBe(320);
    expect(parseSettings({ 'ui.sidebarWidth': '9999' }).sidebarWidth).toBe(480);
  });
});

describe('settingToRecord', () => {
  test('既定値はすべてラウンドトリップで復元できる', () => {
    const raw: Record<string, string> = {};
    const keys = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];
    for (const k of keys) {
      const { key, value } = settingToRecord(k, DEFAULT_SETTINGS[k]);
      raw[key] = value;
    }
    expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  test('未知のキーは例外を投げる', () => {
    expect(() =>
      // @ts-expect-error 意図的に不正なキー
      settingToRecord('unknown', 'x'),
    ).toThrow();
  });
});

describe('isValidProtectionPassword', () => {
  test.each([
    ['1234', true],
    ['0000', true],
    ['9999', true],
    ['12', false],
    ['12345', false],
    ['abcd', false],
    ['', false],
    ['1a2b', false],
  ])('"%s" → %s', (input, expected) => {
    expect(isValidProtectionPassword(input)).toBe(expected);
  });
});
