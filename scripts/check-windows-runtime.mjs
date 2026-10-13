import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

assert.equal(process.platform,'win32','Run this check on Windows with a freshly packaged app.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const executable=path.join(root,'release','win-unpacked','CareManager.exe');
const program=`
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE runtime_check (value INTEGER); INSERT INTO runtime_check VALUES (24)');
assert.equal(db.prepare('SELECT value FROM runtime_check').get().value,24);
const sqlite=db.prepare('SELECT sqlite_version() AS version').get().version;
db.close();
console.log(JSON.stringify({platform:process.platform,electron:process.versions.electron,node:process.versions.node,sqlite,nativeSqlite:'passed',installationAndGUIValidated:false}));
`;
const result=spawnSync(executable,['-e',program],{
  cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},
  encoding:'utf8',windowsHide:true,timeout:30000,
});
if(result.error)throw result.error;
if(result.status!==0)throw new Error(`Packaged runtime check failed (${result.status ?? result.signal}). ${result.stderr || ''}`);
const report=JSON.parse(result.stdout.trim());
assert.equal(report.platform,'win32');
assert.equal(report.nativeSqlite,'passed');
await fs.writeFile(path.join(root,'release','electron-windows-runtime-check.json'),JSON.stringify({...report,checkedAt:new Date().toISOString()},null,2)+'\n');
console.log('Windows packaged Electron SQLite check passed. Installation and GUI verification remain pending.');
