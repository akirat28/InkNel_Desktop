/**
 * カレンダー日付クリック時のフォルダパス算出 / ノート本文生成。
 * 旧 plugin-dev/plugins/calendar/dateClickHandler.js を TS 化。
 */

const TOKEN_RE = /YYYY|MM|DD|HH|mm|ss|M|D/g;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 日付を任意フォーマットで文字列化 */
export function formatDate(date: Date, format: string): string {
  return format.replace(TOKEN_RE, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'MM':
        return pad2(date.getMonth() + 1);
      case 'DD':
        return pad2(date.getDate());
      case 'HH':
        return pad2(date.getHours());
      case 'mm':
        return pad2(date.getMinutes());
      case 'ss':
        return pad2(date.getSeconds());
      case 'M':
        return String(date.getMonth() + 1);
      case 'D':
        return String(date.getDate());
      default:
        return token;
    }
  });
}

/**
 * 指定日付に対応するノートのフォルダパスとタイトルを計算。
 * `/` を含む書式はフォルダ階層化、含まなければベース直下フラット。
 */
export function computeNotePathForDate(
  date: Date,
  baseFolder: string,
  titleFormat: string,
): { folder: string; title: string } {
  const folderBase = (baseFolder || '').trim() || 'カレンダー';
  const formatted = formatDate(date, titleFormat);
  const segments = formatted
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length >= 2) {
    const title = segments[segments.length - 1];
    const folder = [folderBase, ...segments.slice(0, -1)].join('/');
    return { folder, title };
  }
  return { folder: folderBase, title: formatted };
}

export interface CalendarDayInfo {
  holidayName: string | null;
  eventName: string | null;
}

/**
 * 新規ノートの本文を組み立てる。祝日 / イベントがあれば本文先頭に引用ブロックで挿入。
 */
export function buildCalendarNoteBody(
  ymd: string,
  info: CalendarDayInfo,
): string {
  const holiday = info && info.holidayName ? info.holidayName : null;
  const event = info && info.eventName ? info.eventName : null;
  const titleSuffixParts: string[] = [];
  if (holiday) titleSuffixParts.push(holiday);
  if (event) titleSuffixParts.push(event);
  const heading =
    titleSuffixParts.length > 0
      ? `# ${ymd} ${titleSuffixParts.join(' / ')}`
      : `# ${ymd}`;
  const intro: string[] = [];
  if (holiday) intro.push(`> 祝日: ${holiday}`);
  if (event) intro.push(`> イベント: ${event}`);
  return intro.length > 0
    ? `${heading}\n\n${intro.join('\n')}\n\n`
    : `${heading}\n\n`;
}
