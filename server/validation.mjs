export class ApiError extends Error {
  constructor(status, message, code = 'INVALID_REQUEST') {
    super(message); this.status = status; this.code = code;
  }
}

export function object(value, label = '入力') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, `${label}はオブジェクトで指定してください。`);
  return value;
}

export function exact(value, keys, label = '入力') {
  object(value, label);
  const unexpected = Object.keys(value).find(key => !keys.includes(key));
  if (unexpected) throw new ApiError(400, `${label}に未対応の項目があります: ${unexpected}`);
  return value;
}

export function string(value, label, max = 200, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new ApiError(400, `${label}は文字列で指定してください。`);
  value = value.trim();
  if (value.length > max || (required && !value)) throw new ApiError(400, `${label}を${required ? '1〜' : ''}${max}文字以内で指定してください。`);
  return value;
}

export function month(value, label = '対象月', required = false) {
  value = string(value, label, 7, required);
  if (value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new ApiError(400, `${label}は YYYY-MM 形式で指定してください。`);
  if (value && Number(value.slice(0, 4)) < 1868) throw new ApiError(400, `${label}の年が範囲外です。`);
  return value;
}

export function date(value, label) {
  value = string(value, label, 10);
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, `${label}は YYYY-MM-DD 形式で指定してください。`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1868) throw new ApiError(400, `${label}が存在しない日付です。`);
  return value;
}

export function choice(value, choices, fallback, label) {
  if (value === undefined) value = fallback;
  if (!choices.includes(value)) throw new ApiError(400, `${label}の値が正しくありません。`);
  return value;
}

export function boolean(value, fallback = false, label = '選択項目') {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ApiError(400, `${label}は真偽値で指定してください。`);
  return value;
}

export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, '更新番号がありません。画面を再読込してください。', 'REVISION_REQUIRED');
  return value;
}

const residentKeys = ['id', 'chartNumber', 'room', 'name', 'insurer', 'careLevel', 'creationMonth', 'planStartMonth', 'planEndMonth', 'certificationExpiryMonth', 'admissionDate', 'admissionNote', 'physicalIndependence', 'cognitiveIndependence', 'restraint', 'careManager', 'notes', 'status', 'revision', 'updatedAt'];
export function validateResident(value) {
  exact(value, residentKeys, '利用者');
  const result = {
    chartNumber: string(value.chartNumber, 'カルテ番号', 100, true),
    room: string(value.room, '居室', 100), name: string(value.name, '氏名', 100, true),
    insurer: string(value.insurer, '保険者', 200),
    careLevel: choice(value.careLevel, ['', '1', '2', '3', '4', '5'], '', '要介護度'),
    creationMonth: month(value.creationMonth, '作成月'),
    planStartMonth: month(value.planStartMonth, '計画開始月'),
    planEndMonth: month(value.planEndMonth, '計画終了月'),
    certificationExpiryMonth: month(value.certificationExpiryMonth, '認定満了月'),
    admissionDate: date(value.admissionDate, '入所日'), admissionNote: string(value.admissionNote, '入所メモ', 2000),
    physicalIndependence: string(value.physicalIndependence, '身体自立度', 50), cognitiveIndependence: string(value.cognitiveIndependence, '認知自立度', 50),
    restraint: boolean(value.restraint, false, '身体拘束'), careManager: string(value.careManager, '担当ケアマネ', 100),
    notes: string(value.notes, '備考', 10000), status: choice(value.status, ['active', 'discharged'], 'active', '在所状況'),
  };
  if (result.planStartMonth && result.planEndMonth && result.planStartMonth > result.planEndMonth) throw new ApiError(400, '計画終了月は開始月以降にしてください。');
  return result;
}

const planKeys = ['id', 'residentId', 'targetMonth', 'creator', 'creationDate', 'printDate', 'meetingDate', 'careManager', 'effectivePeriodText', 'periodStartDate', 'periodEndDate', 'restraint', 'consentStatus', 'meetingRound', 'notes', 'revision', 'updatedAt'];
export function validatePlan(value) {
  exact(value, planKeys, '計画');
  const result = {
    residentId: string(value.residentId, '利用者ID', 100, true), targetMonth: month(value.targetMonth, '対象月', true),
    creator: string(value.creator, '作成者', 100), creationDate: date(value.creationDate, '作成日'), printDate: date(value.printDate, '印刷日'),
    meetingDate: date(value.meetingDate, '会議日'), careManager: string(value.careManager, '担当ケアマネ', 100),
    effectivePeriodText: string(value.effectivePeriodText, '計画期間', 500),
    periodStartDate: date(value.periodStartDate, '計画開始日'), periodEndDate: date(value.periodEndDate, '計画終了日'), restraint: boolean(value.restraint, false, '身体拘束'),
    consentStatus: choice(value.consentStatus, ['未送付', '送付済', '回収済'], '未送付', '同意書の状況'),
    meetingRound: choice(value.meetingRound, [1, 2], 1, '会議回'), notes: string(value.notes, '備考', 10000),
  };
  if (result.periodStartDate && result.periodEndDate && result.periodStartDate > result.periodEndDate) throw new ApiError(400, '計画終了日は開始日以降にしてください。');
  return result;
}

export const defaultSettings = Object.freeze({
  facilityName: '', floor: '', targetMonth: '', authors: [], careManagers: [], periodMode: 'certification',
  meeting1Date: '', meeting2Date: '', meeting1Time: '', meeting2Time: '', meetingLocation: '', contactName: '', contactPhone: '',
  consentBody: '計画書をご確認いただき、同意欄にご署名ください。',
  restraintBody: '説明内容をご確認いただき、確認欄にご署名ください。',
});

export function names(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new ApiError(400, `${label}は100件以内の一覧で指定してください。`);
  return [...new Set(value.map(item => string(item, label, 100, true)))];
}

function time(value, label) {
  value = string(value, label, 5);
  if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new ApiError(400, `${label}は HH:mm 形式で指定してください。`);
  return value;
}

export function validateSettings(value) {
  exact(value, [...Object.keys(defaultSettings), 'revision'], '設定');
  if (value.revision !== undefined) revision(value.revision);
  return {
    facilityName: string(value.facilityName, '施設名', 200), floor: string(value.floor, 'フロア', 100),
    targetMonth: month(value.targetMonth, '対象月'), authors: names(value.authors, '作成者'), careManagers: names(value.careManagers, '担当ケアマネ'),
    periodMode: choice(value.periodMode, ['certification', 'threeMonths'], 'certification', '期間設定'),
    meeting1Date: date(value.meeting1Date, '第1回会議日'), meeting2Date: date(value.meeting2Date, '第2回会議日'),
    meeting1Time: time(value.meeting1Time, '第1回会議時刻'), meeting2Time: time(value.meeting2Time, '第2回会議時刻'),
    meetingLocation: string(value.meetingLocation, '会議場所', 300), contactName: string(value.contactName, '連絡先氏名', 100), contactPhone: string(value.contactPhone, '電話番号', 50),
    consentBody: string(value.consentBody, '同意文', 10000), restraintBody: string(value.restraintBody, '確認文', 10000),
  };
}

export function validateBackup(value) {
  exact(value, ['type', 'schemaVersion', 'applicationVersion', 'exportedAt', 'settings', 'residents', 'plans'], 'バックアップ');
  if (value.schemaVersion !== 1 || (value.type !== undefined && value.type !== 'caremanager-backup')) throw new ApiError(400, 'この形式・バージョンのバックアップには対応していません。', 'BACKUP_INVALID');
  string(value.applicationVersion, 'ソフトのバージョン', 50, true);
  const exportedAt = string(value.exportedAt, '保存日時', 40, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt) || !Number.isFinite(new Date(exportedAt).getTime()) || new Date(exportedAt).toISOString() !== exportedAt) throw new ApiError(400, 'バックアップの保存日時が正しくありません。', 'BACKUP_INVALID');
  if (!Array.isArray(value.residents) || !Array.isArray(value.plans) || value.residents.length > 10000 || value.plans.length > 10000) throw new ApiError(400, 'バックアップの利用者・プラン一覧が正しくありません。', 'BACKUP_INVALID');
  const settings = validateSettings(value.settings);
  const identifiers = (record, label) => {
    const id = string(record.id, `${label}ID`, 100, true);
    revision(record.revision);
    const updatedAt = string(record.updatedAt, `${label}の更新日時`, 40, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt) || !Number.isFinite(new Date(updatedAt).getTime()) || new Date(updatedAt).toISOString() !== updatedAt) throw new ApiError(400, 'バックアップの更新日時が正しくありません。', 'BACKUP_INVALID');
    return id;
  };
  const residentIds = new Set(), chartNumbers = new Set();
  const residents = value.residents.map(record => {
    const normalized = validateResident(record), id = identifiers(record, '利用者');
    if (residentIds.has(id) || chartNumbers.has(normalized.chartNumber)) throw new ApiError(400, 'バックアップ内の利用者IDまたはカルテ番号が重複しています。', 'BACKUP_INVALID');
    residentIds.add(id); chartNumbers.add(normalized.chartNumber);
    return { originalId: id, resident: normalized };
  });
  const planIds = new Set(), planPairs = new Set();
  const plans = value.plans.map(record => {
    const normalized = validatePlan(record), id = identifiers(record, '計画');
    const pair = JSON.stringify([normalized.residentId, normalized.targetMonth]);
    if (!residentIds.has(normalized.residentId)) throw new ApiError(400, 'バックアップのプランに対応する利用者がありません。', 'BACKUP_INVALID');
    if (planIds.has(id) || planPairs.has(pair)) throw new ApiError(400, 'バックアップ内の計画IDまたは利用者・対象月が重複しています。', 'BACKUP_INVALID');
    planIds.add(id); planPairs.add(pair);
    return normalized;
  });
  return { residents, plans, settings, warnings: value.type === undefined ? ['旧形式のバックアップを読み込みました。復元後の保存には現在の形式を使用します。'] : [] };
}

export function username(value) {
  value = string(value, 'ログイン名', 60, true);
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new ApiError(400, 'ログイン名には半角英数字・ _ . - を使用してください。');
  return value.toLowerCase();
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) throw new ApiError(400, 'パスワードは10〜200文字で指定してください。');
  return value;
}
