const { contextBridge, ipcRenderer } = require('electron');

async function invoke(name, input) {
  try { return await ipcRenderer.invoke(`care:${name}`, input); }
  catch (error) {
    const message = (error?.message || '処理に失敗しました。').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, '');
    throw new Error(message);
  }
}

contextBridge.exposeInMainWorld('careDesktop', Object.freeze({
  info: () => invoke('info'),
  configure: input => invoke('configure', input),
  request: input => invoke('request', input),
  requestBytes: input => invoke('requestBytes', input),
  saveBackup: input => invoke('saveBackup', input),
  pdf: input => invoke('pdf', input),
  print: () => invoke('print'),
}));
