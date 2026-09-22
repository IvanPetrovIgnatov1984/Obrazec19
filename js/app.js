import { route, notFound, startRouter, navigate } from './router.js';
import { db } from './db.js';
import { forceUpdate, hasUnsavedInput, showUpdateBar } from './utils/util.js';
import { listView, newSiteView, editSiteView } from './views/sites.js';
import { detailView, newPositionView } from './views/siteDetail.js';
import { positionDetailView, reportView } from './views/position.js';
import { batchReportView } from './views/batchReport.js';
import { historyView } from './views/history.js';
import { exportView } from './views/export.js';
import { companyView } from './views/company.js';

route('/', () => {
  navigate('/sites');
  return '';
});
route('/company', companyView);
route('/sites', listView);
route('/sites/new', newSiteView);
route('/sites/:id', detailView);
route('/sites/:id/edit', editSiteView);
route('/sites/:id/report', batchReportView);
route('/sites/:id/positions/new', newPositionView);
route('/sites/:id/positions/:posId', positionDetailView);
route('/sites/:id/positions/:posId/report', reportView);
route('/sites/:id/history', historyView);
route('/sites/:id/export', exportView);

notFound(() => '<div class="empty">Страницата не е намерена. <a href="#/sites">Към обектите</a></div>');

// Еднократно изчистване: ЕГН вече не се събира — премахва се и от старите записи.
(async () => {
  try {
    const sites = await db.getAll('sites');
    for (const site of sites) {
      if (Object.prototype.hasOwnProperty.call(site, 'egn')) {
        const { egn, ...rest } = site;
        // putRaw пази старото време на промяна — иначе при връщане от архив
        // тези обекти биха „спечелили“ срещу по-нови данни.
        await db.putRaw('sites', rest);
      }
    }
  } catch (err) {
    console.error('Изчистването на ЕГН се провали', err);
  }
})();

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW register failed', err));
    // Нова версия поема управлението → презареждаме веднъж, за да върви новият код.
    // Но не посред отчитане: тогава само казваме, че има нова версия.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      if (hasUnsavedInput()) {
        showUpdateBar();
        return;
      }
      reloading = true;
      window.location.reload();
    });
  });
}

const reloadBtn = document.getElementById('reload-btn');
if (reloadBtn) {
  reloadBtn.addEventListener('click', async () => {
    reloadBtn.classList.add('spinning');
    const done = await forceUpdate();
    if (!done) reloadBtn.classList.remove('spinning');
  });
}
