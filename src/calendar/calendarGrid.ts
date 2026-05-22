/**
 * カレンダーグリッドのデータ層構築。
 * 旧 plugin-dev/plugins/calendar/calendarGrid.js を TS 化。
 */

import { generateJapaneseHolidays } from './holidays';
import { generateSpecialEvents } from './calendarEvents';
import { computeNotePathForDate } from './dateClickHandler';

export interface CalendarCell {
  day: number | null;
  ymd: string | null;
  date: Date | null;
  hasNote: boolean;
  holidayName: string | null;
  eventName: string | null;
  isToday: boolean;
  weekday: number;
}

export interface NoteLite {
  folder: string;
  title: string;
}

export interface BuildCalendarGridParams {
  year: number;
  month: number; // 0..11
  notes: NoteLite[];
  baseFolder: string;
  titleFormat: string;
  todayRef?: Date;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

export function buildCalendarGrid(
  params: BuildCalendarGridParams,
): CalendarCell[] {
  const { year, month, notes, baseFolder, titleFormat } = params;
  const todayRef = params.todayRef ?? new Date();

  const noteKeySet = new Set<string>();
  for (const n of notes) noteKeySet.add(`${n.folder}|${n.title}`);

  const holidayMap = new Map<string, string>();
  for (const h of generateJapaneseHolidays(year)) holidayMap.set(h.date, h.name);
  const eventMap = new Map<string, string>();
  for (const e of generateSpecialEvents(year)) eventMap.set(e.date, e.name);

  const todayYmd = formatYmd(
    todayRef.getFullYear(),
    todayRef.getMonth(),
    todayRef.getDate(),
  );

  const start = new Date(year, month, 1).getDay();
  const len = new Date(year, month + 1, 0).getDate();

  const cells: CalendarCell[] = [];
  const empty = (): CalendarCell => ({
    day: null,
    ymd: null,
    date: null,
    hasNote: false,
    holidayName: null,
    eventName: null,
    isToday: false,
    weekday: 0,
  });
  for (let i = 0; i < start; i++) {
    const c = empty();
    c.weekday = i;
    cells.push(c);
  }
  for (let d = 1; d <= len; d++) {
    const date = new Date(year, month, d, 0, 0, 0, 0);
    const ymd = formatYmd(year, month, d);
    const { folder, title } = computeNotePathForDate(
      date,
      baseFolder,
      titleFormat,
    );
    cells.push({
      day: d,
      ymd,
      date,
      hasNote: noteKeySet.has(`${folder}|${title}`),
      holidayName: holidayMap.get(ymd) ?? null,
      eventName: eventMap.get(ymd) ?? null,
      isToday: ymd === todayYmd,
      weekday: cells.length % 7,
    });
  }
  while (cells.length % 7 !== 0) {
    const c = empty();
    c.weekday = cells.length % 7;
    cells.push(c);
  }
  return cells;
}
