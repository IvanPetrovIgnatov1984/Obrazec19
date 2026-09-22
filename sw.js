const CACHE_NAME = 'obrazec19-v81';

// Файловете на приложението — винаги се теглят от мрежата, когато има връзка,
// и се кешират само за офлайн работа. Така стар код не може да „залепне“.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/version.js',
  './js/db.js',
  './js/router.js',
  './js/utils/util.js',
  './js/utils/layout.js',
  './js/utils/picker.js',
  './js/utils/people.js',
  './js/utils/reports.js',
  './js/utils/backup.js',
  './js/utils/exporters.js',
  './js/views/sites.js',
  './js/views/siteDetail.js',
  './js/views/position.js',
  './js/views/batchReport.js',
  './js/views/history.js',
  './js/views/export.js',
  './js/views/company.js',
  './js/data/smrCatalog.js',
];

// Библиотеки, шрифтове и икони — не се променят, взимат се от кеша.
const STATIC = [
  './vendor/jspdf.umd.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/fonts/roboto-fonts.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_SHELL, ...STATIC]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const timer = setTimeout(async () => {
      const cached = await caches.match(req);
      if (cached) finish(cached);
    }, 4000);
    // Покрай кеша на браузъра (GitHub Pages го пази 10 минути) — иначе след
    // качване се сервира стар код. Навигацията не приема настройки, затова за
    // нея правим нова заявка по адреса; ако сървърът пренасочи, ползваме оригинала.
    const net =
      req.mode === 'navigate'
        ? fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then((r) => (r.redirected ? fetch(req) : r))
        : fetch(req, { cache: 'no-store' });
    net
      .then((res) => {
        clearTimeout(timer);
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        finish(res);
      })
      .catch(async () => {
        clearTimeout(timer);
        const cached = await caches.match(req);
        finish(cached || (await caches.match('./index.html')) || Response.error());
      });
  });
}

function isStatic(url) {
  return url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Библиотеки и икони: първо кеш (те не се менят).
  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Кодът на приложението: първо мрежа, кешът е резерва. При слаб сигнал
  // (мрежата виси, но не пада) след 4 секунди се дава кешираното копие —
  // иначе на обекта приложението зависва на бял екран.
  event.respondWith(networkFirst(req));
});
