import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { ApiError, object, exact, string, username, password, choice, boolean, revision, validateResident, validatePlan, validateSettings, validateBackup, names, month } from './validation.mjs';

const VERSION = '0.1.0';
const MAX_JSON = 1024 * 1024;
const MAX_WORKBOOK = 10 * 1024 * 1024;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const PREVIEW_TTL = 10 * 60 * 1000;
const MAX_PREVIEWS = 10;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const hashPassword = (value, salt) => scryptSync(value, salt, 64).toString('hex');
const newPassword = value => { const salt = randomBytes(32).toString('hex'); return { salt, hash: hashPassword(password(value), salt) }; };
const dummySalt = randomBytes(32).toString('hex');
const dummyHash = hashPassword('unused-placeholder-password', dummySalt);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req, limit, binary = false) {
  const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== (binary ? 'application/octet-stream' : 'application/json')) throw new ApiError(415, binary ? 'Excelファイルは application/octet-stream で送信してください。' : 'Content-Type は application/json にしてください。', 'CONTENT_TYPE');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ApiError(415, '圧縮されたリクエストは受け付けません。');
  const declared = Number(req.headers['content-length']);
  if (declared > limit) throw new ApiError(413, 'ファイルまたは入力データが大きすぎます。', 'PAYLOAD_TOO_LARGE');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new ApiError(413, 'ファイルまたは入力データが大きすぎます。', 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (binary) return body;
  try { return object(JSON.parse(body.toString('utf8') || '{}')); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'JSONの形式が正しくありません。', 'INVALID_JSON'); }
}

function validateHost(req) {
  const authority = req.headers.host;
  if (typeof authority !== 'string' || !/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[::1\])(?::\d{1,5})?$/i.test(authority)) throw new ApiError(403, 'このホスト名では接続できません。共有元PCのLANアドレスを使用してください。', 'HOST_FORBIDDEN');
  const rawHostname = authority.startsWith('[') ? '::1' : authority.split(':')[0].toLowerCase();
  let parsed;
  try { parsed = new URL(`http://${authority}`); } catch { throw new ApiError(403, '接続先ホストの形式が正しくありません。', 'HOST_FORBIDDEN'); }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new ApiError(403, '接続先ホストの形式が正しくありません。', 'HOST_FORBIDDEN');
  if (rawHostname === 'localhost' || rawHostname === '::1') return;
  if (isIP(rawHostname) !== 4) throw new ApiError(403, '接続先IPアドレスの形式が正しくありません。', 'HOST_FORBIDDEN');
  const [a, b] = rawHostname.split('.').map(Number);
  if (a !== 127 && a !== 10 && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)) throw new ApiError(403, '接続先は共有元PCのLANアドレスにしてください。', 'HOST_FORBIDDEN');
}

function validateOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new ApiError(403, 'この接続元は許可されていません。', 'ORIGIN_FORBIDDEN'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const same = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  if (!['http:', 'https:'].includes(parsed.protocol) || (!same && !local)) throw new ApiError(403, 'この接続元は許可されていません。', 'ORIGIN_FORBIDDEN');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
}

function monthFirst(value) { return value ? `${value}-01` : ''; }
function monthLast(value) {
  if (!value) return '';
  const [year, number] = value.split('-').map(Number);
  return `${value}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
}
function planDefaults(input, resident) {
  return { periodStartDate: monthFirst(resident?.planStartMonth), periodEndDate: monthLast(resident?.planEndMonth), restraint: resident?.restraint ?? false, ...input };
}

export async function createCareServer({ dbPath = ':memory:', host = '127.0.0.1', port = 43180, staticDir } = {}) {
  let store;
  try { store = openStore(dbPath); }
  catch (error) { throw new Error(`業務データベースを開けません。保存先の権限と空き容量を確認してください。 (${error.code ?? 'DATABASE_ERROR'})`, { cause: error }); }
  const { db } = store;
  const sessions = new Map();
  const previews = new Map();
  const loginAttempts = new Map();
  const createSession = row => {
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { userId: row.id, expiresAt: Date.now() + SESSION_TTL });
    return { token, user: store.publicUser(row) };
  };
  const auth = req => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      throw new ApiError(401, 'ログインしてください。', 'UNAUTHENTICATED');
    }
    const row = store.getUser(session.userId);
    if (!row || row.disabled) { sessions.delete(token); throw new ApiError(401, 'このアカウントは無効です。', 'UNAUTHENTICATED'); }
    return store.publicUser(row);
  };
  const admin = user => { if (user.role !== 'admin') throw new ApiError(403, '管理者のみ操作できます。', 'ADMIN_REQUIRED'); };
  const addUser = input => {
    const normalizedUsername = username(input.username);
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedUsername)) throw new ApiError(409, 'このログイン名は使用済みです。', 'DUPLICATE_USERNAME');
    const credentials = newPassword(input.password);
    const userId = randomUUID(), timestamp = store.now();
    db.prepare('INSERT INTO users (id, username, display_name, role, disabled, salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)').run(userId, normalizedUsername, string(input.displayName, '表示名', 100, true), choice(input.role, ['admin', 'staff'], 'staff', '権限'), credentials.salt, credentials.hash, timestamp, timestamp);
    return store.getUser(userId);
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      validateHost(req);
      validateOrigin(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const method = req.method;
      if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true, configured: store.users().length > 0, version: VERSION });
      if (pathname === '/api/setup' && method === 'POST') {
        if (!LOOPBACK.has(req.socket.remoteAddress)) throw new ApiError(403, '初回設定は共有元PCから行ってください。', 'LOCAL_SETUP_REQUIRED');
        const input = exact(await readBody(req, MAX_JSON), ['displayName', 'username', 'password', 'facilityName']);
        const row = store.transaction(() => {
          if (store.users().length) throw new ApiError(409, '初回設定は完了しています。ログインしてください。', 'ALREADY_CONFIGURED');
          const result = addUser({ ...input, role: 'admin' });
          store.setSettings(validateSettings({ ...store.getSettings(), facilityName: input.facilityName ?? '' }));
          store.audit(store.publicUser(result), 'setup', result.id);
          return result;
        });
        return json(res, 201, createSession(row));
      }
      if (pathname === '/api/login' && method === 'POST') {
        const input = exact(await readBody(req, MAX_JSON), ['username', 'password']);
        const name = username(input.username);
        const candidate = input.password;
        if (typeof candidate !== 'string' || !candidate.length || candidate.length > 200) throw new ApiError(400, 'パスワードを200文字以内で入力してください。');
        // The IP limit also bounds attempts that vary the login name.
        const ipKey = `ip:${req.socket.remoteAddress}`, nameKey = `name:${name}`;
        for (const key of [ipKey, nameKey]) {
          const attempt = loginAttempts.get(key);
          if (attempt && attempt.expiresAt > Date.now() && attempt.count >= 10) throw new ApiError(429, 'ログイン試行が多すぎます。10分後に再試行してください。', 'LOGIN_RATE_LIMIT');
        }
        const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
        const actual = hashPassword(candidate, row?.salt ?? dummySalt);
        const matches = timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(row?.password_hash ?? dummyHash, 'hex'));
        if (!matches || !row || row.disabled) {
          for (const key of [ipKey, nameKey]) {
            let attempt = loginAttempts.get(key);
            if (!attempt || attempt.expiresAt <= Date.now()) attempt = { count: 0, expiresAt: Date.now() + PREVIEW_TTL };
            attempt.count += 1; loginAttempts.set(key, attempt);
          }
          throw new ApiError(401, 'ログイン名またはパスワードが正しくありません。', 'LOGIN_FAILED');
        }
        loginAttempts.delete(nameKey);
        store.audit(store.publicUser(row), 'login', row.id);
        return json(res, 200, createSession(row));
      }
      if (pathname.startsWith('/api/')) {
        const user = auth(req);
        if (pathname === '/api/logout' && method === 'POST') {
          exact(await readBody(req, MAX_JSON), []);
          sessions.delete(req.headers.authorization.slice(7));
          store.audit(user, 'logout', user.id);
          return json(res, 200, { ok: true });
        }
        if (pathname === '/api/state' && method === 'GET') return json(res, 200, { user, residents: store.residents(), plans: store.plans(), settings: store.getSettings(), ...(user.role === 'admin' ? { users: store.users(), audit: store.audits() } : {}) });
        if (pathname === '/api/settings' && method === 'GET') { admin(user); return json(res, 200, { settings: store.getSettings() }); }
        if (pathname === '/api/settings' && method === 'PUT') {
          admin(user);
          const input = exact(await readBody(req, MAX_JSON), ['settings', 'revision']);
          const expected = revision(input.revision), { settings } = input;
          const value = validateSettings({ ...store.getSettings(), ...exact(settings, Object.keys(store.getSettings()), '設定') });
          const updated = store.transaction(() => { const result = store.setSettings(value, expected); store.audit(user, 'settings.update'); return result; });
          return json(res, 200, { settings: updated });
        }
        if (pathname === '/api/residents' && method === 'POST') {
          const { resident } = exact(await readBody(req, MAX_JSON), ['resident']);
          const record = store.transaction(() => { const result = store.insertResident(validateResident(resident)); store.audit(user, 'resident.create', result.id); return result; });
          return json(res, 201, record);
        }
        const residentMatch = /^\/api\/residents\/([^/]+)$/.exec(pathname);
        if (residentMatch && ['PUT', 'DELETE'].includes(method)) {
          const input = exact(await readBody(req, MAX_JSON), method === 'PUT' ? ['resident', 'revision'] : ['revision']);
          const expected = revision(input.revision);
          const id = decodeURIComponent(residentMatch[1]);
          const record = store.transaction(() => {
            const current = store.getResident(id);
            if (!current) throw new ApiError(404, '利用者が見つかりません。', 'NOT_FOUND');
            const result = store.updateResident(id, method === 'DELETE' ? { ...current, status: 'discharged' } : validateResident(input.resident), expected);
            store.audit(user, method === 'DELETE' ? 'resident.archive' : 'resident.update', id);
            return result;
          });
          return json(res, 200, record);
        }
        if (pathname === '/api/plans/batch' && method === 'POST') {
          const input = exact(await readBody(req, MAX_JSON), ['targetMonth', 'authorNames', 'periodMode', 'meetingRound', 'assignment']);
          const target = month(input.targetMonth, '対象月', true);
          const authors = names(input.authorNames, '作成者');
          const round = choice(input.meetingRound, [1, 2], 1, '会議回');
          const assignment = choice(input.assignment, ['balanced', 'round1', 'round2', 'roomAB'], round === 1 ? 'round1' : 'round2', '会議の振り分け');
          const mode = choice(input.periodMode, ['certification', 'threeMonths'], 'certification', '期間設定');
          if (mode === 'threeMonths') throw new ApiError(400, '追加3か月行の自動作成は初版では未対応です。通常作成を選択し、追加計画は個別に確認してください。', 'UNSUPPORTED_PERIOD_MODE');
          const settings = store.getSettings();
          const result = store.transaction(() => {
            const eligible = store.residents().filter(resident => resident.status === 'active' && resident.creationMonth === target);
            const existingPlans = db.prepare('SELECT payload FROM plans WHERE target_month = ? ORDER BY rowid').all(target).map(row => JSON.parse(row.payload));
            const existingResidentIds = new Set(existingPlans.map(plan => plan.residentId));
            const targets = eligible.filter(resident => !existingResidentIds.has(resident.id));
            const skipped = eligible.length - targets.length, records = [];
            const positions = { 1: 0, 2: 0 };
            for (const group of [1, 2]) {
              const last = existingPlans.filter(plan => plan.meetingRound === group).at(-1);
              const authorIndex = last ? authors.indexOf(last.creator) : -1;
              if (authorIndex !== -1) positions[group] = (authorIndex + 1) % authors.length;
            }
            targets.forEach((resident, index) => {
              let group;
              if (assignment === 'balanced') group = index < Math.ceil(targets.length / 2) ? 1 : 2;
              else if (assignment === 'roomAB') {
                const lastTwo = /^\d+$/.test(resident.room) ? Number(resident.room.slice(-2)) : NaN;
                if (lastTwo >= 1 && lastTwo <= 10) group = 1;
                else if (lastTwo >= 11 && lastTwo <= 19) group = 2;
                else throw new ApiError(400, '居室A/Bの振り分けには、数字の居室番号で末尾2桁が01〜19の利用者だけを指定してください。台帳の居室を確認してください。', 'ROOM_ASSIGNMENT_INVALID');
              } else group = assignment === 'round1' ? 1 : 2;
              const creator = authors.length ? authors[positions[group] % authors.length] : '';
              positions[group]++;
              const record = store.insertPlan(validatePlan(planDefaults({ residentId: resident.id, targetMonth: target, creator, careManager: resident.careManager, meetingRound: group, meetingDate: group === 1 ? settings.meeting1Date : settings.meeting2Date, effectivePeriodText: resident.planStartMonth && resident.planEndMonth ? `${resident.planStartMonth}〜${resident.planEndMonth}` : '' }, resident)));
              records.push(record);
            });
            store.audit(user, 'plan.batch', null, { targetMonth: target, created: records.length, skipped, assignment });
            return { created: records.length, skipped, plans: records };
          });
          return json(res, 201, result);
        }
        if (pathname === '/api/plans' && method === 'POST') {
          const { plan } = exact(await readBody(req, MAX_JSON), ['plan']);
          const resident = store.getResident(plan?.residentId);
          const record = store.transaction(() => { const result = store.insertPlan(validatePlan(planDefaults(plan, resident))); store.audit(user, 'plan.create', result.id); return result; });
          return json(res, 201, record);
        }
        const planMatch = /^\/api\/plans\/([^/]+)$/.exec(pathname);
        if (planMatch && ['PUT', 'DELETE'].includes(method)) {
          if (method === 'DELETE') admin(user);
          const input = exact(await readBody(req, MAX_JSON), method === 'PUT' ? ['plan', 'revision'] : ['revision']);
          const expected = revision(input.revision), id = decodeURIComponent(planMatch[1]);
          const record = store.transaction(() => {
            if (method === 'PUT') { const result = store.updatePlan(id, validatePlan(input.plan), expected); store.audit(user, 'plan.update', id); return result; }
            const current = store.getPlan(id);
            if (!current) throw new ApiError(404, '計画が見つかりません。', 'NOT_FOUND');
            if (current.revision !== expected) throw new ApiError(409, '他の職員が更新しました。再読込してください。', 'REVISION_CONFLICT');
            if (current.consentStatus === '回収済') throw new ApiError(409, '同意書を回収済みの計画は削除できません。', 'PLAN_COMPLETED');
            db.prepare('DELETE FROM plans WHERE id = ?').run(id); store.audit(user, 'plan.delete', id);
            return { ok: true };
          });
          return json(res, 200, record);
        }
        if (pathname === '/api/users' && method === 'POST') {
          admin(user);
          const input = exact(await readBody(req, MAX_JSON), ['username', 'displayName', 'password', 'role']);
          const record = store.transaction(() => { const result = addUser(input); store.audit(user, 'user.create', result.id, { role: result.role }); return store.publicUser(result); });
          return json(res, 201, record);
        }
        const userMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
        if (userMatch && method === 'PUT') {
          admin(user);
          const input = exact(await readBody(req, MAX_JSON), ['displayName', 'role', 'password', 'disabled']);
          const id = decodeURIComponent(userMatch[1]);
          const record = store.transaction(() => {
            const current = store.getUser(id);
            if (!current) throw new ApiError(404, 'アカウントが見つかりません。', 'NOT_FOUND');
            const displayName = input.displayName === undefined ? current.display_name : string(input.displayName, '表示名', 100, true);
            const role = choice(input.role, ['admin', 'staff'], current.role, '権限');
            const disabled = boolean(input.disabled, Boolean(current.disabled), '無効設定');
            if (current.role === 'admin' && !current.disabled && (disabled || role !== 'admin') && db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND disabled = 0").get().total <= 1) throw new ApiError(409, '最後の有効な管理者は無効化・権限変更できません。', 'LAST_ADMIN');
            const credentials = input.password === undefined ? { salt: current.salt, hash: current.password_hash } : newPassword(input.password);
            db.prepare('UPDATE users SET display_name = ?, role = ?, disabled = ?, salt = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(displayName, role, Number(disabled), credentials.salt, credentials.hash, store.now(), id);
            store.audit(user, 'user.update', id, { role, disabled, passwordChanged: input.password !== undefined });
            if (disabled || input.password !== undefined) for (const [token, session] of sessions) if (session.userId === id) sessions.delete(token);
            return store.publicUser(store.getUser(id));
          });
          return json(res, 200, record);
        }
        if (pathname === '/api/backup' && method === 'GET') {
          admin(user); store.audit(user, 'backup.export');
          res.setHeader('Content-Disposition', `attachment; filename="care-management-${new Date().toISOString().slice(0, 10)}.json"`);
          return json(res, 200, { type: 'caremanager-backup', schemaVersion: 1, applicationVersion: VERSION, exportedAt: store.now(), settings: store.getSettings(), residents: store.residents(), plans: store.plans() });
        }
        if (pathname === '/api/restore/preview' && method === 'POST') {
          admin(user);
          const buffer = await readBody(req, MAX_WORKBOOK, true);
          let parsed;
          try { parsed = JSON.parse(buffer.toString('utf8')); }
          catch { throw new ApiError(400, 'バックアップJSONの形式が正しくありません。', 'BACKUP_INVALID'); }
          const validated = validateBackup(parsed);
          for (const [key, preview] of previews) if (preview.expiresAt <= Date.now()) previews.delete(key);
          if (previews.size >= MAX_PREVIEWS) throw new ApiError(429, 'プレビューが多すぎます。10分後に再試行してください。', 'PREVIEW_LIMIT');
          const previewId = randomBytes(24).toString('base64url');
          const summary = { residentCount: validated.residents.length, planCount: validated.plans.length };
          previews.set(previewId, { ...validated, kind: 'backup', userId: user.id, expiresAt: Date.now() + PREVIEW_TTL });
          return json(res, 200, { previewId, summary, warnings: validated.warnings });
        }
        if (pathname === '/api/restore/commit' && method === 'POST') {
          admin(user);
          const input = exact(await readBody(req, MAX_JSON), ['previewId']);
          const preview = previews.get(string(input.previewId, 'プレビューID', 100, true));
          if (!preview || preview.kind !== 'backup' || preview.userId !== user.id || preview.expiresAt <= Date.now()) throw new ApiError(410, '復元プレビューが期限切れ、または無効です。ファイルを再選択してください。', 'PREVIEW_EXPIRED');
          const result = store.transaction(() => {
            if (db.prepare('SELECT COUNT(*) AS total FROM residents').get().total || db.prepare('SELECT COUNT(*) AS total FROM plans').get().total) throw new ApiError(409, '復元は利用者・プランが未登録の共有元PCで行ってください。既存データは上書きしません。', 'RESTORE_REQUIRES_EMPTY_DATABASE');
            const idMap = new Map();
            for (const item of preview.residents) idMap.set(item.originalId, store.insertResident(item.resident).id);
            for (const plan of preview.plans) store.insertPlan({ ...plan, residentId: idMap.get(plan.residentId) });
            store.setSettings(preview.settings);
            const counts = { createdResidents: preview.residents.length, createdPlans: preview.plans.length };
            store.audit(user, 'backup.restore', null, counts);
            return counts;
          });
          previews.delete(input.previewId);
          return json(res, 201, result);
        }
        if (pathname === '/api/import/preview' && method === 'POST') {
          admin(user);
          const buffer = await readBody(req, MAX_WORKBOOK, true);
          if (!buffer.length) throw new ApiError(400, 'Excelファイルが空です。');
          let parsed;
          try { const { parseWorkbook } = await import('./workbook.mjs'); parsed = await parseWorkbook(buffer); }
          catch (error) { throw new ApiError(400, error.message || 'Excelファイルを読み取れませんでした。', 'WORKBOOK_INVALID'); }
          if (!parsed || !Array.isArray(parsed.residents) || !Array.isArray(parsed.plans)) throw new ApiError(400, 'Excelファイルの解析結果が正しくありません。', 'WORKBOOK_INVALID');
          const validatedResidents = parsed.residents.map(validateResident);
          const validatedSettings = validateSettings({ ...store.getSettings(), ...(parsed.settings ?? {}) });
          const validatedPlans = parsed.plans.map(plan => {
            const { chartNumber, chartNo, ...fields } = plan;
            const chart = string(chartNumber ?? chartNo, 'カルテ番号', 100, true);
            const value = validatePlan({ ...fields, residentId: 'pending' });
            return { ...value, chartNumber: chart, residentId: undefined };
          });
          for (const [key, preview] of previews) if (preview.expiresAt <= Date.now()) previews.delete(key);
          if (previews.size >= MAX_PREVIEWS) throw new ApiError(429, '取込プレビューが多すぎます。既存のプレビューを確定するか、10分後に再試行してください。', 'PREVIEW_LIMIT');
          const previewId = randomBytes(24).toString('base64url');
          const value = { residents: validatedResidents, plans: validatedPlans, settings: validatedSettings, warnings: parsed.warnings ?? [], summary: parsed.summary ?? { residents: validatedResidents.length, plans: validatedPlans.length } };
          previews.set(previewId, { ...value, kind: 'workbook', userId: user.id, expiresAt: Date.now() + PREVIEW_TTL });
          return json(res, 200, { previewId, ...value });
        }
        if (pathname === '/api/import/commit' && method === 'POST') {
          admin(user);
          const input = exact(await readBody(req, MAX_JSON), ['previewId']);
          const preview = previews.get(string(input.previewId, 'プレビューID', 100, true));
          if (!preview || preview.kind !== 'workbook' || preview.userId !== user.id || preview.expiresAt <= Date.now()) throw new ApiError(410, '取込プレビューが期限切れ、または無効です。ファイルを再選択してください。', 'PREVIEW_EXPIRED');
          const result = store.transaction(() => {
            const imported = new Map(); let skippedResidents = 0, skippedPlans = 0, createdPlans = 0;
            for (const inputResident of preview.residents) {
              if (db.prepare('SELECT id FROM residents WHERE chart_number = ?').get(inputResident.chartNumber)) { skippedResidents++; continue; }
              const resident = store.insertResident(inputResident); imported.set(resident.chartNumber, resident.id);
            }
            for (const inputPlan of preview.plans) {
              const residentId = imported.get(inputPlan.chartNumber);
              if (!residentId || db.prepare('SELECT id FROM plans WHERE resident_id = ? AND target_month = ?').get(residentId, inputPlan.targetMonth)) { skippedPlans++; continue; }
              const { chartNumber, ...fields } = inputPlan;
              store.insertPlan(validatePlan({ ...fields, residentId })); createdPlans++;
            }
            // Imported settings are applied only for an empty installation to protect existing office configuration.
            if (skippedResidents === 0 && imported.size === store.residents().length) store.setSettings(preview.settings);
            const counts = { createdResidents: imported.size, createdPlans, skippedResidents, skippedPlans, warnings: preview.warnings };
            store.audit(user, 'workbook.import', null, { createdResidents: imported.size, createdPlans, skippedResidents, skippedPlans });
            return counts;
          });
          previews.delete(input.previewId);
          return json(res, 201, result);
        }
        throw new ApiError(404, 'APIが見つかりません。', 'NOT_FOUND');
      }
      if (staticDir && ['GET', 'HEAD'].includes(method)) {
        const root = resolve(staticDir);
        let requested;
        try { requested = decodeURIComponent(pathname); } catch { throw new ApiError(400, 'URLの形式が正しくありません。'); }
        const file = resolve(root, `.${requested}`);
        if (file !== root && !file.startsWith(root + sep)) throw new ApiError(403, 'アクセスできません。');
        let selected = file;
        try { if ((await stat(selected)).isDirectory()) selected = resolve(selected, 'index.html'); }
        catch { if (!extname(requested)) selected = resolve(root, 'index.html'); else throw new ApiError(404, 'ファイルが見つかりません。', 'NOT_FOUND'); }
        let content;
        try {
          const [realRoot, realSelected] = await Promise.all([realpath(root), realpath(selected)]);
          if (!realSelected.startsWith(realRoot + sep)) throw new ApiError(403, 'アクセスできません。');
          content = await readFile(realSelected);
        } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(404, '画面がまだビルドされていません。', 'NOT_FOUND'); }
        res.writeHead(200, { 'Content-Type': MIME[extname(selected)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return res.end(method === 'HEAD' ? undefined : content);
      }
      throw new ApiError(404, 'ページが見つかりません。', 'NOT_FOUND');
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : '処理に失敗しました。共有元PCの状態を確認してください。', code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR' });
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  const cleanup = setInterval(() => {
    const time = Date.now();
    for (const [key, value] of sessions) if (value.expiresAt <= time) sessions.delete(key);
    for (const [key, value] of previews) if (value.expiresAt <= time) previews.delete(key);
    for (const [key, value] of loginAttempts) if (value.expiresAt <= time) loginAttempts.delete(key);
  }, 60_000);
  cleanup.unref();
  try { await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); }); }
  catch (error) { clearInterval(cleanup); db.close(); throw error; }
  const address = server.address();
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    clearInterval(cleanup); sessions.clear(); previews.clear(); loginAttempts.clear();
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    db.close();
  };
  return { server, db, url, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); if (index === -1) return fallback; if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} の値を指定してください。`); return args[index + 1]; };
  try {
    const dataDir = resolve(option('--data-dir', './local-data'));
    const port = Number(option('--port', '43180'));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('ポートは0〜65535で指定してください。');
    const app = await createCareServer({ dbPath: resolve(dataDir, 'care-management.sqlite'), host: option('--host', '127.0.0.1'), port, staticDir: option('--static-dir', resolve('dist')) });
    console.log(`ケアマネ業務管理 API: ${app.url}`);
    const shutdown = async () => { await app.close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
