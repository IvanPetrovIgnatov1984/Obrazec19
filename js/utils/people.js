// Кой отчита: списък с имена, който се пълни сам и се избира от меню.
import { escapeHtml, getSetting, setSetting } from './util.js';

const LIST_KEY = 'reporters';
const LAST_KEY = 'technicianName';
const NEW = '__new__';

export async function getPeople() {
  const list = (await getSetting(LIST_KEY, null)) || [];
  const last = (await getSetting(LAST_KEY, '')) || '';
  return { list: Array.isArray(list) ? list : [], last };
}

export async function savePeople(list) {
  await setSetting(LIST_KEY, list);
}

// Всяко въведено име влиза в списъка — така той се изгражда от само себе си.
export async function rememberPerson(name) {
  const clean = (name || '').trim();
  if (!clean) return;
  await setSetting(LAST_KEY, clean);
  const { list } = await getPeople();
  if (!list.some((n) => n.toLowerCase() === clean.toLowerCase())) {
    await savePeople([...list, clean]);
  }
}

export async function removePerson(name) {
  const { list } = await getPeople();
  await savePeople(list.filter((n) => n !== name));
}

// Меню с имената + възможност да се въведе ново.
export function personFieldHtml({ label, list, last }) {
  const known = list.length > 0;
  const selected = last && list.includes(last) ? last : known ? '' : NEW;
  return `
    <div class="person-field">
      <label>${escapeHtml(label)}
        <select class="person-select" ${known ? '' : 'hidden'}>
          <option value="" ${selected === '' ? 'selected' : ''}>— избери —</option>
          ${list
            .map(
              (n) =>
                `<option value="${escapeHtml(n)}" ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`
            )
            .join('')}
          <option value="${NEW}" ${selected === NEW ? 'selected' : ''}>+ Друго име…</option>
        </select>
      </label>
      <label class="person-new" ${selected === NEW ? '' : 'hidden'}>${known ? 'Име и фамилия' : escapeHtml(label)}
        <input class="person-input" value="${escapeHtml(known ? '' : last)}" placeholder="Име и фамилия" />
      </label>
    </div>
  `;
}

// Връща функция, която дава текущо избраното име.
export function wirePersonField(scopeEl) {
  const field = scopeEl.querySelector('.person-field');
  if (!field) return () => '';
  const select = field.querySelector('.person-select');
  const newRow = field.querySelector('.person-new');
  const input = field.querySelector('.person-input');

  if (select) {
    select.addEventListener('change', () => {
      const isNew = select.value === NEW;
      newRow.hidden = !isNew;
      if (isNew) input.focus({ preventScroll: true });
    });
  }

  return () => {
    if (!select || select.hidden || select.value === NEW) return input.value.trim();
    return select.value.trim();
  };
}
