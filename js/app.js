import { route, notFound, startRouter, navigate } from './router.js';
import { listView, newSiteView, editSiteView } from './views/sites.js';
import { detailView, newPositionView } from './views/siteDetail.js';
import { positionDetailView, reportView } from './views/position.js';
import { batchReportView } from './views/batchReport.js';
import { historyView } from './views/history.js';
import { signView } from './views/sign.js';
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
route('/sites/:id/sign', signView);
route('/sites/:id/export', exportView);

notFound(() => '<div class="empty">Страницата не е намерена. <a href="#/sites">Към обектите</a></div>');

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW register failed', err));
    // Нова версия поема управлението → презареждаме веднъж, за да върви новият код.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

const reloadBtn = document.getElementById('reload-btn');
if (reloadBtn) {
  reloadBtn.addEventListener('click', async () => {
    reloadBtn.classList.add('spinning');
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
      console.error('Force refresh cleanup failed', err);
    }
    location.href = location.pathname + '?_r=' + Date.now();
  });
}
