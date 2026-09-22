import { db } from '../db.js';

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtNum(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('bg-BG', { maximumFractionDigits: 2 });
}

// Пари — винаги с два знака след запетаята, както се пише в акт.
export function fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Закръгляне до цент без грешката на плаващата запетая (1.005 → 1.01).
export function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, 2200);
}

export async function getSetting(key, fallback = '') {
  const row = await db.get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.put('settings', { key, value });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function fileToCompressedBlob(file, maxSize = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round((height * maxSize) / width);
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Сваля файл през временна връзка (както прави jsPDF/SheetJS вътрешно).
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Отваря системния лист за споделяне (телефон, macOS Safari/Chrome).
// Ако браузърът не го поддържа — показваме собствено меню с възможните начини.
export async function shareOrDownload(blob, filename, { title, text } = {}) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      console.error('Споделянето се провали, показваме менюто', err);
    }
  }
  return shareSheet(blob, filename, { title, text });
}

// Резервно меню за браузъри без системен лист. Важно: уеб приложение няма право
// само да прикачи файл в поща/WhatsApp/Viber — затова файлът се сваля и се
// прикачва ръчно, а текстът се подава готов.
function shareSheet(blob, filename, { title = '', text = '' } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Изпращане">
        <div class="sheet-title">Как да изпратиш акта?</div>
        <div class="muted small sheet-note">Този браузър не може сам да прикачи файла. При избор на приложение актът се сваля, за да го прикачиш.</div>
        <button type="button" class="sheet-btn" data-act="mail">📧 Имейл</button>
        <button type="button" class="sheet-btn" data-act="whatsapp">💬 WhatsApp</button>
        <button type="button" class="sheet-btn" data-act="viber">📱 Viber</button>
        <button type="button" class="sheet-btn" data-act="save">💾 Само свали файла</button>
        <button type="button" class="sheet-btn" data-act="copy">📋 Копирай текста</button>
        <button type="button" class="sheet-btn sheet-cancel" data-act="cancel">Откажи</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close('cancelled');
    });

    backdrop.querySelectorAll('.sheet-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        // Прозорецът се отваря веднага в жеста на потребителя, иначе го блокират.
        if (act === 'whatsapp') {
          window.open('https://wa.me/?text=' + encodeURIComponent(text || title), '_blank', 'noopener');
        } else if (act === 'viber') {
          window.location.href = 'viber://forward?text=' + encodeURIComponent(text || title);
        } else if (act === 'mail') {
          window.location.href =
            'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text || '');
        } else if (act === 'copy') {
          if (navigator.clipboard) navigator.clipboard.writeText(text || title).catch(() => {});
          toast('Текстът е копиран');
          close('copied');
          return;
        } else if (act === 'cancel') {
          close('cancelled');
          return;
        }
        downloadBlob(blob, filename);
        close(act === 'save' ? 'downloaded' : act);
      });
    });
  });
}

// Има ли на екрана въведено, но незаписано нещо — количества, текст, снимки.
// Полетата за търсене и дата не се броят: те не са работа, която да се загуби.
export function hasUnsavedInput(root = document) {
  const app = root.getElementById ? root.getElementById('app') : null;
  if (!app) return false;
  if (app.querySelector('#photo-list img')) return true;
  return [...app.querySelectorAll('input, textarea')].some((el) => {
    const t = el.type;
    if (t === 'search' || t === 'date' || t === 'hidden' || t === 'file' || t === 'checkbox' || t === 'radio') return false;
    return el.value !== el.defaultValue;
  });
}

// Има ли реално връзка — navigator.onLine лъже при „свързан към Wi-Fi без интернет“.
async function reachable(ms = 5000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), ms);
  try {
    const res = await fetch('./js/version.js?probe=' + Date.now(), { cache: 'no-store', signal: ctrl && ctrl.signal });
    return res.ok;
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Изчиства кеша и зарежда най-новата версия. Без мрежа НЕ прави нищо —
// иначе приложението остава без офлайн копие и не се отваря на обекта.
export async function forceUpdate() {
  if (hasUnsavedInput() && !confirm('На екрана има незаписано въвеждане. Обновяването ще го изчисти. Да продължа ли?')) {
    return false;
  }
  if (!(await reachable())) {
    alert('Няма връзка с интернет.\n\nПриложението продължава да работи офлайн. Обнови го, когато имаш мрежа.');
    return false;
  }
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
    console.error('Изчистването на кеша се провали', err);
  }
  location.href = location.pathname + '?_r=' + Date.now() + location.hash;
  return true;
}

// Лента „има нова версия“ — вместо да презареждаме посред отчитане.
export function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.innerHTML = '<span>Има нова версия.</span><button type="button" class="btn btn-primary btn-sm">Обнови, когато приключиш</button>';
  bar.querySelector('button').addEventListener('click', () => {
    if (hasUnsavedInput() && !confirm('На екрана има незаписано въвеждане. Да обновя ли все пак?')) return;
    location.reload();
  });
  document.body.appendChild(bar);
}
