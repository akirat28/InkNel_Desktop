/**
 * カレンダー組み込み機能の i18n。
 * 旧 plugin-dev/plugins/calendar/i18n.js を TypeScript 化したもの。
 */

export interface CalendarStrings {
  prevMonth: string;
  nextMonth: string;
  today: string;
  todayTooltip: string;
  weekdays: readonly [string, string, string, string, string, string, string];
  holidayPrefix: string;
  eventPrefix: string;
  tooltipOpenExisting: string;
  tooltipCreate: string;
  hasNoteLabel: string;
  confirmCreateText: string;
  cancel: string;
}

export const CALENDAR_I18N: Record<string, CalendarStrings> = {
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

export function getCalendarStrings(langCode: string): CalendarStrings {
  return CALENDAR_I18N[langCode] ?? CALENDAR_I18N.en;
}
