/**
 * 日付フォーマット用のユーティリティ。
 * 設定画面で選択したパターン文字列を日付に適用して文字列化する。
 *
 * 対応トークン:
 *   YYYY  4桁年（例: 2026）
 *   MM    2桁月（01〜12）
 *   M     1〜2桁月（1〜12）
 *   DD    2桁日（01〜31）
 *   D     1〜2桁日（1〜31）
 *   HH    2桁時（00〜23）
 *   mm    2桁分（00〜59）
 *   ss    2桁秒（00〜59）
 *
 * トークン以外の文字（"年" "月" "日" "/" "-" 等）はそのまま出力される。
 */

const TOKEN_RE = /YYYY|MM|DD|HH|mm|ss|M|D/g;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

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
