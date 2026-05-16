/**
 * マークダウン本文から `images/<sha256>.<ext>` および
 * `attachments/<sha256>.<ext>` の参照ファイル名を抽出する。
 *
 * 厳密なハッシュ命名パターンにのみマッチするため、ユーザーが手書きした
 * `images/foo.png` のような相対パスは GC 対象外になる。
 */

const IMAGE_REF_RE = /images\/([a-f0-9]{64}\.[a-z0-9]{2,5})/gi;
const ATTACHMENT_REF_RE = /attachments\/([a-f0-9]{64}\.[a-z0-9]{2,5})/gi;

export function extractImageRefs(body: string): Set<string> {
  const set = new Set<string>();
  for (const m of body.matchAll(IMAGE_REF_RE)) {
    set.add(m[1]);
  }
  return set;
}

export function extractAttachmentRefs(body: string): Set<string> {
  const set = new Set<string>();
  for (const m of body.matchAll(ATTACHMENT_REF_RE)) {
    set.add(m[1]);
  }
  return set;
}
