import { db } from '../db.js';
import { fmtDate, fmtNum, getSetting, shareOrDownload, downloadBlob } from './util.js';
import { ROBOTO_REGULAR_B64, ROBOTO_BOLD_B64 } from '../../vendor/fonts/roboto-fonts.js';

const VAT_RATE = 0.2;

function registerFonts(doc) {
  doc.addFileToVFS('Roboto-Regular.ttf', ROBOTO_REGULAR_B64);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', ROBOTO_BOLD_B64);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  doc.setFont('Roboto', 'normal');
}

export async function gatherData(siteId, opts = {}) {
  const { from, to, entryIds } = opts;
  const site = await db.get('sites', siteId);
  const myCompany = (await getSetting('myCompany', null)) || {
    name: '', eik: '', address: '', vatRegistered: false, vatNumber: '', mol: '',
  };
  const positions = await db.getAllByIndex('positions', 'siteId', siteId);
  positions.sort((a, b) => (a.order || 0) - (b.order || 0));
  const allEntries = await db.getAllByIndex('entries', 'siteId', siteId);
  let entries = allEntries;
  if (entryIds) {
    const wanted = new Set(entryIds);
    entries = entries.filter((e) => wanted.has(e.id));
  } else {
    if (from) entries = entries.filter((e) => e.date >= from);
    if (to) entries = entries.filter((e) => e.date <= to);
  }

  const priceById = new Map(positions.map((p) => [p.id, Number(p.unitPrice) || 0]));
  const valueOf = (list) =>
    list.reduce((sum, e) => sum + (priceById.get(e.positionId) || 0) * (Number(e.qty) || 0), 0);
  // договорна стойност по количествената сметка и вече отчетеното преди периода
  const boqValue = positions.reduce((sum, p) => sum + (Number(p.plannedQty) || 0) * (Number(p.unitPrice) || 0), 0);
  const priorValue = !entryIds && from ? valueOf(allEntries.filter((e) => e.date < from)) : 0;
  const periodValue = valueOf(entries);
  const dates = entries.map((e) => e.date).sort();
  const periodFrom = from || dates[0] || '';
  const periodTo = to || dates[dates.length - 1] || '';

  const qtyByPosition = new Map();
  for (const e of entries) {
    qtyByPosition.set(e.positionId, (qtyByPosition.get(e.positionId) || 0) + (Number(e.qty) || 0));
  }
  const rows = positions
    .filter((p) => qtyByPosition.has(p.id))
    .map((p) => {
      const qty = qtyByPosition.get(p.id) || 0;
      const unitPrice = Number(p.unitPrice) || 0;
      return { position: p, qty, unitPrice, value: qty * unitPrice };
    });

  return { site, myCompany, positions, entries, rows, boqValue, priorValue, periodValue, periodFrom, periodTo, valueOf, allEntries };
}

// Моделът на Образец 19: усвоеният аванс се приспада от стойността на СМР,
// а ДДС се начислява върху разликата (данъчната основа) — авансът вече е фактуриран с ДДС.
export function computeTotals(rows, izpalnitelVatRegistered, advanceDeducted) {
  const subtotal = rows.reduce((sum, r) => sum + r.value, 0);
  const advance = Math.max(0, Math.min(Number(advanceDeducted) || 0, subtotal));
  const taxBase = subtotal - advance;
  const vat = izpalnitelVatRegistered ? taxBase * VAT_RATE : 0;
  const due = taxBase + vat;
  const total = subtotal + (izpalnitelVatRegistered ? subtotal * VAT_RATE : 0);
  return { subtotal, advance, taxBase, vat, due, total };
}

// Колко аванс се приспада от този акт според настройките на обекта.
// mode: 'amount' (фиксирана сума) | 'percent' (процент от количествената сметка)
// method: 'proportional' (същият процент от всеки акт) | 'exhaust' (изцяло, докато се усвои)
export function advancePlan(site, { boqValue = 0, periodValue = 0, priorValue = 0 } = {}) {
  const mode = site.advanceMode || 'amount';
  const pct = Number(site.advancePercent) || 0;
  const total = mode === 'percent' ? (boqValue * pct) / 100 : Number(site.advanceAmount) || 0;
  const method = site.advanceMethod || (mode === 'percent' ? 'proportional' : 'exhaust');
  if (!total) return { total: 0, suggested: 0, usedBefore: 0, remaining: 0, mode, pct, method };

  let usedBefore;
  let suggested;
  if (method === 'proportional') {
    const rate = mode === 'percent' ? pct / 100 : boqValue ? total / boqValue : 0;
    usedBefore = Math.min(total, priorValue * rate);
    suggested = Math.min(total - usedBefore, periodValue * rate);
  } else {
    usedBefore = Math.min(total, priorValue);
    suggested = Math.min(total - usedBefore, periodValue);
  }
  return {
    total,
    suggested: Math.max(0, suggested),
    usedBefore: Math.max(0, usedBefore),
    remaining: Math.max(0, total - usedBefore - suggested),
    mode,
    pct,
    method,
  };
}

function counterpartyIdLine(site) {
  if (site.counterpartyType === 'individual') {
    return 'Физическо лице';
  }
  const vatPart = site.vatRegistered ? `ИН по ЗДДС: ${site.vatNumber || '—'}` : 'Нерегистриран по ЗДДС';
  return `ЕИК: ${site.eik || '—'}   ${vatPart}`;
}

function companyIdLine(myCompany) {
  const vatPart = myCompany.vatRegistered ? `ИН по ЗДДС: ${myCompany.vatNumber || '—'}` : 'Нерегистриран по ЗДДС';
  return `ЕИК: ${myCompany.eik || '—'}   ${vatPart}`;
}

// site.role === 'client' означава, че потребителят е Възложител за този обект — тогава
// „Моята фирма“ е Възложителят, а контрагентът, въведен в обекта, е Изпълнителят (и обратното).
export function resolveParties(site, myCompany) {
  const counterparty = {
    name: site.clientName || '—',
    idLine: counterpartyIdLine(site),
    address: site.clientAddress || '—',
    mol: '',
    vatRegistered: site.counterpartyType !== 'individual' && !!site.vatRegistered,
  };
  const company = {
    name: myCompany.name || '—',
    idLine: companyIdLine(myCompany),
    address: myCompany.address || '—',
    mol: myCompany.mol || '',
    vatRegistered: !!myCompany.vatRegistered,
  };
  return site.role === 'client'
    ? { vazlojitel: company, izpalnitel: counterparty }
    : { vazlojitel: counterparty, izpalnitel: company };
}

async function buildPdf(siteId, opts = {}) {
  const { advance, actNo, actDate } = opts;
  const data = await gatherData(siteId, opts);
  const { site, myCompany, rows, periodFrom, periodTo } = data;
  const from = periodFrom;
  const to = periodTo;
  const { vazlojitel, izpalnitel } = resolveParties(site, myCompany);
  const totals = computeTotals(rows, izpalnitel.vatRegistered, advance);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  registerFonts(doc);
  const marginX = 40;
  const pageWidth = 555;
  const colMid = marginX + (pageWidth - marginX) / 2;
  let y = 50;

  doc.setFontSize(14);
  doc.setFont('Roboto', 'bold');
  doc.text(
    `АКТ (Образец 19)${actNo ? ' № ' + actNo : ''} за извършени строително-монтажни работи`,
    marginX,
    y,
    { maxWidth: pageWidth - marginX }
  );
  doc.setFont('Roboto', 'normal');
  y += 20;
  doc.setFontSize(10);
  doc.text(`Дата на съставяне: ${actDate ? fmtDate(actDate) : fmtDate(new Date().toISOString().slice(0, 10))}`, marginX, y);
  y += 22;

  doc.setFontSize(10);
  const leftWidth = colMid - marginX - 10;
  const rightWidth = pageWidth - colMid;
  const LINE = 13;

  // Двуколонен ред, който расте според броя пренесени редове — иначе дълги имена
  // на фирми се застъпват с реда отдолу.
  function twoColRow(leftText, rightText) {
    const leftLines = doc.splitTextToSize(String(leftText == null ? '' : leftText), leftWidth);
    const rightLines = doc.splitTextToSize(String(rightText == null ? '' : rightText), rightWidth);
    doc.text(leftLines, marginX, y);
    doc.text(rightLines, colMid, y);
    y += Math.max(leftLines.length, rightLines.length) * LINE;
  }

  doc.setFont('Roboto', 'bold');
  twoColRow('Възложител', 'Изпълнител');
  doc.setFont('Roboto', 'normal');
  twoColRow(vazlojitel.name, izpalnitel.name);
  twoColRow(vazlojitel.idLine, izpalnitel.idLine);
  if (vazlojitel.mol || izpalnitel.mol) {
    twoColRow(
      vazlojitel.mol ? `МОЛ: ${vazlojitel.mol}` : '',
      izpalnitel.mol ? `МОЛ: ${izpalnitel.mol}` : ''
    );
  }
  twoColRow(`Адрес: ${vazlojitel.address}`, `Адрес: ${izpalnitel.address}`);
  y += 12;

  const objectLines = doc.splitTextToSize(
    `Обект: ${site.name}${site.address ? ' — ' + site.address : ''}`,
    pageWidth - marginX
  );
  doc.text(objectLines, marginX, y);
  y += objectLines.length * LINE;
  doc.text(`Период: ${from ? fmtDate(from) : '—'} до ${to ? fmtDate(to) : '—'}`, marginX, y);
  y += 22;

  const colX = { n: marginX, desc: marginX + 24, unit: marginX + 300, qty: marginX + 350, price: marginX + 410, total: marginX + 480 };
  doc.setFont('Roboto', 'bold');
  doc.text('N', colX.n, y);
  doc.text('описание на извършените СМР', colX.desc, y);
  doc.text('мярка', colX.unit, y);
  doc.text('кол-во', colX.qty, y);
  doc.text('ед.цена', colX.price, y);
  doc.text('общо', colX.total, y);
  doc.setFont('Roboto', 'normal');
  y += 6;
  doc.line(marginX, y, pageWidth, y);
  y += 14;

  rows.forEach((r, i) => {
    if (y > 780) {
      doc.addPage();
      y = 50;
    }
    const p = r.position;
    const desc = `${p.code ? p.code + ' ' : ''}${p.description}`;
    doc.text(String(i + 1), colX.n, y);
    doc.text(truncate(desc, 40), colX.desc, y);
    doc.text(p.unit || '', colX.unit, y);
    doc.text(fmtNum(r.qty), colX.qty, y);
    doc.text(fmtNum(r.unitPrice), colX.price, y);
    doc.text(fmtNum(r.value), colX.total, y);
    y += 16;
  });

  y += 10;
  doc.line(marginX, y, pageWidth, y);
  y += 20;

  if (y > 700) {
    doc.addPage();
    y = 50;
  }

  const sigTop = y;
  doc.setFontSize(9);
  doc.text('име / длъжност / дата / подпис', marginX, sigTop);
  y = sigTop + 20;
  doc.text('за възложителя приел: ______________________________', marginX, y);
  y += 30;
  doc.text('за изпълнителя предал: ______________________________', marginX, y);

  let sy = sigTop + 20;
  const sumLabelX = marginX + 260;
  const sumValueX = pageWidth;
  doc.setFontSize(10);
  doc.text('Стойност на СМР:', sumLabelX, sy);
  doc.text(fmtNum(totals.subtotal) + ' €', sumValueX, sy, { align: 'right' });
  sy += 18;
  if (totals.advance) {
    doc.text('Приспаднат аванс:', sumLabelX, sy);
    doc.text('- ' + fmtNum(totals.advance) + ' €', sumValueX, sy, { align: 'right' });
    sy += 18;
    doc.text('Данъчна основа:', sumLabelX, sy);
    doc.text(fmtNum(totals.taxBase) + ' €', sumValueX, sy, { align: 'right' });
    sy += 18;
  }
  doc.text('ДДС (20%):', sumLabelX, sy);
  doc.text(fmtNum(totals.vat) + ' €', sumValueX, sy, { align: 'right' });
  sy += 18;
  doc.setFont('Roboto', 'bold');
  doc.text('Дължимо за плащане:', sumLabelX, sy);
  doc.text(fmtNum(totals.due) + ' €', sumValueX, sy, { align: 'right' });
  doc.setFont('Roboto', 'normal');

  const filename = `Akt-Obrazec19${actNo ? '-N' + actNo : ''}-${site.name.replace(/[^\p{L}\p{N}]+/gu, '_')}.pdf`;
  return {
    blob: doc.output('blob'),
    filename,
    title: `Акт Образец 19${actNo ? ' № ' + actNo : ''} — ${site.name}`,
    text: `Акт Образец 19${actNo ? ' № ' + actNo : ''} за обект „${site.name}“ — период ${from ? fmtDate(from) : '—'} до ${to ? fmtDate(to) : '—'}. Дължимо за плащане: ${fmtNum(totals.due)} €.`,
  };
}

export async function exportPdf(siteId, opts = {}) {
  const { blob, filename } = await buildPdf(siteId, opts);
  downloadBlob(blob, filename);
}

// Отваря листа за споделяне на телефона; на компютър просто сваля файла.
export async function sharePdf(siteId, opts = {}) {
  const { blob, filename, title, text } = await buildPdf(siteId, opts);
  return shareOrDownload(blob, filename, { title, text });
}

async function buildXlsx(siteId, opts = {}) {
  const { advance, actNo, actDate } = opts;
  const data = await gatherData(siteId, opts);
  const { site, myCompany, rows, periodFrom, periodTo } = data;
  const from = periodFrom;
  const to = periodTo;
  const { vazlojitel, izpalnitel } = resolveParties(site, myCompany);
  const totals = computeTotals(rows, izpalnitel.vatRegistered, advance);

  const detailRows = rows.map((r, i) => ({
    'N': i + 1,
    'Код': r.position.code || '',
    'Описание на извършените СМР': r.position.description,
    'Мярка': r.position.unit || '',
    'Количество': r.qty,
    'Ед. цена': r.unitPrice,
    'Общо': r.value,
  }));

  const summaryRows = [
    { 'Обобщение': 'Акт №', 'Стойност': actNo || '' },
    { 'Обобщение': 'Дата на акта', 'Стойност': actDate ? fmtDate(actDate) : '' },
    { 'Обобщение': 'Възложител', 'Стойност': vazlojitel.name },
    { 'Обобщение': 'Данни на възложителя', 'Стойност': vazlojitel.idLine },
    { 'Обобщение': 'Изпълнител', 'Стойност': izpalnitel.name },
    { 'Обобщение': 'Данни на изпълнителя', 'Стойност': izpalnitel.idLine },
    { 'Обобщение': 'Период', 'Стойност': `${from ? fmtDate(from) : '—'} до ${to ? fmtDate(to) : '—'}` },
    { 'Обобщение': 'Стойност на СМР', 'Стойност': totals.subtotal },
    { 'Обобщение': 'Приспаднат аванс', 'Стойност': totals.advance },
    { 'Обобщение': 'Данъчна основа', 'Стойност': totals.taxBase },
    { 'Обобщение': 'ДДС (20%)', 'Стойност': totals.vat },
    { 'Обобщение': 'Дължимо за плащане', 'Стойност': totals.due },
  ];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(detailRows), 'СМР');
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(summaryRows), 'Обобщение');
  const filename = `Akt-Obrazec19${actNo ? '-N' + actNo : ''}-${site.name.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`;
  const bytes = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return {
    blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
    title: `Акт Образец 19${actNo ? ' № ' + actNo : ''} — ${site.name}`,
    text: `Акт Образец 19${actNo ? ' № ' + actNo : ''} за обект „${site.name}“ (Excel).`,
  };
}

export async function exportXlsx(siteId, opts = {}) {
  const { blob, filename } = await buildXlsx(siteId, opts);
  downloadBlob(blob, filename);
}

export async function shareXlsx(siteId, opts = {}) {
  const { blob, filename, title, text } = await buildXlsx(siteId, opts);
  return shareOrDownload(blob, filename, { title, text });
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
