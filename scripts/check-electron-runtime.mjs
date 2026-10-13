import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(process.platform, 'linux', 'This check records Linux Electron runtime evidence only.');
assert.equal(process.versions.electron, manifest.devDependencies.electron, 'Run this check with the pinned Linux Electron binary and ELECTRON_RUN_AS_NODE=1.');

const nativeDatabase = new DatabaseSync(':memory:');
nativeDatabase.exec('CREATE TABLE runtime_check (value TEXT)');
nativeDatabase.prepare('INSERT INTO runtime_check VALUES (?)').run('sqlite-ok');
assert.equal(nativeDatabase.prepare('SELECT value FROM runtime_check').get().value, 'sqlite-ok');
const sqliteVersion = nativeDatabase.prepare('SELECT sqlite_version() AS version').get().version;
nativeDatabase.close();

const asar = path.join(root, 'release/win-unpacked/resources/app.asar');
const packagedManifest = JSON.parse(await fs.readFile(path.join(asar, 'package.json'), 'utf8'));
assert.equal(packagedManifest.name, manifest.name);
assert.equal(packagedManifest.version, manifest.version);
const { openStore } = await import(pathToFileURL(path.join(asar, 'server/store.mjs')).href);
const store = openStore(':memory:');
assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM residents').get().count, 0);
store.db.close();

const { createCareServer } = await import(pathToFileURL(path.join(asar, 'server/server.mjs')).href);
const app = await createCareServer({ dbPath: ':memory:', host: '127.0.0.1', port: 0, staticDir: path.join(asar, 'dist') });
let assetCount = 0;
try {
  let token;
  const call = async (pathname, method = 'GET', body) => {
    const response = await fetch(app.url + pathname, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json();
    assert(response.ok, `${response.status} ${result.code || ''}`);
    return result;
  };
  assert.equal((await call('/api/health')).configured, false);
  token = (await call('/api/setup', 'POST', { username: 'runtime-test', password: 'runtime-test-only-123', displayName: '合成テスト管理者', facilityName: '検証専用' })).token;
  const person = await call('/api/residents', 'POST', { resident: { chartNumber: 'RUNTIME-001', name: '合成テスト利用者', creationMonth: '2026-10' } });
  assert.equal(person.revision, 1);
  assert.equal((await call(`/api/residents/${person.id}`, 'PUT', { resident: { ...person, notes: '実行環境確認用' }, revision: 1 })).revision, 2);
  assert.equal((await call(`/api/residents/${person.id}`, 'DELETE', { revision: 2 })).status, 'discharged');
  assert.equal((await call('/api/state')).residents.length, 1);
  const response = await fetch(app.url + '/', { signal: AbortSignal.timeout(12_000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert(assets.length >= 2, 'Packaged index must reference JavaScript and CSS assets.');
  for (const asset of assets) assert.equal((await fetch(new URL(asset, app.url), { signal: AbortSignal.timeout(12_000) })).status, 200);
  assetCount = assets.length;
} finally { await app.close(); }

const serverTests = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', 'tests/server.test.mjs'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    output += chunk.toString('utf8');
    if (output.length > 2 * 1024 * 1024) { child.kill(); reject(new Error('Electron server test output exceeded its limit.')); }
  });
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) { console.error(output); reject(new Error(`Server tests failed in Electron with exit code ${code}.`)); return; }
    const total = Number(/# tests (\d+)/.exec(output)?.[1]);
    const passed = Number(/# pass (\d+)/.exec(output)?.[1]);
    const failed = Number(/# fail (\d+)/.exec(output)?.[1]);
    if (!(total >= 13 && passed === total && failed === 0)) { reject(new Error('Electron server test summary is incomplete or contains failures.')); return; }
    resolve({ total, passed, failed, runtime: 'Linux Electron embedded Node' });
  });
});

const result = {
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  electron: process.versions.electron,
  node: process.versions.node,
  sqlite: sqliteVersion,
  nativeSqlite: 'passed',
  packagedAsarStore: 'passed',
  packagedAsarHttpCRUD: 'passed',
  packagedAsarStaticAssets: 'passed',
  checkedAssetCount: assetCount,
  port: 'ephemeral',
  serverTests,
  windowsRuntimeValidated: false,
};
await fs.writeFile(path.join(root, 'release/electron-linux-runtime-check.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Linux Electron ${result.electron} / Node ${result.node}: SQLite, packaged ASAR store, HTTP CRUD, ${assetCount} static assets, and ${serverTests.passed}/${serverTests.total} server tests passed. Windows runtime validation is pending.`);
