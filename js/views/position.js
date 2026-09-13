import { db, uid, today, deletePositionCascade } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, fmtDate, toast, getSetting, setSetting, fileToCompressedBlob } from '../utils/util.js';
import { navigate } from '../router.js';

export async function positionDetailView({ id, posId }) {
  const site = await db.get('sites', id);
  const position = await db.get('positions', posId);
  if (!site || !position) return { html: layout({ title: 'Не е намерено', back: `/sites/${id}`, body: '<p>Позицията не съществува.</p>' }) };

  const entries = await db.getAllByIndex('entries', 'positionId', posId);
  entries.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const done = entries.reduce((sum, e) => sum + (Number(e.qty) || 0), 0);
  const planned = Number(position.plannedQty) || 0;

  const rows = await Promise.all(
    entries.map(async (e) => {
      const photos = await db.getAllByIndex('photos', 'entryId', e.id);
      const thumbs = photos
        .map((p) => `<img class="thumb" src="${URL.createObjectURL(p.blob)}" alt="снимка" />`)
        .join('');
      const value = (Number(position.unitPrice) || 0) * (Number(e.qty) || 0);
      return `
        <div class="card entry-card">
          <div class="site-card-top">
            <strong>${fmtDate(e.date)}</strong>
            <span class="muted">${fmtNum(e.qty)} ${escapeHtml(position.unit || '')}${position.unitPrice ? ' · ' + fmtNum(value) + ' €' : ''}</span>
          </div>
          ${e.factorA != null ? `<div class="muted small">${fmtNum(e.factorA)} ${escapeHtml(e.unitA || '')} × ${fmtNum(e.factorB)} ${escapeHtml(e.unitB || '')}</div>` : ''}
          ${e.coats > 1 ? `<div class="muted small">${fmtNum(e.baseQty)} ${escapeHtml(position.unit || '')} × ${e.coats} ръце</div>` : ''}
          ${e.note ? `<div class="muted small">${escapeHtml(e.note)}</div>` : ''}
          ${e.technician ? `<div class="muted small">Техник: ${escapeHtml(e.technician)}</div>` : ''}
          ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}
          <button class="btn btn-danger-ghost btn-sm" data-del-entry="${e.id}">Изтрий</button>
        </div>
      `;
    })
  );

  const body = `
    <div class="site-header">
      <form id="edit-pos-form" class="form">
        <div class="form-row">
          <label>Код
            <input name="code" value="${escapeHtml(position.code || '')}" placeholder="напр. 12.3" />
          </label>
          <label>Мярка *
            <input name="unit" required value="${escapeHtml(position.unit || '')}" />
          </label>
        </div>
        <label>Описание *
          <input name="description" required value="${escapeHtml(position.description)}" />
        </label>
        <div class="form-row">
          <label>Количество по КС *
            <input name="plannedQty" required type="number" step="any" inputmode="decimal" value="${position.plannedQty ?? 0}" />
          </label>
          <label>Единична цена (€)
            <input name="unitPrice" type="number" step="any" inputmode="decimal" value="${position.unitPrice ?? ''}" placeholder="незадължително" />
          </label>
        </div>
        <button type="submit" class="btn btn-primary">Запази промените</button>
      </form>
      <div class="muted small">${fmtNum(done)} / ${fmtNum(planned)} ${escapeHtml(position.unit || '')} изпълнено</div>
      ${position.unitPrice ? `<div class="muted small">Стойност: ${fmtNum(done * position.unitPrice)} / ${fmtNum(planned * position.unitPrice)} €</div>` : ''}
    </div>
    <a class="btn btn-primary btn-block" href="#/sites/${id}/positions/${posId}/report">+ Ново отчитане</a>
    <h3 class="section-title">История на отчитанията</h3>
    ${entries.length ? rows.join('') : '<div class="empty">Няма отчетени количества.</div>'}

    <button type="button" class="btn btn-danger-ghost btn-sm" id="delete-position-btn">🗑 Изтрий позицията</button>
  `;

  return {
    html: layout({ title: 'Позиция', back: `/sites/${id}`, body }),
    mount(app) {
      app.querySelector('#edit-pos-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const updated = {
          ...position,
          code: fd.get('code').trim(),
          description: fd.get('description').trim(),
          unit: fd.get('unit').trim(),
          plannedQty: parseFloat(fd.get('plannedQty')) || 0,
          unitPrice: parseFloat(fd.get('unitPrice')) || 0,
        };
        if (!updated.description || !updated.unit) return;
        await db.put('positions', updated);
        toast('Промените са запазени');
        navigate(`/sites/${id}/positions/${posId}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      app.querySelectorAll('[data-del-entry]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Изтриване на отчитането?')) return;
          const entryId = btn.getAttribute('data-del-entry');
          await db.deleteByIndex('photos', 'entryId', entryId);
          await db.delete('entries', entryId);
          toast('Изтрито');
          navigate(`/sites/${id}/positions/${posId}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      });
      app.querySelector('#delete-position-btn').addEventListener('click', async () => {
        if (!confirm('Изтриване на позицията и всички нейни отчитания и снимки? Действието е необратимо.')) return;
        await deletePositionCascade(posId);
        toast('Позицията е изтрита');
        navigate(`/sites/${id}`);
      });
    },
  };
}

export async function reportView({ id, posId }) {
  const site = await db.get('sites', id);
  const position = await db.get('positions', posId);
  if (!site || !position) return { html: layout({ title: 'Не е намерено', back: `/sites/${id}`, body: '<p>Позицията не съществува.</p>' }) };

  const technician = await getSetting('technicianName', '');
  const remaining = Math.max(0, (Number(position.plannedQty) || 0) - (await remainingDone(posId)));

  const compound = (position.unit || '').includes('/');
  const [unitA, unitB] = compound ? position.unit.split('/').map((s) => s.trim()) : [null, null];

  const qtyFieldHtml = compound
    ? `
      <div class="form-row">
        <label>Количество (${escapeHtml(unitA)}) *
          <input name="factorA" type="number" step="any" inputmode="decimal" required placeholder="0" />
        </label>
        <label>Добавка (${escapeHtml(unitB)}) *
          <input name="factorB" type="number" step="any" inputmode="decimal" required placeholder="0" />
        </label>
      </div>
      <div class="muted small" id="compound-result">= 0 ${escapeHtml(position.unit)}</div>
    `
    : `
      <div class="form-row">
        <label>Изпълнено количество днес *
          <input name="qty" type="number" step="any" inputmode="decimal" required placeholder="0" />
        </label>
        <label>Ръце / пластове
          <input name="coats" type="number" step="1" min="1" inputmode="numeric" value="1" />
        </label>
      </div>
    `;

  const body = `
    <div class="site-header">
      <h2>${escapeHtml(position.description)}</h2>
      <div class="muted small">Остават: ${fmtNum(remaining)} ${escapeHtml(position.unit || '')}</div>
      ${position.unitPrice ? `<div class="muted small">Ед. цена: ${fmtNum(position.unitPrice)} €</div>` : ''}
      ${compound ? `<div class="muted small">Разчита се различно за всеки етаж/участък — въведете количество и добавка ръчно всеки път.</div>` : ''}
    </div>
    <form id="report-form" class="form">
      <label>Дата *
        <input name="date" type="date" required value="${today()}" />
      </label>
      ${qtyFieldHtml}
      ${position.unitPrice ? `<div class="muted small" id="value-result">Стойност: 0.00 €</div>` : ''}
      <label>${site.role === 'client' ? 'Отговорник от страна на Възложителя' : 'Технически ръководител / Отговорник'}
        <input name="technician" value="${escapeHtml(technician)}" placeholder="Име" />
      </label>
      <label>Бележка
        <textarea name="note" rows="3" placeholder="незадължително"></textarea>
      </label>
      <div class="photo-section">
        <div class="site-card-top"><span>Снимки като доказателство</span></div>
        <div id="photo-list" class="thumbs"></div>
        <button type="button" id="add-photo-btn" class="btn btn-ghost">📷 Добави снимка</button>
        <input type="file" id="photo-input" accept="image/*" capture="environment" hidden />
      </div>
      <button type="submit" class="btn btn-primary">Потвърди</button>
    </form>
  `;

  return {
    html: layout({ title: 'Ново отчитане', back: `/sites/${id}/positions/${posId}`, body }),
    mount(app) {
      const getCoats = () => Math.max(1, parseFloat(app.querySelector('[name=coats]')?.value) || 1);
      const getCurrentQty = () => {
        if (compound) {
          const a = parseFloat(app.querySelector('[name=factorA]')?.value) || 0;
          const b = parseFloat(app.querySelector('[name=factorB]')?.value) || 0;
          return a * b;
        }
        return (parseFloat(app.querySelector('[name=qty]')?.value) || 0) * getCoats();
      };

      const valueEl = app.querySelector('#value-result');
      const updateValue = () => {
        if (!valueEl) return;
        const qty = getCurrentQty();
        const coats = compound ? 1 : getCoats();
        const base = parseFloat(app.querySelector('[name=qty]')?.value) || 0;
        const prefix = coats > 1 ? `${fmtNum(base)} × ${coats} ръце = ${fmtNum(qty)} ${position.unit} · ` : '';
        valueEl.textContent = `${prefix}Стойност: ${fmtNum(qty * (Number(position.unitPrice) || 0))} €`;
      };

      if (compound) {
        const factorAInput = app.querySelector('[name=factorA]');
        const factorBInput = app.querySelector('[name=factorB]');
        const resultEl = app.querySelector('#compound-result');
        const updateResult = () => {
          resultEl.textContent = `= ${fmtNum(getCurrentQty())} ${position.unit}`;
          updateValue();
        };
        factorAInput.addEventListener('input', updateResult);
        factorBInput.addEventListener('input', updateResult);
      } else {
        app.querySelector('[name=qty]').addEventListener('input', updateValue);
        app.querySelector('[name=coats]').addEventListener('input', updateValue);
        updateValue();
      }

      const photoBlobs = [];
      const photoListEl = app.querySelector('#photo-list');
      const fileInput = app.querySelector('#photo-input');

      function renderPhotos() {
        photoListEl.innerHTML = photoBlobs
          .map(
            (blob, i) =>
              `<div class="thumb-wrap"><img class="thumb" src="${URL.createObjectURL(blob)}" /><button type="button" class="thumb-remove" data-idx="${i}">✕</button></div>`
          )
          .join('');
        photoListEl.querySelectorAll('.thumb-remove').forEach((btn) => {
          btn.addEventListener('click', () => {
            photoBlobs.splice(Number(btn.getAttribute('data-idx')), 1);
            renderPhotos();
          });
        });
      }

      app.querySelector('#add-photo-btn').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        const blob = await fileToCompressedBlob(file);
        photoBlobs.push(blob);
        renderPhotos();
        fileInput.value = '';
      });

      app.querySelector('#report-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const baseQty = parseFloat(fd.get('qty')) || 0;
        const coats = compound ? 1 : Math.max(1, parseFloat(fd.get('coats')) || 1);
        const qty = compound
          ? (parseFloat(fd.get('factorA')) || 0) * (parseFloat(fd.get('factorB')) || 0)
          : baseQty * coats;
        const entry = {
          id: uid(),
          siteId: id,
          positionId: posId,
          reportId: uid(), // отчитане само с този ред
          date: fd.get('date'),
          qty,
          note: fd.get('note').trim(),
          technician: fd.get('technician').trim(),
          createdAt: Date.now(),
          ...(compound
            ? {
                factorA: parseFloat(fd.get('factorA')) || 0,
                factorB: parseFloat(fd.get('factorB')) || 0,
                unitA,
                unitB,
              }
            : coats > 1
            ? { baseQty, coats }
            : {}),
        };
        try {
          await db.put('entries', entry);
        } catch (err) {
          console.error('Записът на отчитането се провали', err);
          alert('Отчитането НЕ беше записано.\n\n' + String((err && err.message) || err));
          return;
        }
        await setSetting('technicianName', entry.technician);
        for (const blob of photoBlobs) {
          await db.put('photos', { id: uid(), entryId: entry.id, blob, createdAt: Date.now() });
        }
        toast('Отчитането е запазено');
        navigate(`/sites/${id}/positions/${posId}`);
      });
    },
  };
}

async function remainingDone(posId) {
  const entries = await db.getAllByIndex('entries', 'positionId', posId);
  return entries.reduce((sum, e) => sum + (Number(e.qty) || 0), 0);
}
