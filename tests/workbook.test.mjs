import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../server/workbook.mjs';

function sourceWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const basic = workbook.addWorksheet('基本設定');
  basic.getCell('B7').value = 8;
  basic.getCell('B10').value = 7;
  basic.getCell('C8').value = '期間満了日+３か月';
  basic.getCell('D7').value = '担当者A';
  basic.getCell('E9').value = 1;
  basic.getCell('E11').value = '金';
  basic.getCell('E13').value = 'CM-A';
  basic.getCell('F9').value = 2;
  basic.getCell('F11').value = '金';
  const residents = workbook.addWorksheet('認定期間管理表');
  ['居室', 'カルテ', '氏名'].forEach((v, i) => { residents.getCell(1, i + 1).value = v; });
  const plans = workbook.addWorksheet('ケアプラン管理表');
  ['居室', 'カルテ', '氏名'].forEach((v, i) => { plans.getCell(4, i + 1).value = v; });
  return { workbook, basic, residents, plans };
}

function addResident(sheet, row, chart = String(row)) {
  sheet.getCell(`A${row}`).value = '101';
  sheet.getCell(`B${row}`).value = chart;
  sheet.getCell(`C${row}`).value = `合成利用者${row}`;
  for (const [era, year, month] of [['E', 'F', 'G'], ['H', 'I', 'J'], ['M', 'N', 'O'], ['Q', 'R', 'S']]) {
    sheet.getCell(`${era}${row}`).value = 'R';
    sheet.getCell(`${year}${row}`).value = 8;
    sheet.getCell(`${month}${row}`).value = 7;
  }
  sheet.getCell(`P${row}`).value = 3;
}

async function parse(workbook) {
  return parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
}

test('imports era months, merged rooms and preserves month granularity', async () => {
  const { workbook, residents } = sourceWorkbook();
  addResident(residents, 2, '001');
  addResident(residents, 3, '002');
  residents.mergeCells('A2:A3');
  residents.getCell('T2').value = 'H';
  residents.getCell('U2').value = 31;
  residents.getCell('V2').value = 4;
  residents.getCell('W2').value = 30;
  residents.getCell('Z2').value = '○';
  const result = await parse(workbook);
  assert.equal(result.residents[0].chartNumber, '001');
  assert.equal(result.residents[1].room, '101');
  assert.equal(result.residents[0].creationMonth, '2026-07');
  assert.equal(result.residents[0].admissionDate, '2019-04-30');
  assert.equal(result.settings.periodMode, 'threeMonths');
  assert.equal(result.settings.meeting1Date, '2026-07-03');
  assert.equal(result.settings.meeting2Date, '2026-07-10');
  assert.equal(result.summary.restraintCount, 1);
});

test('imports General-formatted Excel serial dates without inferring effective-period years', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  plans.getCell('B8').value = 123;
  plans.getCell('C8').value = '合成利用者2';
  plans.getCell('G8').value = 46206;
  plans.getCell('I8').value = '8/1～10/31';
  plans.getCell('J8').value = '回収済';
  const result = await parse(workbook);
  assert.equal(result.plans[0].meetingDate, '2026-07-03');
  assert.equal(result.plans[0].effectivePeriodText, '8/1～10/31');
  assert.equal(result.plans[0].periodStartDate, '');
  assert.equal(result.plans[0].periodEndDate, '');
  assert.equal(result.plans[0].meetingRound, 1);
  assert.equal(result.plans[0].consentStatus, '回収済');
});

test('keeps partial admission and bad dates as notes, with warnings free of personal data', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  residents.getCell('G2').value = 13;
  residents.getCell('T2').value = 'R';
  residents.getCell('V2').value = 3;
  residents.getCell('W2').value = 10;
  plans.getCell('B8').value = 123;
  plans.getCell('C8').value = '合成利用者2';
  plans.getCell('E8').value = '2/31';
  plans.getCell('J8').value = '状態不明';
  const result = await parse(workbook);
  assert.equal(result.residents[0].creationMonth, '');
  assert.match(result.residents[0].notes, /月13/);
  assert.equal(result.residents[0].admissionDate, '');
  assert.match(result.residents[0].admissionNote, /年未入力/);
  assert.equal(result.plans[0].creationDate, '');
  assert.match(result.plans[0].notes, /2\/31/);
  assert.match(result.plans[0].notes, /状態不明/);
  assert.equal(result.summary.warningCount, 6);
  assert.ok(result.warnings.every(warning => !warning.includes('合成利用者') && !warning.includes('123')));
});

test('retains reversed source plan months in notes and clears both normalized months', async () => {
  const { workbook, residents } = sourceWorkbook();
  addResident(residents, 2, '123');
  residents.getCell('J2').value = 9;
  residents.getCell('O2').value = 7;
  residents.getCell('D2').value = '合成保険者';
  const result = await parse(workbook);
  const resident = result.residents[0];
  assert.equal(resident.planStartMonth, '');
  assert.equal(resident.planEndMonth, '');
  assert.match(resident.notes, /認定期間管理表 2行.*開始年月2026-09.*終了年月2026-07/);
  assert.equal(resident.insurer, '合成保険者');
  assert.equal(resident.creationMonth, '2026-07');
  assert.equal(resident.careLevel, '3');
  assert.ok(result.warnings.some(warning => warning.includes('2行') && warning.includes('空欄にしました')));
  assert.ok(result.warnings.every(warning => !warning.includes('合成利用者') && !warning.includes('123')));
});

test('skips duplicate rows without overwriting and creates minimal unmatched residents', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  addResident(residents, 3, '123');
  residents.getCell('C3').value = '後の利用者';
  for (const row of [8, 9]) {
    plans.getCell(`B${row}`).value = '999';
    plans.getCell(`C${row}`).value = '別の合成利用者';
  }
  const result = await parse(workbook);
  assert.equal(result.summary.residentCount, 2);
  assert.equal(result.summary.planCount, 1);
  assert.equal(result.residents[0].name, '合成利用者2');
  assert.equal(result.residents[1].chartNumber, '999');
  assert.match(result.residents[1].notes, /だけに存在/);
  assert.equal(result.summary.warningCount, 5);
});

test('rejects unknown layouts and non-Excel archives', async () => {
  const { workbook, residents } = sourceWorkbook();
  residents.getCell('B1').value = '別列';
  await assert.rejects(() => parse(workbook), /列構成/);
  await assert.rejects(() => parseWorkbook(Buffer.from('not an excel archive')), /Excel/);
  await assert.rejects(() => parseWorkbook(Buffer.alloc(10 * 1024 * 1024 + 1)), /10MB/);
});

test('handles leap dates, Japanese era date text and the 1904 serial system', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  plans.getCell('B8').value = '123';
  plans.getCell('C8').value = '合成利用者2';
  plans.getCell('E8').value = '令和6年2月29日';
  plans.getCell('F8').value = '2023-02-29';
  workbook.properties.date1904 = true;
  plans.getCell('G8').value = 1;
  const result = await parse(workbook);
  assert.equal(result.plans[0].creationDate, '2024-02-29');
  assert.equal(result.plans[0].printDate, '');
  assert.equal(result.plans[0].meetingDate, '1904-01-02');
});

test('excludes unnamed residents and plans without registering placeholder names', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  residents.getCell('C2').value = null;
  plans.getCell('B8').value = '123';
  const result = await parse(workbook);
  assert.equal(result.residents.length, 0);
  assert.equal(result.plans.length, 0);
  assert.equal(result.warnings.filter(warning => /氏名が空欄/.test(warning)).length, 2);
});

test('retains a named plan-only resident without guessing an unknown target month', async () => {
  const { workbook, basic, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  residents.getCell('C2').value = null;
  basic.getCell('B7').value = null;
  plans.getCell('B8').value = '123';
  plans.getCell('C8').value = '合成利用者';
  plans.getCell('I8').value = '1/1～3/31';
  const result = await parse(workbook);
  assert.equal(result.residents[0].name, '合成利用者');
  assert.equal(result.plans.length, 0);
  assert.match(result.residents[0].notes, /1\/1～3\/31/);
  assert.equal(result.settings.targetMonth, '');
});

test('excludes plans with a different name under the same chart number', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  plans.getCell('B8').value = '123';
  plans.getCell('C8').value = '異なる合成氏名';
  plans.getCell('H8').value = '誤割当CM';
  const result = await parse(workbook);
  assert.equal(result.residents.length, 1);
  assert.equal(result.plans.length, 0);
  assert.equal(result.residents[0].careManager, '');
  assert.ok(result.warnings.some(warning => warning.includes('8行') && warning.includes('氏名が一致しない')));
  assert.ok(result.warnings.every(warning => !warning.includes('異なる合成氏名') && !warning.includes('123')));
});

test('accepts only ASCII and full-width spaces when matching names', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  residents.getCell('C2').value = '合成　利用者';
  plans.getCell('B8').value = '123';
  plans.getCell('C8').value = '合成 利用者';
  assert.equal((await parse(workbook)).plans.length, 1);
  plans.getCell('C8').value = '合成\t利用者';
  assert.equal((await parse(workbook)).plans.length, 0);
});

test('excludes all plans for chart numbers with conflicting duplicate names', async () => {
  const { workbook, residents, plans } = sourceWorkbook();
  addResident(residents, 2, '123');
  addResident(residents, 3, '123');
  residents.getCell('C3').value = '別の合成利用者';
  plans.getCell('B8').value = '123';
  plans.getCell('C8').value = '合成利用者2';
  plans.getCell('H8').value = '登録しないCM';
  const result = await parse(workbook);
  assert.equal(result.residents.length, 1);
  assert.equal(result.plans.length, 0);
  assert.equal(result.residents[0].careManager, '');
  assert.equal(result.summary.residentCount, result.residents.length);
  assert.equal(result.summary.planCount, result.plans.length);
});

test('finds plan-only duplicate identity conflicts before adding residents or plans', async () => {
  const { workbook, plans } = sourceWorkbook();
  for (const row of [8, 9]) plans.getCell(`B${row}`).value = '999';
  plans.getCell('C8').value = '合成氏名A';
  plans.getCell('C9').value = '合成氏名B';
  const result = await parse(workbook);
  assert.equal(result.residents.length, 0);
  assert.equal(result.plans.length, 0);
  assert.equal(result.warnings.filter(warning => /氏名が一致しない/.test(warning)).length, 2);
});

test('rejects forged or oversized ZIP expansion metadata before Excel decoding', async () => {
  const { workbook } = sourceWorkbook();
  const oversized = Buffer.from(await workbook.xlsx.writeBuffer());
  const start = oversized.readUInt32LE(oversized.length - 22 + 16);
  oversized.writeUInt32LE(65 * 1024 * 1024, start + 24);
  await assert.rejects(() => parseWorkbook(oversized), /展開後/);
  const forged = Buffer.from(await workbook.xlsx.writeBuffer());
  const central = forged.readUInt32LE(forged.length - 22 + 16);
  forged.writeUInt32LE(0, central + 24);
  await assert.rejects(() => parseWorkbook(forged), /展開|破損/);
});

test('extracts fixed document paragraphs without historical name and signature cells', async () => {
  const { workbook } = sourceWorkbook();
  const consent = workbook.addWorksheet('同意書');
  consent.getCell('T9').value = '合成施設';
  consent.getCell('K3').value = 6;
  consent.getCell('B11').value = 'ご確認をお願いします。';
  consent.getCell('B12').value = 'この度、';
  consent.getCell('E12').value = '除外すべき合成差込名';
  consent.getCell('H12').value = '様の計画について';
  consent.getCell('B14').value = '説明文を記載します。';
  consent.getCell('B23').value = '除外すべき組織署名文';
  const restraint = workbook.addWorksheet('拘束同意書');
  restraint.getCell('O35').value = '除外すべき合成差込名';
  restraint.getCell('D36').value = '説明段落1';
  restraint.getCell('E37').value = '説明段落2';
  restraint.getCell('D38').value = '説明段落3';
  const result = await parse(workbook);
  assert.equal(result.settings.facilityName, '合成施設');
  assert.equal(result.settings.floor, '6');
  assert.match(result.settings.consentBody, /この度、\{利用者氏名\}様の計画について/);
  assert.match(result.settings.restraintBody, /説明段落1\n\n説明段落2\n\n説明段落3/);
  assert.ok(!result.settings.consentBody.includes('除外すべき'));
  assert.ok(!result.settings.restraintBody.includes('除外すべき'));
});
