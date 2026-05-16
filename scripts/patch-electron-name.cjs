#!/usr/bin/env node
/**
 * 開発時の Electron.app の Info.plist と実行バイナリ名を書き換えて、
 * macOS のアプリメニューや権限ダイアログで "InkNel" と表示されるようにする。
 *
 * 背景: macOS のアプリ名表示には複数の経路がある。
 *   - メニューバー左上 / Finder: CFBundleName / CFBundleDisplayName
 *   - 権限ダイアログ（ローカルネットワーク等）: CFBundleExecutable / 実バイナリ名
 *
 * Electron 開発時は node_modules/electron/dist/Electron.app をそのまま起動するため、
 * app.setName() や Menu テンプレートでは権限ダイアログ側の表示を上書きできない。
 *
 * このスクリプトは postinstall と predev で自動実行され、以下を書き換える:
 *   1. Info.plist の CFBundleName / CFBundleDisplayName / CFBundleExecutable
 *   2. Info.plist に NSLocalNetworkUsageDescription を追加（ダイアログの説明文）
 *   3. Contents/MacOS/Electron バイナリを Contents/MacOS/InkNel にリネーム
 *   4. node_modules/electron/path.txt を新しいバイナリパスに更新
 *      （electron の cli.js がこの path.txt を読んで spawn するため）
 *
 * （node_modules 内の変更なので、依存再インストール時に再パッチが必要）
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const APP_NAME = 'InkNel';
const NETWORK_USAGE_DESC =
  'InkNel は AirPrint プリンタを検索するためにローカルネットワークへアクセスします。';

if (process.platform !== 'darwin') {
  // macOS 以外では何もしない
  process.exit(0);
}

const electronPkgRoot = path.join(__dirname, '..', 'node_modules', 'electron');
const electronAppPath = path.join(electronPkgRoot, 'dist', 'Electron.app');
const infoPlist = path.join(electronAppPath, 'Contents', 'Info.plist');
const macOSDir = path.join(electronAppPath, 'Contents', 'MacOS');
const oldBinary = path.join(macOSDir, 'Electron');
const newBinary = path.join(macOSDir, APP_NAME);
const pathTxt = path.join(electronPkgRoot, 'path.txt');

if (!fs.existsSync(infoPlist)) {
  console.warn(
    `[patch-electron-name] ${infoPlist} が見つかりません。スキップします。`,
  );
  process.exit(0);
}

function setPlistKey(key, type, value) {
  // PlistBuddy では空白を含む値をシングルクォートで囲む
  const escaped = String(value).replace(/'/g, `'\\''`);
  try {
    execSync(
      `/usr/libexec/PlistBuddy -c 'Set :${key} ${escaped}' "${infoPlist}"`,
      { stdio: 'pipe' },
    );
  } catch {
    execSync(
      `/usr/libexec/PlistBuddy -c 'Add :${key} ${type} ${escaped}' "${infoPlist}"`,
      { stdio: 'pipe' },
    );
  }
}

// 1. Info.plist の文字列キー群
setPlistKey('CFBundleName', 'string', APP_NAME);
setPlistKey('CFBundleDisplayName', 'string', APP_NAME);
setPlistKey('CFBundleExecutable', 'string', APP_NAME);
// 2. ローカルネットワーク権限ダイアログの説明文
setPlistKey('NSLocalNetworkUsageDescription', 'string', NETWORK_USAGE_DESC);

// 3. 実バイナリをリネーム（既にリネーム済みならスキップ）
if (fs.existsSync(oldBinary) && !fs.existsSync(newBinary)) {
  fs.renameSync(oldBinary, newBinary);
  console.log(
    `[patch-electron-name] バイナリ Electron → ${APP_NAME} にリネームしました`,
  );
} else if (!fs.existsSync(newBinary)) {
  console.warn(
    `[patch-electron-name] バイナリが見つかりません: ${oldBinary} / ${newBinary}`,
  );
}

// 4. electron の path.txt を新しいバイナリパスに更新
//    （cli.js がこの内容を読んで spawn するため、ここを更新しないと起動できない）
const newRelativePath = `Electron.app/Contents/MacOS/${APP_NAME}`;
if (fs.existsSync(pathTxt)) {
  const current = fs.readFileSync(pathTxt, 'utf8').trim();
  if (current !== newRelativePath) {
    fs.writeFileSync(pathTxt, newRelativePath);
    console.log(
      `[patch-electron-name] path.txt を更新: ${current} → ${newRelativePath}`,
    );
  }
}

console.log(
  `[patch-electron-name] Electron.app を "${APP_NAME}" に書き換えました`,
);
