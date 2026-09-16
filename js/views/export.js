import { db, uid, today } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, fmtNum, fmtDate, toast } from '../utils/util.js';
import { exportPdf, exportXlsx, sharePdf, shareXlsx, gatherData, computeTotals, resolveParties, advancePlan } from '../utils/exporters.js';
import { groupEntriesIntoReports, reportTotal } from '../utils/reports.js';

export async function exportView({ id }) {
  const site = await db.get('sites', id);
  if (!site) return { html: layout({ title: 'Не е намерено', back: '/sites', body: '<p>Обектът не съществува.</p>' }) };

  const positions = await db.getAllByIndex('positions', 'siteId', id);
  const posById = new Map(positions.map((p) => [p.id, p]));
  const entries = await db.getAllByIndex('entries', 'siteId', id);
  let acts = [];
  try {
    acts = await db.getAllByIndex('acts', 'siteId', id);
  } catch (err) {
    // старa база без таблица за актове — екранът трябва да работи и тогава
    console.error('acts store unavailable', err);
  }
  acts.sort((a, b) => (a.no || 0) - (b.no || 0));

  // Отчитанията, които вече са влезли в издаден акт, не се предлагат втори път.
  const actuated = new Set();
  for (const a of acts) for (const eid of a.entryIds || []) actuated.add(eid);

  // Ако в този обект няма нищо, казваме къде всъщност са отчитанията,
  // вместо да оставяме потребителя пред празен екран.
  let elsewhere = '';
  if (!entries.length) {
    const everyEntry = await db.getAll('entries');
    if (everyEntry.length) {
      const allSites = await db.getAll('sites');
      const nameById = new Map(allSites.map((x) => [x.id, x.name]));
      const counts = new Map();
      for (const e of everyEntry) counts.set(e.siteId, (counts.get(e.siteId) || 0) + 1);
      const others = [...counts.entries()].filter(([sid]) => sid !== id);
      if (others.length) {
        elsewhere =
          '<br><span class="muted small">Отчитания има в: ' +
          others
            .map(([sid, n]) =>
              nameById.has(sid)
                ? `<a href="#/sites/${sid}/export">${escapeHtml(nameById.get(sid))}</a> (${n})`
                : `обект, който вече е изтрит (${n})`
            )
            .join(', ') +
          '.</span>';
      }
    } else {
      elsewhere = '<br><span class="muted small">В приложението още няма нито едно отчитане.</span>';
    }
  }

  const allReports = groupEntriesIntoReports(entries);
  const numberByKey = new Map(allReports.map((g, i) => [g.key, i + 1]));
  const reports = allReports
    .map((g) => {
      // Едно отчитане може да е влязло в акт само частично — останалите му
      // редове са това, което още може да се актува.
      const open = g.entries.filter((e) => !actuated.has(e.id));
      const openGroup = { ...g, entries: open };
      return {
        ...g,
        no: numberByKey.get(g.key),
        openEntries: open,
        value: reportTotal(openGroup, posById),
        fullValue: reportTotal(g, posById),
        done: open.length === 0,
        partial: open.length > 0 && open.length < g.entries.length,
      };
    })
    .reverse();

  const openReports = reports.filter((r) => !r.done);
  const nextNo = acts.reduce((max, a) => Math.max(max, Number(a.no) || 0), 0) + 1;

  // Редовете на едно отчитане — за да се вижда какво точно се включва в акта.
  const entryLine = (e, used = false) => {
    const p = posById.get(e.positionId);
    const unit = p ? p.unit || '' : '';
    const value = (p ? Number(p.unitPrice) || 0 : 0) * (Number(e.qty) || 0);
    const detail =
      e.coats && e.coats > 1
        ? `${fmtNum(e.baseQty)} ${escapeHtml(unit)} × ${e.coats} ръце`
        : e.factorA != null
        ? `${fmtNum(e.factorA)} ${escapeHtml(e.unitA || '')} × ${fmtNum(e.factorB)} ${escapeHtml(e.unitB || '')}`
        : '';
    return `
      <div class="act-line${used ? ' used' : ''}">
        <span class="act-line-desc">${escapeHtml(p ? p.description : 'Изтрита позиция')}${used ? ' · вече актувано' : ''}</span>
        <span class="muted small act-line-qty">${fmtNum(e.qty)} ${escapeHtml(unit)}${value ? ' · ' + fmtNum(value) + ' €' : ''}</span>
        ${detail ? `<span class="muted small act-line-detail">${detail}</span>` : ''}
      </div>
    `;
  };

  const reportRow = (r) => {
    const shown = r.done ? r.entries : r.openEntries;
    const first = shown[0] || r.entries[0] || {};
    const firstPos = posById.get(first.positionId);
    const preview = firstPos
      ? escapeHtml(firstPos.description) + (shown.length > 1 ? ` и още ${shown.length - 1}` : '')
      : '';
    const state = r.done
      ? ' · вече актувано'
      : r.partial
      ? ` · частично актувано (остават ${shown.length} от ${r.entries.length})`
      : '';
    return `
    <div class="card act-report-card${r.done ? ' used' : ''}" data-report-card="${escapeHtml(r.key)}">
      <div class="act-report-head">
        <label class="act-report-pick">
          <input type="checkbox" class="report-pick" value="${escapeHtml(r.key)}" ${r.done ? 'disabled' : 'checked'} />
          <span class="act-report-text">
            <strong class="small">Отчитане №${r.no} · ${fmtDate(r.date)}</strong>
            <span class="muted small">${shown.length} ${shown.length === 1 ? 'работа' : 'работи'} · ${fmtNum(r.done ? r.fullValue : r.value)} €${state}</span>
            ${preview ? `<span class="muted small">${preview}</span>` : ''}
          </span>
        </label>
        <button type="button" class="act-report-toggle" aria-label="Покажи съдържанието">▸</button>
      </div>
      <div class="act-report-body" hidden>
        ${r.entries.map((e) => entryLine(e, actuated.has(e.id))).join('')}
        ${first.technician ? `<div class="muted small">Отчел: ${escapeHtml(first.technician)}</div>` : ''}
        ${first.note ? `<div class="muted small">Бележка: ${escapeHtml(first.note)}</div>` : ''}
      </div>
    </div>
  `;
  };

  const actsHtml = acts.length
    ? acts
        .slice()
        .reverse()
        .map(
          (a) => `
        <div class="card act-card">
          <div class="site-card-top">
            <strong class="small">Акт № ${escapeHtml(String(a.no))} · ${fmtDate(a.date)}</strong>
            <span class="muted small">${fmtNum(a.due)} €</span>
          </div>
          <div class="muted small">${(a.entryIds || []).length} реда · СМР ${fmtNum(a.subtotal)} €${a.advance ? ' · аванс -' + fmtNum(a.advance) + ' €' : ''}</div>
          ${a.handedBy || a.acceptedBy ? `<div class="muted small">${a.handedBy ? 'Предал: ' + escapeHtml(a.handedBy) : ''}${a.handedBy && a.acceptedBy ? ' · ' : ''}${a.acceptedBy ? 'Приел: ' + escapeHtml(a.acceptedBy) : ''}</div>` : ''}
          <div class="quick-actions">
            <button type="button" class="btn btn-primary btn-sm" data-act-share="${a.id}">📤 Изпрати</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act-pdf="${a.id}">⬇️ PDF</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act-xlsx="${a.id}">⬇️ Excel</button>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-act-del="${a.id}">🗑 Изтрий</button>
          </div>
        </div>
      `
        )
        .join('')
    : '<div class="muted small">Още няма издадени актове по този обект.</div>';

  const body = `
    <div class="site-header">
      <h2>${escapeHtml(site.name)}</h2>
      <div class="muted small">Акт Образец 19 — избери кои отчитания влизат в акта</div>
      <div class="muted small" id="advance-info"></div>
    </div>

    <form id="export-form" class="form">
      <h3 class="section-title">Отчитания ${openReports.length ? `(${openReports.length} неактувани)` : ''}</h3>
      ${reports.length
        ? reports.map(reportRow).join('')
        : `<div class="empty">Няма отчитания по този обект.<br><span class="muted small">Първо отчети извършени работи, после се връщаш тук да издадеш акт.</span>${elsewhere}<br><a class="btn btn-primary btn-sm" href="#/sites/${id}/report">📝 Отчети изпълнени работи</a></div>`}
      ${reports.length ? `<div class="quick-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="pick-all">Избери всички</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pick-none">Изчисти</button>
      </div>` : ''}

      <h3 class="section-title">Количествена сметка на акта <span id="boq-count" class="muted"></span></h3>
      <div class="muted small">Сглобява се от отчетените СМР. Махни отметка на ред, за да го оставиш за следващ акт.</div>
      <div id="act-boq"></div>
      <div class="price-notice" id="price-warning" hidden></div>

      <h3 class="section-title">Акт</h3>
      <div class="form-row">
        <label>Акт №
          <input type="number" step="1" min="1" name="actNo" value="${nextNo}" />
        </label>
        <label>Дата на акта
          <input type="date" name="actDate" value="${today()}" />
        </label>
      </div>

      <div class="form-row">
        <label>Предал — за изпълнителя
          <input name="handedBy" placeholder="Име и фамилия" />
        </label>
        <label>Приел — за възложителя
          <input name="acceptedBy" placeholder="Име и фамилия" />
        </label>
      </div>

      <label>Приспадане на аванс за този акт (€)
        <input type="number" step="any" inputmode="decimal" name="advance" placeholder="0" />
      </label>
      <div class="muted small" id="advance-hint"></div>

      <table class="summary-table" id="summary-table">
        <tr><td>Стойност на СМР</td><td id="sum-subtotal">0.00 €</td></tr>
        <tr><td>Приспаднат аванс</td><td id="sum-advance">0.00 €</td></tr>
        <tr><td>Данъчна основа</td><td id="sum-base">0.00 €</td></tr>
        <tr><td>ДДС (20%)</td><td id="sum-vat">0.00 €</td></tr>
        <tr class="total"><td>Дължимо за плащане</td><td id="sum-due">0.00 €</td></tr>
      </table>

      <button type="button" id="make-act" class="btn btn-primary">📄 Състави акт и изпрати</button>
      <button type="button" id="make-xlsx" class="btn btn-ghost">⬇️ Изтегли Excel</button>
    </form>

    <h3 class="section-title">Издадени актове ${acts.length ? `(${acts.length})` : ''}</h3>
    ${actsHtml}
  `;

  return {
    html: layout({ title: 'Акт Образец 19', back: `/sites/${id}`, body }),
    mount(app) {
      const form = app.querySelector('#export-form');
      const advanceInput = form.querySelector('[name=advance]');
      const advanceHint = app.querySelector('#advance-hint');
      const advanceInfo = app.querySelector('#advance-info');
      const makeActBtn = app.querySelector('#make-act');
      let advanceTouched = false;
      advanceInput.addEventListener('input', () => {
        advanceTouched = true;
      });

      const reportByKey = new Map(reports.map((r) => [r.key, r]));

      // От кои отчитания идва всяка позиция — за да е ясно откъде е дошъл редът.
      const reportsByPosition = new Map();
      for (const r of reports) {
        for (const e of r.openEntries) {
          if (!reportsByPosition.has(e.positionId)) reportsByPosition.set(e.positionId, []);
          const list = reportsByPosition.get(e.positionId);
          const label = `Отчитане №${r.no}`;
          if (!list.includes(label)) list.push(label);
        }
      }

      // Позиции, оставени за следващ акт — редът си стои в списъка, но не влиза в акта.
      const excluded = new Set();

      // Всичко отчетено в маркираните отчитания — кандидатите за количествената сметка.
      function candidateEntryIds() {
        const ids = [];
        form.querySelectorAll('.report-pick:checked').forEach((cb) => {
          const r = reportByKey.get(cb.value);
          if (r) for (const e of r.openEntries) ids.push(e.id);
        });
        return ids;
      }

      // Вече актуваното определя колко аванс е усвоен преди този акт.
      const priorActuatedValue = acts.reduce((sum, a) => sum + (Number(a.subtotal) || 0), 0);

      let lastState = null;
      const boqEl = app.querySelector('#act-boq');
      const boqCountEl = app.querySelector('#boq-count');
      const priceWarnEl = app.querySelector('#price-warning');

      // Количествената сметка на акта — редовете идват от отчетените СМР,
      // събрани по позиция. Всеки ред може да се остави за следващ акт.
      function renderBoq(rows) {
        const included = rows.filter((r) => !excluded.has(r.position.id));
        boqCountEl.textContent = rows.length ? `(${included.length} от ${rows.length})` : '';
        if (!rows.length) {
          boqEl.innerHTML =
            '<div class="muted small">Няма избрани отчитания — количествената сметка на акта е празна.</div>';
          return;
        }
        let total = 0;
        let n = 0;
        let missingPrice = 0;
        boqEl.innerHTML =
          rows
            .map((r) => {
              const off = excluded.has(r.position.id);
              if (!off) {
                total += r.value;
                n += 1;
              }
              const from = (reportsByPosition.get(r.position.id) || []).join(', ');
              const noPrice = !r.unitPrice;
              if (noPrice && !off) missingPrice++;
              return `
              <label class="boq-row${off ? ' off' : ''}${noPrice ? ' no-price' : ''}">
                <input type="checkbox" class="boq-pick" value="${escapeHtml(r.position.id)}" ${off ? '' : 'checked'} />
                <span class="boq-no">${off ? '—' : n}</span>
                <span class="boq-body">
                  <span class="boq-desc">${escapeHtml(r.position.code ? r.position.code + ' · ' : '')}${escapeHtml(r.position.description)}</span>
                  <span class="muted small">${fmtNum(r.qty)} ${escapeHtml(r.position.unit || '')}${noPrice ? '' : ' × ' + fmtNum(r.unitPrice) + ' €'}${from ? ' · от ' + from : ''}</span>
                  ${noPrice ? `<span class="price-fix">
                      <span class="price-warn">Няма единична цена</span>
                      <input type="number" step="any" inputmode="decimal" class="boq-price" data-pos="${escapeHtml(r.position.id)}" placeholder="€ / ${escapeHtml(r.position.unit || '')}" />
                    </span>` : ''}
                </span>
                <span class="boq-value">${fmtNum(r.value)} €</span>
              </label>`;
            })
            .join('') +
          `<div class="boq-row boq-total"><span class="boq-no"></span><span class="boq-body"><strong>Общо</strong></span><span class="boq-value"><strong>${fmtNum(total)} €</strong></span></div>`;

        boqEl.querySelectorAll('.boq-pick').forEach((cb) => {
          cb.addEventListener('change', () => {
            if (cb.checked) excluded.delete(cb.value);
            else excluded.add(cb.value);
            refreshSummary();
          });
        });

        // Цената се въвежда на място — иначе актът излиза с нули и не е ясно защо.
        boqEl.querySelectorAll('.boq-price').forEach((inp) => {
          inp.addEventListener('click', (e) => e.preventDefault());
          inp.addEventListener('change', async () => {
            const price = parseFloat(inp.value) || 0;
            if (!price) return;
            const position = await db.get('positions', inp.getAttribute('data-pos'));
            if (!position) return;
            await db.put('positions', { ...position, unitPrice: price });
            toast('Цената е записана в количествената сметка');
            refreshSummary();
          });
        });

        priceWarnEl.hidden = missingPrice === 0;
        priceWarnEl.textContent = missingPrice
          ? `${missingPrice} ${missingPrice === 1 ? 'позиция е' : 'позиции са'} без единична цена — затова сумите излизат непълни. Въведи цената в реда и тя се записва в количествената сметка.`
          : '';
      }

      async function refreshSummary() {
        const candidates = candidateEntryIds();
        const data = await gatherData(id, { entryIds: candidates });
        // Екранът може да е презареден, докато четем от базата — тогава няма какво да обновяваме.
        if (!form.isConnected) return lastState || { entryIds: [], totals: null, advance: 0 };
        const { myCompany, rows: allRows, boqValue } = data;
        const { izpalnitel } = resolveParties(site, myCompany);

        // В акта влизат само редовете с отметка; останалите чакат следващ акт.
        const rows = allRows.filter((r) => !excluded.has(r.position.id));
        const candidateSet = new Set(candidates);
        const entryIds = entries
          .filter((e) => candidateSet.has(e.id) && !excluded.has(e.positionId))
          .map((e) => e.id);
        const periodValue = rows.reduce((sum, r) => sum + r.value, 0);
        const plan = advancePlan(site, { boqValue, periodValue, priorValue: priorActuatedValue });

        if (!advanceTouched) advanceInput.value = plan.suggested ? plan.suggested.toFixed(2) : '';

        advanceInfo.textContent = plan.total
          ? plan.mode === 'percent'
            ? `Аванс по обекта: ${plan.pct}% от ${fmtNum(boqValue)} € = ${fmtNum(plan.total)} €`
            : `Аванс по обекта: ${fmtNum(plan.total)} €`
          : '';
        advanceHint.textContent = plan.total
          ? `${plan.method === 'proportional' ? 'Пропорционално приспадане' : 'Приспадане до усвояване'} · усвоен в предишни актове: ${fmtNum(plan.usedBefore)} € · предложено сега: ${fmtNum(plan.suggested)} € · остатък: ${fmtNum(plan.remaining)} €`
          : '';

        renderBoq(allRows);

        const advance = parseFloat(advanceInput.value) || 0;
        const totals = computeTotals(rows, izpalnitel.vatRegistered, advance);
        app.querySelector('#sum-subtotal').textContent = fmtNum(totals.subtotal) + ' €';
        app.querySelector('#sum-advance').textContent = (totals.advance ? '- ' : '') + fmtNum(totals.advance) + ' €';
        app.querySelector('#sum-base').textContent = fmtNum(totals.taxBase) + ' €';
        app.querySelector('#sum-vat').textContent = fmtNum(totals.vat) + ' €';
        app.querySelector('#sum-due').textContent = fmtNum(totals.due) + ' €';

        lastState = { entryIds, totals, advance };
        makeActBtn.disabled = !entryIds.length;
        return lastState;
      }

      form.addEventListener('input', refreshSummary);
      form.addEventListener('change', refreshSummary);
      refreshSummary();

      app.querySelectorAll('.act-report-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const card = btn.closest('.act-report-card');
          const body = card.querySelector('.act-report-body');
          body.hidden = !body.hidden;
          btn.textContent = body.hidden ? '▸' : '▾';
        });
      });

      const pickAll = app.querySelector('#pick-all');
      const pickNone = app.querySelector('#pick-none');
      if (pickAll)
        pickAll.addEventListener('click', () => {
          form.querySelectorAll('.report-pick:not([disabled])').forEach((cb) => (cb.checked = true));
          refreshSummary();
        });
      if (pickNone)
        pickNone.addEventListener('click', () => {
          form.querySelectorAll('.report-pick').forEach((cb) => (cb.checked = false));
          refreshSummary();
        });

      function actMeta() {
        const fd = new FormData(form);
        return {
          actNo: parseInt(fd.get('actNo'), 10) || nextNo,
          actDate: fd.get('actDate') || today(),
          handedBy: (fd.get('handedBy') || '').trim(),
          acceptedBy: (fd.get('acceptedBy') || '').trim(),
        };
      }

      makeActBtn.addEventListener('click', async () => {
        const state = await refreshSummary();
        if (!state.entryIds.length) {
          toast('Избери поне едно отчитане');
          return;
        }
        const { actNo, actDate, handedBy, acceptedBy } = actMeta();
        const reportKeys = [...form.querySelectorAll('.report-pick:checked')].map((cb) => cb.value);
        toast('Генериране на акта…');
        try {
          await db.put('acts', {
            id: uid(),
            siteId: id,
            no: actNo,
            date: actDate,
            handedBy,
            acceptedBy,
            entryIds: state.entryIds,
            reportKeys,
            advance: state.advance,
            subtotal: state.totals.subtotal,
            taxBase: state.totals.taxBase,
            vat: state.totals.vat,
            due: state.totals.due,
            createdAt: Date.now(),
          });
          const how = await sharePdf(id, { entryIds: state.entryIds, advance: state.advance, actNo, actDate, handedBy, acceptedBy });
          toast(
            how === 'shared'
              ? `Акт № ${actNo} е издаден и изпратен`
              : how === 'cancelled'
              ? `Акт № ${actNo} е издаден`
              : `Акт № ${actNo} е издаден и свален`
          );
          navigate();
        } catch (err) {
          console.error(err);
          alert('Актът не беше съставен.\n\n' + String((err && err.message) || err));
        }
      });

      app.querySelector('#make-xlsx').addEventListener('click', async () => {
        const state = await refreshSummary();
        if (!state.entryIds.length) {
          toast('Избери поне едно отчитане');
          return;
        }
        const { actNo, actDate, handedBy, acceptedBy } = actMeta();
        try {
          await exportXlsx(id, { entryIds: state.entryIds, advance: state.advance, actNo, actDate, handedBy, acceptedBy });
        } catch (err) {
          console.error(err);
          toast('Грешка при износ');
        }
      });

      function navigate() {
        window.location.hash = `#/sites/${id}/export`;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }

      app.querySelectorAll('[data-act-share]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const act = acts.find((a) => a.id === btn.getAttribute('data-act-share'));
          if (!act) return;
          btn.disabled = true;
          try {
            const how = await sharePdf(id, {
              entryIds: act.entryIds,
              advance: act.advance,
              actNo: act.no,
              actDate: act.date,
            });
            if (how === 'downloaded') toast('Устройството не поддържа изпращане — файлът е свален');
          } catch (err) {
            console.error(err);
            toast('Изпращането се провали');
          }
          btn.disabled = false;
        });
      });

      app.querySelectorAll('[data-act-pdf]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const act = acts.find((a) => a.id === btn.getAttribute('data-act-pdf'));
          if (!act) return;
          toast('Генериране…');
          await exportPdf(id, { entryIds: act.entryIds, advance: act.advance, actNo: act.no, actDate: act.date, handedBy: act.handedBy, acceptedBy: act.acceptedBy });
        });
      });
      app.querySelectorAll('[data-act-xlsx]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const act = acts.find((a) => a.id === btn.getAttribute('data-act-xlsx'));
          if (!act) return;
          await exportXlsx(id, { entryIds: act.entryIds, advance: act.advance, actNo: act.no, actDate: act.date, handedBy: act.handedBy, acceptedBy: act.acceptedBy });
        });
      });
      app.querySelectorAll('[data-act-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const act = acts.find((a) => a.id === btn.getAttribute('data-act-del'));
          if (!act) return;
          if (!confirm(`Изтриване на Акт № ${act.no}? Отчитанията в него ще станат отново налични за актуване.`)) return;
          await db.delete('acts', act.id);
          toast('Актът е изтрит');
          navigate();
        });
      });
    },
  };
}
