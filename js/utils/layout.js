import { escapeHtml } from './util.js';

// Заглавието и връзката „Назад“ могат да съдържат части от адреса (номер на обект
// или позиция), затова се екранират — иначе подправена връзка би вкарала код.
// action е собствен HTML на изгледа и не се пипа.
export function layout({ title, back, action, body }) {
  return `
    <header class="topbar">
      ${back ? `<a href="#${escapeHtml(back)}" class="icon-btn back-btn" aria-label="Назад">←</a>` : '<span class="icon-btn-spacer"></span>'}
      <h1>${escapeHtml(title)}</h1>
      ${action ? action : '<span class="icon-btn-spacer"></span>'}
    </header>
    <main class="content">
      ${body}
    </main>
  `;
}
