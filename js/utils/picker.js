// Общ избор на вид СМР: търсене + скрол през целия каталог, с опция за ръчно добавяне.
import { escapeHtml } from './util.js';

export function pickerHtml(groups, { placeholder = 'Търси: армировка, кофраж, боя, замазка...' } = {}) {
  const list = groups
    .map(
      (g) => `
      <div class="pick-group" data-cat="${escapeHtml(g.cat)}">
        <div class="pick-cat">${escapeHtml(g.cat)}</div>
        ${g.items
          .map(
            (it) => `
          <button type="button" class="pick-item${it.highlight ? ' in-boq' : ''}${it.disabled ? ' already' : ''}" data-key="${escapeHtml(it.key)}" data-disabled="${it.disabled ? '1' : ''}" data-desc="${escapeHtml(it.description.toLowerCase())}" data-search="${escapeHtml((it.description + ' ' + g.cat + ' ' + (it.keywords || '')).toLowerCase())}">
            <span class="pick-text">
              <span class="pick-desc">${escapeHtml(it.description)}</span>
              <span class="muted small">${escapeHtml(it.unit || '')}${it.note ? ' · ' + escapeHtml(it.note) : ''}</span>
            </span>
            <span class="pick-sign" aria-hidden="true">${it.disabled ? '✓' : '›'}</span>
          </button>
        `
          )
          .join('')}
      </div>
    `
    )
    .join('');

  return `
    <div class="pick-box">
      <input type="search" class="pick-search" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
      <div class="muted small pick-count"></div>
      <div class="pick-list">${list}</div>
      <div class="pick-empty" hidden>
        <div class="muted small">Няма съвпадения в каталога.</div>
        <button type="button" class="btn btn-ghost btn-sm pick-manual" hidden></button>
      </div>
    </div>
  `;
}

// scopeEl съдържа .pick-search / .pick-count / .pick-list / .pick-empty
export function wirePicker(scopeEl, { total, onPick, onManual, disabledMessage }) {
  const listEl = scopeEl.querySelector('.pick-list');
  const searchEl = scopeEl.querySelector('.pick-search');
  const countEl = scopeEl.querySelector('.pick-count');
  const emptyEl = scopeEl.querySelector('.pick-empty');
  const manualBtn = scopeEl.querySelector('.pick-manual');

  // Търси по думи, без значение на реда им, като описанието е с приоритет пред
  // категорията и синонимите („латекс“ да не вади първо „Шпакловка“). Ако точните
  // думи не дадат резултат, търси по корен („бетониране“ → „бето“ = „Бетон — колони“),
  // и накрая — със «поне една дума», за да не остава празно заради непозната дума.
  const STOP = new Set(['на', 'за', 'и', 'с', 'от', 'по', 'в', 'до']);
  function tokens(q) {
    return q
      .trim()
      .toLowerCase()
      .split(/[\s,.;/—-]+/)
      .filter((t) => t && !STOP.has(t));
  }

  function apply(test) {
    let shown = 0;
    listEl.querySelectorAll('.pick-group').forEach((group) => {
      let visible = 0;
      group.querySelectorAll('.pick-item').forEach((item) => {
        const match = test(item.dataset.search, item.dataset.desc);
        item.hidden = !match;
        if (match) visible++;
      });
      group.hidden = visible === 0;
      shown += visible;
    });
    return shown;
  }

  function filter(q) {
    const words = tokens(q);
    const roots = words.map((w) => (w.length > 4 ? w.slice(0, 4) : w));
    let shown;
    if (!words.length) {
      shown = apply(() => true);
    } else {
      // 1) точно в описанието, 2) и в категорията/синонимите, 3) по корен, 4) поне една дума
      shown = apply((hay, desc) => words.every((w) => desc.includes(w)));
      if (!shown) shown = apply((hay) => words.every((w) => hay.includes(w)));
      if (!shown) shown = apply((hay, desc) => roots.every((w) => desc.includes(w)));
      if (!shown) shown = apply((hay) => roots.every((w) => hay.includes(w)));
      if (!shown && words.length > 1) shown = apply((hay) => roots.some((w) => hay.includes(w)));
    }
    countEl.textContent = words.length ? `${shown} от ${total}` : `${total} вида СМР`;
    emptyEl.hidden = shown > 0;
    if (manualBtn && onManual) {
      const text = searchEl.value.trim();
      manualBtn.hidden = !text;
      manualBtn.textContent = `+ Добави „${text}“ ръчно`;
    }
    if (words.length) listEl.scrollTop = 0;
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pick-item');
    if (!btn) return;
    if (btn.dataset.disabled) {
      if (disabledMessage) disabledMessage();
      return;
    }
    onPick(btn.dataset.key);
  });

  searchEl.addEventListener('input', () => filter(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = listEl.querySelector('.pick-item:not([hidden]):not(.already)');
    if (first) onPick(first.dataset.key);
    else if (onManual && searchEl.value.trim()) onManual(searchEl.value.trim());
  });

  if (manualBtn && onManual) {
    manualBtn.addEventListener('click', () => {
      const text = searchEl.value.trim();
      if (text) onManual(text);
    });
  }

  filter('');
  return { focus: () => searchEl.focus({ preventScroll: true }) };
}
