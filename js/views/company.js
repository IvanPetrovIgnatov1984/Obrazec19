import { db } from '../db.js';
import { layout } from '../utils/layout.js';
import { escapeHtml, toast, getSetting, setSetting } from '../utils/util.js';
import { navigate } from '../router.js';
import { getPeople, savePeople, removePerson } from '../utils/people.js';

export async function companyView() {
  const people = await getPeople();
  const company = (await getSetting('myCompany', null)) || {
    name: '', eik: '', address: '', vatRegistered: false, vatNumber: '', mol: '',
  };

  const body = `
    <div class="site-header">
      <div class="muted small">Данни за твоята фирма — вписват се автоматично във всеки протокол Образец 19, в колоната „Възложител“ или „Изпълнител“ според ролята, която си избрал за съответния обект.</div>
    </div>
    <form id="company-form" class="form">
      <label>Наименование на фирмата *
        <input name="name" required value="${escapeHtml(company.name)}" placeholder="напр. Строй Експерт ЕООД" />
      </label>
      <label>ЕИК *
        <input name="eik" required value="${escapeHtml(company.eik)}" placeholder="напр. 123456789" />
      </label>
      <label>Адрес
        <input name="address" value="${escapeHtml(company.address)}" placeholder="гр. София, ул. ..." />
      </label>
      <label>МОЛ (представляващ)
        <input name="mol" value="${escapeHtml(company.mol)}" placeholder="Име на управителя" />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" name="vatRegistered" ${company.vatRegistered ? 'checked' : ''} />
        Регистрирана по ЗДДС
      </label>
      <label id="vat-number-row" ${company.vatRegistered ? '' : 'hidden'}>ИН по ЗДДС
        <input name="vatNumber" value="${escapeHtml(company.vatNumber)}" placeholder="напр. BG123456789" />
      </label>
      <button type="submit" class="btn btn-primary">Запази</button>
    </form>

    <h3 class="section-title">Кой отчита</h3>
    <div class="muted small">Имената, които излизат в менюто при отчитане. Всяко ново въведено име се добавя тук само.</div>
    <div id="people-list" class="list people-list">
      ${people.list.length
        ? people.list
            .map(
              (n) => `
        <div class="card person-row">
          <span>${escapeHtml(n)}</span>
          <button type="button" class="icon-btn-sm" data-del-person="${escapeHtml(n)}" aria-label="Премахни">🗑</button>
        </div>`
            )
            .join('')
        : '<div class="muted small">Още няма въведени имена.</div>'}
    </div>
    <form id="person-form" class="form form-inline">
      <label>Добави име
        <input name="person" placeholder="Име и фамилия" autocomplete="off" />
      </label>
      <button type="submit" class="btn btn-ghost">+ Добави</button>
    </form>
  `;

  return {
    html: layout({ title: 'Моята фирма', back: '/sites', body }),
    mount(app) {
      const reload = () => {
        navigate('/company');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      };

      app.querySelector('#person-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = e.target.querySelector('[name=person]');
        const name = input.value.trim();
        if (!name) return;
        if (people.list.some((n) => n.toLowerCase() === name.toLowerCase())) {
          toast('Това име вече е в списъка');
          return;
        }
        await savePeople([...people.list, name]);
        input.value = '';
        toast('Добавено');
        reload();
      });

      app.querySelectorAll('[data-del-person]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.getAttribute('data-del-person');
          if (!confirm(`Премахване на „${name}“ от списъка?\n\nВече записаните отчитания не се променят.`)) return;
          await removePerson(name);
          toast('Премахнато');
          reload();
        });
      });

      const vatCheckbox = app.querySelector('[name=vatRegistered]');
      const vatRow = app.querySelector('#vat-number-row');
      vatCheckbox.addEventListener('change', () => {
        vatRow.hidden = !vatCheckbox.checked;
      });

      app.querySelector('#company-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = {
          name: fd.get('name').trim(),
          eik: fd.get('eik').trim(),
          address: fd.get('address').trim(),
          mol: fd.get('mol').trim(),
          vatRegistered: fd.get('vatRegistered') === 'on',
          vatNumber: fd.get('vatRegistered') === 'on' ? fd.get('vatNumber').trim() : '',
        };
        await setSetting('myCompany', data);
        toast('Данните са запазени');
        navigate('/sites');
      });
    },
  };
}
