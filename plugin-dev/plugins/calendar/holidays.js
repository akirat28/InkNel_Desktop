/**
 * 日本の祝祭日生成。
 * 固定祝日 + ハッピーマンデー + 春分／秋分の概算 + 振替休日 + 国民の休日。
 * src/plugins/calendar/holidays.ts と等価。
 */

function getNthMonday(year, month, nth) {
  const firstDay = new Date(year, month - 1, 1);
  const firstDayOfWeek = firstDay.getDay();
  const diff = (1 - firstDayOfWeek + 7) % 7;
  const day = 1 + diff + (nth - 1) * 7;
  return new Date(year, month - 1, day);
}

function getSpringEquinox(year) {
  const day =
    Math.floor(20.8431 + 0.242194 * (year - 1980)) -
    Math.floor((year - 1980) / 4);
  return new Date(year, 2, day);
}

function getAutumnEquinox(year) {
  const day =
    Math.floor(23.2488 + 0.242194 * (year - 1980)) -
    Math.floor((year - 1980) / 4);
  return new Date(year, 8, day);
}

function format(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function generateJapaneseHolidays(year) {
  const holidays = [];
  const add = (date, name) => {
    holidays.push({ date: format(date), name });
  };

  add(new Date(year, 0, 1), '元日');
  add(new Date(year, 1, 11), '建国記念の日');
  add(new Date(year, 1, 23), '天皇誕生日');
  add(new Date(year, 3, 29), '昭和の日');
  add(new Date(year, 4, 3), '憲法記念日');
  add(new Date(year, 4, 4), 'みどりの日');
  add(new Date(year, 4, 5), 'こどもの日');
  add(new Date(year, 7, 11), '山の日');
  add(new Date(year, 10, 3), '文化の日');
  add(new Date(year, 10, 23), '勤労感謝の日');

  add(getNthMonday(year, 1, 2), '成人の日');
  add(getNthMonday(year, 7, 3), '海の日');
  add(getNthMonday(year, 9, 3), '敬老の日');
  add(getNthMonday(year, 10, 2), 'スポーツの日');

  add(getSpringEquinox(year), '春分の日');
  add(getAutumnEquinox(year), '秋分の日');

  const holidayDates = new Set(holidays.map((h) => h.date));
  const extra = [];
  for (const h of holidays) {
    const d = new Date(h.date);
    if (d.getDay() === 0) {
      const sub = new Date(d);
      do {
        sub.setDate(sub.getDate() + 1);
      } while (holidayDates.has(format(sub)));
      const subDate = format(sub);
      holidayDates.add(subDate);
      extra.push({ date: subDate, name: '振替休日' });
    }
  }
  holidays.push(...extra);

  holidays.sort((a, b) => (a.date > b.date ? 1 : -1));
  const interpolated = [];
  for (let i = 0; i < holidays.length - 1; i++) {
    const d1 = new Date(holidays[i].date);
    const d2 = new Date(holidays[i + 1].date);
    const diff = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 2) {
      const middle = new Date(d1);
      middle.setDate(middle.getDate() + 1);
      interpolated.push({ date: format(middle), name: '国民の休日' });
    }
  }
  holidays.push(...interpolated);

  return holidays.sort((a, b) => (a.date > b.date ? 1 : -1));
}
