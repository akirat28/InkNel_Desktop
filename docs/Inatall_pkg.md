# InkNel インストールパッケージ作成手順

リリース時はこの手順に従って Mac / Windows のインストーラを作成し、配布サイトを更新する。

## 0. 必要環境 / 前提条件

### 共通
- Node.js v20+ がインストール済み
- `npm install` 完了済み（`postinstall` で `electron-rebuild` が走り、`better-sqlite3` が Electron 向けにビルド済み）

### macOS ビルド
- macOS 実機（Apple Silicon）
- Apple Developer ID Application 証明書がキーチェーンに登録済み
  - 現在の identity: `akira Tanaka (F3P687R953)`（`package.json > build.mac.identity`）
- プロジェクトルートに `.env` を配置（git 管理外）:
  ```env
  APPLE_ID=<Apple ID メールアドレス>
  APPLE_APP_SPECIFIC_PASSWORD=<App 用パスワード>
  APPLE_TEAM_ID=F3P687R953
  ```
  - App 用パスワードは https://appleid.apple.com/account/manage で発行
  - `APPLE_APP_PASSWORD` でも可（`scripts/notarize.cjs` が両方受理）

### Windows ビルド
- 追加設定不要（macOS 上から Wine + 同梱 NSIS でクロスビルド）
- 初回のみ `electron-builder` が Wine をダウンロード
- 署名は未設定（個人配布のため、SmartScreen 警告は許容）

---

## 1. 全工程フロー

```
┌─────────────────────────────────────────────────┐
│ 1. バージョン更新 (package.json)                 │
│ 2. テスト実行 (npm test)                         │
│ 3. release ディレクトリ削除                      │
│ 4. Mac ビルド + Notarization                    │
│ 5. Windows ビルド (NSIS + ZIP)                  │
│ 6. web-site/downloads/ に配置                   │
│ 7. web-site/index.html バージョン置換            │
│ 8. web-site/version.json 更新                   │
│ 9. ローカル dev を arm64 に復元                 │
│ 10. (任意) git commit + push                    │
└─────────────────────────────────────────────────┘
```

---

## 2. 詳細手順

### 2.1 バージョン更新

`package.json` の `version` フィールドを次のバージョンに書き換える:

```diff
-  "version": "0.1.13",
+  "version": "0.1.14",
```

セマンティックバージョニング（MAJOR.MINOR.PATCH）で機能追加なら MINOR、バグ修正なら PATCH を bump。

### 2.2 テスト実行

```sh
npm test
```

すべてのテスト（現在 82 件以上）がパスすることを確認。`scripts/run-tests.cjs` が `better-sqlite3` を Node 向け→ Electron 向けに自動リビルドしてくれるので、終了後そのまま次の手順へ進める。

### 2.3 release ディレクトリのクリア

```sh
rm -rf release
```

古い成果物が混ざらないよう、毎回クリーンに開始する。

### 2.4 Mac ビルド（署名 + Notarization）

```sh
set -a && source .env && set +a && npm run dist:mac:arm64
```

- `set -a / set +a` で `.env` の変数を子プロセスにエクスポート
- `dist:mac:arm64` が `npm run build` → `electron-builder --mac --arm64` を実行
- electron-builder が `afterSign: scripts/notarize.cjs` フックで `@electron/notarize` を呼ぶ
- Notarization は Apple サーバーへ提出 → 完了通知（通常 3-5 分）

成功時のログ末尾:
```
[notarize] Notarization 完了。
  • building        target=macOS zip arch=arm64 file=release/InkNel-X.Y.Z-arm64-mac.zip
  • building        target=DMG arch=arm64 file=release/InkNel-X.Y.Z-arm64.dmg
```

成果物:
- `release/InkNel-X.Y.Z-arm64.dmg`（インストーラ）
- `release/InkNel-X.Y.Z-arm64-mac.zip`（自動更新用）

#### バックグラウンド実行する場合

時間がかかるので別ターミナル / バックグラウンドで実行する場合:

```sh
set -a && source .env && set +a && npm run dist:mac:arm64 2>&1 | tee /tmp/inknel-mac-build.log
```

進捗確認:
```sh
tail -20 /tmp/inknel-mac-build.log
grep -E "Notarization|notarize|error" /tmp/inknel-mac-build.log
```

### 2.5 Windows ビルド

```sh
npm run dist:win
```

- `@electron/rebuild` が `better-sqlite3` を win32-x64 向けにクロスリビルド
- Wine 経由で NSIS インストーラを生成
- 所要時間: 2-3 分

成果物:
- `release/InkNel Setup X.Y.Z.exe`（NSIS per-user インストーラ）
- `release/InkNel-X.Y.Z-win.zip`（ポータブル版）

### 2.6 web-site/downloads/ への配置

旧バージョンを削除し、新バージョンを配置（配布対象は **dmg + win.zip** のみ）:

```sh
rm web-site/downloads/InkNel-X.Y.Z-OLD-*
cp "release/InkNel-X.Y.Z-arm64.dmg" "release/InkNel-X.Y.Z-win.zip" web-site/downloads/
```

### 2.7 web-site/index.html のバージョン更新

3 箇所のバージョン文字列を一括置換:
- ヒーローバッジの `Version X.Y.Z`
- Mac DL リンクの `downloads/InkNel-X.Y.Z-arm64.dmg`
- Win DL リンクの `downloads/InkNel-X.Y.Z-win.zip`

```sh
# 例: 0.1.13 → 0.1.14
sed -i '' 's/0\.1\.13/0.1.14/g' web-site/index.html
```

### 2.8 web-site/version.json の更新

これがアプリ内「ヘルプ → バージョンアップ確認」で参照される JSON。**忘れずに更新**すること:

```json
{
  "version": "0.1.14",
  "downloads": {
    "mac": "https://inknel.ary-ap.com/downloads/InkNel-0.1.14-arm64.dmg",
    "win": "https://inknel.ary-ap.com/downloads/InkNel-0.1.14-win.zip"
  }
}
```

これを更新しないと、既存ユーザーがアプリ内バージョンチェックを押しても「最新です」と表示されてしまう。

### 2.9 ローカル dev 環境を arm64 に復元

Windows ビルドで `better-sqlite3` が win32-x64 にリビルドされているので、Mac arm64 用に戻す:

```sh
npx electron-rebuild -f -w better-sqlite3
```

これで `npm run dev` が再び動く。

### 2.10 (任意) git commit + push

```sh
git add package.json web-site/
git commit -m "Release v0.1.14"
git push
```

---

## 3. 一連のコマンドまとめ

通常リリース時の最短コマンド列:

```sh
# 1-3
# package.json の version を手動で書き換え
npm test
rm -rf release

# 4
set -a && source .env && set +a && npm run dist:mac:arm64

# 5
npm run dist:win

# 6
rm web-site/downloads/InkNel-*-arm64.dmg web-site/downloads/InkNel-*-win.zip
cp "release/InkNel-X.Y.Z-arm64.dmg" "release/InkNel-X.Y.Z-win.zip" web-site/downloads/

# 7-8
sed -i '' 's/0\.1\.OLD/0.1.NEW/g' web-site/index.html
# version.json を手動で書き換え

# 9
npx electron-rebuild -f -w better-sqlite3
```

---

## 4. 成果物一覧（参考サイズ）

| ファイル | サイズ目安 | 用途 |
|---|---:|---|
| `InkNel-X.Y.Z-arm64.dmg` | ~120 MB | Mac 配布（署名 + Notarization 済み） |
| `InkNel-X.Y.Z-arm64-mac.zip` | ~115 MB | Mac 自動更新用（配布はしない） |
| `InkNel Setup X.Y.Z.exe` | ~95 MB | Windows NSIS per-user インストーラ |
| `InkNel-X.Y.Z-win.zip` | ~130 MB | Windows ポータブル版（配布） |

---

## 5. リリース後の確認

1. **配布サイト** にアクセスして、ダウンロードリンクが新バージョンに更新されているか
2. **`https://inknel.ary-ap.com/version.json`** が新バージョンを返すか（`curl` で確認）
3. **既存アプリ** のヘルプ → バージョンアップ確認を押し、「新しいバージョン X.Y.Z が公開されています」と表示されるか
4. ダウンロードしてインストール → 起動 → 既存 DB / ノートが正しく見える

---

## 6. トラブルシューティング

### 6.1 Notarization に失敗する

```
[notarize] Notarization に失敗しました: Invalid Apple ID and/or password.
```

- `.env` の `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` を確認
- App 用パスワードを再発行（古いものが失効している可能性）
- ネットワーク疎通必須（Apple サーバーに submit するため）

### 6.2 `Library not loaded: Electron Framework ... different Team IDs`

- nested code が正しく署名されていない可能性
- `release/mac-arm64/InkNel.app` を削除してから `npm run dist:mac:arm64` を再実行

### 6.3 Windows ビルドで `better-sqlite3` が見つからない

- `@electron/rebuild` が x64 prebuilt の取得に失敗した可能性
- 対処:
  ```sh
  rm -rf node_modules
  npm install
  npm run dist:win
  ```

### 6.4 `app.getVersion()` と version.json が一致しない

- `package.json` の version 更新を忘れている、または `dist:*` を実行する前に bump し忘れた
- `npm run build` 後に `out/main/index.js` を確認すれば判別可能

### 6.5 macOS で起動できない / Gatekeeper で弾かれる

- Notarization が完了していない可能性
- `spctl --assess --verbose /path/to/InkNel.app` で評価
- `codesign --verify --deep --strict --verbose=2 /path/to/InkNel.app` で署名検証

### 6.6 Windows で SmartScreen 警告

- 未署名ビルドのため正常な警告。「詳細情報」→「実行」で回避可能
- 配布規模が大きくなるなら Code Signing 証明書（EV 推奨）導入を検討

---

## 7. 変更が必要になりやすい箇所

| 項目 | 期限・条件 | 対処 |
|---|---|---|
| Apple Developer Program 会費 | 年次（年 USD 99） | 期限前に更新 |
| Developer ID Application 証明書 | 5 年 | キーチェーンで再発行 |
| App 用パスワード | 都度発行可能 | `.env` を更新 |
| `package.json > build.mac.identity` | 証明書名変更時 | 文字列を更新 |
| Electron バージョン更新 | 必要に応じて | `better-sqlite3` の prebuilt 互換性確認（`NODE_MODULE_VERSION`） |

---

## 8. 関連ファイル

| パス | 役割 |
|---|---|
| `package.json` | electron-builder 設定（`build` セクション） / scripts |
| `scripts/codesign-adhoc.cjs` | Developer ID 証明書未指定時の ad-hoc 署名（指定時はスキップ） |
| `scripts/notarize.cjs` | `afterSign` フック / Apple Notarization |
| `scripts/patch-electron-name.cjs` | dev 起動時に Electron.app → InkNel.app へリネーム |
| `scripts/run-tests.cjs` | テスト前後の `better-sqlite3` リビルドラッパー |
| `build/entitlements.mac.plist` | Hardened Runtime 権限定義 |
| `web-site/index.html` | 配布サイトの DL リンク |
| `web-site/version.json` | アプリ内バージョンチェック用 |

---

## 9. 関連ドキュメント

- `docs/インストーラ.md` — 旧版手順（参考）
- `docs/詳細仕様.md` — InkNel の全体仕様
- `docs/保存先仕様.md` — 保存先フォルダ方式の仕様（iOS 版実装の参考にも使用）

---

**最後に: 本手順は v0.1.14 時点で最新化されています。** 大きな変更（Electron メジャーバージョン更新、署名方式変更等）があった場合はこのドキュメントも更新してください。
