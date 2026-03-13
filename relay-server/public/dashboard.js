'use strict';

var currentSecret = '';
var currentPeriod = 30;
var lastLoaded = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function pct(n, d) {
  return d > 0 ? Math.min((n / d) * 100, 100).toFixed(1) : '0.0';
}

function fmtMs(ms) {
  if (!ms || ms === 0) return '—';
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

function barColor(rate) {
  if (rate >= 0.85) return 'var(--green)';
  if (rate >= 0.60) return 'var(--yellow)';
  return 'var(--red)';
}

function rateClass(rate) {
  if (rate >= 0.85) return 'td-green';
  if (rate >= 0.60) return 'td-yellow';
  return 'td-red';
}

function miniBarHtml(vals, cls) {
  var max = Math.max.apply(null, vals.concat([1]));
  return vals.map(function(v) {
    return '<div class="mbar ' + cls + '" style="height:' + Math.max(4, (v / max) * 100).toFixed(0) + '%"></div>';
  }).join('');
}

function card(title, badgeText, badgeCls, body) {
  var badge = badgeText
    ? '<span class="card-badge ' + badgeCls + '">' + esc(badgeText) + '</span>'
    : '';
  return '<div class="card">'
    + '<div class="card-header"><div class="card-title">' + esc(title) + '</div>' + badge + '</div>'
    + body
    + '</div>';
}

function sectionLabel(text) {
  return '<div class="section-label">' + esc(text) + '</div>';
}

// ── Render ─────────────────────────────────────────────────────────────────────

function renderDashboard(data) {
  var tasks   = data.tasks   || {};
  var usage   = data.usage   || {};
  var perms   = data.permissions || [];
  var trusts  = data.trustProfiles || [];

  var totalTasks    = (tasks.totalCompleted || 0) + (tasks.totalFailed || 0);
  var failRate      = totalTasks > 0 ? (tasks.totalFailed / totalTasks) * 100 : 0;
  var costPct       = usage.limitUsd > 0 ? (usage.totalCostUsd / usage.limitUsd) * 100 : 0;
  var costBarColor  = costPct >= 80 ? 'var(--red)' : costPct >= 50 ? 'var(--yellow)' : 'var(--green)';

  // Update topbar
  var activeUsers = usage.activeUsers || 0;
  var nowStr      = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  document.getElementById('topbar-meta').textContent =
    activeUsers + ' active user' + (activeUsers !== 1 ? 's' : '') + ' · as of ' + nowStr;
  document.getElementById('relay-badge').className = 'topbar-badge connected';
  document.getElementById('relay-label').textContent = 'data loaded';
  if (lastLoaded) {
    document.getElementById('topbar-right').textContent = 'refreshed ' + lastLoaded;
  }

  var html = '';

  // ── SECTION 1: HEALTH PULSE ──────────────────────────────────────────────────
  html += sectionLabel('Health pulse — is the product working?');
  html += '<div class="grid-row row-4">';

  // Active users card
  var userPct = usage.activeUsers > 0 ? '100%' : '0%';
  html += card(
    'Active users', 'healthy', 'cb-green',
    '<div class="big-num">' + esc(activeUsers) + '</div>'
    + '<div class="big-num-sub">' + (usage.totalRequests || 0) + ' relay requests · ' + (usage.usersAtLimit || 0) + ' at limit</div>'
    + '<div class="mini-bars">' + miniBarHtml([20,35,40,55,70,85,100], 'mbar-accent') + '</div>'
    + '<div class="mbar-label-row"><span>—</span><span>—</span><span>—</span><span>now</span></div>'
  );

  // Tasks card
  var failBadgeCls = failRate === 0 ? 'cb-green' : failRate < 20 ? 'cb-yellow' : 'cb-red';
  var failBadge    = totalTasks > 0 ? totalTasks + ' total' : 'no data';
  html += card(
    'Tasks completed', failBadge, failBadgeCls,
    '<div class="big-num">' + esc(tasks.totalCompleted || 0) + '</div>'
    + '<div class="big-num-sub">' + failRate.toFixed(0) + '% failure rate · ' + (tasks.totalFailed || 0) + ' failed</div>'
    + '<div class="mini-bars">' + miniBarHtml([10,20,30,45,60,80,100], 'mbar-green') + '</div>'
    + '<div class="mbar-label-row"><span>—</span><span>—</span><span>—</span><span>now</span></div>'
  );

  // Avg duration card
  var avgMs  = tasks.avgDurationMs || 0;
  var durBadge = avgMs < 15000 ? 'fast' : avgMs < 60000 ? 'moderate' : 'slow';
  var durBadgeCls = avgMs < 15000 ? 'cb-green' : avgMs < 60000 ? 'cb-yellow' : 'cb-red';
  var fbRate = tasks.fallbackRate || 0;
  html += card(
    'Avg task duration', durBadge, durBadgeCls,
    '<div class="big-num">' + esc(fmtMs(avgMs)) + '</div>'
    + '<div class="big-num-sub">fallback rate: ' + (fbRate * 100).toFixed(1) + '% · ' + (tasks.totalCompleted || 0) + ' completed</div>'
    + '<div class="mini-bars">' + miniBarHtml([60,80,100,70,55,45,50], 'mbar-accent') + '</div>'
    + '<div class="mbar-label-row"><span>—</span><span>—</span><span>—</span><span>now</span></div>'
  );

  // LLM cost card
  var resetStr = usage.resetDate ? new Date(usage.resetDate).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '—';
  html += card(
    'LLM cost', costPct.toFixed(1) + '% of limit', costPct < 50 ? 'cb-green' : costPct < 80 ? 'cb-yellow' : 'cb-red',
    '<div class="big-num">$' + esc((usage.totalCostUsd || 0).toFixed(4)) + '</div>'
    + '<div class="big-num-sub">of $' + esc((usage.limitUsd || 30).toFixed(2)) + ' / mo · resets ' + esc(resetStr) + '</div>'
    + '<div class="h-bar-track"><div class="h-bar-fill" style="width:' + costPct.toFixed(1) + '%;background:' + costBarColor + '"></div></div>'
    + '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-top:2px">'
    + esc(usage.totalRequests || 0) + ' requests · ' + esc(usage.activeUsers || 0) + ' active users</div>'
  );

  html += '</div>'; // row-4

  // ── SECTION 2: TRUST CALIBRATION ────────────────────────────────────────────
  html += sectionLabel('Trust calibration — the core research question');
  html += '<div class="grid-row row-3">';

  // Permission approval rates card
  var permRows = '';
  var tierOrder = ['low_risk', 'medium_risk', 'high_risk'];
  var tierLabels = { low_risk: 'Low-risk reads', medium_risk: 'Mid-risk actions', high_risk: 'High-risk actions' };
  // Build a map from the data
  var permMap = {};
  perms.forEach(function(p) {
    // eventType like "permission.low_risk.resolved"
    var key = p.eventType.replace('permission.', '').replace('.resolved', '');
    permMap[key] = p;
  });

  var permBody = '<div style="display:flex;flex-direction:column;gap:10px;margin-top:2px">';
  tierOrder.forEach(function(tier) {
    var p = permMap[tier];
    var rate = p ? p.approvalRate : null;
    var total = p ? p.total : 0;
    var rateDisp = rate !== null ? (rate * 100).toFixed(0) + '%' : '—';
    var color = rate !== null ? barColor(rate) : 'var(--text-muted)';
    var cls   = rate !== null ? rateClass(rate) : 'td-muted';
    permBody += '<div>'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:3px">'
      + '<span style="font-size:11.5px;color:var(--text-secondary)">' + esc(tierLabels[tier] || tier) + '</span>'
      + '<span style="font-family:var(--font-mono);font-size:10px" class="' + cls + '">' + esc(rateDisp) + '</span>'
      + '</div>'
      + '<div class="h-bar-track"><div class="h-bar-fill" style="width:' + (rate !== null ? (rate * 100).toFixed(1) : 0) + '%;background:' + color + '"></div></div>'
      + '<div style="font-family:var(--font-mono);font-size:8.5px;color:var(--text-muted)">'
      + (total > 0 ? total + ' decisions logged' : 'no data yet')
      + '</div>'
      + '</div>';
  });
  permBody += '</div>';

  html += card('Approval rate by risk tier', 'key signal', 'cb-yellow', permBody);

  // Trust profile distribution card
  var trustTotal = trusts.reduce(function(s, t) { return s + t.count; }, 0) || 1;
  var trustProfiles = ['cautious', 'balanced', 'autonomous'];
  var trustColors   = { cautious: 'tdb-cautious', balanced: 'tdb-balanced', autonomous: 'tdb-autonomous' };
  var trustBody = '<div class="trust-dist">';
  trustProfiles.forEach(function(p) {
    var t = trusts.find(function(x) { return x.profile === p; }) || { count: 0 };
    var w = ((t.count / trustTotal) * 100).toFixed(0);
    trustBody += '<div class="td-row">'
      + '<span class="td-label">' + esc(p) + '</span>'
      + '<div class="td-bar-wrap"><div class="td-bar ' + trustColors[p] + '" style="width:' + w + '%"></div></div>'
      + '<span class="td-val">' + esc(t.count) + '</span>'
      + '</div>';
  });
  trustBody += '</div>';
  trustBody += '<div class="insight"><strong>' + trustTotal + '</strong> user' + (trustTotal !== 1 ? 's' : '') + ' with recorded profile changes · distribution reflects last ' + currentPeriod + ' days</div>';

  html += card('Trust profile distribution', 'behavioral', 'cb-blue', trustBody);

  // Time-to-standing-approval (coming soon)
  html += card(
    'Time-to-standing-approval', 'needs n≥5', 'cb-purple',
    '<div class="big-num">—</div>'
    + '<div class="big-num-sub">median hours · not enough data</div>'
    + '<div class="insight">Tracks how long users take to elevate from per-action to standing approval. <strong>Coming once volume increases.</strong></div>'
  );

  html += '</div>'; // row-3

  // ── SECTION 3: PERMISSION PATTERNS ──────────────────────────────────────────
  html += sectionLabel('Permission patterns — how users resolve risk');
  html += '<div class="grid-row row-2">';

  // Approval/denial breakdown table
  var totalApproved = 0, totalDenied = 0;
  perms.forEach(function(p) { totalApproved += p.approved; totalDenied += p.denied; });
  var totalDecisions = totalApproved + totalDenied;

  var tableRows = perms.map(function(p) {
    var tier = p.eventType.replace('permission.', '').replace('.resolved', '');
    var cls  = rateClass(p.approvalRate);
    return '<tr>'
      + '<td class="td-primary">' + esc(tier.replace('_risk', '').replace('_', ' ')) + '</td>'
      + '<td>' + esc(p.total) + '</td>'
      + '<td class="td-green">' + esc(p.approved) + '</td>'
      + '<td class="td-red">' + esc(p.denied) + '</td>'
      + '<td class="' + cls + '">' + esc((p.approvalRate * 100).toFixed(0)) + '%</td>'
      + '</tr>';
  }).join('');

  var tableBody = totalDecisions > 0
    ? '<table class="data-table">'
      + '<thead><tr><th>Tier</th><th>Total</th><th>✓ Approved</th><th>✗ Denied</th><th>Rate</th></tr></thead>'
      + '<tbody>' + tableRows + '</tbody>'
      + '</table>'
      + '<div class="insight">'
      + '<strong>' + totalDecisions + '</strong> total permission decisions · '
      + '<em>' + totalApproved + '</em> approved · '
      + (totalDenied > 0 ? '<strong style="color:var(--red)">' + totalDenied + '</strong> denied' : totalDenied + ' denied')
      + '</div>'
    : '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);padding:16px 0;text-align:center">No permission decisions recorded yet</div>';

  html += card('Decision log by tier', totalDecisions > 0 ? totalDecisions + ' decisions' : 'no data', totalDecisions > 0 ? 'cb-blue' : 'cb-purple', tableBody);

  // Standing approval status
  var standing = totalApproved; // approximation — no standing-specific count
  var standingBody = '<div class="big-num">' + esc(totalApproved) + '</div>'
    + '<div class="big-num-sub">approved decisions across all tiers</div>'
    + '<div class="insight">'
    + 'Standing approval data requires the <strong>permission.standing_approval.granted</strong> event. '
    + 'Counts will populate automatically as users grant standing approvals to trusted actions.'
    + '</div>';
  html += card('Approvals overview', 'live', 'cb-green', standingBody);

  html += '</div>'; // row-2

  // ── SECTION 4: AGENT RELIABILITY ─────────────────────────────────────────────
  html += sectionLabel('Agent reliability — tool call health');
  html += '<div class="grid-row row-3">';

  var tc = data.toolCalls || {};
  var totalCalls  = tc.totalCalls  || 0;
  var successRate = (tc.successRate != null) ? tc.successRate : null;

  // Card 1: overview
  html += card(
    'Tool calls', totalCalls > 0 ? totalCalls + ' total' : 'no data',
    totalCalls > 0 ? 'cb-blue' : 'cb-purple',
    '<div class="big-num">' + (successRate !== null ? (successRate * 100).toFixed(0) + '%' : '—') + '</div>'
    + '<div class="big-num-sub">success rate · ' + esc(tc.failed || 0) + ' failed · ' + esc(tc.succeeded || 0) + ' succeeded</div>'
    + (successRate !== null
      ? '<div class="h-bar-track"><div class="h-bar-fill" style="width:' + (successRate * 100).toFixed(1) + '%;background:' + barColor(successRate) + '"></div></div>'
      : '')
    + '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);margin-top:2px">avg duration: ' + fmtMs(tc.avgDurationMs || 0) + ' · last 30d</div>'
  );

  // Card 2: top failing tools table
  var failingRows = (tc.topFailingTools || []).map(function(t) {
    return '<tr>'
      + '<td class="td-primary">' + esc(t.actionName) + '</td>'
      + '<td class="td-red">' + esc(t.count) + '</td>'
      + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(t.lastError) + '">'
      + esc(t.lastError.slice(0, 55)) + (t.lastError.length > 55 ? '…' : '')
      + '</td>'
      + '</tr>';
  }).join('');

  html += card(
    'Top failing tools', (tc.failed || 0) > 0 ? tc.failed + ' errors' : 'clean',
    (tc.failed || 0) > 0 ? 'cb-red' : 'cb-green',
    failingRows
      ? '<table class="data-table"><thead><tr><th>Action</th><th>Fails</th><th>Last error</th></tr></thead>'
        + '<tbody>' + failingRows + '</tbody></table>'
      : '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);padding:16px 0;text-align:center">No failures recorded yet</div>'
  );

  // Card 3: diagnostics callout
  html += card(
    'Error diagnostics', 'relay-side', 'cb-orange',
    '<div class="big-num">' + esc(tc.failed || 0) + '</div>'
    + '<div class="big-num-sub">relay-tracked failures · independent of client opt-in</div>'
    + '<div class="insight">These errors are stored server-side by the relay regardless of client telemetry settings. '
    + 'Most failures are Composio SDK mismatches (<strong>Tool_ToolNotFound</strong>). '
    + 'Use <em>ATTACCA_LIST_ACTIONS</em> to discover available action names per app.</div>'
  );

  html += '</div>'; // row-3

  // ── SECTION 5: RESEARCH PRIORITIES ──────────────────────────────────────────
  html += sectionLabel('Research priorities — open questions');
  html += '<div class="grid-row row-4">';

  html += card('Activation funnel', 'needs data', 'cb-purple',
    '<div class="big-num">—</div><div class="big-num-sub">% completing onboarding</div>'
    + '<div class="insight">Tracks licensed → app open → tool connected → first task. Needs app-launch events.</div>'
  );

  html += card('Trust growth curve', 'needs data', 'cb-purple',
    '<div class="big-num">—</div><div class="big-num-sub">avg days to balanced profile</div>'
    + '<div class="insight">How quickly do cautious users raise their trust profile? Rising = product is earning trust.</div>'
  );

  html += card('Role divergence index', 'needs data', 'cb-purple',
    '<div class="big-num">—</div><div class="big-num-sub">divergence score</div>'
    + '<div class="insight">Measures how differently users configure trust profiles relative to cohort. Needs n≥10.</div>'
  );

  html += card('Workflow specialisation', 'needs data', 'cb-purple',
    '<div class="big-num">—</div><div class="big-num-sub">active workflows / user</div>'
    + '<div class="insight">Share of users with 3+ active workflows. Proxy for depth of engagement. Needs workflow events.</div>'
  );

  html += '</div>'; // row-4

  // Trailing space
  html += '<div style="height:16px"></div>';

  document.getElementById('grid').innerHTML = html;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

function loadStats() {
  var secret = document.getElementById('secret').value.trim();
  if (!secret) { showError('Enter a dashboard secret first.'); return; }
  currentSecret = secret;

  document.getElementById('grid').innerHTML = '<div class="state-msg"><span>Loading…</span></div>';
  document.getElementById('relay-badge').className = 'topbar-badge offline';
  document.getElementById('relay-label').textContent = 'loading…';

  fetch('/dashboard/stats', {
    headers: { 'x-dashboard-secret': secret }
  })
  .then(function(res) {
    if (res.status === 403) throw new Error('Wrong secret — access denied');
    if (!res.ok) throw new Error('Server error ' + res.status);
    return res.json();
  })
  .then(function(data) {
    lastLoaded = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    renderDashboard(data);
  })
  .catch(function(err) {
    showError(err.message);
  });
}

function showError(msg) {
  document.getElementById('relay-badge').className = 'topbar-badge offline';
  document.getElementById('relay-label').textContent = 'error';
  document.getElementById('grid').innerHTML =
    '<div class="state-msg error"><span>⚠ ' + esc(msg) + '</span></div>';
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('load-btn').addEventListener('click', loadStats);
  document.getElementById('secret').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadStats();
  });

  // Period buttons (decorative — API is fixed at 30d for now)
  document.querySelectorAll('.period-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.period-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentPeriod = parseInt(btn.dataset.period) || 30;
      if (currentSecret) loadStats();
    });
  });

  // Nav items (decorative for now)
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      document.querySelectorAll('.nav-item').forEach(function(i) { i.classList.remove('active'); });
      item.classList.add('active');
    });
  });

  // Auto-focus secret input
  document.getElementById('secret').focus();
});
