/* ═══════════════════════════════════════════════════════════
   GOALS TAB  (v2 visual redesign — 2026-05-17)
   6-card metric grid + collapsible manage section
   Layout: .page-head + 3-col metric cards + .card manage panel
════════════════════════════════════════════════════════════ */
const GoalsTab = (() => {

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ── Badge color by progress % ───────────────────────── */
  function badgeColor(pct) {
    if (pct >= 100) return { bg: 'rgba(34,197,94,.18)', color: '#22c55e' };
    if (pct >= 60)  return { bg: 'rgba(251,191,36,.18)', color: '#fbbf24' };
    return { bg: 'rgba(239,68,68,.18)', color: '#f87171' };
  }

  /* ── Single metric card ───────────────────────────────── */
  function metricCard({ emoji, iconBg, name, targetLabel, current, currentFmt, pct, toGoLabel, hit }) {
    const clampedPct = Math.max(0, Math.min(pct, 100));
    const bc = badgeColor(pct);
    const barColor = pct >= 100 ? '#22c55e' : pct >= 60 ? '#fbbf24' : '#ef4444';
    return `
    <div class="card" style="position:relative;padding:20px">
      <!-- % badge top-right -->
      <div style="position:absolute;top:14px;right:14px;font-size:.68rem;font-weight:700;
                  padding:3px 8px;border-radius:10px;background:${bc.bg};color:${bc.color}">
        ${clampedPct.toFixed(0)}%
      </div>
      <!-- Icon -->
      <div style="width:42px;height:42px;border-radius:12px;background:${iconBg};
                  display:flex;align-items:center;justify-content:center;font-size:1.3rem;margin-bottom:12px">
        ${emoji}
      </div>
      <!-- Name + target -->
      <div style="font-size:.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:2px">${esc(name)}</div>
      <div style="font-size:.7rem;color:var(--text-dim);margin-bottom:10px">Target: ${esc(targetLabel)}</div>
      <!-- Current value -->
      <div style="font-size:1.8rem;font-weight:800;line-height:1;color:var(--text-primary);margin-bottom:10px">
        ${esc(currentFmt)}
      </div>
      <!-- Progress bar -->
      <div style="height:4px;background:var(--border-sub);border-radius:2px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${clampedPct}%;background:${barColor};border-radius:2px;transition:width .4s"></div>
      </div>
      <!-- To-go or hit -->
      <div style="font-size:.72rem;color:var(--text-dim)">
        ${hit ? '<span style="color:#22c55e;font-weight:600">Hit! 🎉</span>' : esc(toGoLabel)}
      </div>
    </div>`;
  }

  /* ── Main render ──────────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    const goals   = DB.getGoals();
    const trades  = DB.getTrades();
    const stats   = DB.calcStats(trades);

    // Monthly P&L
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthTrades = trades.filter(t => t.date >= monthStart && t.result !== '' && t.result !== undefined);
    const monthPL   = monthTrades.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const monthTarget = parseFloat(goals.monthlyTarget) || 0;
    const plPct     = monthTarget > 0 ? (monthPL / monthTarget) * 100 : 0;

    // Win rate
    const wr    = parseFloat(stats.winRate) || 0;
    const wrPct = (wr / 65) * 100;

    // A-grade trades this month
    const aGrades    = monthTrades.filter(t => t.preGrade === 'A').length;
    const aGradeTarget = 20;
    const aGradePct  = (aGrades / aGradeTarget) * 100;

    // Rule compliance (checklist)
    const checklist = DB.getChecklist();
    const clItems = checklist.items || [];
    const clDone  = clItems.filter(i => i.checked).length;
    const clPct   = clItems.length > 0 ? (clDone / clItems.length) * 100 : 0;

    // Avg R-multiple
    const avgR    = parseFloat(stats.avgR) || 0;
    const avgRPct = (avgR / 1.5) * 100;

    // Count active goals for subtitle
    const activeGoalCount = (goals.coachGoals || []).length + 6; // 6 built-in metric cards
    const hitCount = [plPct >= 100, wrPct >= 100, aGradePct >= 100, clPct >= 95, avgRPct >= 100].filter(Boolean).length;

    // Monthly P&L display
    const plSign   = monthPL >= 0 ? '+$' : '-$';
    const plFmt    = plSign + Math.abs(monthPL).toFixed(2);
    const plToGo   = monthTarget > 0
      ? (monthPL >= monthTarget ? 'Target met!' : `$${(monthTarget - monthPL).toFixed(2)} to go`)
      : 'Set a target to track';

    content.innerHTML = `
      <!-- Page header -->
      <div class="page-head">
        <div>
          <h1>Goals</h1>
          <div class="page-head-sub">${activeGoalCount} active goals · ${hitCount} hit</div>
        </div>
        <button class="btn-primary btn-sm" onclick="GoalsTab._addCoachGoal()">＋ New goal</button>
      </div>

      <!-- 6-card metric grid -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">

        ${metricCard({
          emoji: '🎯', iconBg: 'rgba(124,92,255,.18)',
          name: 'Monthly P&L', targetLabel: '$' + monthTarget.toFixed(0),
          current: monthPL, currentFmt: plFmt,
          pct: plPct, toGoLabel: plToGo,
          hit: monthTarget > 0 && monthPL >= monthTarget
        })}

        ${metricCard({
          emoji: '📊', iconBg: 'rgba(34,197,94,.18)',
          name: 'Win rate', targetLabel: '65%',
          current: wr, currentFmt: wr.toFixed(1) + '%',
          pct: wrPct, toGoLabel: `${Math.max(0, 65 - wr).toFixed(1)}% to go`,
          hit: wr >= 65
        })}

        ${metricCard({
          emoji: '⭐', iconBg: 'rgba(251,191,36,.18)',
          name: 'A-grade trades', targetLabel: '20/mo',
          current: aGrades, currentFmt: String(aGrades),
          pct: aGradePct, toGoLabel: `${Math.max(0, aGradeTarget - aGrades)} to go`,
          hit: aGrades >= aGradeTarget
        })}

        ${metricCard({
          emoji: '✅', iconBg: 'rgba(34,197,94,.12)',
          name: 'Rule compliance', targetLabel: '95%',
          current: clPct, currentFmt: clPct.toFixed(1) + '%',
          pct: (clPct / 95) * 100, toGoLabel: `${Math.max(0, 95 - clPct).toFixed(1)}% to go`,
          hit: clPct >= 95
        })}

        ${metricCard({
          emoji: '⚖️', iconBg: 'rgba(168,85,247,.18)',
          name: 'Avg R-multiple', targetLabel: '1.5R',
          current: avgR, currentFmt: avgR.toFixed(2) + 'R',
          pct: avgRPct, toGoLabel: `${Math.max(0, 1.5 - avgR).toFixed(2)}R to go`,
          hit: avgR >= 1.5
        })}

        ${metricCard({
          emoji: '🚀', iconBg: 'rgba(239,68,68,.12)',
          name: 'Account growth', targetLabel: '50%',
          current: 0, currentFmt: 'Set target',
          pct: 0, toGoLabel: 'Configure in Goals',
          hit: false
        })}

      </div>

      <!-- Manage goals collapsible -->
      <details class="card" style="padding:0;overflow:hidden">
        <summary style="padding:16px 20px;cursor:pointer;font-weight:600;font-size:.88rem;
                        list-style:none;display:flex;align-items:center;gap:8px;user-select:none">
          <span style="font-size:.7rem;color:var(--text-dim)">▶</span>
          Manage goals
        </summary>
        <div style="padding:0 20px 20px;border-top:1px solid var(--border-sub);display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px">

          <!-- Monthly P&L target editor -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="font-size:.85rem;font-weight:600">🎯 Monthly P&L Target</div>
              <button class="btn-ghost btn-sm" onclick="GoalsTab._editTarget()">Edit</button>
            </div>
            <div id="targetDisplay">
              <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
                <span style="font-size:1.8rem;font-weight:800;color:${monthPL >= 0 ? 'var(--green)' : 'var(--red)'}">
                  ${monthPL >= 0 ? '+$' : '-$'}${Math.abs(monthPL).toFixed(2)}
                </span>
                <span class="text-sub text-sm">of $${monthTarget.toFixed(0)} target</span>
              </div>
              <div class="progress-wrap" style="margin-bottom:8px">
                <div class="progress-bar ${monthPL >= 0 ? 'green' : 'red'}" style="width:${Math.max(0, Math.min(plPct, 100)).toFixed(1)}%"></div>
              </div>
              <div class="text-xs text-sub">${plPct.toFixed(0)}% of monthly target${monthTarget === 0 ? ' — set a target to track progress' : ''}</div>
            </div>
            <div id="targetEdit" class="hidden" style="margin-top:12px">
              <div class="form-group">
                <label>Monthly Target ($)</label>
                <input type="number" id="targetVal" value="${monthTarget}" step="100" placeholder="e.g. 1000" />
              </div>
              <div class="form-group">
                <label>Max Trades/Day</label>
                <input type="number" id="maxDay" value="${goals.maxTradesDay || ''}" placeholder="e.g. 3" />
              </div>
              <div class="form-group">
                <label>Max Trades/Month</label>
                <input type="number" id="maxMonth" value="${goals.maxTradesMonth || ''}" placeholder="e.g. 30" />
              </div>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button class="btn-primary btn-sm" onclick="GoalsTab._saveTarget()">Save</button>
                <button class="btn-ghost btn-sm" onclick="GoalsTab._cancelTarget()">Cancel</button>
              </div>
            </div>
          </div>

          <!-- Discipline rules -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="font-size:.85rem;font-weight:600">📏 Discipline Rules</div>
              <button class="btn-ghost btn-sm" onclick="GoalsTab._addRule()">＋ Add</button>
            </div>
            <div id="rulesDisplay">
              ${(goals.disciplineRules || []).length === 0
                ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">📋</div><p>Add your standing trading rules.</p></div>`
                : (goals.disciplineRules || []).map((rule, i) => `
                  <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-sub)">
                    <input type="checkbox" id="rule_${i}" ${rule.checkedToday ? 'checked' : ''} onchange="GoalsTab._checkRule(${i},this.checked)" style="accent-color:var(--accent)" />
                    <label for="rule_${i}" style="flex:1;font-size:.85rem;cursor:pointer;${rule.checkedToday ? 'text-decoration:line-through;color:var(--text-dim)' : ''}">${esc(rule.label)}</label>
                    <button class="btn-icon" onclick="GoalsTab._delRule(${i})">✕</button>
                  </div>
                `).join('')
              }
            </div>
          </div>

          <!-- Coaching goals (full width) -->
          <div style="grid-column:1/-1">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="font-size:.85rem;font-weight:600">🧠 Improvement Goals</div>
              <button class="btn-ghost btn-sm" onclick="GoalsTab._addCoachGoal()">＋ Add Goal</button>
            </div>
            ${coachGoalsHtml(goals.coachGoals || [], trades)}
          </div>

        </div>
      </details>
    `;
  }

  function coachGoalsHtml(cGoals, trades) {
    if (!cGoals.length) return `<div class="empty-state" style="padding:20px"><div class="empty-icon">🎯</div><p>Add a specific improvement goal (e.g. "Improve OTE win rate from 40% to 60% in 30 days").</p></div>`;

    return cGoals.map((g, i) => {
      // Compute current metric value
      let current = null;
      if (g.metric === 'win_rate') {
        const s = DB.calcStats(trades); current = s.winRate;
      } else if (g.metric === 'avg_r') {
        const s = DB.calcStats(trades); current = s.avgR;
      }

      const startVal = parseFloat(g.startValue) || 0;
      const targetVal = parseFloat(g.target) || 0;
      const rawProgress = current !== null && targetVal !== startVal
        ? ((current - startVal) / (targetVal - startVal)) * 100 : 0;
      const progress = Math.max(0, Math.min(rawProgress, 100));
      const color = progress >= 100 ? 'var(--green)' : progress >= 50 ? 'var(--accent)' : 'var(--orange)';

      return `
        <div style="padding:12px 0;border-bottom:1px solid var(--border-sub)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              <div style="font-size:.88rem;font-weight:600">${esc(g.label)}</div>
              <div class="text-xs text-sub">Target: ${esc(g.target)} · Deadline: ${esc(g.deadline) || 'No deadline'}</div>
            </div>
            <button class="btn-icon" onclick="GoalsTab._delCoachGoal(${i})">✕</button>
          </div>
          <div class="progress-wrap">
            <div class="progress-bar" style="width:${progress.toFixed(0)}%;background:${color}"></div>
          </div>
          <div class="text-xs text-sub" style="margin-top:4px">
            ${current !== null ? `Current: ${current.toFixed(1)} · ` : ''}${progress.toFixed(0)}% towards goal
          </div>
        </div>
      `;
    }).join('');
  }

  /* ── Public API ───────────────────────────────────────── */
  return {
    render,
    _editTarget: () => {
      document.getElementById('targetDisplay').classList.add('hidden');
      document.getElementById('targetEdit').classList.remove('hidden');
    },
    _cancelTarget: () => {
      document.getElementById('targetDisplay').classList.remove('hidden');
      document.getElementById('targetEdit').classList.add('hidden');
    },
    _saveTarget: () => {
      const g = DB.getGoals();
      DB.saveGoals({
        ...g,
        monthlyTarget: parseFloat(document.getElementById('targetVal')?.value) || 0,
        maxTradesDay:  parseInt(document.getElementById('maxDay')?.value) || 0,
        maxTradesMonth: parseInt(document.getElementById('maxMonth')?.value) || 0,
      });
      App.toast('Goals saved');
      render();
    },
    _addRule: () => {
      const label = prompt('Discipline rule (e.g. "No trades outside killzone"):');
      if (!label?.trim()) return;
      const g = DB.getGoals();
      const rules = [...(g.disciplineRules || []), { label: label.trim(), checkedToday: false }];
      DB.saveGoals({ ...g, disciplineRules: rules });
      App.toast('Rule added');
      render();
    },
    _checkRule: (i, val) => {
      const g = DB.getGoals();
      const rules = [...(g.disciplineRules || [])];
      if (rules[i]) rules[i] = { ...rules[i], checkedToday: val };
      DB.saveGoals({ ...g, disciplineRules: rules });
    },
    _delRule: i => {
      const g = DB.getGoals();
      const rules = (g.disciplineRules || []).filter((_, idx) => idx !== i);
      DB.saveGoals({ ...g, disciplineRules: rules });
      render();
    },
    _addCoachGoal: () => {
      const label  = prompt('Goal description (e.g. "Improve OTE win rate from 40% to 60%"):');
      if (!label?.trim()) return;
      const target = prompt('Target value (e.g. 60 for 60% win rate):');
      const deadline = prompt('Deadline (YYYY-MM-DD or blank):') || '';
      const g = DB.getGoals();
      const coachGoals = [...(g.coachGoals || []), {
        label: label.trim(), metric: 'win_rate',
        target: parseFloat(target) || 0, startValue: 0, deadline
      }];
      DB.saveGoals({ ...g, coachGoals });
      App.toast('Goal added');
      render();
    },
    _delCoachGoal: i => {
      const g = DB.getGoals();
      const coachGoals = (g.coachGoals || []).filter((_, idx) => idx !== i);
      DB.saveGoals({ ...g, coachGoals });
      render();
    }
  };
})();
