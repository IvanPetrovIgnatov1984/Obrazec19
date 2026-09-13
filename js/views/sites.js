import { db, uid, deleteSiteCascade } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, toast, getSetting } from '../utils/util.js';
import { navigate } from '../router.js';
import { APP_VERSION } from '../version.js';

export async function listView() {
  const sites = await db.getAll('sites');
  sites.sort((a, b) => b.createdAt - a.createdAt);

  // Дребна диагностика — веднага показва дали данните са в този браузър.
  const counts = { positions: 0, entries: 0, acts: 0 };
  try {
    counts.positions = (await db.getAll('positions')).length;
    counts.entries = (await db.getAll('entries')).length;
    counts.acts = (await db.getAll('acts')).length;
  } catch (err) {
    console.error(err);
  }

  const myCompany = (await getSetting('myCompany', null)) || {};
  const myCompanyName = myCompany.name || '— виж „Моята фирма“';

  const rows = await Promise.all(
    sites.map(async (s) => {
      const positions = await db.getAllByIndex('positions', 'siteId', s.id);
      const entries = await db.getAllByIndex('entries', 'siteId', s.id);
      const planned = positions.reduce((sum, p) => sum + (Number(p.plannedQty) || 0), 0);
      const done = entries.reduce((sum, e) => sum + (Number(e.qty) || 0), 0);
      const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;
      const isClient = s.role === 'client';
      const vazlozhitel = isClient ? myCompanyName : s.clientName || '—';
      const izpalnitel = isClient ? s.clientName || '—' : myCompanyName;
      return `
        <div class="card site-card" data-href="/sites/${s.id}">
          <div class="site-card-top">
            <strong>${escapeHtml(s.name)}</strong>
            <div class="card-actions">
              <span class="muted">${positions.length} ${positions.length === 1 ? 'позиция' : 'позиции'}</span>
              <button type="button" class="icon-btn-sm" data-del-site="${s.id}" aria-label="Изтрий обекта">🗑</button>
            </div>
          </div>
          <div class="muted small">Възложител: ${escapeHtml(vazlozhitel)}</div>
          <div class="muted small">Изпълнител: ${escapeHtml(izpalnitel)}</div>
          <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="muted small">${pct}% изпълнение</div>
        </div>
      `;
    })
  );

  const companyLine = myCompany.name
    ? `ЕИК ${escapeHtml(myCompany.eik || '—')}${myCompany.vatRegistered ? ' · ' + escapeHtml(myCompany.vatNumber || 'рег. по ДДС') : ' · нерегистрирана по ДДС'}`
    : 'Натисни, за да попълниш данните си — те влизат във всеки протокол.';

  const body = `
    <h3 class="section-title">Моята фирма</h3>
    <a class="card company-card" href="#/company">
      <span class="company-icon">🏢</span>
      <span class="company-text">
        <strong>${myCompany.name ? escapeHtml(myCompany.name) : 'Още не е попълнена'}</strong>
        <span class="muted small">${companyLine}</span>
      </span>
      <span class="chev">›</span>
    </a>

    <h3 class="section-title">Обекти ${sites.length ? `(${sites.length})` : ''}</h3>
    ${sites.length ? `<div class="list">${rows.join('')}</div>` : `<div class="empty">Няма добавени обекти.<br>Натиснете „+“ горе вдясно, за да добавите първия.</div>`}

    <div class="app-version">
      <span>Образец 19 · версия ${APP_VERSION} · ${sites.length} обекта · ${counts.positions} позиции · ${counts.entries} отчитания · ${counts.acts} акта</span>
      <button type="button" id="force-update" class="btn btn-ghost btn-sm">Обнови</button>
    </div>
  `;

  return {
    html: layout({
      title: 'Образец 19',
      action: `<a href="#/sites/new" class="icon-btn" aria-label="Нов обект">+</a>`,
      body,
    }),
    mount(app) {
      app.querySelectorAll('.site-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-del-site]')) return;
          navigate(card.getAttribute('data-href'));
        });
      });
      app.querySelector('#force-update').addEventListener('click', async () => {
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch (err) {
          console.error(err);
        }
        window.location.href = window.location.pathname + '?_u=' + Date.now();
      });

      app.querySelectorAll('[data-del-site]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Изтриване на обекта и всички свързани данни (позиции, отчитания, снимки, подписи)? Действието е необратимо.')) return;
          await deleteSiteCascade(btn.getAttribute('data-del-site'));
          toast('Обектът е изтрит');
          navigate('/sites');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      });
    },
  };
}

const EMPTY_SITE = {
  name: '', address: '', clientName: '', clientAddress: '',
  role: 'contractor', counterpartyType: 'company',
  eik: '', vatRegistered: false, vatNumber: '', egn: '',
  advanceMode: 'amount', advanceAmount: '', advancePercent: '', advanceMethod: '',
};

function roleTexts(role) {
  const isClient = role === 'client';
  return {
    isClient,
    sectionTitle: isClient ? 'Изпълнител (контрагент)' : 'Възложител (контрагент)',
    addressLabel: isClient ? 'Адрес на изпълнителя' : 'Адрес на възложителя',
    hint: isClient
      ? 'Твоята фирма е ВЪЗЛОЖИТЕЛ по този обект — данните ѝ идват от „Моята фирма“. По-долу въвеждаш данните на ИЗПЪЛНИТЕЛЯ.'
      : 'Твоята фирма е ИЗПЪЛНИТЕЛ по този обект — данните ѝ идват от „Моята фирма“. По-долу въвеждаш данните на ВЪЗЛОЖИТЕЛЯ.',
  };
}

function siteFormHtml(site, submitLabel, boqValue) {
  const s = site || EMPTY_SITE;
  const t = roleTexts(s.role);
  const isCompany = s.counterpartyType !== 'individual';
  const advanceValue = s.advanceAmount === '' || s.advanceAmount == null ? '' : s.advanceAmount;
  const percentValue = s.advancePercent === '' || s.advancePercent == null ? '' : s.advancePercent;
  const isPercent = s.advanceMode === 'percent';
  const method = s.advanceMethod || (isPercent ? 'proportional' : 'exhaust');

  return `
    <form id="site-form" class="form">
      <h3 class="section-title">Обект</h3>
      <label>Наименование на обекта *
        <input name="name" required value="${escapeHtml(s.name || '')}" placeholder="напр. Жилищна сграда бл. 24" />
      </label>
      <label>Местоположение / адрес на обекта
        <input name="address" value="${escapeHtml(s.address || '')}" placeholder="гр. София, ул. ..." />
      </label>

      <h3 class="section-title">В качеството на</h3>
      <div class="segmented" data-role-type>
        <button type="button" class="segmented-btn ${t.isClient ? 'active' : ''}" data-value="client">Възложител</button>
        <button type="button" class="segmented-btn ${t.isClient ? '' : 'active'}" data-value="contractor">Изпълнител</button>
      </div>
      <input type="hidden" name="role" value="${t.isClient ? 'client' : 'contractor'}" />
      <div class="role-banner" id="role-hint">${t.hint}</div>

      <h3 class="section-title" id="counterparty-section-title">${t.sectionTitle}</h3>
      <label>Наименование / име на контрагента *
        <input name="clientName" required value="${escapeHtml(s.clientName || '')}" placeholder="напр. Строй Инвест ЕООД или Иван Иванов" />
      </label>

      <div class="segmented" data-counterparty-type>
        <button type="button" class="segmented-btn ${isCompany ? 'active' : ''}" data-value="company">Фирма</button>
        <button type="button" class="segmented-btn ${isCompany ? '' : 'active'}" data-value="individual">Физическо лице</button>
      </div>
      <input type="hidden" name="counterpartyType" value="${isCompany ? 'company' : 'individual'}" />

      <div data-company-fields ${isCompany ? '' : 'hidden'}>
        <label>ЕИК *
          <input name="eik" value="${escapeHtml(s.eik || '')}" placeholder="напр. 123456789" />
        </label>
        <label class="checkbox-row">
          <input type="checkbox" name="vatRegistered" ${s.vatRegistered ? 'checked' : ''} />
          Регистриран по ЗДДС
        </label>
        <label data-vat-number-row ${s.vatRegistered ? '' : 'hidden'}>ИН по ЗДДС
          <input name="vatNumber" value="${escapeHtml(s.vatNumber || '')}" placeholder="напр. BG123456789" />
        </label>
      </div>

      <div data-individual-fields ${isCompany ? 'hidden' : ''}>
        <label>ЕГН
          <input name="egn" value="${escapeHtml(s.egn || '')}" placeholder="незадължително" />
        </label>
      </div>

      <label id="counterparty-address-label">${t.addressLabel}
        <input name="clientAddress" value="${escapeHtml(s.clientAddress || '')}" placeholder="гр. ..., ул. ..." />
      </label>

      <h3 class="section-title">Аванс</h3>
      <div class="segmented" data-advance-mode>
        <button type="button" class="segmented-btn ${isPercent ? '' : 'active'}" data-value="amount">Сума (€)</button>
        <button type="button" class="segmented-btn ${isPercent ? 'active' : ''}" data-value="percent">Процент (%)</button>
      </div>
      <input type="hidden" name="advanceMode" value="${isPercent ? 'percent' : 'amount'}" />

      <label data-advance-amount ${isPercent ? 'hidden' : ''}>Предоставен аванс от възложителя (€)
        <input name="advanceAmount" type="number" step="any" inputmode="decimal" value="${advanceValue}" placeholder="0" />
      </label>

      <div data-advance-percent ${isPercent ? '' : 'hidden'}>
        <label>Аванс (% от количествената сметка)
          <input name="advancePercent" type="number" step="any" min="0" max="100" inputmode="decimal" value="${percentValue}" placeholder="напр. 30" />
        </label>
        <div class="muted small" id="advance-preview"></div>
      </div>

      <label>Начин на приспадане
        <select name="advanceMethod">
          <option value="proportional" ${method === 'proportional' ? 'selected' : ''}>Пропорционално — от всеки акт се приспада същият дял</option>
          <option value="exhaust" ${method === 'exhaust' ? 'selected' : ''}>Изцяло — приспада се от първите актове, докато се усвои</option>
        </select>
      </label>
      <div class="muted small">Стойност на количествената сметка: <strong>${fmtNum(boqValue || 0)} €</strong></div>

      <button type="submit" class="btn btn-primary">${submitLabel}</button>
    </form>
  `;
}

function wireSiteForm(app, onSubmit, boqValue) {
  const advanceButtons = app.querySelectorAll('[data-advance-mode] .segmented-btn');
  const advanceModeInput = app.querySelector('[name=advanceMode]');
  const advanceAmountRow = app.querySelector('[data-advance-amount]');
  const advancePercentRow = app.querySelector('[data-advance-percent]');
  const percentInput = app.querySelector('[name=advancePercent]');
  const previewEl = app.querySelector('#advance-preview');

  function refreshAdvancePreview() {
    const pct = parseFloat(percentInput.value) || 0;
    previewEl.textContent = pct
      ? `${pct}% от ${fmtNum(boqValue || 0)} € = ${fmtNum(((boqValue || 0) * pct) / 100)} €`
      : 'Процентът се смята върху стойността на количествената сметка.';
  }
  percentInput.addEventListener('input', refreshAdvancePreview);
  refreshAdvancePreview();

  advanceButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      advanceButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const isPercent = btn.getAttribute('data-value') === 'percent';
      advanceModeInput.value = isPercent ? 'percent' : 'amount';
      advanceAmountRow.hidden = isPercent;
      advancePercentRow.hidden = !isPercent;
    });
  });

  const roleButtons = app.querySelectorAll('[data-role-type] .segmented-btn');
  const roleInput = app.querySelector('[name=role]');
  const roleHint = app.querySelector('#role-hint');
  const counterpartyTitle = app.querySelector('#counterparty-section-title');
  const addressLabel = app.querySelector('#counterparty-address-label');

  function applyRole(value) {
    const t = roleTexts(value);
    roleInput.value = t.isClient ? 'client' : 'contractor';
    counterpartyTitle.textContent = t.sectionTitle;
    roleHint.textContent = t.hint;
    addressLabel.childNodes[0].nodeValue = t.addressLabel;
  }

  roleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      roleButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyRole(btn.getAttribute('data-value'));
    });
  });

  const typeButtons = app.querySelectorAll('[data-counterparty-type] .segmented-btn');
  const typeInput = app.querySelector('[name=counterpartyType]');
  const companyFields = app.querySelector('[data-company-fields]');
  const individualFields = app.querySelector('[data-individual-fields]');
  const eikInput = app.querySelector('[name=eik]');

  typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      typeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const value = btn.getAttribute('data-value');
      typeInput.value = value;
      const isCompany = value === 'company';
      companyFields.hidden = !isCompany;
      individualFields.hidden = isCompany;
      eikInput.required = isCompany;
    });
  });
  eikInput.required = typeInput.value === 'company';

  const vatCheckbox = app.querySelector('[name=vatRegistered]');
  const vatRow = app.querySelector('[data-vat-number-row]');
  vatCheckbox.addEventListener('change', () => {
    vatRow.hidden = !vatCheckbox.checked;
  });

  app.querySelector('#site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const counterpartyType = fd.get('counterpartyType');
    const isCompany = counterpartyType === 'company';
    const vatOn = isCompany && fd.get('vatRegistered') === 'on';
    const data = {
      role: fd.get('role') === 'client' ? 'client' : 'contractor',
      name: fd.get('name').trim(),
      address: fd.get('address').trim(),
      clientName: fd.get('clientName').trim(),
      clientAddress: fd.get('clientAddress').trim(),
      counterpartyType,
      eik: isCompany ? fd.get('eik').trim() : '',
      vatRegistered: vatOn,
      vatNumber: vatOn ? fd.get('vatNumber').trim() : '',
      egn: !isCompany ? fd.get('egn').trim() : '',
      advanceMode: fd.get('advanceMode') === 'percent' ? 'percent' : 'amount',
      advanceAmount: parseFloat(fd.get('advanceAmount')) || 0,
      advancePercent: parseFloat(fd.get('advancePercent')) || 0,
      advanceMethod: fd.get('advanceMethod') === 'exhaust' ? 'exhaust' : 'proportional',
    };
    if (!data.name || !data.clientName) return;
    await onSubmit(data);
  });
}

export async function newSiteView() {
  return {
    html: layout({ title: 'Нов обект', back: '/sites', body: siteFormHtml(null, 'Запази обекта', 0) }),
    mount(app) {
      wireSiteForm(
        app,
        async (data) => {
          const site = { id: uid(), ...data, createdAt: Date.now() };
          await db.put('sites', site);
          toast('Обектът е запазен');
          navigate(`/sites/${site.id}`);
        },
        0
      );
    },
  };
}

export async function editSiteView({ id }) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const positions = await db.getAllByIndex('positions', 'siteId', id);
  const boqValue = positions.reduce((sum, p) => sum + (Number(p.plannedQty) || 0) * (Number(p.unitPrice) || 0), 0);

  return {
    html: layout({ title: 'Редакция на обект', back: `/sites/${id}`, body: siteFormHtml(site, 'Запази промените', boqValue) }),
    mount(app) {
      wireSiteForm(
        app,
        async (data) => {
          await db.put('sites', { ...site, ...data });
          toast('Промените са запазени');
          navigate(`/sites/${id}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        },
        boqValue
      );
    },
  };
}
