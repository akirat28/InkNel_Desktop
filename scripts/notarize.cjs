#!/usr/bin/env node
/**
 * electron-builder の afterSign フック: ビルドされた .app を
 * Apple に提出して公証 (Notarization) を受ける。
 *
 * 公証済みの .app はダウンロード後に Gatekeeper 警告なしで開ける。
 *
 * 必要な環境変数 (プロジェクトルートの .env から自動読込):
 *   APPLE_ID                                    Apple ID のメールアドレス
 *   APPLE_PASSWORD / APPLE_APP_PASSWORD / APPLE_APP_SPECIFIC_PASSWORD
 *                                               App 用パスワード (https://appleid.apple.com で生成)
 *   APPLE_TEAM_ID                               Developer Team ID (任意。package.json から自動取得もする)
 */
const path = require('node:path');

// プロジェクトルートの .env を自動で読み込み、毎回シェルで export しなくて済むようにする
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword =
    process.env.APPLE_APP_SPECIFIC_PASSWORD ||
    process.env.APPLE_APP_PASSWORD ||
    process.env.APPLE_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID || 'F3P687R953';

  if (!appleId || !appleIdPassword) {
    console.warn(
      '[notarize] APPLE_ID / APPLE_PASSWORD(または APPLE_APP_SPECIFIC_PASSWORD) が未設定のため Notarization をスキップします。',
    );
    console.warn(
      '[notarize] プロジェクトルートの .env に設定するか、シェルで export すると Gatekeeper 警告なしで配布できます。',
    );
    return;
  }

  // @electron/notarize v3+ は内部で APPLE_APP_SPECIFIC_PASSWORD を直接参照するため、
  // 別名で設定された値も同じ env var に複製しておく。
  if (!process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    process.env.APPLE_APP_SPECIFIC_PASSWORD = appleIdPassword;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[notarize] Apple Notarization を開始: ${appPath}`);
  console.log(`[notarize] Apple ID: ${appleId}`);
  console.log(`[notarize] Team ID: ${teamId}`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('[notarize] Notarization 完了。');
  } catch (err) {
    console.error('[notarize] Notarization に失敗しました:', err.message || err);
    throw err;
  }
};
