export function layout({ title, back, action, body }) {
  return `
    <header class="topbar">
      ${back ? `<a href="#${back}" class="icon-btn back-btn" aria-label="Назад">←</a>` : '<span class="icon-btn-spacer"></span>'}
      <h1>${title}</h1>
      ${action ? action : '<span class="icon-btn-spacer"></span>'}
    </header>
    <main class="content">
      ${body}
    </main>
  `;
}
