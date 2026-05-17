/* ═══════════════════════════════════════════════════════════
   MACRO EVENTS — hardcoded high-impact dates
   FOMC + CPI + NFP for Apr 2026 → Jun 2027
   Times in UTC. Update yearly.
════════════════════════════════════════════════════════════ */
const MacroEvents = (() => {

  // type: 'fomc' | 'cpi' | 'nfp'
  // impact: 'high' | 'medium'
  const EVENTS = [
    // ─── 2026 ───
    { date: '2026-04-29', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds rate decision + statement (2pm ET)' },
    { date: '2026-05-01', type: 'nfp',  name: 'Apr NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Apr) — 8:30am ET' },
    { date: '2026-05-13', type: 'cpi',  name: 'Apr CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Apr) — 8:30am ET' },
    { date: '2026-06-05', type: 'nfp',  name: 'May NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (May)' },
    { date: '2026-06-11', type: 'cpi',  name: 'May CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (May)' },
    { date: '2026-06-17', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds + SEP / dot plot' },
    { date: '2026-07-02', type: 'nfp',  name: 'Jun NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Jun)' },
    { date: '2026-07-15', type: 'cpi',  name: 'Jun CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Jun)' },
    { date: '2026-07-29', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds rate decision + statement' },
    { date: '2026-08-07', type: 'nfp',  name: 'Jul NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Jul)' },
    { date: '2026-08-12', type: 'cpi',  name: 'Jul CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Jul)' },
    { date: '2026-09-04', type: 'nfp',  name: 'Aug NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Aug)' },
    { date: '2026-09-10', type: 'cpi',  name: 'Aug CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Aug)' },
    { date: '2026-09-16', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds + SEP / dot plot' },
    { date: '2026-10-02', type: 'nfp',  name: 'Sep NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Sep)' },
    { date: '2026-10-15', type: 'cpi',  name: 'Sep CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Sep)' },
    { date: '2026-10-28', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds rate decision + statement' },
    { date: '2026-11-06', type: 'nfp',  name: 'Oct NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Oct)' },
    { date: '2026-11-12', type: 'cpi',  name: 'Oct CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Oct)' },
    { date: '2026-12-04', type: 'nfp',  name: 'Nov NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Nov)' },
    { date: '2026-12-09', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds + SEP / final 2026 meeting' },
    { date: '2026-12-10', type: 'cpi',  name: 'Nov CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Nov)' },

    // ─── 2027 ───
    { date: '2027-01-08', type: 'nfp',  name: 'Dec NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Dec)' },
    { date: '2027-01-13', type: 'cpi',  name: 'Dec CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Dec)' },
    { date: '2027-01-27', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds — first meeting of 2027' },
    { date: '2027-02-05', type: 'nfp',  name: 'Jan NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Jan)' },
    { date: '2027-02-10', type: 'cpi',  name: 'Jan CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Jan)' },
    { date: '2027-03-05', type: 'nfp',  name: 'Feb NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Feb)' },
    { date: '2027-03-10', type: 'cpi',  name: 'Feb CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Feb)' },
    { date: '2027-03-17', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds + SEP / dot plot' },
    { date: '2027-04-02', type: 'nfp',  name: 'Mar NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Mar)' },
    { date: '2027-04-14', type: 'cpi',  name: 'Mar CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Mar)' },
    { date: '2027-04-28', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds rate decision' },
    { date: '2027-05-07', type: 'nfp',  name: 'Apr NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (Apr)' },
    { date: '2027-05-12', type: 'cpi',  name: 'Apr CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (Apr)' },
    { date: '2027-06-04', type: 'nfp',  name: 'May NFP',             impact: 'high',   icon: '👷', desc: 'Non-farm payrolls (May)' },
    { date: '2027-06-10', type: 'cpi',  name: 'May CPI',             impact: 'high',   icon: '📊', desc: 'Consumer Price Index (May)' },
    { date: '2027-06-16', type: 'fomc', name: 'FOMC Rate Decision',  impact: 'high',   icon: '🏛️', desc: 'Fed funds + SEP / dot plot' },
  ];

  // Returns events on a given YYYY-MM-DD date (could be multiple)
  function onDate(dateStr) {
    return EVENTS.filter(e => e.date === dateStr);
  }

  // Returns the next upcoming event (today or after)
  function next() {
    const today = new Date().toISOString().slice(0,10);
    return EVENTS.find(e => e.date >= today) || null;
  }

  // Returns events within next N days
  function upcoming(days = 7) {
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const end = new Date(today); end.setUTCDate(today.getUTCDate() + days);
    return EVENTS.filter(e => {
      const d = new Date(e.date);
      return d >= today && d <= end;
    });
  }

  // All events in a given month (YYYY-MM)
  function inMonth(year, month0) {
    const prefix = `${year}-${String(month0 + 1).padStart(2,'0')}`;
    return EVENTS.filter(e => e.date.startsWith(prefix));
  }

  function daysUntil(dateStr) {
    const d = new Date(dateStr); const now = new Date();
    return Math.ceil((d - now) / (24*60*60*1000));
  }

  return { EVENTS, onDate, next, upcoming, inMonth, daysUntil };
})();
