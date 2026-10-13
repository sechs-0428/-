import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cacheRoot = root.startsWith('/workspace/') ? '/workspace/.care-build-cache' : path.join(os.tmpdir(), 'care-manager-build-cache');
const environment = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(cacheRoot, 'electron'),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || path.join(cacheRoot, 'builder'),
};
await Promise.all([fs.mkdir(environment.ELECTRON_CACHE, { recursive: true }), fs.mkdir(environment.ELECTRON_BUILDER_CACHE, { recursive: true })]);
const release = path.join(root, 'release');
await fs.mkdir(release, { recursive: true });
await fs.rm(path.join(release, 'windows-artifact.json'), { force: true });
await fs.rm(path.join(release, 'windows-uninstaller-check.json'), { force: true });

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with status ${code}`)));
  });
}

try {
  const npmPath = process.env.npm_execpath;
  if (npmPath) await run(process.execPath, [npmPath, 'run', 'build']);
  else await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { shell: process.platform === 'win32' });
  let uninstallerCheck;
  if (process.platform === 'linux') {
    // electron-builder 26.15.3 already uses this NSIS reader on macOS where Wine
    // is unavailable. Its portable Linux Wine bundle lacks the required Windows
    // DLLs. Apply the same reader only to this app's NSIS intermediate executable,
    // without editing dependencies, executable bytes, or verification settings.
    const builderManifest = require('electron-builder/package.json');
    if (builderManifest.version !== '26.15.3') throw new Error('The Linux NSIS workaround requires electron-builder 26.15.3. Revalidate it before changing the pinned version.');
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const expectedInstaller = path.join(release, `${manifest.build.productName} Setup ${manifest.version}.exe`);
    const { WineVmManager } = require('app-builder-lib/out/vm/WineVm.js');
    const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil.js');
    const originalExec = WineVmManager.prototype.exec;
    WineVmManager.prototype.exec = async function (filename, args, options) {
      if (path.resolve(filename) !== expectedInstaller || !Array.isArray(args) || args.length !== 0 || options?.env?.__COMPAT_LAYER !== 'RunAsInvoker') {
        throw new Error('Unexpected Windows executable request during Linux packaging. Refusing to execute it.');
      }
      const uninstallerPath = path.join(release, `${path.basename(filename, 'exe')}__uninstaller.exe`);
      await UninstallerReader.exec(filename, uninstallerPath);
      const data = await fs.readFile(uninstallerPath);
      if (data.subarray(0, 2).toString('ascii') !== 'MZ' || data.length < 0x40) throw new Error('Extracted NSIS uninstaller has an invalid DOS header.');
      const peOffset = data.readUInt32LE(0x3c);
      if (peOffset + 6 > data.length || data.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\0\0') throw new Error('Extracted NSIS uninstaller has an invalid PE header.');
      const nsisSignature = Buffer.from([0xef, 0xbe, 0xad, 0xde, 0x4e, 0x75, 0x6c, 0x6c, 0x73, 0x6f, 0x66, 0x74, 0x49, 0x6e, 0x73, 0x74]);
      if (!data.includes(nsisSignature)) throw new Error('Extracted uninstaller has no NSIS signature.');
      uninstallerCheck = {
        builderVersion: builderManifest.version,
        method: 'electron-builder built-in UninstallerReader',
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        peHeaderValid: true,
        nsisSignatureValid: true,
        windowsRuntimeValidated: false,
      };
      await fs.writeFile(path.join(release, 'windows-uninstaller-check.json'), `${JSON.stringify(uninstallerCheck, null, 2)}\n`);
      console.log('NSIS uninstaller extracted and checked with the pinned builder reader.');
      return '';
    };
    process.env.ELECTRON_BUILDER_CACHE = environment.ELECTRON_BUILDER_CACHE;
    process.env.ELECTRON_CACHE = environment.ELECTRON_CACHE;
    try {
      const { build } = require('electron-builder');
      await build({ projectDir: root, win: ['nsis'], x64: true, publish: 'never', config: { electronDownload: { cache: environment.ELECTRON_CACHE } } });
    } finally { WineVmManager.prototype.exec = originalExec; }
    if (!uninstallerCheck) throw new Error('The expected NSIS uninstaller extraction did not run.');
  } else {
    const builderArgs = [path.join(root, 'node_modules/electron-builder/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', `--config.electronDownload.cache=${environment.ELECTRON_CACHE}`];
    if (process.platform !== 'win32') builderArgs.push('--config.toolsets.wine=1.0.1');
    await run(process.execPath, builderArgs);
  }
  await run(process.execPath, [path.join(root, 'scripts/check-package.mjs')]);
  let linuxRuntimeCheck;
  if (process.platform === 'linux') {
    const linuxElectron = path.join(root, 'node_modules/electron/dist/electron');
    let runtimePresent = true;
    try { await fs.access(linuxElectron); } catch { runtimePresent = false; }
    if (runtimePresent) {
      await run(linuxElectron, [path.join(root, 'scripts/check-electron-runtime.mjs')], { env: { ...environment, ELECTRON_RUN_AS_NODE: '1' } });
      linuxRuntimeCheck = JSON.parse(await fs.readFile(path.join(release, 'electron-linux-runtime-check.json'), 'utf8'));
    }
  }
  const installers = (await fs.readdir(release)).filter(name => name.endsWith('.exe'));
  const artifacts = [];
  for (const name of installers) {
    const filename = path.join(release, name);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    artifacts.push({ file: name, bytes: (await fs.stat(filename)).size, sha256: hash.digest('hex') });
  }
  await fs.writeFile(path.join(release, 'windows-artifact.json'), `${JSON.stringify({
    builtAt: new Date().toISOString(),
    buildPlatform: process.platform,
    target: 'Windows 10/11 x64',
    windowsRuntimeValidated: false,
    note: 'Installer and packaged files were checked. Installation, shared-PC connectivity, printing, and Windows Firewall behavior still require validation on Windows.',
    artifacts,
    ...(uninstallerCheck ? { uninstallerCheck } : {}),
    ...(linuxRuntimeCheck ? { linuxRuntimeCheck } : {}),
  }, null, 2)}\n`);
  console.log('Windows installer created in release/. Windows installation and operation must be checked on a Windows PC.');
} catch (error) {
  console.error(`Windows packaging failed: ${error.message}`);
  process.exitCode = 1;
}
