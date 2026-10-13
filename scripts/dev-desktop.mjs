import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteUrl = 'http://127.0.0.1:5173';
const children = new Set();
let stopping = false;

function start(command, args, extraEnvironment = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...extraEnvironment }, stdio: 'inherit' });
  children.add(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('close', code => { children.delete(child); if (!stopping) stop(code || 0); });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

start(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
try {
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    try { ready = (await fetch(viteUrl, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Wait for Vite startup. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready || stopping) throw new Error('Vite development server did not start on port 5173.');
  const binaryFile = path.join(root, 'node_modules/electron/path.txt');
  try { await fs.access(binaryFile); }
  catch { throw new Error('Electron runtime is missing. Install it with ELECTRON_SKIP_BINARY_DOWNLOAD unset, or run node node_modules/electron/install.js. Linux desktop execution also needs a graphical session.'); }
  start(process.execPath, [path.join(root, 'node_modules/electron/cli.js'), '.'], { CARE_DEV_URL: viteUrl });
} catch (error) {
  console.error(error.message);
  stop(1);
}
