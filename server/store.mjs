import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, defaultSettings } from './validation.mjs';

export function openStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  if (db.prepare('PRAGMA user_version').get().user_version > 1) {
    db.close(); throw new Error('このデータベースは新しいバージョンのソフトで作成されています。');
  }
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS residents (id TEXT PRIMARY KEY, chart_number TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, resident_id TEXT NOT NULL REFERENCES residents(id), target_month TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(resident_id, target_month));
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, metadata TEXT NOT NULL);
    PRAGMA user_version = 1;`);
  db.prepare('INSERT OR IGNORE INTO settings (id, payload) VALUES (1, ?)').run(JSON.stringify({ ...defaultSettings, revision: 1 }));
  const initialSettings = JSON.parse(db.prepare('SELECT payload FROM settings WHERE id = 1').get().payload);
  if (!Number.isSafeInteger(initialSettings.revision) || initialSettings.revision < 1) db.prepare('UPDATE settings SET payload = ? WHERE id = 1').run(JSON.stringify({ ...initialSettings, revision: 1 }));
  const now = () => new Date().toISOString();
  const transaction = operation => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const audit = (user, action, entityId = null, metadata = {}) => {
    db.prepare('INSERT INTO audit (timestamp, actor_id, actor_name, action, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)').run(now(), user?.id ?? null, user?.displayName ?? 'system', action, entityId, JSON.stringify(metadata));
  };
  const publicUser = row => row && ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, disabled: Boolean(row.disabled), createdAt: row.created_at, updatedAt: row.updated_at });
  const getUser = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const residents = () => db.prepare('SELECT payload FROM residents').all().map(row => JSON.parse(row.payload)).sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }) || a.chartNumber.localeCompare(b.chartNumber, 'ja', { numeric: true }));
  const plans = () => db.prepare('SELECT payload FROM plans ORDER BY target_month, resident_id').all().map(row => JSON.parse(row.payload));
  const getResident = id => { const row = db.prepare('SELECT payload FROM residents WHERE id = ?').get(id); return row ? JSON.parse(row.payload) : null; };
  const getPlan = id => { const row = db.prepare('SELECT payload FROM plans WHERE id = ?').get(id); return row ? JSON.parse(row.payload) : null; };
  const insertResident = input => {
    if (db.prepare('SELECT id FROM residents WHERE chart_number = ?').get(input.chartNumber)) throw new ApiError(409, 'このカルテ番号は登録済みです。', 'DUPLICATE_CHART');
    const record = { ...input, id: randomUUID(), revision: 1, updatedAt: now() };
    db.prepare('INSERT INTO residents (id, chart_number, revision, payload) VALUES (?, ?, ?, ?)').run(record.id, record.chartNumber, record.revision, JSON.stringify(record));
    return record;
  };
  const updateResident = (id, input, expectedRevision) => {
    const current = getResident(id);
    if (!current) throw new ApiError(404, '利用者が見つかりません。', 'NOT_FOUND');
    if (current.revision !== expectedRevision) throw new ApiError(409, '他の職員が更新しました。再読込して変更内容を確認してください。', 'REVISION_CONFLICT');
    if (db.prepare('SELECT id FROM residents WHERE chart_number = ? AND id <> ?').get(input.chartNumber, id)) throw new ApiError(409, 'このカルテ番号は登録済みです。', 'DUPLICATE_CHART');
    const record = { ...input, id, revision: current.revision + 1, updatedAt: now() };
    db.prepare('UPDATE residents SET chart_number = ?, revision = ?, payload = ? WHERE id = ?').run(record.chartNumber, record.revision, JSON.stringify(record), id);
    return record;
  };
  const insertPlan = input => {
    if (!getResident(input.residentId)) throw new ApiError(404, '計画の利用者が見つかりません。', 'NOT_FOUND');
    if (db.prepare('SELECT id FROM plans WHERE resident_id = ? AND target_month = ?').get(input.residentId, input.targetMonth)) throw new ApiError(409, 'この利用者の対象月の計画は登録済みです。', 'DUPLICATE_PLAN');
    const record = { ...input, id: randomUUID(), revision: 1, updatedAt: now() };
    db.prepare('INSERT INTO plans (id, resident_id, target_month, revision, payload) VALUES (?, ?, ?, ?, ?)').run(record.id, record.residentId, record.targetMonth, record.revision, JSON.stringify(record));
    return record;
  };
  const updatePlan = (id, input, expectedRevision) => {
    const current = getPlan(id);
    if (!current) throw new ApiError(404, '計画が見つかりません。', 'NOT_FOUND');
    if (current.revision !== expectedRevision) throw new ApiError(409, '他の職員が更新しました。再読込して変更内容を確認してください。', 'REVISION_CONFLICT');
    if (!getResident(input.residentId)) throw new ApiError(404, '計画の利用者が見つかりません。', 'NOT_FOUND');
    if (db.prepare('SELECT id FROM plans WHERE resident_id = ? AND target_month = ? AND id <> ?').get(input.residentId, input.targetMonth, id)) throw new ApiError(409, 'この利用者の対象月の計画は登録済みです。', 'DUPLICATE_PLAN');
    const record = { ...input, id, revision: current.revision + 1, updatedAt: now() };
    db.prepare('UPDATE plans SET resident_id = ?, target_month = ?, revision = ?, payload = ? WHERE id = ?').run(record.residentId, record.targetMonth, record.revision, JSON.stringify(record), id);
    return record;
  };
  const getSettings = () => JSON.parse(db.prepare('SELECT payload FROM settings WHERE id = 1').get().payload);
  const setSettings = (value, expectedRevision) => {
    const current = getSettings();
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new ApiError(409, '他の職員が事業所設定を更新しました。再読込して変更内容を確認してください。', 'REVISION_CONFLICT');
    const updated = { ...value, revision: current.revision + 1 };
    db.prepare('UPDATE settings SET payload = ? WHERE id = 1').run(JSON.stringify(updated));
    return updated;
  };
  const users = () => db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser);
  const audits = (limit = 200) => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit).map(row => ({ id: row.id, timestamp: row.timestamp, actorId: row.actor_id, actorName: row.actor_name, action: row.action, entityId: row.entity_id, metadata: JSON.parse(row.metadata) }));
  return { db, now, transaction, audit, publicUser, getUser, users, residents, plans, getResident, getPlan, insertResident, updateResident, insertPlan, updatePlan, getSettings, setSettings, audits };
}
