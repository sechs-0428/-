import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {AlertCircle, CalendarDays, Check, ClipboardCheck, Download, FileText, Printer} from 'lucide-react';
import type {CarePlan, Resident, Settings} from './model';
import {monthLabel, wareki} from './utils';
import './documents.css';

type DocumentKind = 'notice1' | 'notice2' | 'consent' | 'restraint';
type DocumentRow = {plan: CarePlan; resident: Resident};
type DocumentsProps = {
  residents: Resident[];
  plans: CarePlan[];
  settings: Settings;
  targetMonth: string;
  onEditPlan: (plan: CarePlan) => void;
  onPrinted: (ids: string[]) => Promise<void>;
};

const documentKinds: {value: DocumentKind; label: string}[] = [
  {value: 'notice1', label: '会議のお知らせ・1回目'},
  {value: 'notice2', label: '会議のお知らせ・2回目'},
  {value: 'consent', label: '包括同意書'},
  {value: 'restraint', label: '拘束同意書・表裏'},
];

const originalConsentBody = `前略、お世話になっております。
この度、{利用者氏名}様の施設利用に際し、施設内で提供させて頂くサービス内容等を記載した「施設サービス計画」の原案、リハビリテーションの計画を記載した「リハビリテーション実施計画書」及び栄養管理の計画を記載した「栄養ケア計画」を作成しましたので、お送りさせていただきます。
つきましては、送付しました「施設サービス計画」の原案、「リハビリテーション実施計画書」及び「栄養ケア計画」の内容についてご確認頂き、下記の同意欄にご記入の上、お手数ですが当施設1階受付までご提出下さいますよう、宜しくお願い致します。
尚、施設ではサービスに対するご説明、ご相談、ご意見、ご希望等、常時承っておりますので、お気軽にご連絡下さいます様宜しくお願い致します。`;

const originalRestraintBody = `あなたの状態が下記のABCをすべて満たしている為、緊急やむを得ず、下記の方法と時間帯等において最小限度の身体拘束を行います。
但し、解除することを目標に鋭意検討を行います。`;

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function fullDate(value: string) {
  if (!isDate(value)) return '未登録';
  const [year, month, day] = value.split('-').map(Number);
  const week = ['日', '月', '火', '水', '木', '金', '土'][new Date(year, month - 1, day).getDay()];
  return `${year}年${month}月${day}日（${week}）`;
}

function period(row: DocumentRow) {
  const {periodStartDate, periodEndDate, effectivePeriodText} = row.plan;
  if (isDate(periodStartDate) && isDate(periodEndDate)) {
    return `${wareki(periodStartDate)} ～ ${wareki(periodEndDate)}`;
  }
  return effectivePeriodText || '未確定';
}

function compactPeriod(row: DocumentRow) {
  const {periodStartDate, periodEndDate, effectivePeriodText} = row.plan;
  if (isDate(periodStartDate) && isDate(periodEndDate)) {
    return `${periodStartDate.replaceAll('-', '/')} ～ ${periodEndDate.replaceAll('-', '/')}`;
  }
  return effectivePeriodText || '未確定';
}

function problemFor(row: DocumentRow, isNotice: boolean) {
  if (isNotice) return isDate(row.plan.meetingDate) ? '' : '会議日を登録してください。';
  if (!isDate(row.plan.periodStartDate) || !isDate(row.plan.periodEndDate)) {
    return '有効期間の開始日・終了日を確定してください。';
  }
  if (row.plan.periodStartDate > row.plan.periodEndDate) return '有効期間の開始日が終了日より後になっています。';
  return '';
}

function fillText(text: string, row: DocumentRow, settings: Settings) {
  const values: Record<string, string> = {
    '利用者氏名': row.resident.name,
    '事業所名': settings.facilityName || '当施設',
    '開始日': wareki(row.plan.periodStartDate),
    '終了日': wareki(row.plan.periodEndDate),
  };
  return text.replace(/\{(利用者氏名|事業所名|開始日|終了日)\}/g, (_, key: string) => values[key]);
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({length: Math.ceil(items.length / size)}, (_, i) => items.slice(i * size, (i + 1) * size));
}

function DocumentFooter({text}: {text: string}) {
  return <footer className="document-footer">{text}</footer>;
}

function NoticePage({rows, allRows, date, round, settings, pageNumber, pages}: {
  rows: DocumentRow[]; allRows: DocumentRow[]; date: string; round: 1 | 2;
  settings: Settings; pageNumber: number; pages: number;
}) {
  const managers = Array.from(new Set(allRows.map(row => row.plan.careManager).filter(Boolean))).join('・');
  const count = new Set(allRows.map(row => row.resident.id)).size;
  const time = round === 1 ? settings.meeting1Time : settings.meeting2Time;
  return <article className="document-page notice-document">
    <div className="document-topline">
      <span>{settings.floor ? `${settings.floor} CM` : '担当CM'}　{managers || settings.contactName || '＿＿＿＿＿＿'}</span>
      <span>宛先：＿＿＿＿＿＿ 様</span>
    </div>
    <h2 className="document-title">サービス担当者会議開催のお知らせ</h2>
    <p className="document-introduction">サービス担当者会議を下記の通り行いますので、出席の程宜しくお願い致します。<br />尚、出席できない場合は担当CMまで連絡をお願い致します。</p>
    <dl className="notice-meeting-info">
      <div><dt>日時</dt><dd>{fullDate(date)}　{time || '＿＿：＿＿'} ～</dd></div>
      <div><dt>場所</dt><dd>{settings.meetingLocation || '＿＿＿＿＿＿＿＿＿＿＿＿'}</dd></div>
      <div><dt>連絡先</dt><dd>{settings.contactName || '担当CM'}{settings.contactPhone && `　${settings.contactPhone}`}</dd></div>
    </dl>
    <div className="notice-list-heading"><span>第{round}回　対象 {count}名</span><span>{allRows.length}件の計画{pages > 1 && ` / ${pageNumber} / ${pages}ページ`}</span></div>
    <table className="notice-print-table">
      <thead><tr><th>居室</th><th>カルテ番号</th><th>利用者氏名</th><th>有効期間</th><th>担当CM</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.plan.id}>
        <td>{row.resident.room || '—'}</td><td>{row.resident.chartNumber || '—'}</td>
        <td>{row.resident.name} 様</td><td>{compactPeriod(row)}</td><td>{row.plan.careManager || '—'}</td>
      </tr>)}</tbody>
    </table>
    <DocumentFooter text={`${settings.facilityName || '事業所名未登録'}　／　第${round}回 ${fullDate(date)}${pages > 1 ? `　${pageNumber} / ${pages}` : ''}`} />
  </article>;
}

function ConsentPage({row, settings, isRestraint}: {row: DocumentRow; settings: Settings; isRestraint: boolean}) {
  return <article className="document-page consent-document">
    <div className="document-topline"><strong>【包括同意書】</strong>{isRestraint && <span>裏面あります</span>}</div>
    <div className="document-identification">{settings.floor && <span>{settings.floor}</span>}<span>No. {row.resident.chartNumber || '＿＿＿＿＿＿'}</span></div>
    <p className="document-salutation">ご家族の皆さまへ</p>
    <div className="document-sender">{settings.facilityName || '事業所名：＿＿＿＿＿＿'}</div>
    <div className="consent-letter">{fillText((settings.consentBody || '').trim() || originalConsentBody, row, settings)}</div>
    <p className="consent-closing">草々</p>
    <div className="consent-agreement">
      私は、{settings.facilityName || '当施設'}での <strong>{wareki(row.plan.periodStartDate)}</strong> から <strong>{wareki(row.plan.periodEndDate)}</strong> までの「施設サービス計画」の原案、「リハビリテーション実施計画書」及び「栄養ケア計画」の内容について説明、交付を受け、同意します。
    </div>
    <div className="consent-signatures">
      <div><span>同意日</span><span className="signature-date">令和　　　　年　　　月　　　日</span></div>
      <div><span>利用者氏名</span><span className="signature-line" /></div>
      <div><span>代筆者氏名</span><span className="signature-line" /><span>続柄（　　　　）</span></div>
    </div>
    <p className="consent-end">以上</p>
    <DocumentFooter text={`${row.resident.name} 様　／　${period(row)}${isRestraint ? '　表面・1 / 2' : ''}`} />
  </article>;
}

function RestraintPage({row, settings}: {row: DocumentRow; settings: Settings}) {
  return <article className="document-page restraint-document">
    <h2 className="document-title">緊急やむを得ない身体拘束に関する説明書</h2>
    <p className="restraint-resident">利用者名：<strong>{row.resident.name}</strong> 様</p>
    <div className="restraint-introduction">{fillText((settings.restraintBody || '').trim() || originalRestraintBody, row, settings)}</div>
    <div className="restraint-criteria">
      <p><strong>A</strong><span>利用者本人又は他の利用者などの生命又は身体が危険にさらされる可能性が著しく高い。</span></p>
      <p><strong>B</strong><span>身体拘束その他の行動制限を行う以外に代替する看護・介護方法が現段階では無い。</span></p>
      <p><strong>C</strong><span>身体拘束その他の行動制限が一時的である。</span></p>
    </div>
    <p className="restraint-instruction">本人・家族へ説明後、必要事項を記入してください。</p>
    <table className="restraint-fields"><tbody>
      <tr><th>個別の状況に因る<br />拘束の必要な理由</th><td><WritingLines /></td></tr>
      <tr><th>身体拘束の方法<br /><small>場所、行為<br />（部位・内容）</small></th><td><WritingLines /></td></tr>
      <tr><th>拘束の時間帯<br />及び時間</th><td><WritingLines /></td></tr>
      <tr><th>特記すべき<br />心身の状況</th><td className="restraint-condition" /></tr>
      <tr><th>拘束開始及び<br />解除の予定</th><td><WritingLines dates /></td></tr>
    </tbody></table>
    <p className="restraint-declaration">上記の通り実施致します。</p>
    <div className="restraint-signatures"><span>令和　　　　年　　　月　　　日</span><div>主治医 <span className="signature-line" /></div><div>フロア責任者 <span className="signature-line" /></div></div>
    <DocumentFooter text={`${row.resident.name} 様　／　裏面・2 / 2`} />
  </article>;
}

function WritingLines({dates = false}: {dates?: boolean}) {
  return <div className={`writing-lines${dates ? ' writing-dates' : ''}`}>
    {['①', '②', '③'].map(number => <div key={number}><span>{number}</span>{dates && <span>　 年　 月　 日　 時 ～　 年　 月　 日まで</span>}</div>)}
  </div>;
}

export default function Documents({residents, plans, settings, targetMonth, onEditPlan, onPrinted}: DocumentsProps) {
  const [kind, setKind] = useState<DocumentKind>('notice1');
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [noticeDate, setNoticeDate] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [oversizePages, setOversizePages] = useState<number[]>([]);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const isNotice = kind === 'notice1' || kind === 'notice2';
  const round: 1 | 2 = kind === 'notice2' ? 2 : 1;
  const allRows = useMemo(() => {
    const residentsById = new Map(residents.filter(resident => resident.status === 'active').map(resident => [resident.id, resident]));
    return plans.filter(plan => plan.targetMonth === targetMonth).flatMap(plan => {
      const resident = residentsById.get(plan.residentId);
      return resident ? [{plan, resident}] : [];
    }).filter(row => isNotice ? row.plan.meetingRound === round : kind === 'restraint' ? row.plan.restraint : !row.plan.restraint)
      .sort((a, b) => a.resident.room.localeCompare(b.resident.room, 'ja', {numeric: true}) || a.resident.chartNumber.localeCompare(b.resident.chartNumber, 'ja', {numeric: true}) || (a.plan.periodStartDate || '').localeCompare(b.plan.periodStartDate || ''));
  }, [residents, plans, targetMonth, isNotice, kind, round]);
  const noticeDates = Array.from(new Set(allRows.map(row => row.plan.meetingDate))).sort();
  const effectiveNoticeDate = noticeDates.includes(noticeDate) ? noticeDate : 'all';
  const visibleRows = allRows.filter(row => !isNotice || effectiveNoticeDate === 'all' || row.plan.meetingDate === effectiveNoticeDate);
  const selectedRows = visibleRows.filter(row => selection[`${targetMonth}:${kind}:${row.plan.id}`] !== false);
  const problems = selectedRows.filter(row => problemFor(row, isNotice));
  const canGenerate = selectedRows.length > 0 && problems.length === 0;
  const canPrint = canGenerate && oversizePages.length === 0;
  const selectedPeople = new Set(selectedRows.map(row => row.resident.id)).size;
  const consentRows = Array.from(new Map(selectedRows.map(row => [
    `${row.resident.id}:${row.plan.periodStartDate}:${row.plan.periodEndDate}`,
    row,
  ])).values());
  const noticeGroups = new Map<string, DocumentRow[]>();
  for (const row of selectedRows) {
    const list = noticeGroups.get(row.plan.meetingDate) || [];
    list.push(row);
    noticeGroups.set(row.plan.meetingDate, list);
  }
  const noticePages = Array.from(noticeGroups.entries()).sort(([a], [b]) => a.localeCompare(b));
  const pageCount = isNotice ? noticePages.reduce((count, [, rows]) => count + Math.ceil(rows.length / 14), 0) : consentRows.length * (kind === 'restraint' ? 2 : 1);
  const layoutKey = JSON.stringify({kind, targetMonth, settings, rows: selectedRows});

  useLayoutEffect(() => {
    let canceled = false;
    const measure = () => {
      if (canceled) return;
      const oversized: number[] = [];
      if (canGenerate) {
        printAreaRef.current?.querySelectorAll<HTMLElement>('.document-page').forEach((element, index) => {
          const bounds = element.getBoundingClientRect();
          const a4Height = bounds.width * 297 / 210;
          if (bounds.height > a4Height + 2 || element.scrollWidth > element.clientWidth + 2) oversized.push(index + 1);
        });
      }
      setOversizePages(previous => previous.join(',') === oversized.join(',') ? previous : oversized);
    };
    measure();
    const observer = new ResizeObserver(measure);
    printAreaRef.current?.querySelectorAll('.document-page').forEach(element => observer.observe(element));
    void document.fonts.ready.then(measure);
    return () => { canceled = true; observer.disconnect(); };
  }, [layoutKey, canGenerate]);

  function changeKind(next: DocumentKind) {
    setKind(next);
    setNoticeDate('all');
    setMessage('');
    setError('');
  }

  function selectAll(checked: boolean) {
    setSelection(previous => {
      const next = {...previous};
      for (const row of visibleRows) next[`${targetMonth}:${kind}:${row.plan.id}`] = checked;
      return next;
    });
  }

  async function output(pdf: boolean) {
    if (!canPrint || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (window.careDesktop) {
        if (pdf) await window.careDesktop.pdf({filename: 'CareManager-帳票.pdf'});
        else await window.careDesktop.print();
        setMessage(pdf ? 'PDFの保存操作後も、印刷日は変更されません。' : '印刷後に「印刷日を記録」を押してください。');
      } else {
        window.print();
        setMessage(pdf ? '印刷画面で「PDFに保存」を選択してください。印刷日は変更されません。' : '印刷後に「印刷日を記録」を押してください。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '帳票の出力に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  async function recordPrinted() {
    if (!canPrint || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onPrinted(selectedRows.map(row => row.plan.id));
      setMessage(`${selectedRows.length}件の印刷日を記録しました。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '印刷日の記録に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  return <section className="documents-page">
    <div className="document-controls">
      <div className="card documents-selection-card">
        <p className="documents-period-note muted">{monthLabel(targetMonth)}・利用中の方の計画を表示しています。</p>
        <div className="documents-selector-row">
          <label className="field"><span>帳票の種類</span><select value={kind} onChange={event => changeKind(event.target.value as DocumentKind)}>{documentKinds.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          {isNotice && noticeDates.length > 1 && <label className="field"><span>会議日</span><select value={effectiveNoticeDate} onChange={event => setNoticeDate(event.target.value)}><option value="all">すべての日付（別ページで作成）</option>{noticeDates.map(date => <option key={date || 'unset'} value={date}>{fullDate(date)}</option>)}</select></label>}
          <div className="documents-selection-summary"><span className="document-summary-number">{selectedPeople}</span><span>名を選択 <strong>{selectedRows.length}件</strong>・{pageCount}ページ</span></div>
        </div>
        {isNotice && noticeDates.length > 1 && effectiveNoticeDate === 'all' && <p className="documents-information"><CalendarDays size={16} />会議日が複数あるため、日付ごとにページを分けて作成します。</p>}
        {!isNotice && consentRows.length < selectedRows.length && <p className="documents-information"><FileText size={16} />同じ利用者・同じ有効期間の同意書は、1セットにまとめて作成します。</p>}
        <div className="documents-table-wrap">
          <table className="documents-selection-table"><thead><tr>
            <th className="document-checkbox-cell"><input type="checkbox" aria-label="対象をすべて選択" checked={visibleRows.length > 0 && selectedRows.length === visibleRows.length} onChange={event => selectAll(event.target.checked)} /></th>
            <th>利用者</th><th>{isNotice ? '会議日' : '有効期間'}</th><th>印刷日</th><th>確認</th>
          </tr></thead><tbody>{visibleRows.map(row => {
            const key = `${targetMonth}:${kind}:${row.plan.id}`;
            const problem = problemFor(row, isNotice);
            return <tr key={row.plan.id} className={selection[key] === false ? 'document-unselected' : ''}>
              <td className="document-checkbox-cell"><input type="checkbox" aria-label={`${row.resident.name}の計画を選択`} checked={selection[key] !== false} onChange={event => setSelection(previous => ({...previous, [key]: event.target.checked}))} /></td>
              <td><strong>{row.resident.name}</strong><span className="document-resident-details">{row.resident.room || '居室未登録'} / No. {row.resident.chartNumber || '未登録'}</span></td>
              <td>{isNotice ? fullDate(row.plan.meetingDate) : period(row)}</td>
              <td>{row.plan.printDate ? wareki(row.plan.printDate) : <span className="muted">未記録</span>}</td>
              <td>{problem ? <div className="document-row-problem"><span>{problem}</span><button className="btn btn-outline" onClick={() => onEditPlan(row.plan)}>計画を編集</button></div> : <span className="document-ready"><Check size={14} />作成可能</span>}</td>
            </tr>;
          })}</tbody></table>
          {!visibleRows.length && <div className="empty-state"><FileText size={28} /><p>この帳票の対象となる計画がありません。</p><span className="muted">対象月・会議回・拘束同意書の設定を確認してください。</span></div>}
        </div>
        {problems.length > 0 && <p className="documents-warning" role="alert"><AlertCircle size={17} />選択した{problems.length}件の登録を修正すると、印刷・PDF保存ができます。</p>}
        {canGenerate && oversizePages.length > 0 && <p className="documents-warning" role="alert"><AlertCircle size={17} /><span>文面がA4ページに収まりません。設定文面を調整してください。<small className="documents-overflow-pages">対象：{oversizePages.join('、')}ページ目</small></span></p>}
        <div className="documents-actions"><div className="toolbar">
          <button className="btn btn-primary" disabled={!canPrint || busy} onClick={() => void output(false)}><Printer size={17} />印刷</button>
          <button className="btn btn-outline" disabled={!canPrint || busy} onClick={() => void output(true)}><Download size={17} />PDFに保存</button>
          <button className="btn btn-outline" disabled={!canPrint || busy} onClick={() => void recordPrinted()}><ClipboardCheck size={17} />印刷日を記録</button>
        </div><p className="muted">実際に印刷した後、印刷日を記録してください。印刷のキャンセルやPDF保存では日付は変わりません。</p></div>
        {message && <p className="documents-message" role="status">{message}</p>}
        {error && <p className="documents-warning" role="alert"><AlertCircle size={17} />{error}</p>}
      </div>
      <div className="documents-preview-heading"><h2>印刷プレビュー</h2><span className="muted">A4・縦{kind === 'restraint' && ' / 表裏を順番に印刷'}</span></div>
    </div>
    <div className="documents-preview">
      {!selectedRows.length ? <div className="card empty-state document-controls"><FileText size={30} /><p>対象の計画を選択してください。</p></div> : !canGenerate ? <div className="card empty-state document-controls"><AlertCircle size={30} /><p>未確定の項目を編集すると、帳票を表示します。</p></div> : <div className="print-area" ref={printAreaRef}>
        {isNotice ? noticePages.flatMap(([date, rows]) => chunk(rows, 14).map((part, index, pages) => <NoticePage key={`${date}:${index}`} rows={part} allRows={rows} date={date} round={round} settings={settings} pageNumber={index + 1} pages={pages.length} />)) : consentRows.flatMap(row => kind === 'restraint' ? [<ConsentPage key={`${row.plan.id}:front`} row={row} settings={settings} isRestraint />, <RestraintPage key={`${row.plan.id}:back`} row={row} settings={settings} />] : [<ConsentPage key={row.plan.id} row={row} settings={settings} isRestraint={false} />])}
      </div>}
    </div>
  </section>;
}
