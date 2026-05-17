#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# release.sh: InkNel リリース自動化スクリプト
#
# 機能:
#   1. package.json のバージョンを指定値に更新 (npm version)
#   2. git commit + push (現在の main へ)
#   3. macOS arm64 DMG (公証込み) → Windows ZIP → Linux deb/AppImage の順にビルド
#   4. GitHub Release を作成 (タグ作成 + 3 ファイル添付 + ノート)
#   5. ローカル開発復元 (better-sqlite3 を Mac Electron 向けに再ビルド)
#
# 使い方:
#   ./scripts/release.sh <version> [<release-notes>]
#   ./scripts/release.sh 0.4.6 "ライトテーマの追加修正"
#   ./scripts/release.sh 0.4.6                   # ← notes 省略時は git ログから生成
#
# 環境要件:
#   - .env に APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
#   - gh CLI 認証済み (gh auth status)
#   - クリーンな git ワーキングツリー (もしくは現在の変更を含めてコミットしてよい状態)
# -----------------------------------------------------------------------------

set -euo pipefail

# ----- 引数チェック -----
if [[ $# -lt 1 ]]; then
  echo "❌ Usage: $0 <version> [<release-notes>]" >&2
  echo "   Example: $0 0.4.6 \"バグ修正リリース\"" >&2
  exit 1
fi

VERSION="$1"
NOTES="${2:-}"

# セマンティックバージョン形式チェック (X.Y.Z または X.Y.Z-suffix)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "❌ Invalid version: '$VERSION' (expected X.Y.Z or X.Y.Z-suffix)" >&2
  exit 1
fi

TAG="v$VERSION"

# プロジェクトルートへ移動
cd "$(dirname "$0")/.."

# ----- 事前検証 -----
echo "▶ 事前検証..."

# gh CLI 認証チェック
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh CLI が未認証です。'gh auth login' を実行してください。" >&2
  exit 1
fi

# 既存タグの重複チェック
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ タグ $TAG は既に存在します。別のバージョンを指定してください。" >&2
  exit 1
fi

# 既存 GitHub Release の重複チェック
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "❌ GitHub Release $TAG は既に存在します。" >&2
  exit 1
fi

# .env 存在チェック (macOS 公証用)
if [[ ! -f .env ]]; then
  echo "⚠️  .env が見つかりません。macOS Notarization はスキップされる可能性があります。" >&2
fi

echo "✓ 事前検証 OK (version=$VERSION, tag=$TAG)"

# ----- 終了時に better-sqlite3 を Mac Electron 向けへ戻す -----
# ビルド成功/失敗にかかわらず、ローカル `npm run dev` が壊れないよう復元する。
cleanup() {
  local exit_code=$?
  echo ""
  echo "▶ better-sqlite3 を macOS Electron 向けに復旧中..."
  npx electron-rebuild -f -w better-sqlite3 || true
  if [[ $exit_code -ne 0 ]]; then
    echo "❌ リリース処理中にエラーが発生しました (exit=$exit_code)" >&2
  fi
  exit $exit_code
}
trap cleanup EXIT

# ----- 1. バージョンバンプ -----
echo ""
echo "▶ [1/5] package.json のバージョンを $VERSION に更新..."
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
echo "✓ package.json: $(node -p "require('./package.json').version")"

# ----- 2. コミット & push -----
echo ""
echo "▶ [2/5] コミット & push..."
# 何か変更があれば全部ステージング (バージョンバンプも含む)
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  COMMIT_MSG="v$VERSION"
  if [[ -n "$NOTES" ]]; then
    COMMIT_MSG="v$VERSION: $NOTES"
  fi
  git commit -m "$COMMIT_MSG"
  echo "✓ コミット作成: $(git log -1 --oneline)"
else
  echo "✓ 変更なし (HEAD: $(git log -1 --oneline))"
fi
git push origin main
echo "✓ push 完了"

# ----- 3. ビルド (順次) -----
DMG_FILE="release/InkNel-${VERSION}-arm64.dmg"
WIN_FILE="release/InkNel-${VERSION}-win.zip"
DEB_FILE="release/inknel-elec_${VERSION}_amd64.deb"

echo ""
echo "▶ [3/5] ビルド開始 (3 種類を順次)..."

echo "  - macOS arm64 DMG (公証込み)..."
npm run dist:mac:arm64 >/dev/null 2>&1 || {
  echo "❌ macOS arm64 ビルド失敗。詳細: npm run dist:mac:arm64 で再実行して確認してください。" >&2
  exit 1
}
[[ -f "$DMG_FILE" ]] || { echo "❌ $DMG_FILE が生成されていません" >&2; exit 1; }
echo "    ✓ $DMG_FILE ($(du -h "$DMG_FILE" | cut -f1))"

echo "  - Windows x64 ZIP..."
npm run dist:win:zip >/dev/null 2>&1 || {
  echo "❌ Windows ZIP ビルド失敗。" >&2
  exit 1
}
[[ -f "$WIN_FILE" ]] || { echo "❌ $WIN_FILE が生成されていません" >&2; exit 1; }
echo "    ✓ $WIN_FILE ($(du -h "$WIN_FILE" | cut -f1))"

echo "  - Linux deb (Ubuntu/Debian)..."
npm run dist:linux >/dev/null 2>&1 || {
  echo "❌ Linux ビルド失敗。" >&2
  exit 1
}
[[ -f "$DEB_FILE" ]] || { echo "❌ $DEB_FILE が生成されていません" >&2; exit 1; }
echo "    ✓ $DEB_FILE ($(du -h "$DEB_FILE" | cut -f1))"

# ----- 4. GitHub Release 作成 -----
echo ""
echo "▶ [4/5] GitHub Release $TAG を作成..."

# リリースノート: 引数で指定されていればそれを、無ければ前回タグからのコミットログから生成。
if [[ -z "$NOTES" ]]; then
  LAST_TAG="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")"
  if [[ -n "$LAST_TAG" ]]; then
    NOTES="$(git log --pretty=format:'- %s' "${LAST_TAG}..HEAD" | head -20)"
  else
    NOTES="初回リリース"
  fi
fi

NOTES_BODY=$(cat <<EOF
## ダウンロード

| プラットフォーム | ファイル |
|---|---|
| macOS (Apple Silicon) | \`InkNel-${VERSION}-arm64.dmg\` |
| Windows (x64, ポータブル) | \`InkNel-${VERSION}-win.zip\` |
| Linux (Ubuntu / Debian, x64) | \`inknel-elec_${VERSION}_amd64.deb\` |

### インストール
- **macOS**: DMG をマウントして \`InkNel.app\` を Applications フォルダにドラッグ。Apple 公証済み。
- **Windows**: ZIP を解凍し、\`InkNel.exe\` を直接実行 (インストール不要)。
- **Linux (Ubuntu / Debian)**: \`sudo apt install ./inknel-elec_${VERSION}_amd64.deb\`

### このバージョンの変更点
$NOTES
EOF
)

gh release create "$TAG" \
  "$DMG_FILE" \
  "$WIN_FILE" \
  "$DEB_FILE" \
  --title "InkNel $TAG" \
  --notes "$NOTES_BODY"

echo "✓ Release 公開: https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/releases/tag/$TAG"

# ----- 5. 完了 (cleanup trap で better-sqlite3 復元) -----
echo ""
echo "▶ [5/5] ローカル開発環境を復元..."
# 復元は trap で実行されるのでここでは表示のみ
echo ""
echo "✅ リリース $TAG 完了！"
