/* ═══════════════════════════════════════════════════════════
   CRYPTO SCANNER — parent shell with 4 sub-tabs:
     Radar | Day Trade | FCP Scanner | Low-Cap Finder
   Sub-tab state persists to localStorage; each child renders
   into the shared #cs-body container.
════════════════════════════════════════════════════════════ */
const CryptoScannerTab = (() => {

  const LS_SUB = 'jb_cs_subtab';
  const SUBS = [
    { id: 'radar',    label: '📡 Radar',       desc: 'Multi-TF RSI spider chart' },
    { id: 'daytrade', label: '🎯 Day Trade',    desc: 'Signal Deck live scanner'  },
    { id: 'fcp',      label: '🔬 FCP',          desc: 'Float · Catalyst · Price'  },
    { id: 'lowcap',   label: '💎 Low-Cap',      desc: 'Binance small-cap finder'  },
  ];

  let _sub = localStorage.getItem(LS_SUB) || 'radar';

  function _setSub(id) {
    _sub = id;
    localStorage.setItem(LS_SUB, id);
    // Update active chip without full re-render
    document.querySelectorAll('.cs-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.sub === id));
    _mountChild();
  }

  function _mountChild() {
    const body = document.getElementById('cs-body');
    if (!body) return;
    // Clear body first so child's render() can set innerHTML cleanly
    body.innerHTML = '';
    switch (_sub) {
      case 'radar':    CryptoRadarTab.render('cs-body'); break;
      case 'daytrade': ScannerTab.render('cs-body');     break;
      case 'fcp':      FCPScanner.render('cs-body');     break;
      case 'lowcap':   LowCapTab.render('cs-body');      break;
    }
  }

  function _chipBar() {
    return `<div class="cs-chip-bar">
      ${SUBS.map(s => `
        <button class="cs-chip${_sub === s.id ? ' active' : ''}" data-sub="${s.id}"
          title="${s.desc}" onclick="CryptoScannerTab.setSub('${s.id}')">
          ${s.label}
        </button>`).join('')}
    </div>`;
  }

  function render() {
    _sub = 'radar';
    localStorage.setItem(LS_SUB, _sub);
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `
      <div class="cs-wrapper">
        <div class="cs-header">
          <h1 class="page-title" style="margin:0">🔍 Crypto Scanner</h1>
          ${_chipBar()}
        </div>
        <div id="cs-body"></div>
      </div>`;
    _mountChild();
  }

  return { render, setSub: _setSub };
})();
