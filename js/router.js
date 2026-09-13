const routes = [];
let notFoundHandler = () => '<p>Страницата не е намерена.</p>';

export function route(pattern, handler) {
  const paramNames = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/:[^/]+/g, (m) => {
        paramNames.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ regex, paramNames, handler });
}

export function notFound(handler) {
  notFoundHandler = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

async function render() {
  const app = document.getElementById('app');
  const hash = window.location.hash.slice(1) || '/';
  const path = hash.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(hash.split('?')[1] || ''));

  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      app.innerHTML = '<div class="loading">Зареждане…</div>';
      window.scrollTo(0, 0);
      try {
        const result = await r.handler(params, query);
        if (result && typeof result === 'object' && 'html' in result) {
          app.innerHTML = result.html;
          if (result.mount) await result.mount(app);
        } else {
          app.innerHTML = result;
        }
      } catch (err) {
        // Иначе екранът остава на „Зареждане…“ и не се вижда каква е причината.
        console.error(err);
        app.innerHTML =
          '<div class="empty">Възникна грешка при зареждането на екрана.<br><span class="muted small">' +
          String((err && err.message) || err).replace(/[<>&]/g, '') +
          '</span><br><a href="#/sites">Към обектите</a></div>';
      }
      return;
    }
  }
  app.innerHTML = await notFoundHandler();
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
}
