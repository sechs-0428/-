import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createCareServer } from '../server/server.mjs';
import ExcelJS from 'exceljs';

const PASSWORD = 'test-password-123';
const resident = (overrides = {}) => ({ chartNumber: 'TEST-001', name: 'テスト利用者', room: '101', creationMonth: '2026-10', planStartMonth: '2026-10', planEndMonth: '2026-12', restraint: false, ...overrides });

async function request(app, path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(app.url + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data; try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data, headers: response.headers };
}

function requestWithHost(app, path, host, { token, origin } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(app.url + path, { headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

async function setup(app) {
  const result = await request(app, '/api/setup', { method: 'POST', body: { displayName: '管理者テスト', username: 'admin', password: PASSWORD, facilityName: 'テスト施設' } });
  assert.equal(result.status, 201);
  assert.equal(result.data.user.role, 'admin');
  assert.equal(result.data.user.password_hash, undefined);
  return result.data;
}

test('authentication, explicit roles, last administrator and session revocation', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  assert.deepEqual((await request(app, '/api/health')).data, { ok: true, configured: false, version: '0.1.0' });
  assert.equal((await request(app, '/api/state')).status, 401);
  const admin = await setup(app);
  assert.equal((await request(app, '/api/setup', { method: 'POST', body: { username: 'another', displayName: '他', password: PASSWORD } })).status, 409);
  assert.equal((await request(app, '/api/users/' + admin.user.id, { token: admin.token, method: 'PUT', body: { disabled: true } })).data.code, 'LAST_ADMIN');
  assert.equal((await request(app, '/api/users/' + admin.user.id, { token: admin.token, method: 'PUT', body: { role: 'staff' } })).data.code, 'LAST_ADMIN');
  const staffResult = await request(app, '/api/users', { token: admin.token, method: 'POST', body: { displayName: '職員テスト', username: 'staff', password: PASSWORD, role: 'staff' } });
  assert.equal(staffResult.status, 201);
  assert.equal((await request(app, '/api/login', { method: 'POST', body: { username: 'staff', password: 'incorrect-password' } })).status, 401);
  const staff = (await request(app, '/api/login', { method: 'POST', body: { username: 'staff', password: PASSWORD } })).data;
  for (const path of ['/api/backup', '/api/settings']) assert.equal((await request(app, path, { token: staff.token })).status, 403);
  assert.equal((await request(app, '/api/users', { token: staff.token, method: 'POST', body: { username: 'bad', displayName: 'bad', password: PASSWORD } })).status, 403);
  const staffState = (await request(app, '/api/state', { token: staff.token })).data;
  assert.equal(staffState.users, undefined); assert.equal(staffState.audit, undefined);
  assert.equal((await request(app, '/api/users/' + staff.user.id, { token: admin.token, method: 'PUT', body: { disabled: true } })).status, 200);
  assert.equal((await request(app, '/api/state', { token: staff.token })).status, 401);
  const logout = await request(app, '/api/logout', { token: admin.token, method: 'POST', body: {} });
  assert.equal(logout.status, 200); assert.equal((await request(app, '/api/state', { token: admin.token })).status, 401);
});

test('resident CRUD uses revisions, keeps archived records and persists across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'care-db-test-'));
  const dbPath = join(directory, 'care.sqlite');
  let app = await createCareServer({ dbPath, port: 0 });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const admin = await setup(app);
  const created = await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident() } });
  assert.equal(created.status, 201); assert.equal(created.data.revision, 1);
  assert.equal((await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident() } })).data.code, 'DUPLICATE_CHART');
  const edited = { ...created.data, notes: '変更内容のテスト' };
  const updated = await request(app, `/api/residents/${edited.id}`, { token: admin.token, method: 'PUT', body: { resident: edited, revision: 1 } });
  assert.equal(updated.status, 200); assert.equal(updated.data.revision, 2);
  assert.equal((await request(app, `/api/residents/${edited.id}`, { token: admin.token, method: 'PUT', body: { resident: edited, revision: 1 } })).data.code, 'REVISION_CONFLICT');
  assert.equal((await request(app, `/api/residents/${edited.id}`, { token: admin.token, method: 'DELETE', body: { revision: 2 } })).data.status, 'discharged');
  await app.close();
  app = await createCareServer({ dbPath, port: 0 });
  assert.equal((await request(app, '/api/state', { token: admin.token })).status, 401);
  const login = (await request(app, '/api/login', { method: 'POST', body: { username: 'admin', password: PASSWORD } })).data;
  const state = (await request(app, '/api/state', { token: login.token })).data;
  assert.equal(state.residents.length, 1); assert.equal(state.residents[0].status, 'discharged');
  assert.equal(state.residents[0].notes, '変更内容のテスト'); assert.equal(state.residents[0].revision, 3);
  assert(state.audit.some(event => event.action === 'resident.archive'));
  const backup = (await request(app, '/api/backup', { token: login.token })).data;
  assert.equal(backup.schemaVersion, 1); assert.equal(backup.residents.length, 1);
  for (const sensitive of ['password_hash', 'passwordHash', 'salt', 'token', 'users']) assert(!JSON.stringify(backup).includes(`"${sensitive}"`));
});

test('monthly batch filters active due residents, assigns authors and preserves date snapshots', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  const currentSettings = (await request(app, '/api/state', { token: admin.token })).data.settings;
  await request(app, '/api/settings', { token: admin.token, method: 'PUT', body: { settings: { meeting1Date: '2026-10-15' }, revision: currentSettings.revision } });
  const records = [];
  for (const data of [
    resident({ chartNumber: 'TEST-A', room: '103' }),
    resident({ chartNumber: 'TEST-B', room: '101', restraint: true }),
    resident({ chartNumber: 'TEST-C', room: '102' }),
    resident({ chartNumber: 'TEST-D', creationMonth: '2026-11' }),
    resident({ chartNumber: 'TEST-E', status: 'discharged' }),
  ]) records.push((await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: data } })).data);
  const batchBody = { targetMonth: '2026-10', authorNames: ['職員A', '職員B'], meetingRound: 1, periodMode: 'certification' };
  const batch = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body: batchBody });
  assert.equal(batch.status, 201); assert.equal(batch.data.created, 3); assert.equal(batch.data.skipped, 0);
  assert.deepEqual(batch.data.plans.map(plan => plan.creator), ['職員A', '職員B', '職員A']);
  const plan = batch.data.plans[0];
  assert.equal(plan.residentId, records[1].id); assert.equal(plan.periodStartDate, '2026-10-01'); assert.equal(plan.periodEndDate, '2026-12-31'); assert.equal(plan.restraint, true); assert.equal(plan.meetingDate, '2026-10-15');
  const repeat = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body: batchBody });
  assert.equal(repeat.data.created, 0); assert.equal(repeat.data.skipped, 3);
  const unsupported = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body: { ...batchBody, periodMode: 'threeMonths' } });
  assert.equal(unsupported.data.code, 'UNSUPPORTED_PERIOD_MODE');
  await request(app, `/api/residents/${records[1].id}`, { token: admin.token, method: 'PUT', body: { resident: { ...records[1], planEndMonth: '2027-01', restraint: false }, revision: 1 } });
  const snapshot = (await request(app, '/api/state', { token: admin.token })).data.plans.find(value => value.id === plan.id);
  assert.equal(snapshot.periodEndDate, '2026-12-31'); assert.equal(snapshot.restraint, true);
  const completed = await request(app, `/api/plans/${plan.id}`, { token: admin.token, method: 'PUT', body: { plan: { ...plan, consentStatus: '回収済' }, revision: plan.revision } });
  assert.equal(completed.status, 200);
  assert.equal((await request(app, `/api/plans/${plan.id}`, { token: admin.token, method: 'DELETE', body: { revision: 2 } })).data.code, 'PLAN_COMPLETED');
  const other = batch.data.plans[1];
  assert.equal((await request(app, `/api/plans/${other.id}`, { token: admin.token, method: 'DELETE', body: { revision: 1 } })).status, 200);
});

test('input rejects invalid calendar dates, unknown fields, bad content types and external origins', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  for (const fields of [{ admissionDate: '2026-02-29' }, { admissionDate: '2026-13-01' }, { creationMonth: '2026-13' }, { creationMonth: '26-10' }, { planStartMonth: '2026-12', planEndMonth: '2026-10' }, { careLevel: '6' }, { restraint: 'false' }, { name: '' }, { unexpected: 'x' }]) {
    const result = await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident(fields) } });
    assert.equal(result.status, 400, JSON.stringify(fields));
  }
  const leap = await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ admissionDate: '2024-02-29' }) } });
  assert.equal(leap.status, 201);
  assert.equal((await request(app, '/api/plans', { token: admin.token, method: 'POST', body: { plan: { residentId: leap.data.id, targetMonth: '2026-10', periodStartDate: '2026-12-01', periodEndDate: '2026-10-31' } } })).status, 400);
  assert.equal((await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: 'TEST-002' }) }, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(app, '/api/state', { token: admin.token, headers: { origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await request(app, '/api/state', { token: admin.token, headers: { origin: 'null' } })).status, 403);
  const local = await request(app, '/api/state', { token: admin.token, headers: { origin: 'http://localhost:5173' } });
  assert.equal(local.status, 200); assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const rebinding = await requestWithHost(app, '/api/health', 'attacker.invalid:43180', { origin: 'http://attacker.invalid:43180' });
  assert.equal(rebinding.status, 403); assert.equal(rebinding.data.code, 'HOST_FORBIDDEN');
  const privateHost = await requestWithHost(app, '/api/state', '192.168.1.20:43180', { token: admin.token, origin: 'http://192.168.1.20:43180' });
  assert.equal(privateHost.status, 200);
  for (const host of ['8.8.8.8:43180', '127.0.0.1:65536', 'user@127.0.0.1:43180', '127.0.0.1:43180/path', '172.32.1.1:43180']) assert.equal((await requestWithHost(app, '/api/health', host)).status, 403, host);
  const missingRevision = await request(app, `/api/residents/${leap.data.id}`, { token: admin.token, method: 'DELETE', body: {} });
  assert.equal(missingRevision.data.code, 'REVISION_REQUIRED');
});

test('login rate limits repeated failures and password whitespace is preserved', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  const spaced = '  test-long-password  ';
  await request(app, '/api/users', { token: admin.token, method: 'POST', body: { username: 'space', displayName: '空白テスト', password: spaced } });
  assert.equal((await request(app, '/api/login', { method: 'POST', body: { username: 'space', password: spaced } })).status, 200);
  for (let index = 0; index < 10; index++) assert.equal((await request(app, '/api/login', { method: 'POST', body: { username: 'admin', password: 'bad-password' } })).status, 401);
  assert.equal((await request(app, '/api/login', { method: 'POST', body: { username: 'admin', password: PASSWORD } })).status, 429);
});

test('static serving blocks traversal and symlink escapes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'care-static-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = join(directory, 'dist'); await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<!doctype html><p>テスト</p>');
  await writeFile(join(directory, 'private.txt'), 'test-only-private-file');
  let symlinkAvailable = true;
  try { await symlink(join(directory, 'private.txt'), join(dist, 'escape.txt')); }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) symlinkAvailable = false; else throw error; }
  const app = await createCareServer({ port: 0, staticDir: dist }); t.after(() => app.close());
  assert.equal((await fetch(app.url + '/')).status, 200);
  assert.equal((await fetch(app.url + '/view/residents')).status, 200);
  if (symlinkAvailable) assert.equal((await fetch(app.url + '/escape.txt')).status, 403);
  assert.equal((await fetch(app.url + '/missing.js')).status, 404);
});

async function syntheticWorkbook() {
  const book = new ExcelJS.Workbook();
  const basic = book.addWorksheet('基本設定');
  basic.getCell('B7').value = 8; basic.getCell('B10').value = 10;
  basic.getCell('C8').value = '期間満了日'; basic.getCell('D7').value = '合成担当者';
  const people = book.addWorksheet('認定期間管理表');
  const plans = book.addWorksheet('ケアプラン管理表');
  for (const [index, label] of ['居室', 'カルテ', '氏名'].entries()) { people.getCell(1, index + 1).value = label; plans.getCell(4, index + 1).value = label; }
  for (const [index, chart] of ['TEST-EXISTING', 'TEST-IMPORTED'].entries()) {
    const row = index + 2, planRow = index + 8;
    people.getCell(`A${row}`).value = '201'; people.getCell(`B${row}`).value = chart; people.getCell(`C${row}`).value = '合成利用者';
    for (const [era, year, number] of [['E', 'F', 'G'], ['H', 'I', 'J'], ['M', 'N', 'O'], ['Q', 'R', 'S']]) { people.getCell(`${era}${row}`).value = 'R'; people.getCell(`${year}${row}`).value = 8; people.getCell(`${number}${row}`).value = 10; }
    people.getCell(`P${row}`).value = 2;
    plans.getCell(`B${planRow}`).value = chart; plans.getCell(`C${planRow}`).value = '合成利用者'; plans.getCell(`I${planRow}`).value = '10/1〜12/31';
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('workbook preview remains server-owned, import skips duplicates and keeps unknown period years blank', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  const existing = (await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: 'TEST-EXISTING', name: '既存テスト', notes: '保持する備考' }) } })).data;
  const secondAdminUser = (await request(app, '/api/users', { token: admin.token, method: 'POST', body: { username: 'secondadmin', displayName: '管理者2', password: PASSWORD, role: 'admin' } })).data;
  const secondAdmin = (await request(app, '/api/login', { method: 'POST', body: { username: secondAdminUser.username, password: PASSWORD } })).data;
  const response = await fetch(app.url + '/api/import/preview', { method: 'POST', headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/octet-stream' }, body: await syntheticWorkbook() });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.residents.length, 2); assert.equal(preview.plans.length, 2);
  assert.equal(preview.plans[0].periodStartDate, ''); assert.equal(preview.plans[0].periodEndDate, '');
  assert.equal((await request(app, '/api/import/commit', { token: secondAdmin.token, method: 'POST', body: { previewId: preview.previewId } })).status, 410);
  const tampered = await request(app, '/api/import/commit', { token: admin.token, method: 'POST', body: { previewId: preview.previewId, residents: [{ chartNumber: 'TAMPERED', name: 'bad' }] } });
  assert.equal(tampered.status, 400);
  const commit = await request(app, '/api/import/commit', { token: admin.token, method: 'POST', body: { previewId: preview.previewId } });
  assert.equal(commit.status, 201); assert.equal(commit.data.createdResidents, 1); assert.equal(commit.data.createdPlans, 1); assert.equal(commit.data.skippedResidents, 1); assert.equal(commit.data.skippedPlans, 1);
  const state = (await request(app, '/api/state', { token: admin.token })).data;
  assert.equal(state.residents.length, 2); assert.equal(state.residents.find(person => person.id === existing.id).notes, '保持する備考');
  assert.equal(state.plans.length, 1); assert.equal(state.plans[0].effectivePeriodText, '10/1〜12/31'); assert.equal(state.plans[0].periodStartDate, ''); assert.equal(state.plans[0].periodEndDate, '');
  assert.equal(state.settings.facilityName, 'テスト施設');
  assert.equal((await request(app, '/api/import/commit', { token: admin.token, method: 'POST', body: { previewId: preview.previewId } })).status, 410);
  const invalid = await fetch(app.url + '/api/import/preview', { method: 'POST', headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/octet-stream' }, body: Buffer.from('not an xlsm') });
  assert.equal(invalid.status, 400);
});

test('settings revisions reject stale changes and internal writes remain monotonic after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'care-settings-test-'));
  const dbPath = join(directory, 'care.sqlite');
  let app = await createCareServer({ dbPath, port: 0 });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const admin = await setup(app);
  const firstClient = (await request(app, '/api/settings', { token: admin.token })).data.settings;
  const secondClient = (await request(app, '/api/settings', { token: admin.token })).data.settings;
  assert(Number.isSafeInteger(firstClient.revision));
  const updated = await request(app, '/api/settings', { token: admin.token, method: 'PUT', body: { settings: { ...firstClient, facilityName: '先に保存した施設' }, revision: firstClient.revision } });
  assert.equal(updated.status, 200); assert.equal(updated.data.settings.revision, firstClient.revision + 1);
  const stale = await request(app, '/api/settings', { token: admin.token, method: 'PUT', body: { settings: { ...secondClient, contactName: '後から保存した担当者' }, revision: secondClient.revision } });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'REVISION_CONFLICT');
  const state = (await request(app, '/api/state', { token: admin.token })).data;
  assert.equal(state.settings.facilityName, '先に保存した施設'); assert.equal(state.settings.contactName, '');
  assert.equal((await request(app, '/api/settings', { token: admin.token, method: 'PUT', body: { settings: { floor: '2F' } } })).data.code, 'REVISION_REQUIRED');
  const savedRevision = state.settings.revision;
  await app.close(); app = await createCareServer({ dbPath, port: 0 });
  const login = (await request(app, '/api/login', { method: 'POST', body: { username: 'admin', password: PASSWORD } })).data;
  assert.equal((await request(app, '/api/settings', { token: login.token })).data.settings.revision, savedRevision);
  // An existing version-1 database without a revision receives a safe initial revision.
  app.db.prepare('UPDATE settings SET payload = ? WHERE id = 1').run(JSON.stringify({ ...state.settings, revision: undefined }));
  await app.close(); app = await createCareServer({ dbPath, port: 0 });
  const migrated = (await request(app, '/api/login', { method: 'POST', body: { username: 'admin', password: PASSWORD } })).data;
  assert.equal((await request(app, '/api/settings', { token: migrated.token })).data.settings.revision, 1);
});

async function backupPreview(app, token, backup) {
  const response = await fetch(app.url + '/api/restore/preview', { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/octet-stream' }, body: typeof backup === 'string' ? backup : JSON.stringify(backup) });
  return { status: response.status, data: await response.json() };
}

test('backup restore preserves record relationships and snapshots while keeping current accounts and history', async t => {
  const source = await createCareServer({ port: 0 }); t.after(() => source.close());
  const sourceAdmin = await setup(source);
  const residentRecords = [];
  for (const data of [resident({ chartNumber: 'BACKUP-001', restraint: true }), resident({ chartNumber: 'BACKUP-002', status: 'discharged' })]) residentRecords.push((await request(source, '/api/residents', { token: sourceAdmin.token, method: 'POST', body: { resident: data } })).data);
  await request(source, '/api/plans', { token: sourceAdmin.token, method: 'POST', body: { plan: { residentId: residentRecords[0].id, targetMonth: '2026-10', creationDate: '2026-10-02', printDate: '2026-10-03', meetingDate: '2026-10-15', periodStartDate: '2026-10-01', periodEndDate: '2026-12-31', restraint: true, consentStatus: '回収済', notes: '復元対象の備考' } } });
  await request(source, '/api/plans', { token: sourceAdmin.token, method: 'POST', body: { plan: { residentId: residentRecords[1].id, targetMonth: '2026-09', periodStartDate: '', periodEndDate: '', effectivePeriodText: '9/1〜11/30', restraint: false } } });
  const backup = (await request(source, '/api/backup', { token: sourceAdmin.token })).data;
  assert.equal(backup.type, 'caremanager-backup');
  const target = await createCareServer({ port: 0 }); t.after(() => target.close());
  const targetAdmin = await setup(target);
  const oldSettingsRevision = (await request(target, '/api/state', { token: targetAdmin.token })).data.settings.revision;
  const preview = await backupPreview(target, targetAdmin.token, backup);
  assert.equal(preview.status, 200); assert.deepEqual(preview.data.summary, { residentCount: 2, planCount: 2 });
  assert.equal((await request(target, '/api/import/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: preview.data.previewId } })).status, 410);
  assert.equal((await request(target, '/api/restore/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: preview.data.previewId, settings: { facilityName: '改竄' } } })).status, 400);
  target.db.exec("CREATE TRIGGER simulated_restore_failure BEFORE INSERT ON plans BEGIN SELECT RAISE(ABORT, 'test-only restore failure'); END;");
  assert.equal((await request(target, '/api/restore/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: preview.data.previewId } })).status, 500);
  const rollbackState = (await request(target, '/api/state', { token: targetAdmin.token })).data;
  assert.equal(rollbackState.residents.length, 0); assert.equal(rollbackState.plans.length, 0); assert.equal(rollbackState.settings.revision, oldSettingsRevision);
  assert(!rollbackState.audit.some(event => event.action === 'backup.restore'));
  target.db.exec('DROP TRIGGER simulated_restore_failure;');
  const commit = await request(target, '/api/restore/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: preview.data.previewId } });
  assert.equal(commit.status, 201); assert.deepEqual(commit.data, { createdResidents: 2, createdPlans: 2 });
  const restored = (await request(target, '/api/state', { token: targetAdmin.token })).data;
  assert.equal(restored.users.length, 1); assert.equal(restored.users[0].id, targetAdmin.user.id);
  assert.equal(restored.settings.revision, oldSettingsRevision + 1);
  const restoredResident = restored.residents.find(person => person.chartNumber === 'BACKUP-001');
  assert.notEqual(restoredResident.id, residentRecords[0].id);
  const restoredPlan = restored.plans.find(plan => plan.residentId === restoredResident.id);
  assert.equal(restoredPlan.periodStartDate, '2026-10-01'); assert.equal(restoredPlan.periodEndDate, '2026-12-31'); assert.equal(restoredPlan.restraint, true); assert.equal(restoredPlan.consentStatus, '回収済'); assert.equal(restoredPlan.printDate, '2026-10-03');
  const unknownPeriod = restored.plans.find(plan => plan.targetMonth === '2026-09');
  assert.equal(unknownPeriod.periodStartDate, ''); assert.equal(unknownPeriod.periodEndDate, ''); assert.equal(unknownPeriod.effectivePeriodText, '9/1〜11/30');
  assert(restored.audit.some(event => event.action === 'backup.restore')); assert(!restored.audit.some(event => event.action === 'resident.create'));
  assert.equal((await request(target, '/api/restore/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: preview.data.previewId } })).status, 410);
  const repeat = await backupPreview(target, targetAdmin.token, backup);
  const denied = await request(target, '/api/restore/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: repeat.data.previewId } });
  assert.equal(denied.status, 409); assert.equal(denied.data.code, 'RESTORE_REQUIRES_EMPTY_DATABASE');
  assert.equal((await request(target, '/api/state', { token: targetAdmin.token })).data.residents.length, 2);
});

test('restore validates full schema, duplicate IDs, references, dates, authorization and preview ownership', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  const sourceResident = (await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident() } })).data;
  await request(app, '/api/plans', { token: admin.token, method: 'POST', body: { plan: { residentId: sourceResident.id, targetMonth: '2026-10' } } });
  const backup = (await request(app, '/api/backup', { token: admin.token })).data;
  const target = await createCareServer({ port: 0 }); t.after(() => target.close());
  const targetAdmin = await setup(target);
  for (const mutate of [
    value => { value.schemaVersion = 2; }, value => { value.type = 'unrelated-backup'; }, value => { value.unrecognized = true; },
    value => { value.residents.push({ ...value.residents[0] }); },
    value => { value.residents.push({ ...value.residents[0], id: 'another-resident' }); },
    value => { value.plans.push({ ...value.plans[0] }); },
    value => { value.plans[0].residentId = 'missing-resident'; },
    value => { value.plans[0].periodEndDate = '2026-02-29'; },
    value => { value.residents[0].unexpected = 'invalid'; },
    value => { value.residents[0].revision = 0; }, value => { value.residents[0].updatedAt = '2026-02-30T00:00:00.000Z'; },
    value => { value.settings.unrecognized = true; }, value => { value.settings.revision = -1; }, value => { value.exportedAt = 'invalid'; },
  ]) {
    const invalid = structuredClone(backup); mutate(invalid);
    assert.equal((await backupPreview(target, targetAdmin.token, invalid)).status, 400);
  }
  assert.equal((await backupPreview(target, targetAdmin.token, '{broken-json')).status, 400);
  assert.equal((await backupPreview(target, undefined, backup)).status, 401);
  const staffUser = (await request(target, '/api/users', { token: targetAdmin.token, method: 'POST', body: { username: 'restorestaff', displayName: '復元職員テスト', password: PASSWORD } })).data;
  const staff = (await request(target, '/api/login', { method: 'POST', body: { username: staffUser.username, password: PASSWORD } })).data;
  assert.equal((await backupPreview(target, staff.token, backup)).status, 403);
  assert.equal((await request(target, '/api/restore/commit', { token: staff.token, method: 'POST', body: { previewId: 'unavailable' } })).status, 403);
  assert.equal((await request(target, '/api/restore/commit', { token: targetAdmin.token, method: 'POST', body: { previewId: 'unavailable' } })).status, 410);
  const otherAdminUser = (await request(target, '/api/users', { token: targetAdmin.token, method: 'POST', body: { username: 'restoreadmin', displayName: '別管理者テスト', password: PASSWORD, role: 'admin' } })).data;
  const otherAdmin = (await request(target, '/api/login', { method: 'POST', body: { username: otherAdminUser.username, password: PASSWORD } })).data;
  const preview = await backupPreview(target, targetAdmin.token, backup);
  assert.equal((await request(target, '/api/restore/commit', { token: otherAdmin.token, method: 'POST', body: { previewId: preview.data.previewId } })).status, 410);
  assert.equal((await request(target, '/api/state', { token: targetAdmin.token })).data.residents.length, 0);
  const legacy = structuredClone(backup); delete legacy.type; delete legacy.settings.revision;
  const legacyPreview = await backupPreview(target, targetAdmin.token, legacy);
  assert.equal(legacyPreview.status, 200); assert.equal(legacyPreview.data.warnings.length, 1);
});

test('balanced batch divides only new residents and continues author rotation independently per meeting', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  const settings = (await request(app, '/api/state', { token: admin.token })).data.settings;
  await request(app, '/api/settings', { token: admin.token, method: 'PUT', body: { settings: { meeting1Date: '2026-10-15', meeting2Date: '2026-10-22' }, revision: settings.revision } });
  const existingResident = (await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: 'BALANCED-EXISTING', room: '100' }) } })).data;
  const existingPlan = (await request(app, '/api/plans', { token: admin.token, method: 'POST', body: { plan: { residentId: existingResident.id, targetMonth: '2026-10', creator: '職員A', meetingRound: 1, notes: '既存の割当を保持' } } })).data;
  for (const room of ['105', '103', '101', '104', '102']) await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: `BALANCED-${room}`, room }) } });
  const body = { targetMonth: '2026-10', authorNames: ['職員A', '職員B'], assignment: 'balanced' };
  const first = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body });
  assert.equal(first.status, 201); assert.equal(first.data.created, 5); assert.equal(first.data.skipped, 1);
  assert.deepEqual(first.data.plans.map(plan => plan.meetingRound), [1, 1, 1, 2, 2]);
  assert.deepEqual(first.data.plans.map(plan => plan.creator), ['職員B', '職員A', '職員B', '職員A', '職員B']);
  assert.deepEqual(first.data.plans.map(plan => plan.meetingDate), ['2026-10-15', '2026-10-15', '2026-10-15', '2026-10-22', '2026-10-22']);
  for (const room of ['109', '107', '108', '106']) await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: `BALANCED-${room}`, room }) } });
  const second = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body });
  assert.equal(second.data.created, 4); assert.equal(second.data.skipped, 6);
  assert.deepEqual(second.data.plans.map(plan => plan.meetingRound), [1, 1, 2, 2]);
  assert.deepEqual(second.data.plans.map(plan => plan.creator), ['職員A', '職員B', '職員A', '職員B']);
  const state = (await request(app, '/api/state', { token: admin.token })).data;
  assert.deepEqual(state.plans.find(plan => plan.id === existingPlan.id), existingPlan);
  assert.equal(state.plans.length, 10);
  const noTargets = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body });
  assert.equal(noTargets.data.created, 0); assert.equal(noTargets.data.skipped, 10);
});

test('room A/B batch assigns numeric room endings and rolls back every plan when a room is unsupported', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  for (const room of ['119', '110', '111', '101']) await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: `ROOMAB-${room}`, room }) } });
  const body = { targetMonth: '2026-10', authorNames: ['職員A', '職員B'], assignment: 'roomAB' };
  const first = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body });
  assert.equal(first.status, 201); assert.equal(first.data.created, 4);
  assert.deepEqual(first.data.plans.map(plan => plan.meetingRound), [1, 1, 2, 2]);
  assert.deepEqual(first.data.plans.map(plan => plan.creator), ['職員A', '職員B', '職員A', '職員B']);
  const validNew = (await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: 'ROOMAB-102', room: '102' }) } })).data;
  const invalidNew = (await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: 'ROOMAB-120', room: '120' }) } })).data;
  const invalid = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body });
  assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'ROOM_ASSIGNMENT_INVALID');
  const afterFailure = (await request(app, '/api/state', { token: admin.token })).data;
  assert.equal(afterFailure.plans.length, 4); assert(!afterFailure.plans.some(plan => plan.residentId === validNew.id));
  assert.equal(afterFailure.audit.filter(event => event.action === 'plan.batch').length, 1);
  await request(app, `/api/residents/${invalidNew.id}`, { token: admin.token, method: 'PUT', body: { resident: { ...invalidNew, room: '118' }, revision: invalidNew.revision } });
  const retry = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body });
  assert.equal(retry.status, 201); assert.equal(retry.data.created, 2); assert.equal(retry.data.skipped, 4);
  assert.deepEqual(retry.data.plans.map(plan => plan.meetingRound), [1, 2]);
  assert.deepEqual(retry.data.plans.map(plan => plan.creator), ['職員A', '職員A']);
});

test('explicit round-only assignment takes precedence while legacy meetingRound remains compatible', async t => {
  const app = await createCareServer({ port: 0 }); t.after(() => app.close());
  const admin = await setup(app);
  const settings = (await request(app, '/api/state', { token: admin.token })).data.settings;
  await request(app, '/api/settings', { token: admin.token, method: 'PUT', body: { settings: { meeting1Date: '2026-10-15', meeting2Date: '2026-10-22' }, revision: settings.revision } });
  for (const [index, options] of [{ assignment: 'round1', meetingRound: 2 }, { assignment: 'round2', meetingRound: 1 }, { meetingRound: 2 }].entries()) {
    const person = (await request(app, '/api/residents', { token: admin.token, method: 'POST', body: { resident: resident({ chartNumber: `ROUND-${index}`, room: '居室未定' }) } })).data;
    const batch = await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body: { targetMonth: '2026-10', authorNames: ['職員A'], ...options } });
    assert.equal(batch.status, 201); assert.equal(batch.data.created, 1); assert.equal(batch.data.skipped, index);
    const expected = options.assignment === 'round1' ? 1 : 2;
    assert.equal(batch.data.plans[0].residentId, person.id); assert.equal(batch.data.plans[0].meetingRound, expected);
    assert.equal(batch.data.plans[0].meetingDate, expected === 1 ? '2026-10-15' : '2026-10-22');
  }
  assert.equal((await request(app, '/api/plans/batch', { token: admin.token, method: 'POST', body: { targetMonth: '2026-10', assignment: 'invalid' } })).status, 400);
});
