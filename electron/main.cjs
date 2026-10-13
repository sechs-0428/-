const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

app.setName('CareManager');
const DEFAULT_PORT = 43180;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT = 12_000;
const DEV_URL = process.env.CARE_DEV_URL || '';
if (DEV_URL && DEV_URL !== 'http://127.0.0.1:5173') throw new Error('CARE_DEV_URLには http://127.0.0.1:5173 を指定してください。');
const DIST_PATH = path.resolve(__dirname, '../dist');
const INDEX_URL = pathToFileURL(path.join(DIST_PATH, 'index.html')).href;
let mainWindow;
let careServer;
let config = { mode: 'unconfigured' };
let startupError = '';
let closing = false;
let configuring = false;

function configPath() { return path.join(app.getPath('userData'), 'connection.json'); }
function databasePath() { return path.join(app.getPath('userData'), 'CareManager.sqlite'); }
function friendlyError(error) {
  if (error?.code === 'EADDRINUSE') return '指定ポートが使用中です。別のポートを選ぶか、起動中のソフトを確認してください。';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return '接続がタイムアウトしました。共有元のソフトが起動しているか、接続先とファイアウォールを確認してください。';
  if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') return '共有元に接続できません。共有元のソフトが起動しているか、IPアドレスとポートを確認してください。';
  if (error?.message === 'fetch failed') return '共有元に接続できません。接続先とネットワークの状態を確認してください。';
  return error?.message || '処理に失敗しました。';
}

function validateServerUrl(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('接続先を http://192.168.1.10:43180 の形式で入力してください。');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('接続先URLの形式が正しくありません。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('接続先には事業所内サーバーのURLのみを指定してください。');
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  const parts = url.hostname.split('.');
  const octets = parts.map(Number);
  const validIPv4 = parts.length === 4 && parts.every((v, i) => /^\d{1,3}$/.test(v) && octets[i] >= 0 && octets[i] <= 255);
  const [a, b] = octets;
  const privateIPv4 = validIPv4 && (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  if (!privateIPv4) throw new Error('接続先には localhost または事業所内のIPv4アドレス（192.168.x.x など）を指定してください。');
  return url.origin;
}

function validatedConfig(input) {
  if (!input || !['host', 'client'].includes(input.mode)) throw new Error('このPCで共有するか、共有元に接続するかを選択してください。');
  if (input.mode === 'client') return { mode: 'client', serverUrl: validateServerUrl(input.serverUrl) };
  const port = input.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ポートには1024〜65535の整数を指定してください。');
  return { mode: 'host', share: input.share === true, port };
}

function addresses() {
  const results = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        try { results.add(validateServerUrl(`http://${entry.address}:${config.port || DEFAULT_PORT}`)); } catch { /* Only show addresses supported by the connection screen. */ }
      }
    }
  }
  return [...results].sort();
}

function connectionInfo() {
  return {
    mode: config.mode,
    serverUrl: config.mode === 'host' ? `http://127.0.0.1:${config.port}` : config.serverUrl || '',
    dataDir: config.mode === 'host' ? app.getPath('userData') : undefined,
    version: app.getVersion(),
    addresses: config.mode === 'host' && config.share ? addresses() : [],
    share: config.mode === 'host' && config.share === true,
    shared: config.mode === 'host' && config.share === true,
    ...(startupError ? { error: startupError } : {}),
  };
}

async function stopServer() {
  const previous = careServer;
  careServer = undefined;
  if (previous) await previous.close();
}

async function startServer(settings) {
  if (settings.mode !== 'host') return;
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const { createCareServer } = await import(pathToFileURL(path.join(__dirname, '../server/server.mjs')).href);
  careServer = await createCareServer({
    dbPath: databasePath(),
    host: settings.share ? '0.0.0.0' : '127.0.0.1',
    port: settings.port,
    staticDir: DIST_PATH,
  });
}

async function configure(input) {
  if (configuring) throw new Error('接続設定を更新中です。しばらく待ってください。');
  const next = validatedConfig(input);
  const previous = config;
  configuring = true;
  try {
    await stopServer();
    await startServer(next);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const temporary = `${configPath()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, configPath());
    config = next;
    startupError = '';
    return connectionInfo();
  } catch (error) {
    await stopServer().catch(() => {});
    try { await startServer(previous); config = previous; }
    catch (restoreError) { config = { mode: 'unconfigured' }; startupError = friendlyError(restoreError); }
    throw new Error(friendlyError(error));
  } finally { configuring = false; }
}

function assertSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('この操作はアプリの画面から実行してください。');
  }
  const senderUrl = event.senderFrame.url.split('#')[0];
  if (DEV_URL) {
    if (new URL(senderUrl).origin !== new URL(DEV_URL).origin) throw new Error('この画面からは操作できません。');
  } else if (senderUrl !== INDEX_URL) throw new Error('この画面からは操作できません。');
}

function apiUrl(value) {
  if (config.mode === 'unconfigured') throw new Error('先に接続方法を設定してください。');
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/api/') || value.includes('\\') || /[\r\n\0]/.test(value)) throw new Error('APIパスが正しくありません。');
  const base = connectionInfo().serverUrl;
  const url = new URL(value, base);
  if (url.origin !== base || !url.pathname.startsWith('/api/')) throw new Error('APIパスが正しくありません。');
  return url;
}

async function request(input, bytes = false) {
  if (!input || typeof input !== 'object') throw new Error('リクエストが正しくありません。');
  const url = apiUrl(input.path);
  const method = bytes ? 'POST' : (input.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('リクエスト方法が正しくありません。');
  const headers = { accept: 'application/json' };
  if (input.token) {
    if (typeof input.token !== 'string' || input.token.length > 1024 || /[\r\n]/.test(input.token)) throw new Error('認証情報が正しくありません。');
    headers.authorization = `Bearer ${input.token}`;
  }
  let body;
  if (bytes) {
    if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(MAX_BODY_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error('ファイルは10MB以内で指定してください。');
    body = Buffer.from(input.base64, 'base64');
    headers['content-type'] = 'application/octet-stream';
    if (input.filename) headers['x-filename'] = encodeURIComponent(String(input.filename).slice(0, 256));
  } else if (input.body !== undefined) {
    body = JSON.stringify(input.body);
    headers['content-type'] = 'application/json';
  }
  if (body && Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('送信データが10MBを超えています。');
  if (method === 'GET' && body) throw new Error('GETには本文を指定できません。');
  try {
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT), redirect: 'error' });
    const reader = response.body?.getReader();
    const chunks = [];
    let received = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('取得データが10MBを超えています。'); }
        chunks.push(Buffer.from(value));
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let result;
    try { result = raw ? JSON.parse(raw) : {}; } catch { throw new Error('共有元から正しい応答を受信できませんでした。'); }
    if (!response.ok) throw new Error(result.error?.message || result.error || result.message || `処理に失敗しました（${response.status}）。`);
    return result;
  } catch (error) { throw new Error(friendlyError(error)); }
}

function registerIpc() {
  const handle = (name, callback) => ipcMain.handle(`care:${name}`, async (event, input) => {
    assertSender(event);
    return callback(input);
  });
  handle('info', () => connectionInfo());
  handle('configure', configure);
  handle('request', input => request(input));
  handle('requestBytes', input => request(input, true));
  handle('saveBackup', async input => {
    const json = typeof input?.json === 'string' ? input.json : JSON.stringify(input?.json, null, 2);
    if (!json || Buffer.byteLength(json) > MAX_BODY_BYTES) throw new Error('バックアップデータが正しくないか、10MBを超えています。');
    try { JSON.parse(json); } catch { throw new Error('バックアップはJSON形式で指定してください。'); }
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: 'バックアップを保存', defaultPath: path.basename(input?.filename || `CareManager-backup-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'JSONバックアップ', extensions: ['json'] }] });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, json, { mode: 0o600 });
    return { canceled: false, filePath };
  });
  handle('pdf', async input => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: 'PDFを保存', defaultPath: path.basename(input?.filename || 'CareManager.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return { canceled: true };
    const data = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
    await fs.writeFile(filePath, data);
    return { canceled: false, filePath };
  });
  handle('print', () => new Promise((resolve, reject) => {
    mainWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      if (success) resolve({ printed: true });
      else if (/cancel/i.test(reason)) resolve({ printed: false, canceled: true });
      else reject(new Error(reason || '印刷できませんでした。'));
    });
  }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460, height: 960, minWidth: 1050, minHeight: 720,
    title: 'ケアマネ業務管理', backgroundColor: '#f4f7fa',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? new URL(url).origin === new URL(DEV_URL).origin : url.split('#')[0] === INDEX_URL;
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(DIST_PATH, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    const dataDirectory = path.join(app.getPath('appData'), 'CareManager');
    await fs.mkdir(dataDirectory, { recursive: true });
    app.setPath('userData', dataDirectory);
    try {
      const saved = JSON.parse(await fs.readFile(configPath(), 'utf8'));
      config = validatedConfig(saved);
      await startServer(config);
    } catch (error) {
      if (error.code !== 'ENOENT') startupError = friendlyError(error);
      config = { mode: 'unconfigured' };
    }
    registerIpc();
    createWindow();
  }).catch(error => { dialog.showErrorBox('起動できませんでした', friendlyError(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!closing && careServer) {
      event.preventDefault();
      closing = true;
      stopServer().catch(() => {}).finally(() => app.quit());
    }
  });
}
