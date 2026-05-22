/**
 * カレンダー組み込み機能本体 (旧 plugin-dev/plugins/calendar を内製化したもの)。
 *
 * Sidebar の mode === 'calendar' のときに表示される。
 * 設定 (フォルダ名 / タイトル書式) は AppSettings.calendarPlugin で保持し、
 * 設定 UI は PreferencesModal の「カレンダー」カテゴリ。
 */

import { useMemo, useState } from 'react';
import type { NoteMeta } from '../global';
import type { AppSettings } from '../settings';
import { buildCalendarGrid, type CalendarCell } from './calendarGrid';
import {
  buildCalendarNoteBody,
  computeNotePathForDate,
  type CalendarDayInfo,
} from './dateClickHandler';
import { getCalendarStrings } from './i18n';

interface Props {
  notes: NoteMeta[];
  settings: AppSettings;
  onSelectNote: (id: string) => void;
  onCreateNote: (input: {
    title?: string;
    folder?: string;
    body?: string;
    tags?: string[];
  }) => Promise<NoteMeta>;
}

interface PendingCreate {
  date: Date;
  ymd: string;
  info: CalendarDayInfo;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export default function CalendarPanel({
  notes,
  settings,
  onSelectNote,
  onCreateNote,
}: Props) {
  const cfg = settings.calendarPlugin ?? {
    folder: 'カレンダー',
    titleFormat: 'YYYY-MM-DD',
  };
  const langCode =
    settings.language && settings.language !== 'auto' ? settings.language : 'ja';
  const i18n = getCalendarStrings(langCode);

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  // クリックされた日付 (YYYY-MM-DD)。青背景でハイライト表示する。
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);

  const grid = useMemo(
    () =>
      buildCalendarGrid({
        year,
        month,
        notes: notes.map((n) => ({ folder: n.folder, title: n.title })),
        baseFolder: cfg.folder,
        titleFormat: cfg.titleFormat,
        todayRef: today,
      }),
    [year, month, notes, cfg.folder, cfg.titleFormat, today],
  );

  const goPrev = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNext = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  const handleCellClick = (cell: CalendarCell) => {
    if (!cell.day || !cell.ymd || !cell.date) return;
    // クリックされた日付を選択状態として記録 (青背景でハイライト)
    setSelectedYmd(cell.ymd);
    const info: CalendarDayInfo = {
      holidayName: cell.holidayName,
      eventName: cell.eventName,
    };
    if (cell.hasNote) {
      const { folder, title } = computeNotePathForDate(
        cell.date,
        cfg.folder,
        cfg.titleFormat,
      );
      const existing = notes.find(
        (n) => n.folder === folder && n.title === title,
      );
      if (existing) onSelectNote(existing.id);
      return;
    }
    setPendingCreate({ date: cell.date, ymd: cell.ymd, info });
  };

  const confirmCreate = async () => {
    if (!pendingCreate) return;
    const { date, ymd, info } = pendingCreate;
    setPendingCreate(null);
    const { folder, title } = computeNotePathForDate(
      date,
      cfg.folder,
      cfg.titleFormat,
    );
    const body = buildCalendarNoteBody(ymd, info);
    await onCreateNote({ title, folder, body });
  };
  const cancelCreate = () => setPendingCreate(null);

  const yearMonthTitle = `${year}年 ${pad2(month + 1)}月`;

  return (
    <div className="calendar-panel">
      <header className="calendar-panel__header">
        <button
          type="button"
          className="calendar-panel__nav"
          onClick={goPrev}
          title={i18n.prevMonth}
          aria-label={i18n.prevMonth}
        >
          ◀
        </button>
        <div className="calendar-panel__title">{yearMonthTitle}</div>
        <button
          type="button"
          className="calendar-panel__nav"
          onClick={goNext}
          title={i18n.nextMonth}
          aria-label={i18n.nextMonth}
        >
          ▶
        </button>
        <button
          type="button"
          className="calendar-panel__today"
          onClick={goToday}
          title={i18n.todayTooltip}
        >
          {i18n.today}
        </button>
      </header>
      <div className="calendar-panel__weekrow" aria-hidden={true}>
        {i18n.weekdays.map((w, i) => (
          <span
            key={`${w}-${i}`}
            className={
              'calendar-panel__weekday ' +
              (i === 0
                ? 'calendar-panel__weekday--sun'
                : i === 6
                  ? 'calendar-panel__weekday--sat'
                  : '')
            }
          >
            {w}
          </span>
        ))}
      </div>
      <div className="calendar-panel__grid" role="grid">
        {grid.map((cell, idx) => {
          if (!cell.day || !cell.ymd || !cell.date) {
            return (
              <div key={idx} className="calendar-panel__cell-empty" />
            );
          }
          const weekday = idx % 7;
          const isSun = weekday === 0;
          const isSat = weekday === 6;
          const parts: string[] = [];
          if (cell.holidayName)
            parts.push(`${i18n.holidayPrefix}: ${cell.holidayName}`);
          if (cell.eventName)
            parts.push(`${i18n.eventPrefix}: ${cell.eventName}`);
          const dayInfo = parts.length > 0 ? ` (${parts.join(' / ')})` : '';
          const tmpl = cell.hasNote
            ? i18n.tooltipOpenExisting
            : i18n.tooltipCreate;
          const title = tmpl
            .replace('{{date}}', cell.ymd)
            .replace('{{info}}', dayInfo);
          return (
            <button
              key={idx}
              type="button"
              className={
                'calendar-panel__day ' +
                (cell.isToday ? 'is-today ' : '') +
                (cell.ymd === selectedYmd ? 'is-selected ' : '') +
                (isSun ? 'is-sun ' : '') +
                (isSat ? 'is-sat ' : '') +
                (cell.holidayName ? 'is-holiday ' : '') +
                (cell.hasNote ? 'has-note ' : '')
              }
              onClick={() => handleCellClick(cell)}
              title={title}
            >
              <span className="calendar-panel__day-content">
                <span className="calendar-panel__day-num">{cell.day}</span>
                {/* ノート有無に関係なく常にドット要素を出して縦方向のレイアウトを
                    揃える (ノートが無い日は visibility: hidden で見た目だけ消す)。 */}
                <span
                  className={
                    'calendar-panel__day-dot' +
                    (cell.hasNote ? '' : ' is-hidden')
                  }
                  aria-label={cell.hasNote ? i18n.hasNoteLabel : undefined}
                  aria-hidden={cell.hasNote ? undefined : true}
                />
              </span>
            </button>
          );
        })}
      </div>
      {pendingCreate ? (
        <div
          className="calendar-panel__create-confirm"
          role="dialog"
          aria-live="polite"
        >
          <span className="calendar-panel__create-confirm-text">
            {i18n.confirmCreateText
              .replace(
                '{{date}}',
                `${pendingCreate.date.getMonth() + 1}/${pendingCreate.date.getDate()}`,
              )
              .replace(
                '{{info}}',
                pendingCreate.info.holidayName
                  ? ` (${pendingCreate.info.holidayName})`
                  : pendingCreate.info.eventName
                    ? ` (${pendingCreate.info.eventName})`
                    : '',
              )}
          </span>
          <div className="calendar-panel__create-confirm-actions">
            <button
              type="button"
              className="calendar-panel__create-confirm-btn calendar-panel__create-confirm-btn--ok"
              onClick={confirmCreate}
            >
              OK
            </button>
            <button
              type="button"
              className="calendar-panel__create-confirm-btn"
              onClick={cancelCreate}
            >
              {i18n.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
