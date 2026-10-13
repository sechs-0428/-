import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { listPackage, extractFile } = require('@electron/asar');
// ASAR's lookup splits by the host OS separator, while the inventory below is
// normalized to forward slashes for comparisons. Convert back for extraction.
const extractAppFile = filename => extractFile(asar, path.normalize(filename));
const appDirectory = path.join(root, 'release/win-unpacked');
const asar = path.join(appDirectory, 'resources/app.asar');
const releaseFiles = await fs.readdir(path.join(root, 'release'));
const installers = releaseFiles.filter(name => name.endsWith('.exe'));
assert(installers.length > 0, 'No Windows installer found in release/.');
if (process.platform === 'linux') {
  const uninstaller = JSON.parse(await fs.readFile(path.join(root, 'release/windows-uninstaller-check.json'), 'utf8'));
  assert.equal(uninstaller.builderVersion, '26.15.3');
  assert.equal(uninstaller.peHeaderValid, true);
  assert.equal(uninstaller.nsisSignatureValid, true);
  assert.match(uninstaller.sha256, /^[a-f0-9]{64}$/);
  assert(uninstaller.bytes > 50_000, 'Extracted NSIS uninstaller is unexpectedly small.');
}

for (const filename of [path.join(appDirectory, 'CareManager.exe'), ...installers.map(name => path.join(root, 'release', name))]) {
  const file = await fs.open(filename, 'r');
  try {
    const header = Buffer.alloc(2);
    await file.read(header, 0, 2, 0);
    assert.equal(header.toString('ascii'), 'MZ', `${path.basename(filename)} is not a Windows executable.`);
    assert((await file.stat()).size > 1_000_000, `${path.basename(filename)} is unexpectedly small.`);
    if (filename === path.join(appDirectory, 'CareManager.exe')) {
      const offset = Buffer.alloc(4);
      await file.read(offset, 0, 4, 0x3c);
      const pe = Buffer.alloc(6);
      await file.read(pe, 0, 6, offset.readUInt32LE());
      assert.equal(pe.subarray(0, 4).toString('binary'), 'PE\0\0', 'Application PE header is invalid.');
      assert.equal(pe.readUInt16LE(4), 0x8664, 'Application must target Windows x64.');
    }
  } finally { await file.close(); }
}

const files = listPackage(asar).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
for (const required of ['package.json', 'dist/index.html', 'electron/main.cjs', 'electron/preload.cjs', 'server/server.mjs']) {
  assert(files.includes(required), `Missing packaged file: ${required}`);
}
assert(!files.some(name => /\.xlsm$/i.test(name)), 'The installer must not contain a workbook with client records.');
assert(!files.some(name => /(?:^|\/)(?:CareManager\.sqlite|connection\.json|\.env(?:\..*)?)$/i.test(name)), 'The installer must not contain local settings, credentials, or a client database.');
let synchronizedFiles = 0;
for (const filename of files.filter(name => /^(?:dist|electron|server)\//.test(name))) {
  if (!(await fs.stat(path.join(root, filename))).isFile()) continue;
  assert.deepEqual(extractAppFile(filename), await fs.readFile(path.join(root, filename)), `Packaged file differs from the current build/source: ${filename}`);
  synchronizedFiles++;
}
const manifest = JSON.parse(extractAppFile('package.json').toString('utf8'));
assert.equal(manifest.main, 'electron/main.cjs');
const index = extractAppFile('dist/index.html').toString('utf8');
assert(/Content-Security-Policy/i.test(index), 'Packaged renderer must specify a Content Security Policy.');
assert(!/(?:src|href)="\/assets\//.test(index), 'Vite assets must use relative paths for the installed desktop app.');
console.log(`Package check passed: ${installers.join(', ')}; ${files.length} packaged entries; ${synchronizedFiles} app files match current sources/build${process.platform === 'linux' ? '; NSIS uninstaller headers and signature verified' : ''}. Actual Windows runtime validation is pending.`);
