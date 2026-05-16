/**
 * 日本のカレンダーイベント生成（祝日ではない、習慣的な記念日）。
 * src/plugins/calendar/calendarEvents.ts と等価。
 */

function format(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNthSunday(year, month, nth) {
  const first = new Date(year, month - 1, 1);
  const diff = (7 - first.getDay()) % 7;
  const day = 1 + diff + (nth - 1) * 7;
  return new Date(year, month - 1, day);
}

function getSetsubun(year) {
  if (year === 2021 || year === 2025 || year === 2029 || year === 2033) {
    return new Date(year, 1, 2);
  }
  return new Date(year, 1, 3);
}

export function generateSpecialEvents(year) {
  const events = [];
  const add = (date, name, category) => {
    events.push({ date: format(date), name, category });
  };

  add(new Date(year, 1, 14), 'バレンタインデー', '恋愛');
  add(new Date(year, 2, 14), 'ホワイトデー', '恋愛');
  add(new Date(year, 11, 24), 'クリスマスイブ', '恋愛');
  add(new Date(year, 11, 25), 'クリスマス', '恋愛');
  add(getNthSunday(year, 5, 2), '母の日', '家族');
  add(getNthSunday(year, 6, 3), '父の日', '家族');
  add(new Date(year, 2, 3), 'ひな祭り', '日本文化');
  add(getSetsubun(year), '節分', '日本文化');
  add(new Date(year, 6, 7), '七夕', '日本文化');
  add(new Date(year, 9, 31), 'ハロウィン', '季節');
  add(new Date(year, 7, 13), 'お盆入り', '伝統');
  add(new Date(year, 7, 16), 'お盆明け', '伝統');

  return events.sort((a, b) => (a.date > b.date ? 1 : -1));
}
