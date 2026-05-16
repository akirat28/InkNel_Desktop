#!/usr/bin/env node
/**
 * electron-builder の afterPack フック: パッケージされた .app を
 * deepest-first の順序で ad-hoc 署名し直す。
 *
 * 背景:
 *   macOS 26 (Tahoe) 以降は hardened runtime のライブラリ検証が厳しくなり、
 *   ad-hoc 署名同士でも TeamID 不一致と判定されて dyld が
 *   "Library not loaded ... different Team IDs" でクラッシュさせる。
 *
 * 対策:
 *   1. build/entitlements.mac.plist で library validation を明示的に無効化
 *   2. 全 nested code（dylib → framework → helper.app → main.app）を
 *      deepest-first の順で `codesign --force --sign - --entitlements ...
 *      --options runtime` で署名する
 *   3. 既存署名は --force で強制上書き
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ENTITLEMENTS = path.join(
  __dirname,
  '..',
  'build',
  'entitlements.mac.plist',
);

/**
 * @param {{ appOutDir: string, packager: { appInfo: { productFilename: string } }, electronPlatformName: string }} context
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // electron-builder が実際の証明書（identity !== null）で署名する場合は
  // このフックは不要（electron-builder 内蔵の @electron/osx-sign が処理する）。
  // ad-hoc 署名（identity === null）の場合のみ手動で deepest-first 署名を行う。
  const macConfig = context.packager?.config?.mac;
  if (macConfig && macConfig.identity !== null && macConfig.identity !== '-') {
    console.log('[codesign-adhoc] 証明書署名が設定されているため ad-hoc 署名をスキップします');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`[codesign-adhoc] ${appPath} が見つかりません。スキップ`);
    return;
  }
  if (!fs.existsSync(ENTITLEMENTS)) {
    console.warn(
      `[codesign-adhoc] entitlements ファイルが見つかりません: ${ENTITLEMENTS}`,
    );
    return;
  }

  console.log(`[codesign-adhoc] ad-hoc 署名開始: ${appPath}`);
  console.log(`[codesign-adhoc] entitlements: ${ENTITLEMENTS}`);

  // 1. 署名対象を deepest-first で集める
  const findFiles = (root, predicate) => {
    /** @type {string[]} */
    const result = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          walk(full);
        }
        if (predicate(full, entry)) {
          result.push(full);
        }
      }
    };
    walk(root);
    return result;
  };

  const dylibs = findFiles(appPath, (p, e) =>
    e.isFile() && p.endsWith('.dylib'),
  );
  const frameworkVersions = findFiles(appPath, (p, e) => {
    if (!e.isDirectory()) return false;
    return /\.framework\/Versions\/[^/]+$/.test(p) && !p.endsWith('/Current');
  });
  const helperApps = findFiles(appPath, (p, e) => {
    if (!e.isDirectory()) return false;
    return p.endsWith('.app') && p !== appPath;
  });
  const helperBinaries = findFiles(appPath, (p, e) => {
    if (!e.isFile()) return false;
    if (!/Helpers\/[^/]+$/.test(p)) return false;
    return !p.endsWith('.plist') && !p.endsWith('.json');
  });

  // deepest first
  const byDepthDesc = (a, b) =>
    b.split(path.sep).length - a.split(path.sep).length;

  /** @type {string[]} */
  const signOrder = [
    ...dylibs.sort(byDepthDesc),
    ...helperBinaries.sort(byDepthDesc),
    ...frameworkVersions.sort(byDepthDesc),
    ...helperApps.sort(byDepthDesc),
    appPath, // 最後に main app
  ];

  console.log(`[codesign-adhoc] 署名対象: ${signOrder.length} 個`);

  const signOne = (target) => {
    const cmd = [
      'codesign',
      '--force',
      '--sign',
      '-',
      '--timestamp=none',
      '--options',
      'runtime',
      '--entitlements',
      `"${ENTITLEMENTS}"`,
      `"${target}"`,
    ].join(' ');
    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch (err) {
      const stderr = err.stderr?.toString() || err.message;
      console.error(`[codesign-adhoc] 失敗: ${target}\n  ${stderr.trim()}`);
      throw err;
    }
  };

  for (const target of signOrder) {
    signOne(target);
  }

  console.log(`[codesign-adhoc] 署名完了`);

  // 検証
  try {
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, {
      stdio: 'pipe',
    });
    console.log(`[codesign-adhoc] 検証 OK`);
  } catch (verifyErr) {
    const stderr = verifyErr.stderr?.toString() || verifyErr.message;
    console.warn(`[codesign-adhoc] 検証警告:\n${stderr}`);
  }
};
