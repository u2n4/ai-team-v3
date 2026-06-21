#!/usr/bin/env node
/**
 * Self-healing Electron binary check.
 *
 * On some Windows setups, `npm install` reports a "Cache hit" for the Electron
 * download but the extraction into node_modules/electron/dist/ silently fails,
 * leaving the package without an electron.exe or path.txt. The app then refuses
 * to launch even though `npm install` exited 0.
 *
 * This postinstall verifies the binary is present and, if it is missing,
 * repairs it from the local @electron/get cache. It is intentionally
 * defensive: it NEVER throws and ALWAYS exits 0, because a failing postinstall
 * would abort the whole `npm install`. A genuine failure here only means the
 * user has to run Electron's own installer manually — it never breaks the
 * dependency install itself.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

function log(msg) {
  console.log(`[postinstall-electron] ${msg}`);
}

/** Resolve the platform-specific executable name inside dist/. */
function expectedExecutable(platform) {
  if (platform === 'win32') return 'electron.exe';
  if (platform === 'darwin') return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
  return 'electron';
}

/** True when node_modules/electron/dist holds a usable binary. */
function isHealthy(electronDir, platform) {
  const distDir = path.join(electronDir, 'dist');
  const exe = path.join(distDir, expectedExecutable(platform));
  if (!fs.existsSync(exe)) return false;
  // A valid extraction is tens/hundreds of MB; guard against a truncated stub.
  try {
    const { size } = fs.statSync(exe);
    if (platform === 'win32' && size < 1_000_000) return false;
  } catch {
    return false;
  }
  return true;
}

/** Candidate @electron/get cache roots, most-specific first. */
function cacheRoots() {
  const roots = [];
  if (process.env.electron_config_cache) roots.push(process.env.electron_config_cache);
  if (process.env.ELECTRON_CACHE) roots.push(process.env.ELECTRON_CACHE);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, 'electron', 'Cache'));
  }
  if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Caches', 'electron'));
  }
  roots.push(path.join(os.homedir(), '.cache', 'electron')); // linux / xdg fallback
  return roots.filter(Boolean);
}

/** Find the cached zip for this electron version, searching one level deep. */
function findCachedZip(zipName) {
  for (const root of cacheRoots()) {
    if (!fs.existsSync(root)) continue;
    // @electron/get stores zips under a per-url hash subdir.
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const direct = path.join(root, zipName);
    if (fs.existsSync(direct)) return direct;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const candidate = path.join(root, e.name, zipName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Extract zip into destDir using a platform-native unzip. */
function extractZip(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    // PowerShell Expand-Archive: -Force overwrites the partial extraction.
    execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
       `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destDir}' -Force`],
      { stdio: 'ignore' }
    );
  } else {
    execFileSync('unzip', ['-o', '-q', zip, '-d', destDir], { stdio: 'ignore' });
  }
}

function main() {
  const platform = process.platform;
  let electronDir;
  try {
    // Resolve the installed electron package next to this project.
    electronDir = path.dirname(require.resolve('electron/package.json'));
  } catch {
    log('electron package not installed (e.g. --ignore-scripts); skipping.');
    return;
  }

  if (isHealthy(electronDir, platform)) {
    log('electron binary present — OK.');
    return;
  }

  log('electron binary missing or incomplete — attempting repair from cache.');

  let version;
  try {
    version = require(path.join(electronDir, 'package.json')).version;
  } catch {
    log('could not read electron version; run `node node_modules/electron/install.js` manually.');
    return;
  }

  const arch = process.arch; // x64 / arm64 / ...
  const zipName = `electron-v${version}-${platform}-${arch}.zip`;
  const zip = findCachedZip(zipName);

  if (!zip) {
    log(`no cached ${zipName} found; run \`node node_modules/electron/install.js\` to download it.`);
    return;
  }

  const distDir = path.join(electronDir, 'dist');
  try {
    extractZip(zip, distDir);
  } catch (err) {
    log(`extraction failed (${err && err.message}); run \`node node_modules/electron/install.js\` manually.`);
    return;
  }

  if (!isHealthy(electronDir, platform)) {
    log('extraction completed but binary still not found; run electron installer manually.');
    return;
  }

  // electron/index.js reads dist/<contents of path.txt> to locate the binary.
  try {
    fs.writeFileSync(path.join(electronDir, 'path.txt'), expectedExecutable(platform));
  } catch (err) {
    log(`extracted binary but failed to write path.txt (${err && err.message}).`);
    return;
  }

  log(`repaired electron ${version} from cache.`);
}

try {
  main();
} catch (err) {
  // Never break `npm install`.
  log(`unexpected error, skipping (${err && err.message}).`);
}
process.exit(0);
