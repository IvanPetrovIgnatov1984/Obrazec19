import { db, uid, deleteSiteCascade, deletePositionCascade } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, toast, getSetting } from '../utils/util.js';
import { navigate } from '../router.js';
import { SMR_CATALOG, SMR_CATEGORY_ORDER, OTHER_CATEGORY, categoryForDescription, keywordsFor } from '../data/smrCatalog.js';
import { advancePlan } from '../utils/exporters.js';
import { pickerHtml, wirePicker } from '../utils/picker.js';

async function positionProgress(position) {
  const entries = await db.getAllByIndex('entries', 'positionId', position.id);
  const done = entries.reduce((sum, e) => sum + (Number(e.qty) || 0), 0);
  const planned = Number(position.plannedQty) || 0;
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;
  return { done, planned, pct };
}

export async function detailView({ id }) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const positions = await db.getAllByIndex('positions', 'siteId', id);
  positions.sort((a, b) => (a.order || 0) - (b.order || 0));

  const rows = await Promise.all(
    positions.map(async (p) => {
      const { done, planned, pct } = await positionProgress(p);
      const over = planned > 0 && done > planned;
      // Позиции, добавени в движение при отчитане, нямат количество по КС — показваме ги като допълнителни.
      const noPrice = !Number(p.unitPrice);
      const priceTag = noPrice ? ' · <span class="tag-warn">няма цена</span>' : '';
      const qtyLine = planned > 0
        ? `${fmtNum(done)} / ${fmtNum(planned)} ${escapeHtml(p.unit || '')}${p.unitPrice ? ' · ' + fmtNum(done * p.unitPrice) + ' / ' + fmtNum(planned * p.unitPrice) + ' €' : ''}${priceTag}`
        : `${fmtNum(done)} ${escapeHtml(p.unit || '')}${p.unitPrice ? ' · ' + fmtNum(done * p.unitPrice) + ' €' : ''} · <span class="tag-extra">извън КС</span>${priceTag}`;
      return `
        <div class="card pos-card" data-href="/sites/${id}/positions/${p.id}">
          <div class="site-card-top">
            <strong>${escapeHtml(p.code ? p.code + ' · ' : '')}${escapeHtml(p.description)}</strong>
            <button type="button" class="icon-btn-sm" data-del-pos="${p.id}" aria-label="Изтрий позицията">🗑</button>
          </div>
          <div class="muted small">${qtyLine}</div>
          ${planned > 0 ? `<div class="progress"><div class="progress-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>` : ''}
        </div>
      `;
    })
  );

  const isCompany = site.counterpartyType !== 'individual';
  const counterpartyLine = isCompany
    ? `Фирма · ЕИК ${escapeHtml(site.eik || '—')}${site.vatRegistered ? ' · ' + escapeHtml(site.vatNumber || 'рег. по ДДС') : ' · нерегистрирана по ДДС'}`
    : 'Физическо лице';
  const isClientRole = site.role === 'client';

  // Двете страни по акта — с имената им, а не с роля спрямо потребителя.
  const myCompany = (await getSetting('myCompany', null)) || {};
  const myName = myCompany.name
    ? escapeHtml(myCompany.name)
    : '<a href="#/company">попълни „Моята фирма“</a>';
  const myLine = myCompany.name
    ? `Фирма · ЕИК ${escapeHtml(myCompany.eik || '—')}${myCompany.vatRegistered ? ' · ' + escapeHtml(myCompany.vatNumber || 'рег. по ДДС') : ' · нерегистрирана по ДДС'}`
    : '';
  const counterpartyName = escapeHtml(site.clientName || '—');
  const parties = isClientRole
    ? [
        { label: 'Възложител', name: myName, line: myLine },
        { label: 'Изпълнител', name: counterpartyName, line: counterpartyLine },
      ]
    : [
        { label: 'Възложител', name: counterpartyName, line: counterpartyLine },
        { label: 'Изпълнител', name: myName, line: myLine },
      ];
  const partiesHtml = parties
    .map(
      (p) => `
      <div class="party-row">
        <span class="party-label">${p.label}</span>
        <span class="party-name">${p.name}</span>
        ${p.line ? `<span class="muted small">${p.line}</span>` : ''}
      </div>`
    )
    .join('');

  const boqValue = positions.reduce((sum, p) => sum + (Number(p.plannedQty) || 0) * (Number(p.unitPrice) || 0), 0);
  const plan = advancePlan(site, { boqValue });
  const advanceLine = plan.total
    ? `<div class="muted small">Аванс: <strong>${fmtNum(plan.total)} €</strong>${
        plan.mode === 'percent' ? ` (${plan.pct}% от ${fmtNum(boqValue)} €)` : ''
      } · ${plan.method === 'proportional' ? 'пропорционално приспадане' : 'приспадане до усвояване'}</div>`
    : '';

  const body = `
    <div class="site-header">
      <h2>${escapeHtml(site.name)}</h2>
      <div class="muted small">${escapeHtml(site.address || '')}</div>
      <div class="parties">${partiesHtml}</div>
      ${advanceLine}
      <a class="btn btn-ghost btn-sm" href="#/sites/${id}/edit">✏️ Редактирай данните на обекта</a>
    </div>
    <a class="btn btn-primary btn-block" href="#/sites/${id}/report">📝 Отчети изпълнени работи</a>
    <div class="quick-actions">
      <a class="btn btn-ghost" href="#/sites/${id}/history">📒 Дневник</a>
      <a class="btn btn-ghost" href="#/sites/${id}/export">📄 Акт Образец 19</a>
    </div>
    <h3 class="section-title">Количествена сметка</h3>
    ${positions.length ? `<div class="list">${rows.join('')}</div>` : '<div class="empty">Няма добавени позиции.<br>Натиснете „+ Нова позиция“.</div>'}

    <button type="button" class="btn btn-danger-ghost btn-sm" id="delete-site-btn">🗑 Изтрий обекта</button>
  `;

  return {
    html: layout({
      title: 'Обект',
      back: '/sites',
      action: `<a href="#/sites/${id}/positions/new" class="icon-btn" aria-label="Нова позиция">+</a>`,
      body,
    }),
    mount(app) {
      app.querySelectorAll('.pos-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-del-pos]')) return;
          navigate(card.getAttribute('data-href'));
        });
      });
      app.querySelectorAll('[data-del-pos]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Изтриване на позицията и всички нейни отчитания и снимки? Действието е необратимо.')) return;
          await deletePositionCascade(btn.getAttribute('data-del-pos'));
          toast('Позицията е изтрита');
          navigate(`/sites/${id}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      });
      app.querySelector('#delete-site-btn').addEventListener('click', async () => {
        if (!confirm('Изтриване на целия обект — включително всички позиции, отчитания, снимки и актове? Действието е необратимо.')) return;
        await deleteSiteCascade(id);
        toast('Обектът е изтрит');
        navigate('/sites');
      });
    },
  };
}

export async function newPositionView({ id }) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const existing = await db.getAllByIndex('positions', 'siteId', id);
  const taken = new Set(existing.map((p) => (p.description || '').trim().toLowerCase()));

  const byCategory = new Map();
  SMR_CATALOG.forEach((item, i) => {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push({
      key: 'cat:' + i,
      description: item.description,
      unit: item.unit,
      disabled: taken.has(item.description.trim().toLowerCase()),
      note: taken.has(item.description.trim().toLowerCase()) ? 'вече в КС' : '',
    });
  });
  const known = SMR_CATEGORY_ORDER.filter((c) => byCategory.has(c));
  const extraCats = [...byCategory.keys()].filter((c) => !SMR_CATEGORY_ORDER.includes(c) && c !== OTHER_CATEGORY).sort();
  const orderedCats = [...known, ...extraCats, ...(byCategory.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : [])];
  const groups = orderedCats.map((cat) => ({
    cat,
    items: byCategory.get(cat).map((it) => ({ ...it, keywords: keywordsFor(cat) })),
  }));
  const totalPickable = SMR_CATALOG.length;
  const pickerMarkup = pickerHtml(groups);

  const body = `
    <form id="pos-form" class="form">
      <h3 class="section-title">Нови позиции <span id="rows-count" class="muted"></span></h3>
      <div id="rows-container"></div>
      <button type="button" id="add-row-btn" class="btn btn-add-more">+ Добави още позиция</button>
      <button type="submit" class="btn btn-primary">Потвърди</button>
    </form>
  `;

  return {
    html: layout({ title: 'Нови позиции', back: `/sites/${id}`, body }),
    mount(app) {
      const rowsContainer = app.querySelector('#rows-container');
      const rowsCountEl = app.querySelector('#rows-count');

      function refreshSummary() {
        const n = rowsContainer.children.length;
        rowsCountEl.textContent = n > 1 ? `(${n})` : '';
      }

      function choose(rowEl, { description, unit, category }) {
        rowEl.dataset.picked = '1';
        rowEl.dataset.category = category || '';
        rowEl.querySelector('.pick-box').hidden = true;
        rowEl.querySelector('.row-title').textContent = description;
        const fieldsEl = rowEl.querySelector('.row-fields');
        fieldsEl.hidden = false;
        fieldsEl.innerHTML = `
          <label>Описание *
            <input class="st-desc" value="${escapeHtml(description)}" placeholder="Описание" />
          </label>
          <div class="form-row">
            <label>Мярка *
              <input class="st-unit" value="${escapeHtml(unit || '')}" placeholder="м2, м3, бр, м, кг" />
            </label>
            <label>Количество по КС
              <input class="st-qty" type="number" step="any" inputmode="decimal" placeholder="0" />
            </label>
          </div>
          <div class="form-row">
            <label>Код
              <input class="st-code" placeholder="напр. 12.3" />
            </label>
            <label>Единична цена (€)
              <input class="st-price" type="number" step="any" inputmode="decimal" placeholder="0" />
            </label>
          </div>
          <button type="button" class="btn btn-ghost btn-sm row-change">Смени вида СМР</button>
        `;
        fieldsEl.querySelector('.st-desc').addEventListener('input', (e) => {
          rowEl.querySelector('.row-title').textContent = e.target.value || 'Нова позиция';
        });
        fieldsEl.querySelector('.row-change').addEventListener('click', () => resetPick(rowEl));
        const focusEl = unit ? fieldsEl.querySelector('.st-qty') : fieldsEl.querySelector('.st-unit');
        focusEl.focus({ preventScroll: true });
      }

      function resetPick(rowEl) {
        delete rowEl.dataset.picked;
        delete rowEl.dataset.category;
        rowEl.querySelector('.row-title').textContent = 'Избери вид СМР';
        const fieldsEl = rowEl.querySelector('.row-fields');
        fieldsEl.innerHTML = '';
        fieldsEl.hidden = true;
        rowEl.querySelector('.pick-box').hidden = false;
        const search = rowEl.querySelector('.pick-search');
        search.value = '';
        search.dispatchEvent(new Event('input'));
        search.focus({ preventScroll: true });
      }

      function addRow() {
        const rowEl = document.createElement('div');
        rowEl.className = 'card work-row';
        rowEl.innerHTML = `
          <div class="site-card-top">
            <strong class="small row-title">Избери вид СМР</strong>
            <button type="button" class="icon-btn-sm row-remove" aria-label="Махни позицията">−</button>
          </div>
          ${pickerMarkup}
          <div class="row-fields" hidden></div>
        `;
        rowsContainer.appendChild(rowEl);

        wirePicker(rowEl, {
          total: totalPickable,
          onPick: (key) => {
            const item = SMR_CATALOG[Number(key.slice(4))];
            if (item) choose(rowEl, item);
          },
          onManual: (text) => choose(rowEl, { description: text, unit: '', category: categoryForDescription(text) }),
          disabledMessage: () => toast('Този вид СМР вече е в количествената сметка'),
        });

        rowEl.querySelector('.row-remove').addEventListener('click', () => {
          if (rowsContainer.children.length === 1) {
            resetPick(rowEl);
            return;
          }
          rowEl.remove();
          refreshSummary();
        });
        refreshSummary();
        return rowEl;
      }

      app.querySelector('#add-row-btn').addEventListener('click', () => {
        const rowEl = addRow();
        rowEl.querySelector('.pick-search').focus({ preventScroll: true });
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      addRow();

      app.querySelector('#pos-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rows = [...rowsContainer.querySelectorAll('.work-row')].filter((r) => r.dataset.picked);
        if (!rows.length) {
          toast('Още няма избран вид СМР');
          return;
        }
        const invalid = rows.find(
          (r) => !r.querySelector('.st-desc').value.trim() || !r.querySelector('.st-unit').value.trim()
        );
        if (invalid) {
          toast('Попълни описание и мярка на всички позиции');
          invalid.querySelector('.st-unit').focus();
          return;
        }
        let n = 0;
        try {
        for (const r of rows) {
          const description = r.querySelector('.st-desc').value.trim();
          await db.put('positions', {
            id: uid(),
            siteId: id,
            code: r.querySelector('.st-code').value.trim(),
            description,
            unit: r.querySelector('.st-unit').value.trim(),
            category: r.dataset.category || categoryForDescription(description) || OTHER_CATEGORY,
            plannedQty: parseFloat(r.querySelector('.st-qty').value) || 0,
            unitPrice: parseFloat(r.querySelector('.st-price').value) || 0,
            order: Date.now() + n,
            createdAt: Date.now(),
          });
          n++;
        }
        } catch (err) {
          console.error('Записът на позициите се провали', err);
          alert('Позициите НЕ бяха записани.\n\n' + String((err && err.message) || err));
          return;
        }
        toast(n === 1 ? 'Позицията е добавена' : `Добавени ${n} позиции`);
        navigate(`/sites/${id}`);
      });
    },
  };
}
