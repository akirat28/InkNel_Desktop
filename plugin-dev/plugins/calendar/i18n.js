/**
 * カレンダープラグイン専用の i18n テーブル（配布版）。
 * src/plugins/calendar/i18n.ts と等価。
 */

export const CALENDAR_I18N = {
  ja: {
    prevMonth: '前の月',
    nextMonth: '次の月',
    today: '今月',
    todayTooltip: '今月へ戻る',
    weekdays: ['日', '月', '火', '水', '木', '金', '土'],
    holidayPrefix: '祝',
    eventPrefix: 'イベント',
    tooltipOpenExisting: '{{date}}{{info}} のノートを開く（既存）',
    tooltipCreate: '{{date}}{{info}} のノートを作成',
    hasNoteLabel: 'ノートあり',
    confirmCreateText: '{{date}}{{info}} のノートを作成しますか？',
    cancel: 'キャンセル',
  },
  en: {
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    todayTooltip: 'Jump to this month',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    holidayPrefix: 'Holiday',
    eventPrefix: 'Event',
    tooltipOpenExisting: 'Open note for {{date}}{{info}} (existing)',
    tooltipCreate: 'Create note for {{date}}{{info}}',
    hasNoteLabel: 'Has note',
    confirmCreateText: 'Create a note for {{date}}{{info}}?',
    cancel: 'Cancel',
  },
};

export function getCalendarStrings(langCode) {
  return CALENDAR_I18N[langCode] ?? CALENDAR_I18N.en;
}
