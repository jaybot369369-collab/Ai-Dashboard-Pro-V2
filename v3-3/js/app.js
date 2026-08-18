/* ═══════════════════════════════════════════════════════════
   APP — nav, day/night, and which page is showing.
════════════════════════════════════════════════════════════ */
const App = (() => {
  'use strict';
  const { esc } = UI;

  const PAGES = [
    { id: 'desk',        group: 'Your day', icon: '', label: 'Morning Desk', mod: () => DeskPage },
    { id: 'tradelog',    group: 'Your day', icon: '', label: 'Trade Log',    mod: () => TradeLogPage },
    { id: 'performance', group: 'Your day', icon: '', label: 'Performance',  mod: () => PerformancePage },
    { id: 'playbook',    group: 'Thinking', icon: '', label: 'Playbook',     mod: () => PlaybookPage },
    { id: 'tendencies',  group: 'Thinking', icon: '', label: 'Tendencies',   mod: () => TendenciesPage },
    { id: 'coach',       group: 'Thinking', icon: '', label: 'AI Coach',     mod: () => CoachPage },
    { id: 'context',     group: 'Thinking', icon: '', label: 'Context',      mod: () => ContextPage },
    { id: 'level2',      group: 'Markets',  icon: '', label: 'Level 2',      mod: () => Level2Page },
    { id: 'radar',       group: 'Markets',  icon: '', label: 'Radar',        mod: () => RadarPage },
    { id: 'calendar',    group: 'Markets',  icon: '', label: 'Calendar',     mod: () => CalendarPage },
    { id: 'settings',    group: 'System',   icon: '', label: 'Settings',     mod: () => SettingsPage },
  ];

  const LS_THEME = 'jp3_theme';
  const LS_PAGE  = 'jp3_page';
  let current = null;

  function theme() {
    return localStorage.getItem(LS_THEME)
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day');
  }
  function setTheme(t) {
    localStorage.setItem(LS_THEME, t);
    document.documentElement.setAttribute('data-theme', t);
    UI.$$('[data-theme-set]').forEach(b => b.classList.toggle('on', b.dataset.themeSet === t));
    // charts are drawn on canvas, so they need redrawing on a colour change
    const p = PAGES.find(x => x.id === current);
    if (p && ['performance', 'radar'].includes(p.id)) p.mod().render();
  }

  function buildNav() {
    let last = null;
    UI.$('nav').innerHTML = PAGES.map(p => {
      const head = p.group !== last ? `<div class="nav-group">${esc(p.group)}</div>` : '';
      last = p.group;
      const badge = p.id === 'tradelog' ? Store.trades().length.toLocaleString() : '';
      return head + `
        <a class="nav-item ${p.id === current ? 'active' : ''}" data-page="${p.id}">
          <span class="ni">${p.icon}</span><span class="nav-label">${esc(p.label)}</span>
          ${badge ? `<em class="count">${badge}</em>` : ''}
        </a>`;
    }).join('');
    UI.$$('#nav [data-page]').forEach(a =>
      a.addEventListener('click', () => go(a.dataset.page)));
  }

  function go(id) {
    const prev = PAGES.find(p => p.id === current);
    if (prev && prev.mod().leave) { try { prev.mod().leave(); } catch {} }

    const p = PAGES.find(x => x.id === id) || PAGES[0];
    current = p.id;
    localStorage.setItem(LS_PAGE, current);
    buildNav();

    const mod = p.mod();
    UI.$('headTitle').textContent = mod.title || p.label;
    UI.$('headSub').textContent = typeof mod.sub === 'function' ? mod.sub() : (mod.sub || '');
    UI.$('view').innerHTML = '';
    try {
      mod.render();
    } catch (e) {
      console.error('[app] page failed', id, e);
      UI.$('view').innerHTML = `<div class="card"><div class="notice">
        <span class="notice-ico"></span><div><b>This page hit a problem.</b><br>
        ${esc(e.message)}</div></div></div>`;
    }
    window.scrollTo(0, 0);
  }

  async function start() {
    setTheme(theme());
    UI.$$('[data-theme-set]').forEach(b =>
      b.addEventListener('click', () => setTheme(b.dataset.themeSet)));

    try {
      const r = await Store.init();
      if (r.seeded) UI.toast(`Loaded your ${r.count.toLocaleString()} trades`);
    } catch (e) {
      UI.$('view').innerHTML = `<div class="card"><div class="notice">
        <span class="notice-ico"></span><div><b>Could not load your data.</b><br>${esc(e.message)}</div></div></div>`;
      return;
    }

    // PIN, if one is set
    const pin = Store.settings().pin;
    if (pin) {
      const tries = prompt('Enter your three digit code');
      if (tries !== pin) {
        document.body.innerHTML = '<div style="padding:40px;font:16px system-ui">Wrong code.</div>';
        return;
      }
    }

    go(localStorage.getItem(LS_PAGE) || 'desk');
  }

  /** Which page is showing. Async pages check this before painting. */
  const currentPage = () => current;

  return { start, go, setTheme, PAGES, currentPage };
})();

document.addEventListener('DOMContentLoaded', App.start);
