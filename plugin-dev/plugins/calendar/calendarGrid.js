/**
 * カレンダーグリッドの「データ層」を構築する純 JS モジュール。
 * src/plugins/calendar/CalendarPanel.tsx のグリッド計算ロジックと等価。
 */

import { generateJapaneseHolidays } from './holidays.js';
import { generateSpecialEvents } from './calendarEvents.js';
import { computeNotePathForDate } from './dateClickHandler.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYmd(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * @param {Object} params
 * @param {number} params.year
 * @param {number} params.month  - 0..11
 * @param {Array<{folder:string,title:string}>} params.notes
 * @param {string} params.baseFolder
 * @param {string} params.titleFormat
 * @param {Date}   [params.todayRef]
 */
export function buildCalendarGrid(params) {
  const { year, month, notes, baseFolder, titleFormat } = params;
  const todayRef = params.todayRef ?? new Date();

  const noteKeySet = new Set();
  for (const n of notes) noteKeySet.add(`${n.folder}|${n.title}`);

  const holidayMap = new Map();
  for (const h of generateJapaneseHolidays(year)) holidayMap.set(h.date, h.name);
  const eventMap = new Map();
  for (const e of generateSpecialEvents(year)) eventMap.set(e.date, e.name);

  const todayYmd = formatYmd(
    todayRef.getFullYear(),
    todayRef.getMonth(),
    todayRef.getDate(),
  );

  const start = new Date(year, month, 1).getDay();
  const len = new Date(year, month + 1, 0).getDate();

  const cells = [];
  const empty = () => ({
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
