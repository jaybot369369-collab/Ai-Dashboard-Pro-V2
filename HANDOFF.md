# AI Dashboard Pro V2 — Design Handoff
*Last updated: 2026-05-17 | Picking up from Claude Sonnet 4.6 session*

## What this project is
A tab-by-tab visual redesign of `_CLAUDE PROJECTS/AI Dashboard Pro V2/` to match the Claude.ai exported design reference at `~/Downloads/AI Dashboard Pro - Single File.html` (decoded to `/tmp/claude_design_decoded.html`).

**Run it:** `cd "_CLAUDE PROJECTS/AI Dashboard Pro V2" && python3 -m http.server 8768` → `localhost:8768`

**Light theme** is the default (set in `jb_settings` localStorage). If browser shows dark, run in console:
```js
const s = JSON.parse(localStorage.getItem('jb_settings') || '{}');
s.theme = 'light';
localStorage.setItem('jb_settings', JSON.stringify(s));
location.reload();
```

---

## Commit history (this redesign series)

| Commit | Tabs |
|--------|------|
| `de01a1b` | Dashboard V3 — Claude.ai design |
| `a9fd446` | Daily Report tab V3 |
| `0fcfbc1` | ICT Dojo — page-head, hero card, 9-concept grid |
| `690fcf7` | Playbook — 3-col card grid, emoji icons, WR badges |
| `f474d77` | Rules, Goals, AI Coach, Tendencies, My Reports, Pro Tools, Bot Farm, Market Intel, Liquidity Watcher |

---

## Status of every tab

| Tab | data-tab | Status | Notes |
|-----|----------|--------|-------|
| Dashboard | `dashboard` | ✅ Done | KPI grid, equity curve, hi-card, donut |
| Daily Report | `dailyreport` | ✅ Done | |
| ICT Dojo | `dojo` | ✅ Done | |
| Trade Log | `tradelog` | ⚠️ **NOT YET** | Still old design — needs redesign |
| Playbook | `playbook` | ✅ Done | |
| Rules | `rules` | ✅ Done | hi-card compliance hero, 3 ruleset cards |
| AI Coach | `aicoach` | ✅ Done | 2-col insights grid, ask-coach bar, ⚙️ settings |
| Goals | `goals` | ✅ Done | 6 metric cards |
| Tendencies | `tendencies` | ✅ Done | DOW bar chart, session/setup rows, direction donut |
| My Reports | `reports` | ✅ Done | template cards + sub-tabs |
| Liquidity Watcher | `liquidity` | ✅ Done | iframe tab + page-head |
| Market Intel | `marketintel` | ✅ Done | page-head in all states |
| Bot Farm | `fund` | ✅ Done | page-head in online/offline |
| Pro Tools | `protools` | ✅ Done | 3 calculator cards + sub-nav |

**Only Trade Log (`js/tabs/tradelog.js`) remains to be redesigned.**

---

## Design reference

The canonical reference is the Claude.ai single-file export. Key design primitives already in `css/styles.css`:

- `.page-head` → page title area (h1 left, actions right)
- `.hi-card` → purple gradient hero card
- `.card` → standard white/surface card
- `.kpi-grid` / `.kpi` → 4-KPI row with sparklines
- `.row-12-8` / `.row-8-4` → 2-col layout grids

All tab modules use the IIFE pattern: `const TabNameTab = (() => { ... return { render, _methods }; })();`

---

## Trade Log redesign guide (next task)

**Reference:** Open `~/Downloads/AI Dashboard Pro - Single File.html` decoded version and find the Trade Log section. It should show:
- `.page-head` "Trade Log" h1 + trade count subtitle + filter row
- A clean table view of trades with the Claude.ai table styling (`.table-wrap > table`)
- Possibly a summary row at top

**File to edit:** `js/tabs/tradelog.js`
- Keep all CRUD: `_edit`, `_delete`, `_save`, `_cancelEdit`, `_addTrade`, `_closeModal`
- Keep all filter logic: `_setFilter`, `_setRange`, `_search`
- Only rewrite `render()` and any private HTML-builder functions
- DO NOT touch `DB.saveTrades()`, `DB.getTrades()`, or any data layer

**Cache-bust:** After editing, bump `tradelog.js?v=tl2` → `tl3` in `index.html` line ~391.

---

## Workflow for each tab

1. User sends screenshot of Claude.ai reference design
2. Read the current tab JS file to understand existing structure
3. Rewrite `render()` to match the reference — keep all CRUD/data methods
4. Bump `?v=N` version in `index.html` for that script
5. Reload browser, verify via JS: `document.querySelector('.page-head h1')?.textContent`
6. Commit when verified

---

## Key patterns

```js
// Page head (every tab)
`<div class="page-head">
  <div><h1>Tab Name</h1><div class="page-head-sub">subtitle</div></div>
  <button class="btn-primary btn-sm">+ Action</button>
</div>`

// Standard card
`<div class="card">...</div>`

// Purple hero card  
`<div class="hi-card">...</div>`

// 2-col grid
`<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">...</div>`

// 3-col grid
`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">...</div>`
```

---

## Server
Port 8768. If down: `lsof -ti:8768 | xargs kill -9 2>/dev/null; cd "_CLAUDE PROJECTS/AI Dashboard Pro V2" && nohup python3 -m http.server 8768 > /tmp/dash_v2.log 2>&1 &`
