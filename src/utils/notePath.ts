/**
 * NoteHeader の入力欄に表示する「ファイル名（パス形式）」と
 * データモデルの `folder` / `title` を相互変換するユーティリティ。
 *
 * 例:
 *   "階層1/テスト1"           → folder="階層1", title="テスト1"
 *   "階層1/階層2/テスト1"     → folder="階層1/階層2", title="テスト1"
 *   "テスト1"                 → folder="", title="テスト1"
 *   ""                        → folder="", title=""
 *   "階層1/"                  → folder="階層1", title=""
 */

/** スラッシュ区切りパスを folder と title に分解する。 */
export function parsePath(input: string): { folder: string; title: string } {
  const idx = input.lastIndexOf('/');
  if (idx === -1) {
    return { folder: '', title: input };
  }
  let folder = input.slice(0, idx);
  const title = input.slice(idx + 1);
  // 連続スラッシュを単一化、前後スラッシュをトリム
  folder = folder.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  return { folder, title };
}

/** folder と title を結合してパス文字列に戻す。 */
export function buildPath(folder: string, title: string): string {
  return folder ? `${folder}/${title}` : title;
}
