import { db, uid, today } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, fmtDate, toast, getSetting, setSetting, fileToCompressedBlob } from '../utils/util.js';
import { pickerHtml, wirePicker } from '../utils/picker.js';
import { groupEntriesIntoReports, reportCardHtml, wireReportCards } from '../utils/reports.js';
import { navigate } from '../router.js';
import { getPeople, personFieldHtml, wirePersonField, rememberPerson } from '../utils/people.js';
import { SMR_CATALOG, SMR_CATEGORY_ORDER, OTHER_CATEGORY, categoryForDescription, resolveCategory, keywordsFor } from '../data/smrCatalog.js';

export async function batchReportView({ id }, query) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const positions = await db.getAllByIndex('positions', 'siteId', id);
  const date = (query && query.date) || today();
  const allEntries = await db.getAllByIndex('entries', 'siteId', id);
  const doneByPos = new Map();
  for (const e of allEntries) {
    doneByPos.set(e.positionId, (doneByPos.get(e.positionId) || 0) + (Number(e.qty) || 0));
  }
  const posById = new Map(positions.map((p) => [p.id, p]));

  function remainingOf(p) {
    const planned = Number(p.plannedQty) || 0;
    if (!planned) return null;
    return Math.max(0, planned - (doneByPos.get(p.id) || 0));
  }

  // Всяко „Потвърди“ прави едно отчитане; тук показваме готовите отчитания за деня.
  const allReports = groupEntriesIntoReports(allEntries);
  const numberByKey = new Map(allReports.map((g, i) => [g.key, i + 1]));
  const dayReports = allReports.filter((g) => g.date === date);
  const openKey = (query && query.open) || '';

  const photoCounts = new Map();
  for (const g of dayReports) {
    let max = 0;
    for (const e of g.entries) {
      const photos = await db.getAllByIndex('photos', 'entryId', e.id);
      if (photos.length > max) max = photos.length;
    }
    photoCounts.set(g.key, max);
  }

  let dayTotal = 0;
  for (const g of dayReports) {
    for (const e of g.entries) {
      const p = posById.get(e.positionId);
      dayTotal += (p ? Number(p.unitPrice) || 0 : 0) * (Number(e.qty) || 0);
    }
  }
  const dayRowsHtml = dayReports
    .map((g) =>
      reportCardHtml(g, {
        posById,
        index: numberByKey.get(g.key),
        open: g.reportId === openKey || dayReports.length === 1,
        showDate: false,
        photoCount: photoCounts.get(g.key) || 0,
      })
    )
    .join('');

  // ---- Каталог за избор: позициите от КС + пълният каталог на СМР ----
  const takenDescriptions = new Set(positions.map((p) => (p.description || '').trim().toLowerCase()));
  const byCategory = new Map();
  function push(cat, item) {
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item);
  }
  for (const p of positions) {
    const rem = remainingOf(p);
    push(resolveCategory(p), {
      key: 'pos:' + p.id,
      description: p.description,
      unit: p.unit || '',
      highlight: true,
      note: 'в КС' + (rem != null ? ` · остават ${fmtNum(rem)} ${p.unit || ''}` : '') + (p.unitPrice ? ` · ${fmtNum(p.unitPrice)} €/${p.unit || ''}` : ''),
    });
  }
  SMR_CATALOG.forEach((item, i) => {
    if (takenDescriptions.has(item.description.trim().toLowerCase())) return;
    push(item.category, { key: 'cat:' + i, description: item.description, unit: item.unit, note: 'нова позиция' });
  });
  const known = SMR_CATEGORY_ORDER.filter((c) => byCategory.has(c));
  const extraCats = [...byCategory.keys()].filter((c) => !SMR_CATEGORY_ORDER.includes(c) && c !== OTHER_CATEGORY).sort();
  const orderedCats = [...known, ...extraCats, ...(byCategory.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : [])];
  const groups = orderedCats.map((cat) => {
    const items = (byCategory.get(cat) || []).slice();
    items.sort((a, b) => (a.highlight === b.highlight ? 0 : a.highlight ? -1 : 1));
    return { cat, items: items.map((it) => ({ ...it, keywords: keywordsFor(cat) })) };
  });
  const totalPickable = groups.reduce((n, g) => n + g.items.length, 0);
  const pickerMarkup = pickerHtml(groups);

  // Ако за избраната дата няма нищо, но има на други — казваме го, вместо да мълчим.
  const otherDates = [...new Set(allReports.map((g) => g.date))].filter((d) => d !== date).sort();
  const latestOther = otherDates[otherDates.length - 1];
  let otherDatesHint =
    !dayReports.length && latestOther
      ? `<br>Има отчитания на друга дата — последното е <a href="#/sites/${id}/report?date=${latestOther}">${fmtDate(latestOther)}</a>${otherDates.length > 1 ? ` (общо ${otherDates.length} дати)` : ''}.`
      : '';

  // Нито едно отчитане в този обект — казваме къде са тогава.
  if (!allEntries.length) {
    const everyEntry = await db.getAll('entries');
    if (everyEntry.length) {
      const allSites = await db.getAll('sites');
      const nameById = new Map(allSites.map((x) => [x.id, x.name]));
      const counts = new Map();
      for (const e of everyEntry) counts.set(e.siteId, (counts.get(e.siteId) || 0) + 1);
      const others = [...counts.entries()].filter(([sid]) => sid !== id);
      if (others.length) {
        const list = others
          .map(([sid, n]) =>
            nameById.has(sid)
              ? `<a href="#/sites/${sid}/report">${escapeHtml(nameById.get(sid))}</a> (${n})`
              : `изтрит обект (${n})`
          )
          .join(', ');
        otherDatesHint = `<br>В този обект няма нито едно отчитане. Отчитания има в: ${list}.`;
      }
    } else {
      otherDatesHint = '<br>В приложението още няма нито едно отчитане.';
    }
  }

  const people = await getPeople();
  const technicianLabel = site.role === 'client' ? 'Отчита (за Възложителя)' : 'Отчита (за Изпълнителя)';

  const body = `
    <div class="site-header">
      <h2>${escapeHtml(site.name)}</h2>
      <div class="muted small">Отчитане за ${fmtDate(date)}</div>
    </div>

    <form id="date-form" class="form form-inline">
      <label>Дата на отчитане
        <input type="date" name="date" value="${escapeHtml(date)}" />
      </label>
      <button type="submit" class="btn btn-ghost">Смени</button>
    </form>

    <h3 class="section-title">Вече отчетено за ${fmtDate(date)} ${dayReports.length ? `(${dayReports.length})` : ''}</h3>
    ${dayReports.length
      ? `${dayRowsHtml}${dayTotal ? `<div class="muted small">Общо за деня: <strong>${fmtNum(dayTotal)} €</strong></div>` : ''}`
      : `<div class="muted small">Няма отчитане за ${fmtDate(date)}. Въведи първата работа по-долу.${otherDatesHint}</div>`}

    <form id="batch-form" class="form">
      <h3 class="section-title">Ново отчитане <span id="rows-count" class="muted"></span></h3>
      <div id="rows-container"></div>
      <button type="button" id="add-row-btn" class="btn btn-add-more">+ Добави още СМР</button>

      ${personFieldHtml({ label: technicianLabel, list: people.list, last: people.last })}
      <label>Бележка
        <textarea name="note" rows="2" placeholder="незадължително — важи за всички редове"></textarea>
      </label>
      <div class="photo-section">
        <div class="site-card-top"><span>Снимки като доказателство</span></div>
        <div id="photo-list" class="thumbs"></div>
        <button type="button" id="add-photo-btn" class="btn btn-ghost">📷 Добави снимка</button>
        <input type="file" id="photo-input" accept="image/*" capture="environment" hidden />
      </div>
      <div class="muted small" id="new-total"></div>
      <button type="submit" class="btn btn-primary">Потвърди</button>
    </form>
  `;

  return {
    html: layout({ title: 'Отчитане на СМР', back: `/sites/${id}`, body }),
    mount(app) {
      const dateForm = app.querySelector('#date-form');
      const goToDate = (d) => {
        if (!d || d === date) return;
        navigate(`/sites/${id}/report?date=${d}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      };
      dateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        goToDate(new FormData(e.target).get('date'));
      });
      // Смяната на датата важи веднага — иначе работите се записват под старата.
      dateForm.querySelector('[name=date]').addEventListener('change', (e) => goToDate(e.target.value));

      const reload = () => {
        navigate(`/sites/${id}/report?date=${date}`);
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
          const group = dayReports.find((g) => g.key === key);
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

      const readPerson = wirePersonField(app);

      const rowsContainer = app.querySelector('#rows-container');
      const rowsCountEl = app.querySelector('#rows-count');
      const newTotalEl = app.querySelector('#new-total');

      // Какво е избрано в реда: позиция от КС, вид от каталога или ръчно въведена работа.
      function rowTarget(rowEl) {
        const key = rowEl.dataset.key;
        if (!key) return null;
        const priceEl = rowEl.querySelector('.row-price');
        const unitEl = rowEl.querySelector('.row-unit');
        if (key.startsWith('pos:')) return posById.get(key.slice(4)) || null;
        if (key.startsWith('cat:')) {
          const item = SMR_CATALOG[Number(key.slice(4))];
          if (!item) return null;
          return {
            id: null,
            isNew: true,
            description: item.description,
            unit: item.unit,
            category: item.category,
            unitPrice: priceEl ? parseFloat(priceEl.value) || 0 : 0,
            plannedQty: 0,
          };
        }
        const description = rowEl.dataset.manualDesc || '';
        return {
          id: null,
          isNew: true,
          description,
          unit: unitEl ? unitEl.value.trim() : '',
          category: categoryForDescription(description) || OTHER_CATEGORY,
          unitPrice: priceEl ? parseFloat(priceEl.value) || 0 : 0,
          plannedQty: 0,
        };
      }

      function rowQty(rowEl) {
        const p = rowTarget(rowEl);
        if (!p) return { qty: 0, base: 0, coats: 1, position: null };
        if ((p.unit || '').includes('/')) {
          const a = parseFloat(rowEl.querySelector('.row-factorA').value) || 0;
          const b = parseFloat(rowEl.querySelector('.row-factorB').value) || 0;
          return { qty: a * b, base: a * b, coats: 1, position: p, a, b };
        }
        const qtyEl = rowEl.querySelector('.row-qty');
        const coatsEl = rowEl.querySelector('.row-coats');
        const base = qtyEl ? parseFloat(qtyEl.value) || 0 : 0;
        const coats = coatsEl ? Math.max(1, parseFloat(coatsEl.value) || 1) : 1;
        return { qty: base * coats, base, coats, position: p };
      }

      function refreshSummary() {
        const n = rowsContainer.children.length;
        rowsCountEl.textContent = n > 1 ? `(${n})` : '';
        let total = 0;
        rowsContainer.querySelectorAll('.work-row').forEach((rowEl) => {
          const { qty, position } = rowQty(rowEl);
          if (position) total += qty * (Number(position.unitPrice) || 0);
        });
        newTotalEl.textContent = total ? `Обща стойност на отчитането: ${fmtNum(total)} €` : '';
      }

      function renderFields(rowEl) {
        const fieldsEl = rowEl.querySelector('.row-fields');
        const p = rowTarget(rowEl);
        if (!p) {
          fieldsEl.innerHTML = '';
          fieldsEl.hidden = true;
          refreshSummary();
          return;
        }
        const manual = rowEl.dataset.key.startsWith('man:');
        const compound = (p.unit || '').includes('/');
        const unitHtml = manual
          ? `<label>Мярка *
               <input type="text" class="row-unit" value="${escapeHtml(p.unit)}" placeholder="м2, м3, бр, м, кг" />
             </label>`
          : '';
        const priceHtml = p.isNew
          ? `<label>Единична цена (€${p.unit && !manual ? ' / ' + escapeHtml(p.unit) : ''})
               <input type="number" step="any" inputmode="decimal" class="row-price" placeholder="0" />
             </label>`
          : '';
        const qtyHtml = compound
          ? (() => {
              const [unitA, unitB] = p.unit.split('/').map((s) => s.trim());
              return `
                <div class="form-row">
                  <label>Количество (${escapeHtml(unitA)}) *
                    <input type="number" step="any" inputmode="decimal" class="row-factorA" placeholder="0" />
                  </label>
                  <label>Добавка (${escapeHtml(unitB)}) *
                    <input type="number" step="any" inputmode="decimal" class="row-factorB" placeholder="0" />
                  </label>
                </div>`;
            })()
          : `
              <div class="form-row">
                <label>Количество${p.unit && !manual ? ' (' + escapeHtml(p.unit) + ')' : ''} *
                  <input type="number" step="any" inputmode="decimal" class="row-qty" placeholder="0" />
                </label>
                <label>Ръце / пластове
                  <input type="number" step="1" min="1" inputmode="numeric" class="row-coats" value="1" />
                </label>
              </div>`;

        fieldsEl.innerHTML = `${unitHtml}${qtyHtml}${priceHtml}<div class="muted small row-result"></div>`;
        fieldsEl.hidden = false;

        const resultEl = fieldsEl.querySelector('.row-result');
        const update = () => {
          const { qty, base, coats, position } = rowQty(rowEl);
          if (!position) return;
          const parts = [];
          if (coats > 1) parts.push(`${fmtNum(base)} × ${coats} ръце = ${fmtNum(qty)} ${position.unit}`);
          else if ((position.unit || '').includes('/')) parts.push(`= ${fmtNum(qty)} ${position.unit}`);
          if (position.unitPrice) parts.push(`Стойност: ${fmtNum(qty * position.unitPrice)} €`);
          else if (qty) parts.push(`${fmtNum(qty)} ${position.unit} · няма единична цена, стойност няма да се сметне`);
          if (!position.isNew) {
            const rem = remainingOf(position);
            if (rem != null) parts.push(`остават ${fmtNum(rem)} ${position.unit}`);
          }
          resultEl.textContent = parts.join(' · ');
          refreshSummary();
        };
        fieldsEl.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', update));
        update();

        const first = fieldsEl.querySelector('.row-unit, .row-qty, .row-factorA');
        if (first) first.focus({ preventScroll: true });
      }

      function choose(rowEl, key, manualDesc) {
        rowEl.dataset.key = key;
        if (manualDesc) rowEl.dataset.manualDesc = manualDesc;
        const p = rowTarget(rowEl);
        if (!p) return;
        rowEl.querySelector('.pick-box').hidden = true;
        rowEl.querySelector('.row-title').textContent = p.description;
        const chosen = rowEl.querySelector('.row-chosen');
        chosen.hidden = false;
        chosen.querySelector('.chosen-meta').textContent = p.isNew
          ? 'нова позиция — ще се добави в количествената сметка'
          : `${p.unit}${p.unitPrice ? ' · ' + fmtNum(p.unitPrice) + ' €/' + p.unit : ''}`;
        renderFields(rowEl);
      }

      function resetPick(rowEl) {
        delete rowEl.dataset.key;
        delete rowEl.dataset.manualDesc;
        rowEl.querySelector('.row-title').textContent = 'Избери вид СМР';
        rowEl.querySelector('.row-chosen').hidden = true;
        const fieldsEl = rowEl.querySelector('.row-fields');
        fieldsEl.innerHTML = '';
        fieldsEl.hidden = true;
        rowEl.querySelector('.pick-box').hidden = false;
        rowEl.querySelector('.pick-search').value = '';
        rowEl.querySelector('.pick-search').dispatchEvent(new Event('input'));
        rowEl.querySelector('.pick-search').focus({ preventScroll: true });
        refreshSummary();
      }

      function addRow() {
        const rowEl = document.createElement('div');
        rowEl.className = 'card work-row';
        rowEl.innerHTML = `
          <div class="site-card-top">
            <strong class="small row-title">Избери вид СМР</strong>
            <button type="button" class="icon-btn-sm row-remove" aria-label="Махни от отчитането">−</button>
          </div>
          ${pickerMarkup}
          <div class="row-chosen" hidden>
            <div class="muted small chosen-meta"></div>
            <button type="button" class="btn btn-ghost btn-sm row-change">Смени вида СМР</button>
          </div>
          <div class="row-fields" hidden></div>
        `;
        rowsContainer.appendChild(rowEl);

        wirePicker(rowEl, {
          total: totalPickable,
          onPick: (key) => choose(rowEl, key),
          onManual: (text) => choose(rowEl, 'man:' + Date.now(), text),
        });

        rowEl.querySelector('.row-change').addEventListener('click', () => resetPick(rowEl));
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

      app.querySelector('#batch-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const technicianName = readPerson();
        const note = fd.get('note').trim();

        const toSave = [];
        let missingUnit = null;
        rowsContainer.querySelectorAll('.work-row').forEach((rowEl) => {
          const { qty, base, coats, position, a, b } = rowQty(rowEl);
          if (!position || !qty) return;
          if (!position.unit) {
            missingUnit = missingUnit || rowEl;
            return;
          }
          const compound = (position.unit || '').includes('/');
          const extra = compound
            ? (() => {
                const [unitA, unitB] = position.unit.split('/').map((s) => s.trim());
                return { factorA: a, factorB: b, unitA, unitB };
              })()
            : coats > 1
            ? { baseQty: base, coats }
            : {};
          toSave.push({ position, qty, extra });
        });

        if (missingUnit) {
          toast('Попълни мярката на ръчно въведената работа');
          const el = missingUnit.querySelector('.row-unit');
          if (el) el.focus();
          return;
        }
        if (!toSave.length) {
          toast('Няма попълнени количества');
          return;
        }

        // Всички редове от едно „Потвърди“ образуват едно отчитане.
        const reportId = uid();
        // Работите извън количествената сметка стават нови позиции (по една на описание).
        const createdByDesc = new Map();
        let createdCount = 0;
        let savedIds = [];
        try {
        for (const item of toSave) {
          let positionId = item.position.id;
          if (!positionId) {
            const key = item.position.description.trim().toLowerCase();
            if (createdByDesc.has(key)) {
              positionId = createdByDesc.get(key);
            } else {
              positionId = uid();
              await db.put('positions', {
                id: positionId,
                siteId: id,
                code: '',
                description: item.position.description,
                unit: item.position.unit,
                category: item.position.category,
                plannedQty: 0,
                unitPrice: Number(item.position.unitPrice) || 0,
                order: Date.now(),
                createdAt: Date.now(),
              });
              createdByDesc.set(key, positionId);
              createdCount++;
            }
          }
          const entry = {
            id: uid(),
            siteId: id,
            positionId,
            reportId,
            date,
            qty: item.qty,
            note,
            technician: technicianName,
            createdAt: Date.now(),
            ...item.extra,
          };
          await db.put('entries', entry);
          savedIds.push(entry.id);
          for (const blob of photoBlobs) {
            await db.put('photos', { id: uid(), entryId: entry.id, blob, createdAt: Date.now() });
          }
        }
        await rememberPerson(technicianName);

        // Проверяваме, че записаното наистина е в базата — иначе загубата минава незабелязано.
        const check = await db.getAllByIndex('entries', 'siteId', id);
        const stored = new Set(check.map((e) => e.id));
        const missing = savedIds.filter((x) => !stored.has(x));
        if (missing.length) {
          throw new Error(
            `Базата данни не запази ${missing.length} от ${savedIds.length} реда. Възможна причина: браузърът е в частен режим или е свършило мястото.`
          );
        }
        } catch (err) {
          // Досега такъв провал минаваше мълчаливо и работите просто изчезваха.
          console.error('Записът на отчитането се провали', err);
          alert(
            'Отчитането НЕ беше записано.\n\n' +
              String((err && err.message) || err) +
              '\n\nНищо не е загубено — данните са още на екрана. Опитай пак или ми покажи това съобщение.'
          );
          return;
        }
        toast(`Записано отчитане с ${toSave.length} ${toSave.length === 1 ? 'работа' : 'работи'}${createdCount ? ` · ${createdCount} нови позиции в КС` : ''}`);
        navigate(`/sites/${id}/report?date=${date}&open=${reportId}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}
