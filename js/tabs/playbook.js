/* ═══════════════════════════════════════════════════════════
   PLAYBOOK TAB
════════════════════════════════════════════════════════════ */
const PlaybookTab = (() => {

  const SETUP_ICONS = [
    ['silver bullet', '🥈'], ['liquidity sweep', '🎯'], ['liquidity', '🎯'],
    ['order block', '📦'],   ['breaker', '🧱'],          ['cisd', '⚡'],
    ['asia range', '🌏'],    ['asia', '🌏'],              ['ote', '📐'],
    ['fair value', '📊'],    ['fvg', '📊'],               ['power of 3', '🔺'],
    ['killzone', '⏱️'],      ['sweep', '🌊'],             ['continuation', '➡️'],
    ['turtle', '🐢'],
  ];

  function setupIcon(name) {
    const lower = (name || '').toLowerCase();
    for (const [key, icon] of SETUP_ICONS) {
      if (lower.includes(key)) return icon;
    }
    return '📋';
  }

  function wrBadge(wr) {
    if (wr === null) return { color: '#6b7280', label: '—' };
    if (wr >= 75)   return { color: '#22c55e', label: wr.toFixed(0) + '%' };
    if (wr >= 60)   return { color: '#f59e0b', label: wr.toFixed(0) + '%' };
    if (wr >= 50)   return { color: '#f97316', label: wr.toFixed(0) + '%' };
    return { color: '#ef4444', label: wr.toFixed(0) + '%' };
  }

  /* ─────────────────────────────────────────────────────────
     CHART EXAMPLES DATA
     Each example: { title, context, candles[], zones[], lines[], markers[] }
     Candle: { o, h, l, c }  (h >= max(o,c), l <= min(o,c))
     Zone:   { yHi, yLo, color, opacity, label }
     Line:   { y, color, dash, label }
     Marker: { type:'arrow_up'|'arrow_down'|'tag', candle, y, color, text }
  ───────────────────────────────────────────────────────── */
  const CHART_EXAMPLES = {

    fvg: [
      {
        title: 'Bullish FVG — Clean Fill & Bounce',
        context: 'Strong impulse up leaves a 2-candle gap. Price retraces into the zone, holds, and continues the trend.',
        candles: [
          {o:50,h:52,l:49,c:51},   {o:51,h:53,l:50,c:52},   {o:52,h:53,l:51.5,c:52.5},
          {o:52.5,h:64,l:52,c:63}, {o:63,h:67,l:55,c:66},   {o:66,h:68,l:65,c:67},
          {o:67,h:69,l:66,c:68},   {o:68,h:69,l:63,c:64},   {o:64,h:65,l:59,c:60},
          {o:60,h:61,l:54,c:55},   {o:55,h:60,l:54,c:59},   {o:59,h:64,l:58,c:63},
          {o:63,h:68,l:62,c:67},   {o:67,h:71,l:66,c:70},
        ],
        zones:   [{ yHi:55, yLo:53, color:'#22c55e', opacity:0.22, label:'FVG' }],
        lines:   [{ y:54, color:'#22c55e', dash:true, label:'Entry' }],
        markers: [{ type:'arrow_up', candle:10, y:54, color:'#22c55e' }],
      },
      {
        title: 'Bearish FVG — Retrace Into Gap, Rejection',
        context: 'Aggressive sell-off creates a gap overhead. Price retraces up into the FVG and is firmly rejected.',
        candles: [
          {o:75,h:77,l:73,c:76},   {o:76,h:77,l:73,c:74},   {o:74,h:75,l:69,c:70},
          {o:70,h:72,l:57,c:58},   {o:58,h:66,l:57,c:60},   {o:60,h:61,l:56,c:57},
          {o:57,h:58,l:53,c:54},   {o:54,h:59,l:53,c:58},   {o:58,h:64,l:57,c:63},
          {o:63,h:68,l:62,c:67},   {o:67,h:70,l:65,c:66},   {o:66,h:67,l:60,c:61},
          {o:61,h:62,l:56,c:57},   {o:57,h:58,l:52,c:53},
        ],
        zones:   [{ yHi:69, yLo:66, color:'#ef4444', opacity:0.22, label:'FVG' }],
        lines:   [{ y:67, color:'#ef4444', dash:true, label:'Entry' }],
        markers: [{ type:'arrow_down', candle:10, y:70, color:'#ef4444' }],
      },
      {
        title: 'IFVG — Gap Fully Filled, Flips to Resistance',
        context: 'A bullish FVG is completely mitigated on the way down. It then becomes an Inverse FVG — resistance on the retrace.',
        candles: [
          {o:57,h:59,l:56,c:58},   {o:58,h:65,l:57.5,c:64}, {o:64,h:76,l:63.5,c:75},
          {o:75,h:79,l:67,c:78},   {o:78,h:81,l:77,c:80},   {o:80,h:81,l:75,c:76},
          {o:76,h:77,l:71,c:72},   {o:72,h:73,l:67,c:68},   {o:68,h:69,l:64,c:65},
          {o:65,h:66,l:60,c:61},   {o:61,h:65,l:60,c:64},   {o:64,h:68,l:63,c:67},
          {o:67,h:69,l:65,c:66},   {o:66,h:67,l:59,c:60},
        ],
        zones:   [{ yHi:67, yLo:65, color:'#f59e0b', opacity:0.25, label:'IFVG' }],
        lines:   [{ y:66, color:'#f59e0b', dash:true }],
        markers: [{ type:'arrow_down', candle:12, y:69, color:'#ef4444' }],
      },
      {
        title: 'FVG 50% Mitigation — Partial Fill Entry',
        context: 'Price only fills to the midpoint of the FVG zone, signalling structural strength. Entry at 50% is the precise ICT model.',
        candles: [
          {o:55,h:57,l:54,c:56},   {o:56,h:57,l:55,c:56},   {o:56,h:72,l:55.5,c:71},
          {o:71,h:74,l:63,c:73},   {o:73,h:76,l:72,c:75},   {o:75,h:77,l:74,c:76},
          {o:76,h:77,l:71,c:72},   {o:72,h:73,l:67,c:68},   {o:68,h:69,l:61,c:62},
          {o:62,h:63,l:60,c:62},   {o:62,h:67,l:61,c:66},   {o:66,h:72,l:65,c:71},
          {o:71,h:75,l:70,c:74},   {o:74,h:78,l:73,c:77},
        ],
        zones:   [{ yHi:63, yLo:57, color:'#22c55e', opacity:0.15, label:'FVG' }],
        lines:   [
          { y:60, color:'#22c55e', dash:true, label:'50%' },
        ],
        markers: [{ type:'arrow_up', candle:9, y:60, color:'#22c55e' }],
      },
      {
        title: 'FVG + OB Confluence — High Probability Entry',
        context: 'The FVG zone sits directly on top of an Order Block. Overlapping premium areas create a high-conviction entry with tight risk.',
        candles: [
          {o:57,h:59,l:55,c:58},   {o:58,h:59,l:55.5,c:56}, {o:56,h:70,l:55.5,c:69},
          {o:69,h:73,l:61,c:72},   {o:72,h:75,l:71,c:74},   {o:74,h:76,l:73,c:75},
          {o:75,h:77,l:73,c:74},   {o:74,h:75,l:69,c:70},   {o:70,h:71,l:65,c:66},
          {o:66,h:67,l:59,c:60},   {o:60,h:62,l:57,c:61},   {o:61,h:67,l:60,c:66},
          {o:66,h:72,l:65,c:71},   {o:71,h:76,l:70,c:75},
        ],
        zones: [
          { yHi:61, yLo:59, color:'#22c55e', opacity:0.22, label:'FVG' },
          { yHi:59, yLo:55, color:'#6366f1', opacity:0.20, label:'OB'  },
        ],
        markers: [{ type:'arrow_up', candle:10, y:57, color:'#22c55e' }],
      },
    ],

    turtle: [
      {
        title: 'Previous High Sweep — Short Reversal',
        context: 'Price spikes above a clear previous high to grab buy-side liquidity, then closes back below. The sweep is the signal.',
        candles: [
          {o:58,h:60,l:57,c:59},   {o:59,h:63,l:58,c:62},   {o:62,h:70,l:61,c:69},
          {o:69,h:70,l:65,c:66},   {o:66,h:68,l:64,c:65},   {o:65,h:67,l:63,c:64},
          {o:64,h:66,l:63,c:65},   {o:65,h:67,l:63,c:64},   {o:64,h:65,l:62,c:63},
          {o:63,h:65,l:62,c:64},   {o:64,h:74,l:63,c:64.5}, {o:64.5,h:65,l:59,c:60},
          {o:60,h:61,l:55,c:56},   {o:56,h:57,l:52,c:53},
        ],
        lines:   [{ y:70, color:'#f59e0b', dash:true, label:'Prev High' }],
        markers: [
          { type:'tag',        candle:10, y:75.5, color:'#ef4444', text:'SWEEP' },
          { type:'arrow_down', candle:11, y:65,   color:'#ef4444' },
        ],
      },
      {
        title: 'Previous Low Sweep — Long Reversal',
        context: 'Sell-side liquidity below an obvious previous low is taken, trapping late shorts. Price swiftly reverses long.',
        candles: [
          {o:72,h:74,l:70,c:73},   {o:73,h:75,l:71,c:74},   {o:74,h:75,l:64,c:65},
          {o:65,h:68,l:64,c:67},   {o:67,h:69,l:65,c:66},   {o:66,h:68,l:64.5,c:65},
          {o:65,h:67,l:64,c:66},   {o:66,h:67,l:64,c:65},   {o:65,h:66,l:63.5,c:64},
          {o:64,h:65,l:63.5,c:64}, {o:64,h:65,l:60,c:63.5}, {o:63.5,h:69,l:63,c:68},
          {o:68,h:73,l:67,c:72},   {o:72,h:76,l:71,c:75},
        ],
        lines:   [{ y:64, color:'#f59e0b', dash:true, label:'Prev Low' }],
        markers: [
          { type:'tag',       candle:10, y:59.5, color:'#22c55e', text:'SWEEP' },
          { type:'arrow_up',  candle:11, y:63,   color:'#22c55e' },
        ],
      },
      {
        title: 'Equal Highs Swept — Triple Liquidity Pool',
        context: 'Three touches at the same high build an obvious liquidity pool. When price finally spikes above all three, smart money exits longs into the breakout buyers.',
        candles: [
          {o:56,h:58,l:55,c:57},   {o:57,h:62,l:56,c:61},   {o:61,h:68,l:60,c:65},
          {o:65,h:68,l:62,c:63},   {o:63,h:65,l:61,c:62},   {o:62,h:64,l:60,c:63},
          {o:63,h:68,l:62,c:66},   {o:66,h:68,l:64,c:65},   {o:65,h:66,l:63,c:64},
          {o:64,h:65,l:62,c:63},   {o:63,h:73,l:62,c:63.5}, {o:63.5,h:64,l:58,c:59},
          {o:59,h:60,l:54,c:55},   {o:55,h:56,l:51,c:52},
        ],
        lines:   [{ y:68, color:'#f59e0b', dash:true, label:'Equal Highs' }],
        markers: [
          { type:'tag',        candle:10, y:74.5, color:'#ef4444', text:'BSL SWEPT' },
          { type:'arrow_down', candle:11, y:64,   color:'#ef4444' },
        ],
      },
      {
        title: 'Asia Range False Breakout — London Trap',
        context: 'A tight Asia session range traps buyers on the breakout above. London drives price right back through and below the Asia low.',
        candles: [
          {o:63,h:66,l:62,c:65},   {o:65,h:66,l:63,c:64},   {o:64,h:66,l:62,c:63},
          {o:63,h:65,l:62,c:64},   {o:64,h:66,l:62,c:63},   {o:63,h:65,l:62,c:64},
          {o:64,h:65.5,l:62,c:63}, {o:63,h:74,l:62,c:63.5}, {o:63.5,h:64,l:60,c:61},
          {o:61,h:62,l:57,c:58},   {o:58,h:59,l:54,c:55},   {o:55,h:56,l:52,c:53},
          {o:53,h:54,l:50,c:51},   {o:51,h:52,l:48,c:49},
        ],
        zones:   [{ yHi:66, yLo:62, color:'#6366f1', opacity:0.15, label:'Asia Range' }],
        markers: [
          { type:'tag',        candle:7, y:75.5, color:'#ef4444', text:'FALSE BRK' },
          { type:'arrow_down', candle:8, y:64,   color:'#ef4444' },
        ],
      },
      {
        title: 'Stop Hunt Into FVG — BSL Sweep + Reversal',
        context: 'Sell stops below equal lows are taken. Price immediately taps into a FVG zone below and reverses aggressively. The sweep + FVG combo is the entry trigger.',
        candles: [
          {o:72,h:74,l:70,c:73},   {o:73,h:74,l:70,c:71},   {o:71,h:72,l:66,c:67},
          {o:67,h:68,l:63,c:64},   {o:64,h:66,l:63,c:65},   {o:65,h:67,l:63,c:64},
          {o:64,h:65,l:63,c:64},   {o:64,h:65,l:63,c:63.5}, {o:63.5,h:64,l:58,c:63},
          {o:63,h:68,l:62,c:67},   {o:67,h:72,l:66,c:71},   {o:71,h:75,l:70,c:74},
          {o:74,h:77,l:73,c:76},   {o:76,h:79,l:75,c:78},
        ],
        zones:   [{ yHi:60, yLo:57, color:'#22c55e', opacity:0.22, label:'FVG' }],
        lines:   [{ y:63.5, color:'#f59e0b', dash:true, label:'Equal Lows' }],
        markers: [
          { type:'tag',      candle:8, y:56.5, color:'#22c55e', text:'STOP HUNT' },
          { type:'arrow_up', candle:9, y:62,   color:'#22c55e' },
        ],
      },
    ],

    silver_bullet: [
      {
        title: 'NY AM — Session Low Sweep, FVG Long (10-11am)',
        context: 'Price dips below the session low during the 10am killzone, grabs sell-side liquidity, then impulses up leaving an FVG. Entry on the retrace into the gap.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:67,l:63,c:64}, {o:64,h:65,l:62,c:63},
          {o:63,h:64,l:60,c:62}, {o:62,h:65,l:59.5,c:64},
          {o:64,h:76,l:63.5,c:75}, {o:75,h:78,l:67,c:77},
          {o:77,h:79,l:75,c:76}, {o:76,h:77,l:70,c:71},
          {o:71,h:72,l:66.5,c:67}, {o:67,h:72,l:66,c:71},
          {o:71,h:76,l:70,c:75}, {o:75,h:79,l:74,c:78},
        ],
        zones:   [{ yHi:67, yLo:64, color:'#22c55e', opacity:0.22, label:'FVG' }],
        lines:   [{ y:60, color:'#f59e0b', dash:true, label:'Session Low' }],
        markers: [{ type:'arrow_up', candle:10, y:66, color:'#22c55e' }],
      },
      {
        title: 'NY AM — Session High Sweep, FVG Short (10-11am)',
        context: 'Price spikes above the session high at the 10am open, taking buy-side liquidity. An aggressive bearish displacement follows, leaving an FVG that acts as resistance.',
        candles: [
          {o:68,h:70,l:67,c:69}, {o:69,h:72,l:68,c:71}, {o:71,h:74,l:70,c:73},
          {o:73,h:74,l:71,c:72}, {o:72,h:78,l:71,c:72},
          {o:72,h:73,l:61,c:62}, {o:62,h:69,l:61,c:65},
          {o:65,h:66,l:61,c:62}, {o:62,h:70,l:61,c:69},
          {o:69,h:73,l:68,c:70}, {o:70,h:71,l:63,c:64},
          {o:64,h:65,l:59,c:60}, {o:60,h:61,l:56,c:57},
        ],
        zones:   [{ yHi:71, yLo:68, color:'#ef4444', opacity:0.22, label:'FVG' }],
        lines:   [{ y:74, color:'#f59e0b', dash:true, label:'Session High' }],
        markers: [{ type:'arrow_down', candle:9, y:73, color:'#ef4444' }],
      },
      {
        title: 'London Open — Asia Low Swept, FVG Long',
        context: 'Asia session builds a clear range low. London open sweeps below it, creating sell-side liquidity grab. Bullish FVG forms on the impulse back up — entry on retrace.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:65,l:62,c:63},
          {o:63,h:65,l:62,c:64}, {o:64,h:65.5,l:62,c:63},
          {o:63,h:64,l:59,c:62}, {o:62,h:76,l:61.5,c:75},
          {o:75,h:78,l:67,c:77}, {o:77,h:79,l:75,c:76},
          {o:76,h:77,l:69,c:70}, {o:70,h:74,l:67.5,c:73},
          {o:73,h:78,l:72,c:77}, {o:77,h:81,l:76,c:80},
        ],
        zones:   [{ yHi:67, yLo:64, color:'#22c55e', opacity:0.22, label:'FVG' }],
        lines:   [{ y:62, color:'#f59e0b', dash:true, label:'Asia Low' }],
        markers: [{ type:'arrow_up', candle:10, y:67, color:'#22c55e' }],
      },
      {
        title: 'NY PM — 2pm Sweep, FVG Short (2-3pm)',
        context: 'At the 2pm NY killzone price spikes above the noon high, triggering buy stops. A rapid bearish reversal leaves an FVG overhead — entry on retrace into zone.',
        candles: [
          {o:70,h:72,l:69,c:71}, {o:71,h:73,l:70,c:72}, {o:72,h:74,l:71,c:73},
          {o:73,h:74,l:71,c:72}, {o:72,h:73,l:70,c:71},
          {o:71,h:78,l:70,c:72}, {o:72,h:73,l:62,c:63},
          {o:63,h:69,l:62,c:66}, {o:66,h:67,l:62,c:63},
          {o:63,h:71,l:62,c:70}, {o:70,h:73,l:69,c:71},
          {o:71,h:72,l:64,c:65}, {o:65,h:66,l:60,c:61},
        ],
        zones:   [{ yHi:71, yLo:68, color:'#ef4444', opacity:0.22, label:'FVG' }],
        lines:   [{ y:74, color:'#f59e0b', dash:true, label:'Noon High' }],
        markers: [{ type:'arrow_down', candle:10, y:73, color:'#ef4444' }],
      },
      {
        title: 'Immediate Displacement — No Retrace Needed',
        context: 'After the liquidity sweep, price displaces so aggressively the FVG never fills. The move is confirmed at the open of the candle after the impulse — aggressive entry only.',
        candles: [
          {o:63,h:65,l:62,c:64}, {o:64,h:65,l:63,c:64}, {o:64,h:65,l:59,c:64},
          {o:64,h:78,l:63.5,c:77}, {o:77,h:80,l:74,c:79},
          {o:79,h:82,l:78,c:81}, {o:81,h:84,l:80,c:83},
          {o:83,h:86,l:82,c:85}, {o:85,h:88,l:84,c:87},
          {o:87,h:90,l:86,c:89}, {o:89,h:92,l:88,c:91},
        ],
        zones:   [{ yHi:74, yLo:65, color:'#22c55e', opacity:0.12, label:'FVG (unfilled)' }],
        lines:   [{ y:61, color:'#f59e0b', dash:true, label:'SSL' }],
        markers: [
          { type:'tag',      candle:3, y:79, color:'#22c55e', text:'DISPLACEMENT' },
          { type:'arrow_up', candle:4, y:74, color:'#22c55e' },
        ],
      },
    ],

    order_block: [
      {
        title: 'Bullish OB — Last Bearish Candle Before Impulse',
        context: 'The last bearish (red) candle before a strong up-move becomes the Order Block. When price returns to that candle\'s body, institutions re-enter long.',
        candles: [
          {o:65,h:67,l:64,c:66}, {o:66,h:67,l:64,c:65}, {o:65,h:66,l:63,c:64},
          {o:64,h:65,l:62,c:63}, {o:63,h:65,l:61,c:62},
          {o:62,h:77,l:61.5,c:76}, {o:76,h:79,l:75,c:78},
          {o:78,h:80,l:76,c:77}, {o:77,h:78,l:73,c:74},
          {o:74,h:75,l:70,c:71}, {o:71,h:73,l:62,c:63},
          {o:63,h:67,l:62,c:66}, {o:66,h:71,l:65,c:70},
          {o:70,h:75,l:69,c:74},
        ],
        zones:   [{ yHi:65, yLo:61, color:'#6366f1', opacity:0.22, label:'Bull OB' }],
        markers: [{ type:'arrow_up', candle:11, y:62, color:'#22c55e' }],
      },
      {
        title: 'Bearish OB — Last Bullish Candle Before Impulse',
        context: 'The final bullish (green) candle before a sharp sell-off defines the Order Block. On the retrace back into that body, smart money shorts.',
        candles: [
          {o:58,h:60,l:57,c:59}, {o:59,h:62,l:58,c:61}, {o:61,h:65,l:60,c:64},
          {o:64,h:68,l:63,c:67}, {o:67,h:72,l:66,c:71},
          {o:71,h:73,l:58,c:59}, {o:59,h:63,l:58,c:61},
          {o:61,h:62,l:57,c:58}, {o:58,h:64,l:57,c:63},
          {o:63,h:69,l:62,c:68}, {o:68,h:73,l:67,c:70},
          {o:70,h:72,l:65,c:66}, {o:66,h:67,l:61,c:62},
          {o:62,h:63,l:57,c:58},
        ],
        zones:   [{ yHi:73, yLo:67, color:'#ef4444', opacity:0.22, label:'Bear OB' }],
        markers: [{ type:'arrow_down', candle:10, y:73, color:'#ef4444' }],
      },
      {
        title: 'OB + FVG Stack — Premium Confluence',
        context: 'An Order Block sits directly below an FVG. Price enters the FVG first, then taps the OB below it. The two overlapping premium zones create a high-conviction long entry.',
        candles: [
          {o:57,h:59,l:56,c:58}, {o:58,h:59,l:56,c:57},
          {o:57,h:73,l:56.5,c:72}, {o:72,h:76,l:64,c:75},
          {o:75,h:78,l:74,c:77}, {o:77,h:79,l:76,c:78},
          {o:78,h:80,l:75,c:76}, {o:76,h:77,l:71,c:72},
          {o:72,h:73,l:66,c:67}, {o:67,h:68,l:61,c:62},
          {o:62,h:65,l:59,c:64}, {o:64,h:70,l:63,c:69},
          {o:69,h:75,l:68,c:74}, {o:74,h:79,l:73,c:78},
        ],
        zones: [
          { yHi:64, yLo:59, color:'#22c55e', opacity:0.18, label:'FVG' },
          { yHi:59, yLo:56, color:'#6366f1', opacity:0.22, label:'OB'  },
        ],
        markers: [{ type:'arrow_up', candle:10, y:59, color:'#22c55e' }],
      },
      {
        title: 'OB 50% Mitigation — Wick Tap Only',
        context: 'Price only touches the midpoint of the OB body before reversing. A wick that penetrates just to 50% of the candle range signals the OB is holding — the cleanest entry.',
        candles: [
          {o:60,h:62,l:59,c:61}, {o:61,h:62,l:59,c:60},
          {o:60,h:75,l:59.5,c:74}, {o:74,h:77,l:73,c:76},
          {o:76,h:79,l:75,c:78}, {o:78,h:80,l:77,c:79},
          {o:79,h:81,l:76,c:77}, {o:77,h:78,l:73,c:74},
          {o:74,h:75,l:70,c:71}, {o:71,h:72,l:65,c:66},
          {o:66,h:68,l:63,c:67}, {o:67,h:72,l:66,c:71},
          {o:71,h:76,l:70,c:75},
        ],
        zones:   [{ yHi:62, yLo:59, color:'#6366f1', opacity:0.22, label:'Bull OB' }],
        lines:   [{ y:60.5, color:'#6366f1', dash:true, label:'50%' }],
        markers: [{ type:'arrow_up', candle:10, y:63, color:'#22c55e' }],
      },
      {
        title: 'OB After MSS — Structure Break First',
        context: 'Price prints a series of lower lows (bearish delivery). A Market Structure Shift (break of a swing high) signals the change. The OB from the new impulse is the entry on retrace.',
        candles: [
          {o:78,h:80,l:76,c:77}, {o:77,h:78,l:73,c:74}, {o:74,h:75,l:70,c:71},
          {o:71,h:72,l:67,c:68}, {o:68,h:69,l:64,c:65},
          {o:65,h:66,l:61,c:62}, {o:62,h:63,l:59,c:60},
          {o:60,h:61,l:58,c:59}, {o:59,h:64,l:58,c:63},
          {o:63,h:76,l:62.5,c:75},
          {o:75,h:78,l:74,c:77}, {o:77,h:79,l:73,c:74},
          {o:74,h:75,l:68,c:69}, {o:69,h:73,l:68,c:72},
        ],
        zones:   [{ yHi:64, yLo:59, color:'#6366f1', opacity:0.22, label:'Bull OB' }],
        lines:   [{ y:70, color:'#f59e0b', dash:true, label:'MSS' }],
        markers: [
          { type:'tag',      candle:9,  y:77, color:'#22c55e', text:'MSS BREAK' },
          { type:'arrow_up', candle:12, y:68, color:'#22c55e' },
        ],
      },
    ],

    breaker: [
      {
        title: 'Bullish Breaker — Failed Bear OB Becomes Support',
        context: 'A bearish OB is violated when price breaks above it. On the retrace back to that zone, it now acts as support — a breaker block. Smart money buys the retest.',
        candles: [
          {o:72,h:74,l:70,c:71}, {o:71,h:72,l:68,c:69}, {o:69,h:70,l:66,c:67},
          {o:67,h:70,l:65,c:69}, {o:69,h:74,l:68,c:73},
          {o:73,h:78,l:72,c:77}, {o:77,h:81,l:76,c:80},
          {o:80,h:82,l:77,c:78}, {o:78,h:79,l:74,c:75},
          {o:75,h:76,l:70,c:71}, {o:71,h:74,l:70,c:73},
          {o:73,h:78,l:72,c:77}, {o:77,h:82,l:76,c:81},
        ],
        zones:   [{ yHi:74, yLo:70, color:'#22c55e', opacity:0.22, label:'Breaker' }],
        lines:   [{ y:74, color:'#22c55e', dash:true }],
        markers: [
          { type:'tag',      candle:5,  y:79, color:'#22c55e', text:'OB BROKEN' },
          { type:'arrow_up', candle:10, y:70, color:'#22c55e' },
        ],
      },
      {
        title: 'Bearish Breaker — Failed Bull OB Becomes Resistance',
        context: 'A bullish OB is violated when price breaks below it. On the retrace back up, the zone flips to resistance — the bearish breaker. Smart money sells the retrace.',
        candles: [
          {o:58,h:60,l:56,c:59}, {o:59,h:62,l:58,c:61}, {o:61,h:66,l:60,c:65},
          {o:65,h:67,l:63,c:64}, {o:64,h:65,l:61,c:62},
          {o:62,h:63,l:56,c:57}, {o:57,h:58,l:53,c:54},
          {o:54,h:55,l:51,c:52}, {o:52,h:58,l:51,c:57},
          {o:57,h:63,l:56,c:62}, {o:62,h:66,l:61,c:63},
          {o:63,h:65,l:58,c:59}, {o:59,h:60,l:54,c:55},
        ],
        zones:   [{ yHi:67, yLo:63, color:'#ef4444', opacity:0.22, label:'Breaker' }],
        lines:   [{ y:63, color:'#ef4444', dash:true }],
        markers: [
          { type:'tag',        candle:5,  y:55, color:'#ef4444', text:'OB BROKEN' },
          { type:'arrow_down', candle:10, y:66, color:'#ef4444' },
        ],
      },
      {
        title: 'Breaker + FVG Above — Dual Confluence',
        context: 'The breaker zone sits directly below an FVG. Price fills the FVG, then drops to the breaker. Both zones align to create a powerful short entry with minimal risk.',
        candles: [
          {o:66,h:68,l:65,c:67}, {o:67,h:70,l:66,c:69}, {o:69,h:74,l:68,c:73},
          {o:73,h:75,l:70,c:71}, {o:71,h:72,l:68,c:69},
          {o:69,h:70,l:63,c:64}, {o:64,h:65,l:60,c:61},
          {o:61,h:62,l:58,c:59}, {o:59,h:65,l:58,c:64},
          {o:64,h:70,l:63,c:69}, {o:69,h:73,l:68,c:70},
          {o:70,h:72,l:65,c:66}, {o:66,h:67,l:61,c:62},
        ],
        zones: [
          { yHi:73, yLo:70, color:'#f59e0b', opacity:0.20, label:'FVG'     },
          { yHi:70, yLo:66, color:'#ef4444', opacity:0.18, label:'Breaker' },
        ],
        markers: [{ type:'arrow_down', candle:10, y:73, color:'#ef4444' }],
      },
      {
        title: 'Breaker — Multiple Retests, Holds Each Time',
        context: 'A breaker zone that is retested multiple times reinforces its significance. Each bounce from the zone confirms ongoing institutional interest at that level.',
        candles: [
          {o:68,h:70,l:67,c:69}, {o:69,h:72,l:68,c:71}, {o:71,h:76,l:70,c:75},
          {o:75,h:78,l:74,c:77}, {o:77,h:79,l:73,c:74},
          {o:74,h:75,l:71,c:72}, {o:72,h:76,l:71,c:75},
          {o:75,h:77,l:72,c:73}, {o:73,h:74,l:71,c:72},
          {o:72,h:76,l:71,c:75}, {o:75,h:79,l:74,c:78},
          {o:78,h:81,l:77,c:80},
        ],
        zones:   [{ yHi:73, yLo:70, color:'#22c55e', opacity:0.20, label:'Breaker' }],
        markers: [
          { type:'arrow_up', candle:5,  y:71, color:'#22c55e' },
          { type:'arrow_up', candle:8,  y:71, color:'#22c55e' },
          { type:'arrow_up', candle:10, y:71, color:'#22c55e' },
        ],
      },
      {
        title: 'Breaker After Aggressive Displacement',
        context: 'A violent, multi-candle displacement breaks through and leaves the OB far behind. The breaker zone formed by that OB becomes the key level on any deep retracement.',
        candles: [
          {o:70,h:72,l:69,c:71}, {o:71,h:73,l:70,c:72}, {o:72,h:74,l:71,c:73},
          {o:73,h:75,l:72,c:74},
          {o:74,h:83,l:73.5,c:82}, {o:82,h:86,l:81,c:85},
          {o:85,h:89,l:84,c:88}, {o:88,h:91,l:85,c:86},
          {o:86,h:87,l:82,c:83}, {o:83,h:84,l:79,c:80},
          {o:80,h:81,l:74,c:75}, {o:75,h:79,l:74,c:78},
          {o:78,h:83,l:77,c:82},
        ],
        zones:   [{ yHi:75, yLo:72, color:'#22c55e', opacity:0.22, label:'Breaker' }],
        markers: [
          { type:'tag',      candle:4,  y:84, color:'#22c55e', text:'DISPLACEMENT' },
          { type:'arrow_up', candle:11, y:72, color:'#22c55e' },
        ],
      },
    ],

    cisd: [
      {
        title: 'Bearish→Bullish CISD — Break Above Swing High',
        context: 'After a series of lower lows, price breaks above the most recent swing high with a strong displacement candle. This Change in State of Delivery confirms the shift to bullish delivery.',
        candles: [
          {o:76,h:78,l:74,c:75}, {o:75,h:76,l:72,c:73}, {o:73,h:74,l:69,c:70},
          {o:70,h:72,l:68,c:71}, {o:71,h:73,l:67,c:68},
          {o:68,h:69,l:64,c:65}, {o:65,h:66,l:62,c:63},
          {o:63,h:78,l:62.5,c:77},
          {o:77,h:80,l:76,c:79}, {o:79,h:81,l:75,c:76},
          {o:76,h:77,l:72,c:73}, {o:73,h:77,l:72,c:76},
          {o:76,h:80,l:75,c:79},
        ],
        lines:   [{ y:73, color:'#22c55e', dash:true, label:'Swing High' }],
        markers: [
          { type:'tag',      candle:7, y:79, color:'#22c55e', text:'CISD' },
          { type:'arrow_up', candle:10, y:72, color:'#22c55e' },
        ],
      },
      {
        title: 'Bullish→Bearish CISD — Break Below Swing Low',
        context: 'A series of higher highs ends when price breaks below the most recent swing low with force. The CISD candle confirms a shift to bearish delivery — short on any retrace.',
        candles: [
          {o:60,h:62,l:59,c:61}, {o:61,h:64,l:60,c:63}, {o:63,h:67,l:62,c:66},
          {o:66,h:69,l:65,c:68}, {o:68,h:71,l:67,c:70},
          {o:70,h:72,l:68,c:69}, {o:69,h:71,l:67,c:68},
          {o:68,h:69,l:57,c:58},
          {o:58,h:59,l:55,c:56}, {o:56,h:62,l:55,c:61},
          {o:61,h:64,l:60,c:63}, {o:63,h:65,l:60,c:61},
          {o:61,h:62,l:56,c:57},
        ],
        lines:   [{ y:65, color:'#ef4444', dash:true, label:'Swing Low' }],
        markers: [
          { type:'tag',        candle:7,  y:56, color:'#ef4444', text:'CISD' },
          { type:'arrow_down', candle:10, y:65, color:'#ef4444' },
        ],
      },
      {
        title: 'CISD + OB Retrace Entry',
        context: 'After a bullish CISD, price retraces to the Order Block formed by the displacement candle. The OB aligns with the prior swing high (now support), creating a precise entry.',
        candles: [
          {o:65,h:67,l:64,c:66}, {o:66,h:67,l:63,c:64}, {o:64,h:65,l:61,c:62},
          {o:62,h:76,l:61.5,c:75},
          {o:75,h:78,l:74,c:77}, {o:77,h:80,l:76,c:79},
          {o:79,h:81,l:75,c:76}, {o:76,h:77,l:72,c:73},
          {o:73,h:74,l:68,c:69}, {o:69,h:73,l:68,c:72},
          {o:72,h:76,l:71,c:75}, {o:75,h:80,l:74,c:79},
        ],
        zones:   [{ yHi:76, yLo:62, color:'#6366f1', opacity:0.15, label:'OB' }],
        lines:   [{ y:67, color:'#22c55e', dash:true, label:'Prior Swing H' }],
        markers: [
          { type:'tag',      candle:3,  y:77, color:'#22c55e', text:'CISD' },
          { type:'arrow_up', candle:9,  y:68, color:'#22c55e' },
        ],
      },
      {
        title: 'LTF CISD After HTF Alignment',
        context: 'The higher timeframe is bullish. On the lower timeframe, price breaks a local swing high (CISD). This LTF shift aligns with HTF bias — highest-probability entry model.',
        candles: [
          {o:66,h:68,l:65,c:67}, {o:67,h:68,l:65,c:66}, {o:66,h:67,l:64,c:65},
          {o:65,h:66,l:62,c:63}, {o:63,h:64,l:61,c:62},
          {o:62,h:64,l:60,c:63}, {o:63,h:72,l:62.5,c:71},
          {o:71,h:74,l:70,c:73}, {o:73,h:75,l:70,c:71},
          {o:71,h:72,l:68,c:69}, {o:69,h:72,l:68,c:71},
          {o:71,h:75,l:70,c:74}, {o:74,h:78,l:73,c:77},
        ],
        lines:   [
          { y:68, color:'#22c55e', dash:true, label:'LTF Swing H' },
          { y:60, color:'#6366f1', dash:true, label:'HTF Support' },
        ],
        markers: [
          { type:'tag',      candle:6,  y:73, color:'#22c55e', text:'CISD' },
          { type:'arrow_up', candle:10, y:68, color:'#22c55e' },
        ],
      },
      {
        title: 'Failed CISD — Trap and Continuation',
        context: 'Price appears to break the swing high (false CISD), trapping long breakout buyers. It reverses immediately — the failed CISD becomes a short trigger, continuing the prior bearish trend.',
        candles: [
          {o:74,h:76,l:72,c:73}, {o:73,h:74,l:70,c:71}, {o:71,h:72,l:68,c:69},
          {o:69,h:70,l:66,c:67}, {o:67,h:68,l:64,c:65},
          {o:65,h:73,l:64,c:65.5},
          {o:65.5,h:66,l:60,c:61}, {o:61,h:62,l:57,c:58},
          {o:58,h:59,l:54,c:55}, {o:55,h:56,l:52,c:53},
        ],
        lines:   [{ y:70, color:'#f59e0b', dash:true, label:'Swing High' }],
        markers: [
          { type:'tag',        candle:5, y:74.5, color:'#ef4444', text:'FAILED CISD' },
          { type:'arrow_down', candle:6, y:66,   color:'#ef4444' },
        ],
      },
    ],

    ote: [
      {
        title: 'Bullish OTE — 62% Fib Retrace, Clean Entry',
        context: 'A clear swing low to swing high is established. Price retraces to the 62% Fibonacci level — the Optimal Trade Entry zone — and holds, continuing the trend.',
        candles: [
          {o:55,h:57,l:54,c:56}, {o:56,h:58,l:55,c:57}, {o:57,h:72,l:56.5,c:71},
          {o:71,h:75,l:70,c:74}, {o:74,h:77,l:73,c:76},
          {o:76,h:78,l:73,c:74}, {o:74,h:75,l:70,c:71},
          {o:71,h:72,l:66,c:67},
          {o:67,h:69,l:65,c:68}, {o:68,h:73,l:67,c:72},
          {o:72,h:77,l:71,c:76}, {o:76,h:80,l:75,c:79},
        ],
        zones:   [{ yHi:69, yLo:64, color:'#22c55e', opacity:0.18, label:'62–79% OTE' }],
        lines:   [{ y:66.5, color:'#22c55e', dash:true, label:'62%' }],
        markers: [{ type:'arrow_up', candle:8, y:65, color:'#22c55e' }],
      },
      {
        title: 'Bearish OTE — 62% Retrace of Down Swing',
        context: 'After a clean bearish impulse, price retraces up to the 62% level. The OTE zone overhead is where institutional shorts re-enter — entry with a tight stop above the 79% level.',
        candles: [
          {o:78,h:80,l:77,c:79}, {o:79,h:80,l:77,c:78}, {o:78,h:79,l:63,c:64},
          {o:64,h:65,l:61,c:62}, {o:62,h:63,l:59,c:60},
          {o:60,h:61,l:58,c:59}, {o:59,h:64,l:58,c:63},
          {o:63,h:69,l:62,c:68},
          {o:68,h:72,l:67,c:69}, {o:69,h:70,l:62,c:63},
          {o:63,h:64,l:58,c:59}, {o:59,h:60,l:54,c:55},
        ],
        zones:   [{ yHi:73, yLo:68, color:'#ef4444', opacity:0.18, label:'62–79% OTE' }],
        lines:   [{ y:70, color:'#ef4444', dash:true, label:'62%' }],
        markers: [{ type:'arrow_down', candle:8, y:72, color:'#ef4444' }],
      },
      {
        title: 'Deep OTE — 79% With Liquidity Sweep',
        context: 'Price dips below the 79% Fibonacci level to sweep stops, then snaps back. The wick through 79% grabs the sell-side liquidity; the reversal candle is the entry signal.',
        candles: [
          {o:57,h:58,l:56,c:57}, {o:57,h:76,l:56.5,c:75},
          {o:75,h:79,l:74,c:78}, {o:78,h:81,l:77,c:80},
          {o:80,h:82,l:77,c:78}, {o:78,h:79,l:74,c:75},
          {o:75,h:76,l:71,c:72}, {o:72,h:73,l:68,c:69},
          {o:69,h:70,l:64,c:65},
          {o:65,h:70,l:64,c:69}, {o:69,h:75,l:68,c:74},
          {o:74,h:79,l:73,c:78},
        ],
        zones:   [{ yHi:71, yLo:64, color:'#22c55e', opacity:0.18, label:'OTE 62–79%' }],
        lines:   [
          { y:71, color:'#22c55e', dash:false },
          { y:64, color:'#22c55e', dash:true, label:'79%' },
        ],
        markers: [
          { type:'tag',      candle:8, y:63.5, color:'#22c55e', text:'SWEEP' },
          { type:'arrow_up', candle:9, y:64, color:'#22c55e' },
        ],
      },
      {
        title: 'OTE After Structure Break',
        context: 'A market structure shift (break of the prior swing high) confirms the trend change. Price then retraces into the OTE zone of the new swing — precise entry in the direction of the new structure.',
        candles: [
          {o:67,h:69,l:66,c:68}, {o:68,h:69,l:65,c:66}, {o:66,h:67,l:63,c:64},
          {o:64,h:78,l:63.5,c:77},
          {o:77,h:80,l:76,c:79}, {o:79,h:82,l:78,c:81},
          {o:81,h:83,l:77,c:78}, {o:78,h:79,l:74,c:75},
          {o:75,h:76,l:71,c:72},
          {o:72,h:75,l:71,c:74}, {o:74,h:79,l:73,c:78},
          {o:78,h:83,l:77,c:82},
        ],
        zones:   [{ yHi:76, yLo:71, color:'#22c55e', opacity:0.18, label:'OTE' }],
        lines:   [{ y:69, color:'#f59e0b', dash:true, label:'MSS Level' }],
        markers: [
          { type:'tag',      candle:3,  y:79, color:'#22c55e', text:'MSS' },
          { type:'arrow_up', candle:9,  y:71, color:'#22c55e' },
        ],
      },
      {
        title: 'OTE + FVG Confluence at 62%',
        context: 'An FVG from the impulse swing aligns precisely with the 62% retracement level. Price taps the FVG, which sits inside the OTE zone, creating the highest-probability entry in this model.',
        candles: [
          {o:58,h:60,l:57,c:59}, {o:59,h:61,l:58,c:60},
          {o:60,h:76,l:59.5,c:75}, {o:75,h:79,l:68,c:78},
          {o:78,h:81,l:77,c:80}, {o:80,h:82,l:78,c:79},
          {o:79,h:80,l:75,c:76}, {o:76,h:77,l:71,c:72},
          {o:72,h:73,l:67,c:68},
          {o:68,h:72,l:67,c:71}, {o:71,h:76,l:70,c:75},
          {o:75,h:80,l:74,c:79},
        ],
        zones: [
          { yHi:72, yLo:68, color:'#22c55e', opacity:0.22, label:'FVG' },
          { yHi:74, yLo:67, color:'#22c55e', opacity:0.10, label:'OTE' },
        ],
        lines:   [{ y:70, color:'#22c55e', dash:true, label:'62%' }],
        markers: [{ type:'arrow_up', candle:9, y:67, color:'#22c55e' }],
      },
    ],

    sweep: [
      {
        title: 'BSL Sweep — Buy Stops Above Equal Highs Taken',
        context: 'Two or more highs at the same level accumulate buy-stop orders above them. Price spikes above, triggers those stops, then reverses. The sweep candle is the short signal.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:70,l:64,c:67}, {o:67,h:70,l:65,c:66},
          {o:66,h:68,l:64,c:65}, {o:65,h:67,l:63,c:64},
          {o:64,h:70,l:63,c:65}, {o:65,h:66,l:62,c:63},
          {o:63,h:75,l:62,c:64},
          {o:64,h:65,l:59,c:60}, {o:60,h:61,l:56,c:57},
          {o:57,h:58,l:53,c:54}, {o:54,h:55,l:51,c:52},
        ],
        lines:   [{ y:70, color:'#f59e0b', dash:true, label:'Equal Highs' }],
        markers: [
          { type:'tag',        candle:7, y:76.5, color:'#ef4444', text:'BSL TAKEN' },
          { type:'arrow_down', candle:8, y:65,   color:'#ef4444' },
        ],
      },
      {
        title: 'SSL Sweep — Sell Stops Below Equal Lows Taken',
        context: 'Multiple lows at the same price pack sell-stop orders below. Price sweeps through them, triggering late shorts, then snaps back up as institutional buying absorbs the sell flow.',
        candles: [
          {o:70,h:72,l:68,c:71}, {o:71,h:73,l:66,c:67}, {o:67,h:69,l:66,c:68},
          {o:68,h:70,l:66,c:67}, {o:67,h:69,l:65,c:66},
          {o:66,h:68,l:66,c:67}, {o:67,h:69,l:65,c:66},
          {o:66,h:67,l:60,c:65},
          {o:65,h:70,l:64,c:69}, {o:69,h:74,l:68,c:73},
          {o:73,h:77,l:72,c:76}, {o:76,h:80,l:75,c:79},
        ],
        lines:   [{ y:66, color:'#f59e0b', dash:true, label:'Equal Lows' }],
        markers: [
          { type:'tag',      candle:7, y:59.5, color:'#22c55e', text:'SSL TAKEN' },
          { type:'arrow_up', candle:8, y:64,   color:'#22c55e' },
        ],
      },
      {
        title: 'Double Sweep — Both Sides Taken, Then Direction',
        context: 'Price sweeps the lows (SSL), bounces to sweep the highs (BSL), then commits to the primary direction. Both sides of the market are cleared before the real move begins.',
        candles: [
          {o:68,h:70,l:67,c:69}, {o:69,h:70,l:64,c:65},
          {o:65,h:72,l:64,c:71}, {o:71,h:73,l:70,c:72},
          {o:72,h:73,l:68,c:69}, {o:69,h:74,l:68,c:73},
          {o:73,h:78,l:72,c:74},
          {o:74,h:75,l:62,c:63},
          {o:63,h:64,l:59,c:60}, {o:60,h:61,l:57,c:58},
          {o:58,h:59,l:55,c:56},
        ],
        lines:   [
          { y:64, color:'#22c55e', dash:true, label:'SSL' },
          { y:73, color:'#ef4444', dash:true, label:'BSL' },
        ],
        markers: [
          { type:'tag',        candle:1,  y:63,   color:'#22c55e', text:'SSL' },
          { type:'tag',        candle:6,  y:79.5, color:'#ef4444', text:'BSL' },
          { type:'arrow_down', candle:7,  y:75,   color:'#ef4444' },
        ],
      },
      {
        title: 'Trendline Liquidity — Sweep Below Rising Lows',
        context: 'A series of higher lows forms an ascending trendline. The stops below those lows are swept in one candle. The trendline "break" is actually a liquidity grab before continuation.',
        candles: [
          {o:58,h:60,l:57,c:59}, {o:59,h:62,l:58,c:61}, {o:61,h:64,l:60,c:63},
          {o:63,h:66,l:62,c:65}, {o:65,h:68,l:64,c:67},
          {o:67,h:69,l:66,c:68}, {o:68,h:70,l:67,c:69},
          {o:69,h:71,l:62,c:70},
          {o:70,h:74,l:69,c:73}, {o:73,h:77,l:72,c:76},
          {o:76,h:79,l:75,c:78},
        ],
        markers: [
          { type:'tag',      candle:7, y:61, color:'#22c55e', text:'SWEEP' },
          { type:'arrow_up', candle:8, y:62, color:'#22c55e' },
        ],
      },
      {
        title: 'Premium→Discount Flip After SSL',
        context: 'Price is in premium (above 50% of range). Stops below the 50% equilibrium are swept. Price then trades in discount, flipping institutional bias from distribution to accumulation.',
        candles: [
          {o:72,h:74,l:70,c:73}, {o:73,h:75,l:71,c:72}, {o:72,h:73,l:69,c:70},
          {o:70,h:71,l:67,c:68}, {o:68,h:69,l:65,c:66},
          {o:66,h:67,l:60,c:65},
          {o:65,h:69,l:64,c:68}, {o:68,h:73,l:67,c:72},
          {o:72,h:76,l:71,c:75}, {o:75,h:79,l:74,c:78},
        ],
        lines:   [{ y:67, color:'#6366f1', dash:true, label:'50% Equil.' }],
        markers: [
          { type:'tag',      candle:5, y:59, color:'#22c55e', text:'SSL' },
          { type:'arrow_up', candle:6, y:64, color:'#22c55e' },
        ],
      },
    ],

    asia: [
      {
        title: 'Asia Range → Bullish London Breakout',
        context: 'Asia session consolidates in a tight range. London open drives price above the Asia high with conviction. The Asia high becomes support on the first pullback.',
        candles: [
          {o:63,h:66,l:62,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:66,l:62,c:63},
          {o:63,h:65,l:62,c:64}, {o:64,h:66,l:62,c:63}, {o:63,h:65,l:62,c:64},
          {o:64,h:76,l:63.5,c:75},
          {o:75,h:78,l:74,c:77}, {o:77,h:79,l:74,c:75},
          {o:75,h:76,l:66.5,c:67}, {o:67,h:71,l:66,c:70},
          {o:70,h:75,l:69,c:74}, {o:74,h:78,l:73,c:77},
        ],
        zones:   [{ yHi:66, yLo:62, color:'#6366f1', opacity:0.15, label:'Asia Range' }],
        lines:   [{ y:66, color:'#6366f1', dash:true, label:'Asia High' }],
        markers: [
          { type:'tag',      candle:6,  y:77, color:'#22c55e', text:'LONDON BRK' },
          { type:'arrow_up', candle:10, y:66, color:'#22c55e' },
        ],
      },
      {
        title: 'Asia Range → Bearish London Breakdown',
        context: 'After a quiet Asia session, London drives price below the Asia low. The Asia low flips to resistance. Short entry on the first retrace back into the Asia range from below.',
        candles: [
          {o:64,h:67,l:63,c:66}, {o:66,h:67,l:64,c:65}, {o:65,h:67,l:63,c:64},
          {o:64,h:66,l:63,c:65}, {o:65,h:67,l:63,c:64}, {o:64,h:66,l:63,c:65},
          {o:65,h:66,l:54,c:55},
          {o:55,h:56,l:52,c:53}, {o:53,h:59,l:52,c:58},
          {o:58,h:64,l:57,c:62}, {o:62,h:65,l:61,c:63},
          {o:63,h:64,l:57,c:58}, {o:58,h:59,l:54,c:55},
        ],
        zones:   [{ yHi:67, yLo:63, color:'#6366f1', opacity:0.15, label:'Asia Range' }],
        lines:   [{ y:63, color:'#ef4444', dash:true, label:'Asia Low' }],
        markers: [
          { type:'tag',        candle:6,  y:53, color:'#ef4444', text:'LONDON BRK' },
          { type:'arrow_down', candle:10, y:65, color:'#ef4444' },
        ],
      },
      {
        title: 'Asia High Swept — False Break, Reversal Down',
        context: 'Price spikes above the Asia high early in London, triggering buy stops. It immediately reverses back inside the range and through the Asia low — the classic Asia range false break (Turtle Soup variant).',
        candles: [
          {o:63,h:66,l:62,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:66,l:62,c:63},
          {o:63,h:65,l:62,c:64}, {o:64,h:65.5,l:62,c:63},
          {o:63,h:74,l:62,c:63.5},
          {o:63.5,h:64,l:59,c:60}, {o:60,h:61,l:56,c:57},
          {o:57,h:58,l:53,c:54}, {o:54,h:55,l:50,c:51},
        ],
        zones:   [{ yHi:66, yLo:62, color:'#6366f1', opacity:0.15, label:'Asia Range' }],
        markers: [
          { type:'tag',        candle:5, y:75.5, color:'#ef4444', text:'BSL SWEPT' },
          { type:'arrow_down', candle:6, y:64,   color:'#ef4444' },
        ],
      },
      {
        title: 'Asia Low Swept — False Break, Reversal Up',
        context: 'London dips below the Asia low, grabs sell stops, and snaps back inside the range. The wick below becomes a spring — price drives through the Asia high and beyond.',
        candles: [
          {o:64,h:67,l:63,c:66}, {o:66,h:67,l:64,c:65}, {o:65,h:67,l:63,c:64},
          {o:64,h:66,l:63,c:65}, {o:65,h:67,l:63,c:64},
          {o:64,h:65,l:59,c:64},
          {o:64,h:74,l:63.5,c:73}, {o:73,h:77,l:72,c:76},
          {o:76,h:79,l:75,c:78}, {o:78,h:81,l:77,c:80},
        ],
        zones:   [{ yHi:67, yLo:63, color:'#6366f1', opacity:0.15, label:'Asia Range' }],
        markers: [
          { type:'tag',      candle:5, y:58.5, color:'#22c55e', text:'SSL SWEPT' },
          { type:'arrow_up', candle:6, y:59,   color:'#22c55e' },
        ],
      },
      {
        title: 'Tight Asia Range — Explosive Expansion',
        context: 'An unusually tight Asia session compresses price into a narrow band. Coiled energy releases on the London open with a large-range candle. The tighter the Asia range, the larger the expected expansion.',
        candles: [
          {o:65,h:65.8,l:64.8,c:65.3}, {o:65.3,h:65.9,l:65,c:65.5},
          {o:65.5,h:66,l:65.1,c:65.3}, {o:65.3,h:65.9,l:65,c:65.6},
          {o:65.6,h:66,l:65.1,c:65.4}, {o:65.4,h:65.9,l:65,c:65.5},
          {o:65.5,h:79,l:65,c:78},
          {o:78,h:81,l:77,c:80}, {o:80,h:83,l:79,c:82},
          {o:82,h:85,l:81,c:84},
        ],
        zones:   [{ yHi:66, yLo:65, color:'#6366f1', opacity:0.25, label:'Asia Range' }],
        markers: [
          { type:'tag',      candle:6, y:80.5, color:'#22c55e', text:'EXPANSION' },
          { type:'arrow_up', candle:7, y:65,   color:'#22c55e' },
        ],
      },
    ],

    amd: [
      {
        title: 'Classic AMD — Accumulation · Manipulation · Distribution',
        context: 'Asia session accumulates (tight range). London manipulates by sweeping the Asia low (trap). New York distributes — the real directional move begins off the swept low.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:66,l:63,c:65},
          {o:65,h:66,l:63,c:64},
          {o:64,h:65,l:59,c:64},
          {o:64,h:68,l:63.5,c:67}, {o:67,h:71,l:66,c:70},
          {o:70,h:74,l:69,c:73}, {o:73,h:77,l:72,c:76},
          {o:76,h:80,l:75,c:79}, {o:79,h:83,l:78,c:82},
        ],
        zones: [
          { yHi:66, yLo:63, color:'#6366f1', opacity:0.15, label:'A — Accumulation' },
        ],
        markers: [
          { type:'tag', candle:4, y:58.5, color:'#f59e0b', text:'M — Manip.'    },
          { type:'tag', candle:7, y:75,   color:'#22c55e', text:'D — Distrib.'  },
        ],
      },
      {
        title: 'Bearish AMD — High Swept, Distribution Sells',
        context: 'Asia consolidates. London sweeps the Asia high (manipulation up). New York distributes — aggressive sell-off below the Asia range that runs throughout the NY session.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:66,l:63,c:65},
          {o:65,h:66,l:63,c:64},
          {o:64,h:73,l:63.5,c:64},
          {o:64,h:65,l:59,c:60}, {o:60,h:61,l:56,c:57},
          {o:57,h:58,l:53,c:54}, {o:54,h:55,l:51,c:52},
          {o:52,h:53,l:49,c:50}, {o:50,h:51,l:47,c:48},
        ],
        zones: [
          { yHi:66, yLo:63, color:'#6366f1', opacity:0.15, label:'A — Asia Range' },
        ],
        markers: [
          { type:'tag',        candle:4, y:74.5, color:'#f59e0b', text:'M — Manip.' },
          { type:'tag',        candle:5, y:58,   color:'#ef4444', text:'D — Distrib.' },
          { type:'arrow_down', candle:5, y:64,   color:'#ef4444' },
        ],
      },
      {
        title: 'AMD With OB Entry on Manipulation Leg',
        context: 'During the manipulation leg, price creates an Order Block before reversing. The OB marks the precise re-entry point as price distributes in the true direction.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:65.5,l:63,c:64},
          {o:64,h:65,l:62,c:63},
          {o:63,h:64,l:57,c:63},
          {o:63,h:68,l:62.5,c:67}, {o:67,h:72,l:66,c:71},
          {o:71,h:73,l:68,c:69},
          {o:69,h:70,l:65,c:66}, {o:66,h:70,l:65,c:69},
          {o:69,h:74,l:68,c:73}, {o:73,h:78,l:72,c:77},
        ],
        zones:   [{ yHi:64, yLo:60, color:'#6366f1', opacity:0.22, label:'OB (Manip. Low)' }],
        markers: [
          { type:'tag',      candle:4, y:56.5, color:'#f59e0b', text:'MANIPULATION' },
          { type:'arrow_up', candle:9, y:65,   color:'#22c55e' },
        ],
      },
      {
        title: 'Intraday AMD — 15m Timeframe Cycle',
        context: 'The Power of 3 plays out in a single trading day on the 15m chart. Morning accumulation → midday sweep/manipulation → afternoon session strong directional move.',
        candles: [
          {o:65,h:67,l:64,c:66}, {o:66,h:67,l:64,c:65}, {o:65,h:67,l:64,c:66},
          {o:66,h:67,l:64,c:65}, {o:65,h:67,l:64,c:66},
          {o:66,h:67,l:61,c:65},
          {o:65,h:68,l:64.5,c:67}, {o:67,h:71,l:66,c:70},
          {o:70,h:74,l:69,c:73}, {o:73,h:77,l:72,c:76},
          {o:76,h:80,l:75,c:79},
        ],
        zones: [
          { yHi:67, yLo:64, color:'#6366f1', opacity:0.12, label:'Accumulation' },
        ],
        lines: [{ y:61, color:'#f59e0b', dash:true, label:'Manip. Low' }],
        markers: [
          { type:'arrow_up', candle:7, y:64, color:'#22c55e' },
          { type:'tag',      candle:9, y:75, color:'#22c55e', text:'DISTRIBUTION' },
        ],
      },
      {
        title: 'Weekly AMD — Mon/Tue Accumulate, Wed Sweep, Thu/Fri Run',
        context: 'On the daily chart, Monday-Tuesday price consolidates. Wednesday\'s candle is the manipulation sweep. Thursday-Friday is the distribution leg — the classic weekly Power of 3 structure.',
        candles: [
          {o:64,h:67,l:63,c:66}, {o:66,h:68,l:65,c:67},
          {o:67,h:68,l:61,c:67},
          {o:67,h:73,l:66.5,c:72}, {o:72,h:77,l:71,c:76},
          {o:76,h:80,l:75,c:79}, {o:79,h:83,l:78,c:82},
        ],
        zones: [
          { yHi:68, yLo:63, color:'#6366f1', opacity:0.15, label:'Mon–Tue (A)' },
        ],
        markers: [
          { type:'tag',      candle:2, y:60.5, color:'#f59e0b', text:'Wed (M)' },
          { type:'tag',      candle:4, y:74,   color:'#22c55e', text:'Thu–Fri (D)' },
          { type:'arrow_up', candle:3, y:61.5, color:'#22c55e' },
        ],
      },
    ],

    killzone: [
      {
        title: 'London Open Killzone — OB Entry at Open (2-5am NY)',
        context: 'At the London open, price sweeps the Asia low into a bullish OB. The combination of killzone timing + OB + liquidity grab creates a reliable long entry at the start of European trading.',
        candles: [
          {o:64,h:66,l:63,c:65}, {o:65,h:66,l:63,c:64}, {o:64,h:65,l:63,c:64},
          {o:64,h:65,l:60,c:64},
          {o:64,h:76,l:63.5,c:75}, {o:75,h:78,l:74,c:77},
          {o:77,h:79,l:74,c:75}, {o:75,h:76,l:71,c:72},
          {o:72,h:73,l:67,c:68}, {o:68,h:72,l:67,c:71},
          {o:71,h:76,l:70,c:75},
        ],
        zones:   [{ yHi:65, yLo:61, color:'#6366f1', opacity:0.22, label:'Bull OB' }],
        lines:   [{ y:63, color:'#f59e0b', dash:true, label:'Asia Low' }],
        markers: [{ type:'arrow_up', candle:9, y:67, color:'#22c55e' }],
      },
      {
        title: 'NY AM Killzone — Sweep + Long (7-10am NY)',
        context: 'At the NY open (7-10am), price dips below the London low, triggering sell stops. A reversal into a local FVG confirms the setup. This is the highest-volume killzone of the day.',
        candles: [
          {o:68,h:71,l:67,c:70}, {o:70,h:73,l:69,c:72}, {o:72,h:74,l:71,c:73},
          {o:73,h:74,l:70,c:71}, {o:71,h:72,l:68,c:69},
          {o:69,h:70,l:64,c:68},
          {o:68,h:76,l:67.5,c:75}, {o:75,h:78,l:74,c:77},
          {o:77,h:79,l:74,c:75}, {o:75,h:79,l:74,c:78},
          {o:78,h:82,l:77,c:81},
        ],
        zones:   [{ yHi:70, yLo:67, color:'#22c55e', opacity:0.18, label:'FVG' }],
        lines:   [{ y:68, color:'#f59e0b', dash:true, label:'London Low' }],
        markers: [
          { type:'tag',      candle:5, y:63.5, color:'#22c55e', text:'NY OPEN' },
          { type:'arrow_up', candle:6, y:67,   color:'#22c55e' },
        ],
      },
      {
        title: 'NY PM Killzone — 2pm Reversal from OB (1-4pm NY)',
        context: 'At 2pm NY, price has been grinding upward all morning. It taps into a bearish OB left from the AM session. The killzone timing + OB creates a short scalp against the morning trend.',
        candles: [
          {o:60,h:62,l:59,c:61}, {o:61,h:64,l:60,c:63}, {o:63,h:67,l:62,c:66},
          {o:66,h:69,l:65,c:68}, {o:68,h:72,l:67,c:71},
          {o:71,h:76,l:70,c:75},
          {o:75,h:76,l:70,c:71}, {o:71,h:72,l:66,c:67},
          {o:67,h:68,l:63,c:64}, {o:64,h:65,l:60,c:61},
        ],
        zones:   [{ yHi:76, yLo:72, color:'#ef4444', opacity:0.22, label:'Bear OB' }],
        lines:   [{ y:72, color:'#f59e0b', dash:true, label:'2pm Level' }],
        markers: [
          { type:'tag',        candle:5, y:77.5, color:'#ef4444', text:'2PM KZ' },
          { type:'arrow_down', candle:6, y:76,   color:'#ef4444' },
        ],
      },
      {
        title: 'London Close Killzone — Fade the London High (10am-12pm NY)',
        context: 'At the London close, European institutions square off positions. A sharp reversal from the London session high is common — short into the London close from the session high OB.',
        candles: [
          {o:60,h:62,l:59,c:61}, {o:61,h:65,l:60,c:64}, {o:64,h:69,l:63,c:68},
          {o:68,h:73,l:67,c:72}, {o:72,h:77,l:71,c:74},
          {o:74,h:75,l:69,c:70}, {o:70,h:71,l:65,c:66},
          {o:66,h:67,l:62,c:63}, {o:63,h:64,l:59,c:60},
          {o:60,h:61,l:57,c:58},
        ],
        zones:   [{ yHi:77, yLo:73, color:'#ef4444', opacity:0.22, label:'London High OB' }],
        markers: [
          { type:'tag',        candle:4, y:78.5, color:'#ef4444', text:'LDN CLOSE KZ' },
          { type:'arrow_down', candle:5, y:75,   color:'#ef4444' },
        ],
      },
      {
        title: 'Asian Killzone — Range Formation, OB for London (8pm-midnight NY)',
        context: 'The Asian killzone sets up the range that London will trade against. A clean bearish OB forms at the top of the Asia range. London opens and sweeps the Asia low, confirming the OB short.',
        candles: [
          {o:68,h:73,l:67,c:72}, {o:72,h:74,l:70,c:71},
          {o:71,h:72,l:67,c:68}, {o:68,h:69,l:65,c:66},
          {o:66,h:67,l:64,c:65}, {o:65,h:66,l:63,c:64},
          {o:64,h:65,l:58,c:63},
          {o:63,h:70,l:62,c:69}, {o:69,h:72,l:68,c:71},
          {o:71,h:73,l:68,c:70}, {o:70,h:72,l:67,c:68},
          {o:68,h:69,l:62,c:63},
        ],
        zones: [
          { yHi:74, yLo:70, color:'#ef4444', opacity:0.20, label:'Asia Bear OB' },
          { yHi:67, yLo:64, color:'#6366f1', opacity:0.12, label:'Asia Range Low' },
        ],
        markers: [
          { type:'tag',        candle:6,  y:57,   color:'#22c55e', text:'ASIA SSL' },
          { type:'arrow_down', candle:10, y:74,   color:'#ef4444' },
        ],
      },
    ],

    continuation: [
      {
        title: 'OB Retap — Pullback to OB, Trend Continues',
        context: 'After an initial move up from an OB, price pulls back to retest the same zone. The second touch of the OB is the continuation entry — the trend resumes after the retap.',
        candles: [
          {o:60,h:62,l:59,c:61}, {o:61,h:62,l:59,c:60},
          {o:60,h:74,l:59.5,c:73}, {o:73,h:77,l:72,c:76},
          {o:76,h:79,l:75,c:78}, {o:78,h:80,l:74,c:75},
          {o:75,h:76,l:71,c:72}, {o:72,h:73,l:67,c:68},
          {o:68,h:72,l:67,c:71}, {o:71,h:76,l:70,c:75},
          {o:75,h:80,l:74,c:79}, {o:79,h:83,l:78,c:82},
        ],
        zones:   [{ yHi:62, yLo:59, color:'#6366f1', opacity:0.22, label:'Bull OB' }],
        markers: [
          { type:'tag',      candle:2,  y:75, color:'#22c55e', text:'1st entry'  },
          { type:'arrow_up', candle:8,  y:67, color:'#22c55e' },
        ],
      },
      {
        title: 'FVG Fill → Continuation of Prior Trend',
        context: 'After a strong impulse leaves an FVG, price pulls back into it. The FVG acts as a magnet — once filled, price resumes in the original direction with the same or greater momentum.',
        candles: [
          {o:58,h:60,l:57,c:59},
          {o:59,h:75,l:58.5,c:74}, {o:74,h:78,l:66,c:77},
          {o:77,h:80,l:76,c:79}, {o:79,h:81,l:76,c:77},
          {o:77,h:78,l:73,c:74}, {o:74,h:75,l:68,c:69},
          {o:69,h:73,l:67,c:72}, {o:72,h:76,l:71,c:75},
          {o:75,h:80,l:74,c:79}, {o:79,h:84,l:78,c:83},
        ],
        zones:   [{ yHi:66, yLo:60, color:'#22c55e', opacity:0.18, label:'FVG' }],
        markers: [
          { type:'arrow_up', candle:7, y:67, color:'#22c55e' },
        ],
      },
      {
        title: 'Higher High Structure — Pullback to Prior High',
        context: 'A break above a prior swing high establishes bullish structure. The prior high becomes support. Price pulls back to that exact level and holds — the classic break-and-retest continuation.',
        candles: [
          {o:60,h:64,l:59,c:63}, {o:63,h:67,l:62,c:64},
          {o:64,h:65,l:61,c:62}, {o:62,h:66,l:61,c:65},
          {o:65,h:73,l:64.5,c:72},
          {o:72,h:75,l:71,c:74}, {o:74,h:76,l:70,c:71},
          {o:71,h:72,l:68,c:69}, {o:69,h:73,l:68,c:72},
          {o:72,h:77,l:71,c:76}, {o:76,h:80,l:75,c:79},
        ],
        lines:   [{ y:67, color:'#22c55e', dash:true, label:'Prior High → Support' }],
        markers: [
          { type:'tag',      candle:4,  y:74, color:'#22c55e', text:'STRUCTURE BRK' },
          { type:'arrow_up', candle:8,  y:68, color:'#22c55e' },
        ],
      },
      {
        title: 'Consolidation Break-and-Retest',
        context: 'Price forms a tight consolidation (flag/base). A breakout above the consolidation high is followed by a retest of that level. The retest candle — holding the breakout level — is the entry.',
        candles: [
          {o:65,h:73,l:64,c:72},
          {o:72,h:73,l:70,c:71}, {o:71,h:73,l:70,c:72}, {o:72,h:73,l:70,c:71},
          {o:71,h:73,l:70,c:72}, {o:72,h:73,l:70,c:71},
          {o:71,h:79,l:70.5,c:78},
          {o:78,h:80,l:74,c:75}, {o:75,h:76,l:72.5,c:73},
          {o:73,h:77,l:72,c:76}, {o:76,h:81,l:75,c:80},
        ],
        zones:   [{ yHi:73, yLo:70, color:'#6366f1', opacity:0.15, label:'Consolidation' }],
        markers: [
          { type:'tag',      candle:6, y:80, color:'#22c55e', text:'BREAKOUT' },
          { type:'arrow_up', candle:8, y:73, color:'#22c55e' },
        ],
      },
      {
        title: 'Mid-Trend SSL Sweep → Continuation Long',
        context: 'In an established uptrend, a liquidity sweep of the most recent swing low shakes out weak longs. Institutional buyers step in at the sweep low, and the trend resumes with stronger momentum.',
        candles: [
          {o:60,h:63,l:59,c:62}, {o:62,h:66,l:61,c:65},
          {o:65,h:69,l:64,c:68}, {o:68,h:71,l:67,c:70},
          {o:70,h:73,l:67,c:68},
          {o:68,h:69,l:63,c:67},
          {o:67,h:73,l:66.5,c:72}, {o:72,h:76,l:71,c:75},
          {o:75,h:79,l:74,c:78}, {o:78,h:82,l:77,c:81},
        ],
        lines:   [{ y:67, color:'#f59e0b', dash:true, label:'Recent Low' }],
        markers: [
          { type:'tag',      candle:5, y:62.5, color:'#22c55e', text:'SWEEP' },
          { type:'arrow_up', candle:6, y:63,   color:'#22c55e' },
        ],
      },
    ],

  };

  /* ─────────────────────────────────────────────────────────
     Find built-in examples for a setup name
  ───────────────────────────────────────────────────────── */
  function findExamples(name) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('fvg') || lower.includes('ifvg') || lower.includes('fair value'))
      return { key:'fvg',           label:'FVG / IFVG',                 list: CHART_EXAMPLES.fvg };
    if (lower.includes('turtle') || lower.includes('false break') || lower.includes('false brk') || lower.includes('stop hunt'))
      return { key:'turtle',        label:'Turtle Soup',                 list: CHART_EXAMPLES.turtle };
    if (lower.includes('silver bullet'))
      return { key:'silver_bullet', label:'Silver Bullet',               list: CHART_EXAMPLES.silver_bullet };
    if (/\border\s*block\b|\bob\b/.test(lower) || lower.includes('order block'))
      return { key:'order_block',   label:'Order Block',                 list: CHART_EXAMPLES.order_block };
    if (lower.includes('breaker'))
      return { key:'breaker',       label:'Breaker Block',               list: CHART_EXAMPLES.breaker };
    if (lower.includes('cisd') || lower.includes('change in state'))
      return { key:'cisd',          label:'CISD',                        list: CHART_EXAMPLES.cisd };
    if (lower.includes('ote') || lower.includes('optimal trade'))
      return { key:'ote',           label:'OTE — Optimal Trade Entry',   list: CHART_EXAMPLES.ote };
    if ((lower.includes('sweep') || lower.includes('liquidity')) && !lower.includes('turtle') && !lower.includes('stop hunt') && !lower.includes('silver'))
      return { key:'sweep',         label:'Liquidity Sweep',             list: CHART_EXAMPLES.sweep };
    if (lower.includes('asia'))
      return { key:'asia',          label:'Asia Range',                  list: CHART_EXAMPLES.asia };
    if (lower.includes('power of 3') || lower.includes('amd') || lower.includes('accumulation'))
      return { key:'amd',           label:'Power of 3 / AMD',            list: CHART_EXAMPLES.amd };
    if (lower.includes('killzone') || lower.includes('kill zone'))
      return { key:'killzone',      label:'Killzone',                    list: CHART_EXAMPLES.killzone };
    if (lower.includes('continuation'))
      return { key:'continuation',  label:'Continuation',                list: CHART_EXAMPLES.continuation };
    return null;
  }

  /* ─────────────────────────────────────────────────────────
     SVG mini-chart renderer
  ───────────────────────────────────────────────────────── */
  function makeMiniChart(ex, W, H) {
    W = W || 278; H = H || 152;
    const candles = ex.candles;
    const allP = candles.flatMap(c => [c.h, c.l]);
    const minP = Math.min(...allP);
    const maxP = Math.max(...allP);
    const span = maxP - minP || 1;
    const pad  = span * 0.13;
    const lo   = minP - pad;
    const hi   = maxP + pad;
    const rng  = hi - lo;

    function py(v) { return (H * (1 - (v - lo) / rng)).toFixed(2); }
    const n  = candles.length;
    const cw = W / n;
    const bw = Math.max(cw * 0.55, 2.5);

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">`;

    // bg
    s += `<rect width="${W}" height="${H}" fill="var(--bg-card,#fff)"/>`;

    // grid
    for (let i = 1; i <= 3; i++) {
      const gy = (H * i / 4).toFixed(1);
      s += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="var(--border,#e5e7eb)" stroke-width="0.6"/>`;
    }

    // zones
    for (const z of (ex.zones || [])) {
      const zy1 = parseFloat(py(z.yHi));
      const zy2 = parseFloat(py(z.yLo));
      const x1 = z.x1 != null ? (z.x1 * cw).toFixed(1) : '0';
      const zW  = z.x2 != null ? ((z.x2 - z.x1) * cw).toFixed(1) : W.toString();
      s += `<rect x="${x1}" y="${zy1.toFixed(2)}" width="${zW}" height="${(zy2 - zy1).toFixed(2)}" fill="${z.color}" opacity="${z.opacity || 0.2}" rx="1"/>`;
      if (z.label) s += `<text x="${parseFloat(x1) + 4}" y="${(zy1 + 10).toFixed(1)}" font-size="9" fill="${z.color}" font-family="system-ui,sans-serif" font-weight="700" opacity="1">${z.label}</text>`;
    }

    // lines
    for (const l of (ex.lines || [])) {
      const ly = py(l.y);
      const dash = l.dash ? ' stroke-dasharray="4 3"' : '';
      s += `<line x1="0" y1="${ly}" x2="${W}" y2="${ly}" stroke="${l.color}" stroke-width="1.1"${dash} opacity="0.9"/>`;
      if (l.label) s += `<text x="${W - 4}" y="${(parseFloat(ly) - 2.5).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${l.color}" font-family="system-ui,sans-serif" font-weight="700">${l.label}</text>`;
    }

    // candles
    for (let i = 0; i < n; i++) {
      const c  = candles[i];
      const cx = (i * cw + cw / 2).toFixed(2);
      const bull = c.c >= c.o;
      const col  = bull ? '#22c55e' : '#ef4444';
      const bt   = parseFloat(py(Math.max(c.o, c.c)));
      const bb   = parseFloat(py(Math.min(c.o, c.c)));
      const bH   = Math.max(bb - bt, 1.2).toFixed(2);
      const bx   = (i * cw + (cw - bw) / 2).toFixed(2);
      s += `<line x1="${cx}" y1="${py(c.h)}" x2="${cx}" y2="${py(c.l)}" stroke="${col}" stroke-width="1.1"/>`;
      s += `<rect x="${bx}" y="${bt.toFixed(2)}" width="${bw.toFixed(2)}" height="${bH}" fill="${col}" rx="0.5"/>`;
    }

    // markers
    for (const m of (ex.markers || [])) {
      const mx = (m.candle * cw + cw / 2);
      if (m.type === 'arrow_up') {
        const ay = parseFloat(py(m.y));
        const tip = ay + 2, base = ay + 16;
        s += `<polygon points="${mx.toFixed(1)},${tip.toFixed(1)} ${(mx-5).toFixed(1)},${base.toFixed(1)} ${(mx+5).toFixed(1)},${base.toFixed(1)}" fill="${m.color||'#22c55e'}"/>`;
      } else if (m.type === 'arrow_down') {
        const ay = parseFloat(py(m.y));
        const tip = ay - 2, base = ay - 16;
        s += `<polygon points="${mx.toFixed(1)},${tip.toFixed(1)} ${(mx-5).toFixed(1)},${base.toFixed(1)} ${(mx+5).toFixed(1)},${base.toFixed(1)}" fill="${m.color||'#ef4444'}"/>`;
      } else if (m.type === 'tag') {
        const ty  = parseFloat(py(m.y));
        const anc = mx > W / 2 ? 'end' : 'start';
        const tx  = anc === 'end' ? mx - 4 : mx + 4;
        s += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="${anc}" font-size="8.5" fill="${m.color||'var(--text)'}" font-family="system-ui,sans-serif" font-weight="800">${m.text}</text>`;
      }
    }

    s += '</svg>';
    return s;
  }

  /* ─────────────────────────────────────────────────────────
     Examples modal
  ───────────────────────────────────────────────────────── */
  function showExamplesModal(setup, found) {
    document.getElementById('pb_examples_modal')?.remove();

    const cards = found.list.map((ex, idx) => `
      <div style="background:var(--surface,var(--bg-2,#f9fafb));border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column">
        <div style="border-bottom:1px solid var(--border);background:var(--bg-card,#fff);padding:3px 3px 0">
          ${makeMiniChart(ex)}
        </div>
        <div style="padding:10px 13px 12px">
          <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px">${esc(ex.title)}</div>
          <div style="font-size:11.5px;color:var(--text-2);line-height:1.5">${esc(ex.context)}</div>
        </div>
      </div>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'pb_examples_modal';
    modal.style.cssText = [
      'position:fixed;inset:0;z-index:9999',
      'background:rgba(0,0,0,.52)',
      'display:flex;align-items:flex-start;justify-content:center',
      'padding:28px 16px 48px;overflow-y:auto',
    ].join(';');

    modal.innerHTML = `
      <div style="background:var(--bg-card,#fff);border-radius:16px;width:100%;max-width:980px;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden">

        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px 16px;border-bottom:1px solid var(--border)">
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:22px">${setupIcon(setup.name)}</span>
              <div>
                <div style="font-size:16px;font-weight:700;color:var(--text)">${esc(found.label)} — Chart Examples</div>
                <div style="font-size:12px;color:var(--text-2);margin-top:1px">5 real setup patterns · green = bullish · red = bearish</div>
              </div>
            </div>
          </div>
          <button
            onclick="document.getElementById('pb_examples_modal')?.remove()"
            style="width:32px;height:32px;border:none;background:var(--surface,var(--bg-2,#f0f0f0));border-radius:50%;font-size:17px;line-height:1;cursor:pointer;color:var(--text-2);flex-shrink:0;display:flex;align-items:center;justify-content:center"
            onmouseenter="this.style.background='var(--hover,rgba(0,0,0,.09))'"
            onmouseleave="this.style.background='var(--surface,var(--bg-2,#f0f0f0))'"
          >×</button>
        </div>

        <div style="padding:20px 22px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px">
          ${cards}
        </div>

        <div style="padding:12px 22px 18px;border-top:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2)"><span style="display:inline-block;width:12px;height:10px;background:#22c55e;border-radius:2px"></span>Bullish / Long setup</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2)"><span style="display:inline-block;width:12px;height:10px;background:#ef4444;border-radius:2px"></span>Bearish / Short setup</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2)"><span style="display:inline-block;width:12px;height:10px;background:#f59e0b;border-radius:2px"></span>IFVG or liquidity level</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2)"><span style="display:inline-block;width:12px;height:10px;background:#6366f1;border-radius:2px"></span>OB or range zone</div>
          <div style="margin-left:auto;font-size:11.5px;color:var(--text-2)">Click outside to close</div>
        </div>
      </div>
    `;

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  /* ─────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    const setups  = DB.recomputePlaybookStats();
    const sorted  = [...setups].sort((a, b) => (b.winRate ?? -999) - (a.winRate ?? -999));

    // Get Free Score + Rule Adherence summary cards live on the Dashboard tab
    // (see js/tabs/dashboard.js) — moved there 2026-07-01 for visibility.

    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Playbook</h1>
          <div class="sub">${sorted.length} approved setup${sorted.length !== 1 ? 's' : ''} · sorted by win rate</div>
        </div>
        <button onclick="PlaybookTab._addSetup()" style="display:flex;align-items:center;gap:6px;padding:9px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap"
          onmouseenter="this.style.opacity='.88'" onmouseleave="this.style.opacity='1'">
          <span style="font-size:18px;line-height:1;margin-top:-1px">+</span> New setup
        </button>
      </div>
      <div id="playbookGrid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start"></div>
    `;

    document.getElementById('playbookGrid').innerHTML =
      sorted.length ? sorted.map(s => setupCard(s)).join('') :
      `<div style="grid-column:1/-1;padding:64px 20px;text-align:center;color:var(--text-2)">
        No setups yet. Click <strong>+ New setup</strong> to add your first.
      </div>`;
  }

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function safeImgUrl(u) {
    return typeof u === 'string' && /^(https?:|data:image\/)/i.test(u) ? u : '';
  }

  function setupCard(s) {
    const safeId = /^[A-Za-z0-9_-]+$/.test(s.id) ? s.id : '';
    const ar     = s.avgR !== null ? (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R' : '—';
    const badge  = wrBadge(s.winRate);
    const icon   = setupIcon(s.name);
    const imgSrc = safeImgUrl(s.screenshotUrl);
    const hasEx  = !!findExamples(s.name);

    const extraRows = [];
    if (s.entryRules) extraRows.push(['Entry Rules', esc(s.entryRules)]);
    if (s.slRules)    extraRows.push(['SL', esc(s.slRules)]);
    if (s.tpRules)    extraRows.push(['TP', esc(s.tpRules)]);

    return `
      <div class="card" id="pb_${esc(safeId)}" style="padding:0;overflow:hidden;display:flex;flex-direction:column">

        <div id="pb_view_${esc(safeId)}" style="display:flex;flex-direction:column;flex:1">
          <div style="padding:20px 20px 0">

            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="font-size:26px;line-height:1;background:var(--surface,var(--bg-2,#f5f5f5));width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
                <div>
                  <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px">${esc(s.name)}</div>
                  <div style="font-size:12px;color:var(--text-2)">${s.tradeCount} trade${s.tradeCount !== 1 ? 's' : ''} · avg ${ar}</div>
                </div>
              </div>
              <div style="font-size:13px;font-weight:700;color:${badge.color};background:${badge.color}22;padding:3px 10px;border-radius:99px;white-space:nowrap;flex-shrink:0">${badge.label}</div>
            </div>

            <p style="font-size:13px;color:var(--text-2);line-height:1.55;margin:0 0 12px">${esc(s.description) || '<em>No description</em>'}</p>

            ${extraRows.map(([label, val]) => `
              <div style="margin-bottom:8px;font-size:12px;color:var(--text-2)">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${label}</div>
                <div style="white-space:pre-wrap">${val}</div>
              </div>`).join('')}

            ${imgSrc ? `<img src="${esc(imgSrc)}" style="width:100%;border-radius:6px;margin-bottom:12px" onerror="this.style.display='none'" />` : ''}

            ${(s.checklist || []).length > 0 ? `
              <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:16px">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin-bottom:8px">Pre-Trade Checklist</div>
                ${(s.checklist || []).map((item, i) => `
                  <div class="checklist-item${item.checked ? ' checked' : ''}">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="PlaybookTab._check('${safeId}',${i},this.checked)" />
                    ${esc(item.label)}
                  </div>`).join('')}
              </div>` : '<div style="margin-bottom:16px"></div>'}
          </div>

          <div style="margin-top:auto;border-top:1px solid var(--border);display:flex">
            <button style="flex:1;padding:13px;background:none;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;border-right:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:5px;${hasEx ? 'color:var(--accent)' : 'color:var(--text-2)'}"
              onmouseenter="this.style.background='var(--hover,rgba(0,0,0,.04))'" onmouseleave="this.style.background='none'"
              onclick="PlaybookTab._showExamples('${safeId}')">
              ${hasEx ? '📈' : '📋'} Examples${hasEx ? '' : ''}
            </button>
            <button style="flex:1;padding:13px;background:none;border:none;font-size:13px;font-weight:600;color:var(--accent);cursor:pointer;transition:background .15s"
              onmouseenter="this.style.background='var(--hover,rgba(0,0,0,.04))'" onmouseleave="this.style.background='none'"
              onclick="PlaybookTab._edit('${safeId}')">Edit</button>
          </div>
        </div>

        <div id="pb_edit_${esc(safeId)}" class="hidden" style="padding:20px">
          ${editForm(s)}
        </div>
      </div>
    `;
  }

  function editForm(s) {
    const safeId = /^[A-Za-z0-9_-]+$/.test(s.id) ? s.id : '';
    const cl = (s.checklist || []).map((item, i) =>
      `<div class="pb-cl-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input type="text" class="pb-cl-input" data-orig-idx="${i}" value="${esc(item.label)}" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.8rem" />
        <button class="btn-icon" onclick="PlaybookTab._removeCheck(this)">✕</button>
      </div>`
    ).join('');

    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px;font-weight:700;color:var(--text)">Edit Setup</div>
          <button class="btn-icon" onclick="PlaybookTab._del('${safeId}')" title="Delete setup" style="color:var(--red)">🗑</button>
        </div>
        <div class="form-group"><label>Name</label><input type="text" id="pbe_name_${esc(safeId)}" value="${esc(s.name)}" /></div>
        <div class="form-group"><label>Description</label><textarea id="pbe_desc_${esc(safeId)}" rows="2">${esc(s.description || '')}</textarea></div>
        <div class="form-group"><label>Entry Rules</label><textarea id="pbe_entry_${esc(safeId)}" rows="2">${esc(s.entryRules || '')}</textarea></div>
        <div class="form-group"><label>SL Rules</label><input type="text" id="pbe_sl_${esc(safeId)}" value="${esc(s.slRules || '')}" /></div>
        <div class="form-group"><label>TP Rules</label><input type="text" id="pbe_tp_${esc(safeId)}" value="${esc(s.tpRules || '')}" /></div>
        <div class="form-group"><label>Screenshot URL</label><input type="url" id="pbe_ss_${esc(safeId)}" value="${esc(s.screenshotUrl || '')}" /></div>
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--text-sub);margin-bottom:6px">Checklist Items</div>
          <div id="pb_cllist_${esc(safeId)}">${cl}</div>
          <button class="btn-ghost btn-sm" onclick="PlaybookTab._addCheck('${safeId}')" style="margin-top:6px">＋ Add Item</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary btn-sm" onclick="PlaybookTab._save('${safeId}')">Save</button>
          <button class="btn-ghost btn-sm" onclick="PlaybookTab._cancelEdit('${safeId}')">Cancel</button>
        </div>
      </div>
    `;
  }

  return {
    render,
    _edit: id => {
      document.getElementById(`pb_view_${id}`)?.classList.add('hidden');
      document.getElementById(`pb_edit_${id}`)?.classList.remove('hidden');
    },
    _cancelEdit: id => {
      document.getElementById(`pb_view_${id}`)?.classList.remove('hidden');
      document.getElementById(`pb_edit_${id}`)?.classList.add('hidden');
    },
    _showExamples: id => {
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;

      // Built-in chart examples for known setup types
      const found = findExamples(setup.name);
      if (found) { showExamplesModal(setup, found); return; }

      // Fallback: count tagged trades
      const trades = DB.getTrades().filter(t => (t.setupType || '').toLowerCase() === (setup.name || '').toLowerCase());
      if (!trades.length) { App.toast('No trades tagged to this setup yet — add a setup name like "FVG" to unlock chart examples'); return; }
      App.toast(`${trades.length} trade${trades.length !== 1 ? 's' : ''} tagged to "${setup.name}"`);
    },
    _save: id => {
      const g = s => document.getElementById(`pbe_${s}_${id}`)?.value || '';
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const existing = setup.checklist || [];
      const inputs = document.querySelectorAll(`#pb_cllist_${CSS.escape(id)} .pb-cl-input`);
      const cl = Array.from(inputs).map(inp => {
        const oi = inp.dataset.origIdx;
        const checked = (oi !== undefined && existing[+oi]) ? !!existing[+oi].checked : false;
        return { label: inp.value, checked };
      }).filter(item => item.label.trim());
      DB.updateSetup(id, {
        name: g('name'), description: g('desc'),
        entryRules: g('entry'), slRules: g('sl'), tpRules: g('tp'),
        screenshotUrl: g('ss'), checklist: cl
      });
      App.toast('Setup saved');
      render();
    },
    _check: (id, idx, val) => {
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const cl = [...(setup.checklist || [])];
      if (cl[idx]) cl[idx] = { ...cl[idx], checked: val };
      DB.updateSetup(id, { checklist: cl });
    },
    _addCheck: id => {
      const list = document.getElementById(`pb_cllist_${id}`);
      if (!list) return;
      const div = document.createElement('div');
      div.className = 'pb-cl-row';
      div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
      div.innerHTML = `<input type="text" class="pb-cl-input" placeholder="Checklist item…" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.8rem" /><button class="btn-icon" onclick="PlaybookTab._removeCheck(this)">✕</button>`;
      list.appendChild(div);
    },
    _removeCheck: btn => {
      btn?.closest('.pb-cl-row')?.remove();
    },
    _del: id => {
      App.confirmDelete('Delete this setup from the catalogue?', () => {
        DB.deleteSetup(id);
        App.toast('Setup deleted');
        render();
      });
    },
    _addSetup: () => {
      const name = prompt('Setup name:');
      if (!name?.trim()) return;
      DB.addSetup({ name: name.trim(), description: '', entryRules: '', slRules: '', tpRules: '', checklist: [], screenshotUrl: '' });
      render();
    }
  };
})();
