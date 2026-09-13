import { db } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, toast } from '../utils/util.js';
import { navigate } from '../router.js';
import { groupEntriesIntoReports, reportCardHtml, reportTotal, wireReportCards } from '../utils/reports.js';

export async function historyView({ id }, query) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const from = query.from || '';
  const to = query.to || '';

  const positions = await db.getAllByIndex('positions', 'siteId', id);
  const posById = new Map(positions.map((p) => [p.id, p]));

  const allEntries = await db.getAllByIndex('entries', 'siteId', id);
  const allReports = groupEntriesIntoReports(allEntries);
  const numberByKey = new Map(allReports.map((g, i) => [g.key, i + 1]));

  let reports = allReports;
  if (from) reports = reports.filter((g) => g.date >= from);
  if (to) reports = reports.filter((g) => g.date <= to);
  reports = reports.slice().reverse(); // най-новото отчитане най-отгоре

  const photoCounts = new Map();
  for (const g of reports) {
    let max = 0;
    for (const e of g.entries) {
      const photos = await db.getAllByIndex('photos', 'entryId', e.id);
      if (photos.length > max) max = photos.length;
    }
    photoCounts.set(g.key, max);
  }

  const totalValue = reports.reduce((sum, g) => sum + reportTotal(g, posById), 0);
  const openKey = query.open || '';

  const cards = reports
    .map((g) =>
      reportCardHtml(g, {
        posById,
        index: numberByKey.get(g.key),
        open: g.reportId === openKey,
        photoCount: photoCounts.get(g.key) || 0,
      })
    )
    .join('');

  const body = `
    <form id="filter-form" class="form form-inline">
      <label>От
        <input type="date" name="from" value="${escapeHtml(from)}" />
      </label>
      <label>До
        <input type="date" name="to" value="${escapeHtml(to)}" />
      </label>
      <button type="submit" class="btn btn-ghost">Филтър</button>
    </form>
    ${reports.length ? `<div class="muted small">${reports.length} ${reports.length === 1 ? 'отчитане' : 'отчитания'}${totalValue ? ` · обща стойност <strong>${fmtNum(totalValue)} €</strong>` : ''}</div>` : ''}
    ${reports.length ? cards : '<div class="empty">Няма отчитания за избрания период.</div>'}
  `;

  return {
    html: layout({ title: 'Дневник', back: `/sites/${id}`, body }),
    mount(app) {
      app.querySelector('#filter-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const qs = new URLSearchParams();
        if (fd.get('from')) qs.set('from', fd.get('from'));
        if (fd.get('to')) qs.set('to', fd.get('to'));
        navigate(`/sites/${id}/history?${qs.toString()}`);
      });

      const reload = () => {
        const qs = new URLSearchParams();
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        navigate(`/sites/${id}/history?${qs.toString()}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      };

      wireReportCards(app, {
        onDeleteEntry: async (entryId) => {
          if (!confirm('Изтриване на реда от отчитането?')) return;
          await db.deleteByIndex('photos', 'entryId', entryId);
          await db.delete('entries', entryId);
          toast('Редът е изтрит');
          reload();
        },
        onDeleteReport: async (key) => {
          const group = reports.find((g) => g.key === key);
          if (!group) return;
          if (!confirm(`Изтриване на цялото отчитане (${group.entries.length} реда)? Действието е необратимо.`)) return;
          for (const e of group.entries) {
            await db.deleteByIndex('photos', 'entryId', e.id);
            await db.delete('entries', e.id);
          }
          toast('Отчитането е изтрито');
          reload();
        },
      });
    },
  };
}
