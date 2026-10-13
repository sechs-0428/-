import ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 10000;
const ERA_BASE = { R: 2018, '令和': 2018, H: 1988, '平成': 1988, S: 1925, '昭和': 1925, T: 1911, '大正': 1911, M: 1867, '明治': 1867 };
const WEEKDAYS = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };

// Check ZIP metadata before ExcelJS expands the archive. No VBA is executed.
function checkArchive(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Excelファイルを指定してください。');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('Excelファイルは10MB以下にしてください。');
  let end = -1;
  for (let pos = buffer.length - 22; pos >= Math.max(0, buffer.length - 65557); pos--) {
    if (buffer.readUInt32LE(pos) === 0x06054b50 && pos + 22 + buffer.readUInt16LE(pos + 20) === buffer.length) { end = pos; break; }
  }
  if (end < 0) throw new Error('有効なExcelファイルではありません。');
  const entries = buffer.readUInt16LE(end + 10);
  const start = buffer.readUInt32LE(end + 16);
  const size = buffer.readUInt32LE(end + 12);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || entries !== buffer.readUInt16LE(end + 8)
    || entries === 0xffff || entries > 1000 || start === 0xffffffff || size === 0xffffffff || start + size !== end) {
    throw new Error('このExcelファイルの圧縮形式には対応していません。');
  }
  let pos = start;
  let expanded = 0;
  const names = new Set();
  for (let entry = 0; entry < entries; entry++) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Excelファイルの構造が不正です。');
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressed = buffer.readUInt32LE(pos + 20);
    const uncompressed = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset + 30 > start) {
      throw new Error('暗号化されたファイル、または不正なExcelファイルには対応していません。');
    }
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    if (names.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Excelファイルの構造が不正です。');
    names.add(name);
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('展開後のExcelファイルが大きすぎます。');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50 || buffer.readUInt16LE(localOffset + 8) !== method) throw new Error('Excelファイルの構造が不正です。');
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataOffset + compressed > start) throw new Error('Excelファイルの構造が不正です。');
    const content = buffer.subarray(dataOffset, dataOffset + compressed);
    let actualLength;
    try { actualLength = method === 0 ? content.length : inflateRawSync(content, { maxOutputLength: Math.min(uncompressed + 1, MAX_EXPANDED_BYTES + 1) }).length; }
    catch { throw new Error('Excelファイルが破損しているか、展開後のサイズが上限を超えています。'); }
    if (actualLength !== uncompressed) throw new Error('Excelファイルの展開サイズが不正です。');
    pos = next;
  }
  if (pos !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw new Error('有効なExcelファイルではありません。');
}

function scalar(cell) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value !== 'object' || value instanceof Date) return value;
  if ('result' in value) return value.result ?? '';
  if (value.richText) return value.richText.map(part => part.text).join('');
  if ('text' in value) return value.text ?? '';
  return '';
}

function text(value) {
  return value == null ? '' : String(value).trim().normalize('NFC');
}

// Identity matching allows only ordinary Japanese/ASCII spaces to differ.
function nameKey(value) {
  return value == null ? '' : String(value).replace(/[ \u3000]/g, '');
}

function integer(value) {
  const normalized = text(value).replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10));
  return /^\d+$/.test(normalized) ? Number(normalized) : NaN;
}

function yearValue(era, value) {
  const e = text(era).normalize('NFKC').toUpperCase();
  const y = text(value) === '元' ? 1 : integer(value);
  if (!Number.isInteger(y) || y < 1) return NaN;
  if (Object.hasOwn(ERA_BASE, e)) return ERA_BASE[e] + y;
  if ((!e || e === '西暦' || e === 'AD') && y >= 1868 && y <= 2199) return y;
  return NaN;
}

function validDate(y, m, d) {
  if (!Number.isInteger(y) || y < 1868 || y > 2199 || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function sourceNote(label, values) {
  return `${label}（原本）：${values.map(([key, value]) => `${key}${text(value) || '未入力'}`).join('・')}`;
}

function readMonth(sheet, row, columns, warn, notes, label) {
  const values = columns.map(col => scalar(sheet.getCell(`${col}${row}`)));
  if (values.every(value => text(value) === '')) return '';
  const y = yearValue(values[0], values[1]);
  const m = integer(values[2]);
  if (!validDate(y, m, 1)) {
    warn(sheet.name, row, columns.join('/'), `${label}の年月が不完全または不正です。原本を備考に保持しました。`);
    notes.push(sourceNote(label, [['元号', values[0]], ['年', values[1]], ['月', values[2]]]));
    return '';
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function dateValue(value, date1904 = false) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value < 110000) {
    // Excel serial 60 represents a nonexistent leap day.
    if (!date1904 && Math.floor(value) === 60) return '';
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const days = Math.floor(value) - (!date1904 && value > 60 ? 1 : 0);
    const d = new Date(epoch + days * 86400000);
    if (validDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return '';
  }
  const v = text(value).replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10));
  let match = v.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
  if (match && validDate(Number(match[1]), Number(match[2]), Number(match[3]))) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = v.match(/^(令和|平成|昭和|大正|明治|R|H|S|T|M)\s*(元|\d+)\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?$/i);
  if (match) {
    const y = yearValue(match[1], match[2]);
    if (validDate(y, Number(match[3]), Number(match[4]))) return isoDate(y, Number(match[3]), Number(match[4]));
  }
  return '';
}

function blankResident(chartNumber, room = '', name = '') {
  return { chartNumber, room, name, insurer: '', careLevel: '', creationMonth: '', planStartMonth: '', planEndMonth: '', certificationExpiryMonth: '', admissionDate: '', admissionNote: '', physicalIndependence: '', cognitiveIndependence: '', restraint: false, careManager: '', notes: '', status: 'active' };
}

function checkLayout(sheet, headerRow) {
  if (!sheet || !['居室', 'カルテ', '氏名'].every((value, i) => text(scalar(sheet.getCell(headerRow, i + 1))) === value)) throw new Error('対応する管理表の列構成ではありません。原本の「認定期間管理表」「ケアプラン管理表」を確認してください。');
  if (sheet.rowCount > MAX_ROWS) throw new Error('Excelの行数が上限を超えています。');
}

function timeValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = text(value).match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  return match && Number(match[1]) < 24 ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function meetingDate(targetMonth, nth, weekday) {
  if (!/^\d{4}-\d{2}$/.test(targetMonth) || nth < 1 || nth > 5 || !Object.hasOwn(WEEKDAYS, weekday)) return '';
  const [y, m] = targetMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const day = 1 + (WEEKDAYS[weekday] - first + 7) % 7 + (nth - 1) * 7;
  return validDate(y, m, day) ? isoDate(y, m, day) : '';
}

export async function parseWorkbook(buffer) {
  checkArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw new Error('Excelファイルを読み込めませんでした。暗号化や破損がないか確認してください。'); }
  const warnings = [];
  const warn = (sheet, row, column, message) => warnings.push(`${sheet} ${row}行 ${column}列：${message}`);
  const residents = [];
  const plans = [];
  const residentByChart = new Map();
  const residentNames = new Map();
  const conflictedCharts = new Set();
  const basic = workbook.getWorksheet('基本設定');
  const residentSheet = workbook.getWorksheet('認定期間管理表');
  const planSheet = workbook.getWorksheet('ケアプラン管理表');
  if (!residentSheet && !planSheet) throw new Error('「認定期間管理表」または「ケアプラン管理表」が必要です。');
  if (residentSheet) checkLayout(residentSheet, 1);
  if (planSheet) checkLayout(planSheet, 4);
  const settings = { facilityName: '', floor: '', targetMonth: '', authors: [], careManagers: [], periodMode: 'certification', meeting1Date: '', meeting2Date: '', meeting1Time: '', meeting2Time: '', meetingLocation: '', contactName: '', contactPhone: '', consentBody: '', restraintBody: '' };
  if (basic) {
    const y = yearValue('R', scalar(basic.getCell('B7')));
    const m = integer(scalar(basic.getCell('B10')));
    if (validDate(y, m, 1)) settings.targetMonth = `${y}-${String(m).padStart(2, '0')}`;
    else warn(basic.name, 7, 'B7/B10', '対象年月が不完全または不正です。');
    const mode = text(scalar(basic.getCell('C8'))).normalize('NFKC');
    if (mode === '期間満了日+3か月') settings.periodMode = 'threeMonths';
    else if (mode && mode !== '満了日迄') warn(basic.name, 8, 'C', '有効期間の方式を認識できません。設定を確認してください。');
    for (let row = 7; row <= Math.min(basic.rowCount, 1000); row++) {
      const author = text(scalar(basic.getCell(`D${row}`)));
      if (!author) break;
      if (!settings.authors.includes(author)) settings.authors.push(author);
    }
    settings.careManagers = [...new Set(['E13', 'F13'].map(ref => text(scalar(basic.getCell(ref)))).filter(Boolean))];
    for (const [index, col] of [[1, 'E'], [2, 'F']]) {
      const nth = integer(scalar(basic.getCell(`${col}9`)));
      const weekday = text(scalar(basic.getCell(`${col}11`))).replace(/曜日$/, '');
      settings[`meeting${index}Date`] = meetingDate(settings.targetMonth, nth, weekday);
      if ((Number.isFinite(nth) || weekday) && !settings[`meeting${index}Date`]) warn(basic.name, 9, `${col}9/${col}11`, '対象月の会議日を算出できません。');
      else if (settings[`meeting${index}Date`]) warn(basic.name, 9, `${col}9/${col}11`, '対象年月と第n曜日の設定から会議日を算出しました。旧帳票の日付は使用していません。');
    }
  } else warnings.push('基本設定シートがないため、対象年月と会議設定は空欄です。');
  const consentSheet = workbook.getWorksheet('同意書');
  if (consentSheet) {
    settings.facilityName = text(scalar(consentSheet.getCell('T9')));
    settings.floor = text(scalar(consentSheet.getCell('K3')));
    // Fixed text only: E12 contains a historical resident name and is excluded.
    const greeting = text(scalar(consentSheet.getCell('B11')));
    const beforeName = text(scalar(consentSheet.getCell('B12')));
    const afterName = text(scalar(consentSheet.getCell('H12')));
    const body = text(scalar(consentSheet.getCell('B14')));
    const paragraph = [beforeName, beforeName && afterName ? '{利用者氏名}' : '', afterName, body].join('');
    settings.consentBody = [greeting, paragraph].filter(Boolean).join('\n\n');
  }
  const restraintSheet = workbook.getWorksheet('拘束同意書');
  if (restraintSheet) settings.restraintBody = ['D36', 'E37', 'D38'].map(ref => text(scalar(restraintSheet.getCell(ref)))).filter(Boolean).join('\n\n');
  for (const [index, name] of [[1, '会議のお知らせ（１回目）'], [2, '会議のお知らせ（２回目）']]) {
    const notice = workbook.getWorksheet(name);
    if (notice) settings[`meeting${index}Time`] = timeValue(scalar(notice.getCell('H6')));
  }

  if (residentSheet) {
    for (let row = 2; row <= residentSheet.rowCount; row++) {
      const values = ref => scalar(residentSheet.getCell(`${ref}${row}`));
      const chartNumber = text(values('B'));
      if (!chartNumber && !text(values('C'))) continue;
      if (!chartNumber || chartNumber.length > 64) { warn(residentSheet.name, row, 'B', 'カルテ番号がない、または長すぎるため、この行を読み込みません。'); continue; }
      if (!text(values('C'))) { warn(residentSheet.name, row, 'C', '氏名が空欄のため取り込み対象から除外しました。原Excelで確認してください。'); continue; }
      if (residentByChart.has(chartNumber)) {
        if (residentNames.get(chartNumber) !== nameKey(values('C'))) {
          conflictedCharts.add(chartNumber);
          warn(residentSheet.name, row, 'B/C', '同じカルテ番号の氏名が一致しません。後の利用者行と、この番号のプランは取り込み対象から除外します。原Excelで確認してください。');
        } else warn(residentSheet.name, row, 'B', '同じカルテ番号が重複しています。後の行は読み込みません。');
        continue;
      }
      const resident = blankResident(chartNumber, text(values('A')), text(values('C')));
      const notes = [];
      resident.insurer = text(values('D'));
      for (const [field, cols, label] of [
        ['creationMonth', ['E', 'F', 'G'], '作成年月'], ['planStartMonth', ['H', 'I', 'J'], 'プラン開始年月'],
        ['planEndMonth', ['M', 'N', 'O'], 'プラン終了年月'], ['certificationExpiryMonth', ['Q', 'R', 'S'], '認定期限年月'],
      ]) resident[field] = readMonth(residentSheet, row, cols, warn, notes, label);
      if (resident.planStartMonth && resident.planEndMonth && resident.planStartMonth > resident.planEndMonth) {
        notes.push(sourceNote(`${residentSheet.name} ${row}行 逆転したプラン期間`, [['開始年月', resident.planStartMonth], ['終了年月', resident.planEndMonth]]));
        resident.planStartMonth = '';
        resident.planEndMonth = '';
        warn(residentSheet.name, row, 'H:O', 'プラン終了年月が開始年月より前のため、開始・終了年月を空欄にしました。原本の年月を備考で確認し、修正してください。');
      }
      const care = text(values('P'));
      if (care && !/^[1-5]$/.test(care)) { warn(residentSheet.name, row, 'P', '介護度を認識できません。原本を備考に保持しました。'); notes.push(sourceNote('介護度', [['値', care]])); }
      else resident.careLevel = care;
      const admission = ['T', 'U', 'V', 'W'].map(values);
      if (admission.some(value => text(value))) {
        const y = yearValue(admission[0], admission[1]);
        const m = integer(admission[2]);
        const d = integer(admission[3]);
        if (validDate(y, m, d)) resident.admissionDate = isoDate(y, m, d);
        else { resident.admissionNote = sourceNote('入所日', [['元号', admission[0]], ['年', admission[1]], ['月', admission[2]], ['日', admission[3]]]); warn(residentSheet.name, row, 'T:W', '入所日が不完全または不正です。原本を入所日メモに保持しました。'); }
      }
      resident.physicalIndependence = text(values('X'));
      resident.cognitiveIndependence = text(values('Y'));
      if (resident.physicalIndependence && !['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(resident.physicalIndependence)) warn(residentSheet.name, row, 'X', '自立度が原本の入力候補と異なります。');
      if (resident.cognitiveIndependence && !['I', 'Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M'].includes(resident.cognitiveIndependence)) warn(residentSheet.name, row, 'Y', '認知症自立度が原本の入力候補と異なります。');
      const restraint = text(values('Z'));
      resident.restraint = ['○', '〇', 'あり', '有', '有り', '1', 'true'].includes(restraint);
      if (restraint && !resident.restraint) { warn(residentSheet.name, row, 'Z', '拘束欄を認識できません。原本を備考に保持しました。'); notes.push(sourceNote('拘束', [['値', restraint]])); }
      if (text(values('K'))) { warn(residentSheet.name, row, 'K', '未定義の補助列の値を備考に保持しました。'); notes.push(sourceNote('K列', [['値', values('K')]])); }
      resident.notes = notes.join('\n');
      residents.push(resident);
      residentByChart.set(chartNumber, resident);
      residentNames.set(chartNumber, nameKey(values('C')));
    }
  } else warnings.push('認定期間管理表シートがないため、プランの利用者情報だけを登録します。');

  if (planSheet) {
    // Find conflicts before importing any plan or copying a care manager.
    const planNames = new Map();
    for (let row = 8; row <= planSheet.rowCount; row++) {
      const chart = text(scalar(planSheet.getCell(`B${row}`)));
      const sourceName = scalar(planSheet.getCell(`C${row}`));
      if (!chart || !text(sourceName)) continue;
      const key = nameKey(sourceName);
      if ((planNames.has(chart) && planNames.get(chart) !== key) || (residentNames.has(chart) && residentNames.get(chart) !== key)) conflictedCharts.add(chart);
      else planNames.set(chart, key);
    }
    const planCharts = new Set();
    for (let row = 8; row <= planSheet.rowCount; row++) {
      const values = ref => scalar(planSheet.getCell(`${ref}${row}`));
      const chartNumber = text(values('B'));
      if (!chartNumber && !text(values('C'))) continue;
      if (!chartNumber || chartNumber.length > 64) { warn(planSheet.name, row, 'B', 'カルテ番号がない、または長すぎるため、この行を読み込みません。'); continue; }
      if (!text(values('C'))) { warn(planSheet.name, row, 'C', '氏名が空欄のため取り込み対象から除外しました。原Excelで確認してください。'); continue; }
      if (conflictedCharts.has(chartNumber)) { warn(planSheet.name, row, 'B/C', '氏名が一致しないため取り込み対象から除外しました。原Excelで確認してください。'); continue; }
      if (planCharts.has(chartNumber)) { warn(planSheet.name, row, 'B', '同じカルテ番号のプランが重複しています。後の行は読み込みません。'); continue; }
      planCharts.add(chartNumber);
      if (!residentByChart.has(chartNumber)) {
        const resident = blankResident(chartNumber, text(values('A')), text(values('C')));
        resident.notes = 'ケアプラン管理表だけに存在する利用者です。認定期間などの基本情報を確認してください。';
        residents.push(resident);
        residentByChart.set(chartNumber, resident);
        residentNames.set(chartNumber, nameKey(values('C')));
        warn(planSheet.name, row, 'B', '認定期間管理表に対応する利用者がありません。最小限の利用者情報を追加しました。');
      }
      const notes = [];
      const plan = { chartNumber, targetMonth: settings.targetMonth, creator: text(values('D')), creationDate: '', printDate: '', meetingDate: '', careManager: text(values('H')), periodStartDate: '', periodEndDate: '', effectivePeriodText: text(values('I')), consentStatus: '未送付', meetingRound: row < 28 ? 1 : 2, restraint: residentByChart.get(chartNumber).restraint, notes: '' };
      for (const [field, col, label] of [['creationDate', 'E', '作成日'], ['printDate', 'F', '印刷日'], ['meetingDate', 'G', '会議日']]) {
        const value = values(col);
        plan[field] = dateValue(value, workbook.properties.date1904);
        if (text(value) && !plan[field]) { warn(planSheet.name, row, col, `${label}が不完全または不正です。原本を備考に保持しました。`); notes.push(sourceNote(label, [['値', value]])); }
      }
      if (plan.effectivePeriodText) warn(planSheet.name, row, 'I', '有効期間の原文を保持しました。年を推測せず、開始日と終了日は空欄です。');
      const consent = text(values('J'));
      if (['未送付', '送付済', '回収済'].includes(consent)) plan.consentStatus = consent;
      else if (consent) { warn(planSheet.name, row, 'J', '同意書の状態を認識できません。原本を備考に保持しました。'); notes.push(sourceNote('同意書', [['値', consent]])); }
      plan.notes = notes.join('\n');
      if (plan.careManager) {
        residentByChart.get(chartNumber).careManager = plan.careManager;
        if (!settings.careManagers.includes(plan.careManager)) settings.careManagers.push(plan.careManager);
      }
      if (plan.creator && !settings.authors.includes(plan.creator)) settings.authors.push(plan.creator);
      if (!settings.targetMonth) {
        const resident = residentByChart.get(chartNumber);
        const preserved = sourceNote('対象月未確定のプラン', [['作成者', values('D')], ['作成日', values('E')], ['印刷日', values('F')], ['会議日', values('G')], ['担当CM', values('H')], ['有効期間', values('I')], ['同意書', values('J')]]);
        resident.notes = [resident.notes, preserved].filter(Boolean).join('\n');
        warn(planSheet.name, row, 'B', '対象年月が不明のためプランを読み込みません。原本の情報を利用者備考に保持しました。');
        continue;
      }
      plans.push(plan);
    }
  }
  return { residents, plans, settings, warnings, summary: { residentCount: residents.length, planCount: plans.length, restraintCount: residents.filter(item => item.restraint).length, warningCount: warnings.length } };
}
