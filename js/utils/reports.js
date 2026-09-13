// Едно отчитане = редовете, записани заедно с едно „Потвърди“ (общ reportId).
// По-старите записи нямат reportId — групират се по дата, за да не се губят.
import { escapeHtml, fmtNum, fmtDate } from './util.js';

export function groupEntriesIntoReports(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = e.reportId || `date:${e.date}`;
    if (!map.has(key)) {
      map.set(key, { key, reportId: e.reportId || null, date: e.date, createdAt: e.createdAt, entries: [] });
    }
    const g = map.get(key);
    g.entries.push(e);
    if (e.createdAt < g.createdAt) g.createdAt = e.createdAt;
  }
  const list = [...map.values()];
  for (const g of list) g.entries.sort((a, b) => a.createdAt - b.createdAt);
  return list.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date.localeCompare(b.date)));
}

export function reportTotal(group, posById) {
  return group.entries.reduce((sum, e) => {
    const p = posById.get(e.positionId);
    return sum + (p ? Number(p.unitPrice) || 0 : 0) * (Number(e.qty) || 0);
  }, 0);
}

function lineHtml(e, posById) {
  const p = posById.get(e.positionId);
  const unit = p ? p.unit || '' : '';
  const value = (p ? Number(p.unitPrice) || 0 : 0) * (Number(e.qty) || 0);
  const detail = e.coats && e.coats > 1
    ? `${fmtNum(e.baseQty)} ${escapeHtml(unit)} × ${e.coats} ръце`
    : e.factorA != null
    ? `${fmtNum(e.factorA)} ${escapeHtml(e.unitA || '')} × ${fmtNum(e.factorB)} ${escapeHtml(e.unitB || '')}`
    : '';
  return `
    <div class="report-line">
      <div class="site-card-top">
        <span class="small">${escapeHtml(p ? p.description : 'Изтрита позиция')}</span>
        <span class="muted small nowrap">${fmtNum(e.qty)} ${escapeHtml(unit)}${value ? ' · ' + fmtNum(value) + ' €' : ''}</span>
      </div>
      ${detail ? `<div class="muted small">${detail}</div>` : ''}
      <button type="button" class="btn btn-danger-ghost btn-sm" data-del-entry="${e.id}">Изтрий реда</button>
    </div>
  `;
}

// index — поредният номер на отчитането за обекта; open — да е ли разгънато.
export function reportCardHtml(group, { posById, index, open = false, showDate = true, photoCount = 0 }) {
  const total = reportTotal(group, posById);
  const first = group.entries[0] || {};
  const n = group.entries.length;
  const worksLabel = n === 1 ? '1 работа' : `${n} работи`;
  return `
    <div class="card report-card" data-report="${escapeHtml(group.key)}">
      <button type="button" class="report-head">
        <span class="report-caret">${open ? '▾' : '▸'}</span>
        <span class="report-title">
          <strong class="small">Отчитане №${index}${showDate ? ' · ' + fmtDate(group.date) : ''}</strong>
          <span class="muted small">${worksLabel}${total ? ' · ' + fmtNum(total) + ' €' : ''}</span>
        </span>
      </button>
      <div class="report-body"${open ? '' : ' hidden'}>
        ${group.entries.map((e) => lineHtml(e, posById)).join('')}
        ${first.technician ? `<div class="muted small">Отчел: ${escapeHtml(first.technician)}</div>` : ''}
        ${first.note ? `<div class="muted small">Бележка: ${escapeHtml(first.note)}</div>` : ''}
        ${photoCount ? `<div class="muted small">📷 ${photoCount} снимки</div>` : ''}
        ${total ? `<div class="muted small">Общо за отчитането: <strong>${fmtNum(total)} €</strong></div>` : ''}
        <button type="button" class="btn btn-danger-ghost btn-sm" data-del-report="${escapeHtml(group.key)}">🗑 Изтрий цялото отчитане</button>
      </div>
    </div>
  `;
}

export function wireReportCards(app, { onDeleteEntry, onDeleteReport }) {
  app.querySelectorAll('.report-card').forEach((card) => {
    const head = card.querySelector('.report-head');
    const body = card.querySelector('.report-body');
    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      card.querySelector('.report-caret').textContent = body.hidden ? '▸' : '▾';
    });
  });
  if (onDeleteEntry) {
    app.querySelectorAll('[data-del-entry]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDeleteEntry(btn.getAttribute('data-del-entry'));
      });
    });
  }
  if (onDeleteReport) {
    app.querySelectorAll('[data-del-report]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDeleteReport(btn.getAttribute('data-del-report'));
      });
    });
  }
}
