/* ═══════════════════════════════════════════════════════════
   PERFORMANCE COACH TAB
   • Auto-flag alerts (7 types)
   • Trade grading insights
   • Weekly/monthly review prompts
   • Improvement goals progress
   • Setup catalogue performance cards
════════════════════════════════════════════════════════════ */
const CoachTab = (() => {

  let activeSubTab = 'alerts';

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="sub-tabs">
        ${['alerts','grading','review','catalogue']
          .map(id => `<div class="sub-tab${activeSubTab === id ? ' active' : ''}" onclick="CoachTab._sub('${id}')">${subLabel(id)}</div>`)
          .join('')}
      </div>
      <div id="coachContent"></div>
    `;
    renderSub();
  }

  function subLabel(id) {
    return { alerts: '🚨 Alerts', grading: '📊 Grade Insights', review: '📝 Reviews', catalogue: '📖 Setup Catalogue' }[id] || id;
  }

  function renderSub() {
    const wrap = document.getElementById('coachContent');
    if (!wrap) return;
    switch (activeSubTab) {
      case 'alerts':    renderAlerts(wrap); break;
      case 'grading':   renderGrading(wrap); break;
      case 'review':    renderReview(wrap); break;
      case 'catalogue': renderCatalogue(wrap); break;
    }
  }

  /* Telegram setup moved to Pro Tools tab — old renderTelegram_DEPRECATED
     was never reachable from the sub-nav (sub-tabs are alerts/grading/review/
     catalogue). Removed 2026-05-10 audit. */

  /* ═══════════════════════════════════════════════════════
     ALERT ENGINE — 7 alert types
  ═══════════════════════════════════════════════════════ */
  function computeAlerts() {
    const trades = DB.getTrades();
    const goals  = DB.getGoals();
    const alerts = [];

    // Helper: last N trades (closed)
    const closed = trades.filter(t => t.result !== undefined && t.result !== '').sort((a, b) => new Date(b.date) - new Date(a.date));

    /* ── 1. Losing streak ──────────────────────────────── */
    let streak = 0;
    for (const t of closed) {
      if (parseFloat(t.result) < 0) streak++;
      else break;
    }
    if (streak >= 3) {
      alerts.push({ type: 'danger', icon: '🔴', title: `Losing streak: ${streak} losses in a row`, desc: 'Consider pausing. Review your last trades before the next entry. Your edge may be temporarily misaligned with current market conditions.' });
    }

    /* ── 2. Overtrading ────────────────────────────────── */
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = trades.filter(t => t.date === today).length;
    const maxDay = goals.maxTradesDay || 0;
    if (maxDay > 0 && todayCount >= maxDay) {
      alerts.push({ type: 'warning', icon: '⚠️', title: `Daily trade limit reached (${todayCount}/${maxDay})`, desc: 'You have hit your self-imposed daily trade limit. Stop trading for today — this rule exists to protect your account.' });
    }
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthCount = trades.filter(t => t.date >= monthStart).length;
    const maxMonth = goals.maxTradesMonth || 0;
    if (maxMonth > 0 && monthCount >= maxMonth) {
      alerts.push({ type: 'warning', icon: '⚠️', title: `Monthly trade limit reached (${monthCount}/${maxMonth})`, desc: 'Monthly limit hit. Evaluate your month before taking further trades.' });
    }

    /* ── 3. Session weakness ───────────────────────────── */
    const sessions = DB.performanceBySession(closed);
    const overallWR = closed.length ? closed.filter(t => parseFloat(t.result) > 0).length / closed.length * 100 : 0;
    sessions.forEach(s => {
      if (s.total >= 10 && overallWR > 0 && (overallWR - s.winRate) > 15) {
        alerts.push({ type: 'warning', icon: '🕐', title: `Session weakness: ${s.label} (${s.winRate.toFixed(0)}% vs ${overallWR.toFixed(0)}% overall)`, desc: `Your win rate during the ${s.label} session is ${(overallWR - s.winRate).toFixed(0)}% below your overall average over ${s.total} trades. Consider reducing size or skipping this session.` });
      }
    });

    /* ── 4. Setup underperformance ─────────────────────── */
    const setupData = DB.winRateBySetup(closed.slice(0, 20));
    setupData.forEach(s => {
      if (s.total >= 5 && s.winRate < 35) {
        alerts.push({ type: 'warning', icon: '📉', title: `Setup underperforming: ${s.label} (${s.winRate.toFixed(0)}% win rate)`, desc: `Over your last ${s.total} ${s.label} trades, your win rate is ${s.winRate.toFixed(0)}%. This is below the 35% threshold. Review entry criteria for this setup.` });
      }
    });

    /* ── 5. HTF bias violations ────────────────────────── */
    const journal = DB.getJournalEntry ? null : null; // journal keys
    const recent5 = closed.slice(0, 5);
    recent5.forEach(t => {
      const entry = DB.getJournalEntry(t.date);
      if (!entry?.bias || !t.direction || !t.htfBias) return;
      const bias = t.htfBias?.toLowerCase();
      const dir  = t.direction?.toLowerCase();
      if ((bias === 'bearish' && dir === 'long') || (bias === 'bullish' && dir === 'short')) {
        alerts.push({ type: 'warning', icon: '🧭', title: `HTF bias violation on ${t.date}: ${t.symbol}`, desc: `You logged HTF bias as ${t.htfBias} but took a ${t.direction} trade. Trading against your bias is a high-risk behaviour. Review before doing this again.` });
      }
    });

    /* ── 6. Win rate trending down ─────────────────────── */
    const last7  = DB.filterByRange(closed, '7').filter(t => t.result !== '' && t.result !== undefined);
    const last30 = DB.filterByRange(closed, '30').filter(t => t.result !== '' && t.result !== undefined);
    const wr7  = last7.length  ? last7.filter(t => parseFloat(t.result) > 0).length / last7.length * 100 : null;
    const wr30 = last30.length ? last30.filter(t => parseFloat(t.result) > 0).length / last30.length * 100 : null;
    if (wr7 !== null && wr30 !== null && (wr30 - wr7) > 10) {
      alerts.push({ type: 'warning', icon: '📉', title: `Win rate trending down (7d: ${wr7.toFixed(0)}% vs 30d: ${wr30.toFixed(0)}%)`, desc: 'Your 7-day win rate is noticeably below your 30-day average. Review recent trades for changes in conditions or discipline.' });
    }

    /* ── 7. Potential revenge trading ─────────────────── */
    const sortedClosed = [...closed].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (let i = 1; i < sortedClosed.length; i++) {
      const prev = sortedClosed[i - 1], cur = sortedClosed[i];
      if (parseFloat(prev.result) < 0 && prev.date === cur.date) {
        const prevTime = prev.date, curTime = cur.date;
        if (prevTime === curTime) {
          alerts.push({ type: 'info', icon: '🎭', title: `Possible revenge trade on ${cur.date}: ${cur.symbol}`, desc: `A trade followed quickly after a loss on the same day. Verify this wasn't emotionally driven. Check if the setup was A/B grade.` });
          break;
        }
      }
    }

    /* ── Positive alerts ───────────────────────────────── */
    if (streak === 0 && closed.length >= 3) {
      const lastWins = closed.slice(0, 3).every(t => parseFloat(t.result) > 0);
      if (lastWins) {
        alerts.push({ type: 'positive', icon: '🏆', title: 'Green run — last 3 trades all wins', desc: "Great execution. Stay disciplined — don't raise risk just because you're on a hot streak." });
      }
    }

    return alerts;
  }

  function renderAlerts(wrap) {
    const alerts = computeAlerts();
    wrap.innerHTML = `
      <div class="section-header" style="margin-bottom:12px">
        <div class="section-title">Live Coaching Alerts</div>
        <span class="text-sub text-sm">Auto-generated from your trade data</span>
      </div>
      ${!alerts.length
        ? `<div class="coach-alert positive"><div class="alert-icon">✅</div><div class="alert-body"><div class="alert-title">All clear</div><div class="alert-desc">No issues detected in your recent trade data. Keep following your playbook.</div></div></div>`
        : `<div class="alert-list">${alerts.map(a => `
            <div class="coach-alert ${esc(a.type)}">
              <div class="alert-icon">${a.icon}</div>
              <div class="alert-body">
                <div class="alert-title">${esc(a.title)}</div>
                <div class="alert-desc">${esc(a.desc)}</div>
              </div>
            </div>
          `).join('')}</div>`
      }
    `;
  }

  /* ═══════════════════════════════════════════════════════
     GRADE INSIGHTS
  ═══════════════════════════════════════════════════════ */
  function renderGrading(wrap) {
    const trades = DB.getTrades().filter(t => t.result !== '' && t.result !== undefined);

    const byPreGrade  = groupBy(trades, 'preGrade');
    const byPostGrade = groupBy(trades, 'postGrade');

    wrap.innerHTML = `
      <div class="section-title" style="margin-bottom:16px">Trade Grade Performance Analysis</div>
      <p class="text-sub text-sm" style="margin-bottom:16px">Do your A-grade plans outperform C/D? Are poor executions costing you money?</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card">
          <div class="card-header"><div class="card-title">Pre-Trade Grade (Plan Quality)</div></div>
          ${gradeTable(byPreGrade, 'plan')}
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Post-Trade Grade (Execution Quality)</div></div>
          ${gradeTable(byPostGrade, 'execution')}
        </div>
      </div>
    `;
  }

  function groupBy(trades, key) {
    const map = { A: [], B: [], C: [], D: [], '': [] };
    trades.forEach(t => {
      const k = t[key] || '';
      if (!map[k]) map[k] = [];
      map[k].push(t);
    });
    return map;
  }

  function gradeTable(byGrade, type) {
    const grades = ['A', 'B', 'C', 'D'];
    const rows = grades.map(g => {
      const grp = byGrade[g] || [];
      if (!grp.length) return null;
      const s = DB.calcStats(grp);
      return { grade: g, ...s };
    }).filter(Boolean);

    if (!rows.length) return `<div class="empty-state" style="padding:20px"><p>No graded trades yet. Grade trades using the ${type} grade field in the trade form.</p></div>`;

    return `<div class="table-wrap"><table>
      <thead><tr><th>Grade</th><th>Trades</th><th>Win %</th><th>P&L</th><th>Avg R</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td><span class="badge badge-${r.grade === 'A' ? 'green' : r.grade === 'B' ? 'accent' : r.grade === 'C' ? 'orange' : 'red'}">${r.grade}</span></td>
          <td>${r.total}</td>
          <td class="${r.winRate >= 50 ? 'text-green' : 'text-red'}">${r.closed ? r.winRate.toFixed(0) + '%' : '—'}</td>
          <td class="${r.totalPL >= 0 ? 'text-green' : 'text-red'}">${r.closed ? (r.totalPL >= 0 ? '+$' : '-$') + Math.abs(r.totalPL).toFixed(2) : '—'}</td>
          <td>${r.closed ? r.avgR.toFixed(2) + 'R' : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  /* ═══════════════════════════════════════════════════════
     WEEKLY / MONTHLY REVIEWS
  ═══════════════════════════════════════════════════════ */
  function renderReview(wrap) {
    const log = DB.getCoachLog().filter(e => e.type === 'review');

    wrap.innerHTML = `
      <div class="section-header" style="margin-bottom:4px">
        <div class="section-title">Structured Review Prompts</div>
      </div>
      <p class="text-sub text-sm" style="margin-bottom:16px">Complete a guided review at the end of each week or month.</p>

      <div class="card" style="margin-bottom:16px" id="reviewForm">
        <div class="card-header"><div class="card-title">New Review</div></div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Review Period</label>
          <select id="reviewPeriod">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        ${reviewQuestion('q1', 'Which setup performed best this period and why?')}
        ${reviewQuestion('q2', 'Which rule did you break most? What triggered it?')}
        ${reviewQuestion('q3', 'What will you do differently next week/month?')}
        ${reviewQuestion('q4', 'What is one strength you want to double down on?')}
        ${reviewQuestion('q5', 'Rate your overall discipline this period (1–10) and explain.')}
        <button class="btn-primary" onclick="CoachTab._saveReview()" style="margin-top:12px">Save Review</button>
      </div>

      <div class="section-title" style="margin-bottom:12px">Review History</div>
      ${!log.length
        ? `<div class="empty-state"><div class="empty-icon">📝</div><p>No reviews saved yet.</p></div>`
        : log.map(e => `
          <div class="card card-sm" style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
              <div class="card-title">${e.period === 'monthly' ? 'Monthly' : 'Weekly'} Review</div>
              <div class="text-dim text-xs">${e.date?.slice(0, 10)}</div>
            </div>
            ${Object.entries(e.answers || {}).map(([q, a]) => `
              <div style="margin-bottom:8px">
                <div class="text-xs text-dim" style="margin-bottom:2px">${esc(q)}</div>
                <div class="text-sm" style="white-space:pre-wrap">${esc(a) || '—'}</div>
              </div>
            `).join('')}
          </div>
        `).join('')
      }
    `;
  }

  function reviewQuestion(id, label) {
    return `<div class="form-group" style="margin-bottom:10px">
      <label>${label}</label>
      <textarea id="${id}" rows="2" placeholder="Your answer…"></textarea>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════
     SETUP CATALOGUE
  ═══════════════════════════════════════════════════════ */
  /* Signed money, no decimals: +$120 / -$45 */
  function _money(v) {
    const n = Number(v) || 0;
    return (n < 0 ? '-$' : '+$') + Math.abs(n).toFixed(0);
  }

  /* Headline "followed the rules vs broke them" card + configurable threshold.
     Scoped to manual ('new') trades so imported history can't distort it. */
  function _adherenceCard() {
    const split  = DB.adherenceSplit(DB.filterByMode(DB.getTrades(), 'new'));
    const F = split.followed, B = split.broke;
    const thrPct = (DB.getAdherenceThreshold() * 100).toFixed(0);
    const thrInput = `<label style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text-sub)">Followed = met ≥
        <input type="number" min="5" max="100" step="5" value="${thrPct}" onchange="CoachTab._setAdherenceThr(this.value)"
               style="width:56px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px 6px;border-radius:6px;font-size:.8rem;text-align:center" /> % of rules</label>`;

    const bucket = (label, ico, o, col) => `
      <div style="border:1px solid var(--border);border-left:4px solid ${col};border-radius:10px;padding:12px 14px">
        <div style="font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${col};margin-bottom:8px">${ico} ${label} · ${o.n} trade${o.n === 1 ? '' : 's'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div><div class="rs-label">Win rate</div><div style="font-size:1.15rem;font-weight:700;color:${col}">${o.n ? o.wr.toFixed(0) + '%' : '—'}</div></div>
          <div><div class="rs-label">Avg R</div><div style="font-size:1.15rem;font-weight:700">${o.n ? o.avgR.toFixed(2) + 'R' : '—'}</div></div>
          <div><div class="rs-label">Total P&L</div><div style="font-size:1.15rem;font-weight:700">${o.n ? _money(o.pl) : '—'}</div></div>
        </div>
      </div>`;

    let verdict = '';
    if (F.n && B.n) {
      const wrD = F.wr - B.wr, rD = F.avgR - B.avgR;
      const good = wrD >= 0;
      verdict = `<div style="margin-top:12px;padding:10px 14px;border-radius:8px;background:var(--bg);font-size:.85rem;line-height:1.5">
        <strong style="color:${good ? 'var(--green)' : 'var(--red)'}">Following your rules is worth ${wrD >= 0 ? '+' : ''}${wrD.toFixed(0)}% win rate and ${rD >= 0 ? '+' : ''}${rD.toFixed(2)}R per trade.</strong>
        ${good ? '' : ' ⚠️ Broken-rule trades are currently outperforming — small sample, or your rules need review.'}</div>`;
    } else {
      verdict = `<div style="margin-top:12px;font-size:.82rem;color:var(--text-dim);line-height:1.5">Not enough scored trades on both sides yet. Log a trade with its setup rules ticked — or grade a trade A–D — to fill this in.</div>`;
    }

    const notes = [];
    if (split.estimated) notes.push(`${split.estimated} estimated from post-grade (no rule ticks yet)`);
    if (split.unscored)  notes.push(`${split.unscored} closed trade${split.unscored === 1 ? '' : 's'} with no rules or grade excluded`);

    return `
      <div class="card" style="margin-bottom:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          <div class="section-title" style="margin:0">🎯 Rule Adherence — did you follow your playbook?</div>
          ${thrInput}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${bucket('Followed', '✓', F, 'var(--green)')}
          ${bucket('Broke rules', '✗', B, 'var(--red)')}
        </div>
        ${verdict}
        ${notes.length ? `<div class="text-xs text-dim" style="margin-top:10px">ℹ️ ${notes.join(' · ')}. Estimated rows are a rough proxy, not confirmed rule adherence.</div>` : ''}
      </div>`;
  }

  function renderCatalogue(wrap) {
    const setups = DB.recomputePlaybookStats();
    wrap.innerHTML = `
      <div class="section-title" style="margin-bottom:4px">Setup Performance Catalogue</div>
      <p class="text-sub text-sm" style="margin-bottom:16px">
        Live stats for every setup in your playbook. This data will eventually power setup prediction and suggestions.
      </p>
      ${_adherenceCard()}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">
        ${setups.map(s => {
          const wr = s.winRate !== null ? s.winRate.toFixed(0) + '%' : 'No data';
          const ar = s.avgR   !== null ? s.avgR.toFixed(2) + 'R' : '—';
          const color = s.winRate !== null ? (s.winRate >= 50 ? 'var(--green)' : 'var(--red)') : 'var(--text-sub)';
          const desc = s.description || '';
          const truncDesc = desc.length > 120 ? esc(desc.slice(0, 120)) + '…' : esc(desc);
          const adh = (o, col, ico) => o ? `<span style="color:${col}">${ico} ${o.n}t · ${o.wr.toFixed(0)}% · ${o.avgR.toFixed(2)}R</span>` : '';
          const adhLine = (s.adhFollowed || s.adhBroke) ? `
              <div class="text-xs" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-sub);display:flex;gap:12px;flex-wrap:wrap">
                <span class="text-dim">Rules:</span>
                ${adh(s.adhFollowed, 'var(--green)', '✓') || '<span class="text-dim">✓ —</span>'}
                ${adh(s.adhBroke, 'var(--red)', '✗') || '<span class="text-dim">✗ —</span>'}
              </div>` : '';
          return `
            <div class="card">
              <div style="font-size:1rem;font-weight:700;color:var(--accent);margin-bottom:8px">${esc(s.name)}</div>
              <div class="report-stats" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
                <div class="report-stat">
                  <div class="rs-label">Win Rate</div>
                  <div class="rs-value" style="font-size:1.2rem;color:${color}">${wr}</div>
                </div>
                <div class="report-stat">
                  <div class="rs-label">Avg R</div>
                  <div class="rs-value" style="font-size:1.2rem">${ar}</div>
                </div>
              </div>
              <div class="text-xs text-sub">${s.tradeCount} trades logged</div>
              ${adhLine}
              ${desc ? `<div class="text-xs text-dim" style="margin-top:6px;line-height:1.5">${truncDesc}</div>` : ''}
            </div>
          `;
        }).join('')}
        ${!setups.length ? '<div class="empty-state"><div class="empty-icon">📖</div><p>Add setups in the Playbook tab first.</p></div>' : ''}
      </div>
    `;
  }

  return {
    render,
    _sub: id => { activeSubTab = id; render(); },
    _setAdherenceThr: (v) => { DB.setAdherenceThreshold(v); renderSub(); },
    // v1.1 (2026-05-10): exposed so AI Coach can include these
    // sections after the tabs were merged. Each takes a wrap element
    // and writes innerHTML into it.
    _renderAlerts:    renderAlerts,
    _renderGrading:   renderGrading,
    _renderCatalogue: renderCatalogue,
    _getAlerts:       computeAlerts,
    _alertCount:      () => computeAlerts().length,
    _saveReview: () => {
      const period = document.getElementById('reviewPeriod')?.value || 'weekly';
      const questions = [
        'Which setup performed best this period and why?',
        'Which rule did you break most? What triggered it?',
        'What will you do differently next week/month?',
        'What is one strength you want to double down on?',
        'Rate your overall discipline this period (1–10) and explain.',
      ];
      const answers = {};
      ['q1','q2','q3','q4','q5'].forEach((id, i) => {
        answers[questions[i]] = document.getElementById(id)?.value || '';
      });
      DB.addCoachLog({ type: 'review', period, answers });
      App.toast('Review saved');
      renderSub();
    }
  };
})();
