/* ═══════════════════════════════════════════════════════════
   CRYPTO SCANNER — parent shell with 4 sub-tabs:
     Radar | Day Trade | FCP Scanner | Low-Cap Finder

   Chip bar is rendered inside #cs-body as the FIRST element
   on every sub-switch (above #cs-mount where child iframes
   live). This guarantees chip clicks can never be intercepted
   by a child iframe regardless of iframe height or z-index.
════════════════════════════════════════════════════════════ */
const CryptoScannerTab = (() => {

  const SUBS = [
    { id: 'radar',    label: '📡 Radar',    desc: 'Multi-TF RSI spider chart' },
    { id: 'daytrade', label: '🎯 Day Trade', desc: 'Signal Deck live scanner'  },
    { id: 'fcp',      label: '🔬 FCP',       desc: 'Float · Catalyst · Price'  },
    { id: 'lowcap',   label: '💎 Low-Cap',   desc: 'Binance small-cap finder'  },
  ];

  let _sub = 'radar';

  function _chipBar() {
    return SUBS.map(s => `
      <button class="cs-chip${_sub === s.id ? ' active' : ''}" data-sub="${s.id}"
        title="${s.desc}" onclick="CryptoScannerTab.setSub('${s.id}')">
        ${s.label}
      </button>`).join('');
  }

  function _mountChild() {
    const body = document.getElementById('cs-body');
    if (!body) return;
    // Chip bar is the first element inside cs-body on every sub-switch.
    // It sits above #cs-mount in DOM order — iframe can never intercept chip clicks.
    body.innerHTML = `
      <div class="cs-header">
        <h1 class="page-title" style="margin:0">🔍 Crypto Scanner</h1>
        <div class="cs-chip-bar">${_chipBar()}</div>
      </div>
      <div id="cs-mount"></div>`;
    switch (_sub) {
      case 'radar':    CryptoRadarTab.render('cs-mount'); break;
      case 'daytrade': ScannerTab.render('cs-mount');     break;
      case 'fcp':      FCPScanner.render('cs-mount');     break;
      case 'lowcap':   LowCapTab.render('cs-mount');      break;
    }
  }

  function _setSub(id) {
    _sub = id;
    _mountChild();
  }

  function render() {
    _sub = 'radar';
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = '<div class="cs-wrapper"><div id="cs-body"></div></div>';
    _mountChild();
  }

  return { render, setSub: _setSub };
})();
