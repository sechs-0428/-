import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'electron/main.cjs'), 'utf8');

function createMainContext({ fetchImpl = fetch, developmentUrl = '' } = {}) {
  const electron = {
    app: {
      setName: () => {},
      requestSingleInstanceLock: () => true,
      on: () => {},
      whenReady: () => new Promise(() => {}),
      getVersion: () => '0.1.0',
      getPath: () => '/tmp/care-desktop-test-data',
    },
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : require(name),
    __dirname: path.join(root, 'electron'),
    process: { env: developmentUrl ? { CARE_DEV_URL: developmentUrl } : {} },
    URL, Buffer, AbortSignal, console, fetch: fetchImpl,
  });
  vm.runInContext(source, context);
  return { context, evaluate: value => vm.runInContext(value, context) };
}

test('desktop connection settings allow loopback and private IPv4 only', () => {
  const { evaluate } = createMainContext();
  for (const url of ['http://192.168.1.2:43180', 'http://172.16.0.2:43180', 'http://10.0.0.2:43180', 'http://127.0.0.1:43180']) {
    assert.equal(evaluate(`validateServerUrl(${JSON.stringify(url)})`), url);
  }
  assert.equal(evaluate('validateServerUrl("http://localhost:43180")'), 'http://127.0.0.1:43180');
  for (const url of ['http://8.8.8.8:43180', 'http://172.32.0.2:43180', 'http://192.168.1.2/api/health', 'http://user:password@192.168.1.2', 'file:///tmp/x', 'http://example.com', 'http://192.168.1.2#fragment']) {
    assert.throws(() => evaluate(`validateServerUrl(${JSON.stringify(url)})`), undefined, url);
  }
});

test('desktop host is private by default and rejects invalid ports', () => {
  const { evaluate } = createMainContext();
  assert.equal(evaluate('validatedConfig({mode:"host"}).share'), false);
  assert.equal(evaluate('validatedConfig({mode:"host",share:true,port:43181}).port'), 43181);
  for (const port of [0, 80, 65536, '43180', 43180.5]) assert.throws(() => evaluate(`validatedConfig({mode:"host",port:${JSON.stringify(port)}})`));
  evaluate('config={mode:"host",port:43180,share:true}');
  assert.equal(evaluate('connectionInfo().share'), true);
  assert.equal(evaluate('connectionInfo().shared'), true);
});

test('desktop requests cannot escape the configured API origin or path', () => {
  const { evaluate } = createMainContext();
  evaluate('config={mode:"client",serverUrl:"http://192.168.1.2:43180"}');
  assert.equal(evaluate('apiUrl("/api/health").href'), 'http://192.168.1.2:43180/api/health');
  for (const value of ['https://8.8.8.8/api/test', '//8.8.8.8/api/test', '/api/../outside', '/api/%2e%2e/outside', '/api/\\\\8.8.8.8', '/api/test\n']) {
    assert.throws(() => evaluate(`apiUrl(${JSON.stringify(value)})`), undefined, value);
  }
});

test('desktop IPC permits only the owning main renderer frame', () => {
  const { context, evaluate } = createMainContext();
  const frame = { url: evaluate('INDEX_URL') };
  const webContents = { mainFrame: frame };
  context.testWindow = { webContents };
  evaluate('mainWindow=testWindow');
  context.testEvent = { sender: webContents, senderFrame: frame };
  assert.doesNotThrow(() => evaluate('assertSender(testEvent)'));
  context.testEvent = { sender: {}, senderFrame: frame };
  assert.throws(() => evaluate('assertSender(testEvent)'));
  context.testEvent = { sender: webContents, senderFrame: { url: frame.url } };
  assert.throws(() => evaluate('assertSender(testEvent)'));
  frame.url = 'https://example.com';
  context.testEvent = { sender: webContents, senderFrame: frame };
  assert.throws(() => evaluate('assertSender(testEvent)'));
});

test('desktop development bridge cannot be enabled for an external page', () => {
  assert.doesNotThrow(() => createMainContext({ developmentUrl: 'http://127.0.0.1:5173' }));
  assert.throws(() => createMainContext({ developmentUrl: 'https://example.com' }));
});

test('desktop JSON and workbook requests carry authentication without following redirects', async () => {
  const calls = [];
  const { evaluate } = createMainContext({ fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } });
  evaluate('config={mode:"client",serverUrl:"http://192.168.1.2:43180"}');
  assert.equal((await evaluate('request({path:"/api/clients",method:"POST",body:{name:"sample"},token:"test-session"})')).ok, true);
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-session');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body, '{"name":"sample"}');
  assert.equal((await evaluate('request({path:"/api/import/preview",base64:"YWJj",filename:"test.xlsm",token:"test-session"},true)')).ok, true);
  assert.equal(calls[1].options.headers['content-type'], 'application/octet-stream');
  assert.equal(calls[1].options.body.toString('utf8'), 'abc');
  await assert.rejects(evaluate('request({path:"/api/health",token:"bad\\r\\nheader"})'));
  assert.equal(calls.length, 2);
});

test('desktop exposes server errors and rejects oversized responses', async () => {
  const failed = createMainContext({ fetchImpl: async () => new Response(JSON.stringify({ error: '権限がありません。' }), { status: 403 }) });
  failed.evaluate('config={mode:"client",serverUrl:"http://192.168.1.2:43180"}');
  await assert.rejects(failed.evaluate('request({path:"/api/users"})'), /権限がありません/);
  const oversized = createMainContext({ fetchImpl: async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)) });
  oversized.evaluate('config={mode:"client",serverUrl:"http://192.168.1.2:43180"}');
  await assert.rejects(oversized.evaluate('request({path:"/api/backup"})'), /10MB/);
});

test('desktop preload displays the reason without Electron IPC prefixes', async () => {
  const preloadSource = await fs.readFile(path.join(root, 'electron/preload.cjs'), 'utf8');
  let exposed;
  let failure = "Error invoking remote method 'care:request': Error: 権限がありません。";
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'careDesktop'); exposed = value; } },
    ipcRenderer: { invoke: async () => { throw new Error(failure); } },
  };
  vm.runInNewContext(preloadSource, { require: name => { assert.equal(name, 'electron'); return electron; } });
  await assert.rejects(exposed.request({ path: '/api/users' }), error => error.message === '権限がありません。');
  failure = '共有元に接続できません。';
  await assert.rejects(exposed.info(), error => error.message === '共有元に接続できません。');
});
