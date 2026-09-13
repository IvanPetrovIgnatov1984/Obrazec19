import { db, uid, today } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, fmtDate, toast, getSetting, setSetting } from '../utils/util.js';
import { navigate } from '../router.js';

export async function signView({ id }, query) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const date = query.date || today();
  const positions = await db.getAllByIndex('positions', 'siteId', id);
  const posById = Object.fromEntries(positions.map((p) => [p.id, p]));
  const allEntries = await db.getAllByIndex('entries', 'siteId', id);
  const entries = allEntries.filter((e) => e.date === date);

  const otherDates = [...new Set(allEntries.map((e) => e.date))].filter((d) => d !== date).sort();
  const latestOther = otherDates[otherDates.length - 1];
  const otherDatesHint =
    !entries.length && latestOther
      ? `<br><span class="muted small">Има отчитания на друга дата — последното е <a href="#/sites/${id}/sign?date=${latestOther}">${fmtDate(latestOther)}</a>.</span>`
      : '';

  const existing = (await db.getAllByIndex('signatures', 'siteId', id)).find((s) => s.date === date);
  const signedBy = await getSetting('technicianName', '');

  // В Образец 19 Изпълнителят „предава“ работата, а Възложителят я „приема“.
  const isClientRole = site.role === 'client';
  const myRoleLabel = isClientRole ? 'Възложител' : 'Изпълнител';
  const signAction = isClientRole ? 'приел' : 'предал';

  const rows = entries
    .map((e) => {
      const p = posById[e.positionId];
      return `<li>${escapeHtml(p ? p.description : '—')} — ${fmtNum(e.qty)} ${escapeHtml(p ? p.unit || '' : '')}</li>`;
    })
    .join('');

  const body = `
    <form id="date-form" class="form form-inline">
      <label>Дата
        <input type="date" name="date" value="${escapeHtml(date)}" />
      </label>
      <button type="submit" class="btn btn-ghost">Смени</button>
    </form>
    <h3 class="section-title">Отчетени количества за ${fmtDate(date)}</h3>
    ${entries.length ? `<ul class="entry-summary">${rows}</ul>` : `<div class="empty">Няма отчитания за ${fmtDate(date)}.${otherDatesHint}</div>`}

    ${existing ? `
      <h3 class="section-title">Подписано</h3>
      <div class="card">
        <img class="signature-preview" src="${existing.dataUrl}" alt="подпис" />
        <div class="muted small">Подписал: ${escapeHtml(existing.signedBy || '')}${existing.signedRole ? ` · за ${escapeHtml(existing.signedRole)} (${escapeHtml(existing.signAction || '')})` : ''}</div>
        <div class="quick-actions">
          <button id="resign-btn" class="btn btn-ghost btn-sm">Подпиши наново</button>
          <button id="delete-sig-btn" class="btn btn-danger-ghost btn-sm">🗑 Изтрий подписа</button>
        </div>
      </div>
    ` : `
      <h3 class="section-title">Подпис за потвърждение</h3>
      <div class="role-banner">Подписваш като <strong>${myRoleLabel}</strong> — в качеството на „${signAction}“.</div>
      <label>Име на подписващия
        <input id="signed-by" value="${escapeHtml(signedBy)}" placeholder="Име" />
      </label>
      <div class="signature-pad-wrap">
        <canvas id="sig-canvas"></canvas>
      </div>
      <div class="quick-actions">
        <button id="clear-sig" type="button" class="btn btn-ghost">Изчисти</button>
        <button id="save-sig" type="button" class="btn btn-primary">Потвърди и подпиши</button>
      </div>
    `}
  `;

  return {
    html: layout({ title: 'Подпис', back: `/sites/${id}`, body }),
    mount(app) {
      const dateInput = app.querySelector('#date-form [name=date]');
      dateInput.addEventListener('change', (e) => {
        if (!e.target.value || e.target.value === date) return;
        navigate(`/sites/${id}/sign?date=${e.target.value}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      app.querySelector('#date-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        navigate(`/sites/${id}/sign?date=${fd.get('date')}`);
      });

      const resignBtn = app.querySelector('#resign-btn');
      if (resignBtn) {
        resignBtn.addEventListener('click', async () => {
          if (existing) await db.delete('signatures', existing.id);
          navigate(`/sites/${id}/sign?date=${date}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        app.querySelector('#delete-sig-btn').addEventListener('click', async () => {
          if (!confirm('Изтриване на подписа за тази дата?')) return;
          if (existing) await db.delete('signatures', existing.id);
          toast('Подписът е изтрит');
          navigate(`/sites/${id}/sign?date=${date}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        return;
      }

      const canvas = app.querySelector('#sig-canvas');
      if (!canvas) return;
      const wrap = canvas.parentElement;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = wrap.clientWidth * ratio;
      canvas.height = 220 * ratio;
      canvas.style.width = wrap.clientWidth + 'px';
      canvas.style.height = '220px';
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      const pad = new window.SignaturePad(canvas, { backgroundColor: '#ffffff' });

      app.querySelector('#clear-sig').addEventListener('click', () => pad.clear());
      app.querySelector('#save-sig').addEventListener('click', async () => {
        if (pad.isEmpty()) {
          toast('Моля, поставете подпис');
          return;
        }
        const signedByName = app.querySelector('#signed-by').value.trim();
        const dataUrl = pad.toDataURL('image/png');
        await db.put('signatures', {
          id: uid(),
          siteId: id,
          date,
          dataUrl,
          signedBy: signedByName,
          signedRole: myRoleLabel,
          signAction,
          createdAt: Date.now(),
        });
        await setSetting('technicianName', signedByName);
        toast('Подписано успешно');
        navigate(`/sites/${id}/sign?date=${date}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}
