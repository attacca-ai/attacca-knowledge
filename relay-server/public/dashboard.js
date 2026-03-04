async function loadStats() {
  var secret = document.getElementById('secret').value;
  var content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading...</div>';

  try {
    var res = await fetch('/dashboard/stats', {
      headers: { 'x-dashboard-secret': secret }
    });
    if (!res.ok) throw new Error('Unauthorized or server error');
    var data = await res.json();
    renderDashboard(data);
  } catch (err) {
    content.innerHTML = '<div class="error">' + err.message + '</div>';
  }
}

function renderDashboard(data) {
  var content = document.getElementById('content');

  var taskCard = '<div class="card">'
    + '<h2>Task Completion</h2>'
    + '<div class="stat">' + data.tasks.totalCompleted + '</div>'
    + '<div class="stat-label">Tasks completed</div>'
    + '<div class="stat-sub">'
    + '<div class="stat-label">' + data.tasks.totalFailed + ' failed</div>'
    + '<div class="stat-label">Avg duration: ' + Math.round(data.tasks.avgDurationMs / 1000) + 's</div>'
    + '<div class="stat-label">Fallback rate: ' + (data.tasks.fallbackRate * 100).toFixed(1) + '%</div>'
    + '</div></div>';

  var permRows = data.permissions.map(function(p) {
    return '<tr>'
      + '<td>' + p.eventType.replace('permission.', '').replace('.resolved', '') + '</td>'
      + '<td>' + p.total + '</td>'
      + '<td>' + (p.approvalRate * 100).toFixed(0) + '%</td>'
      + '<td><div class="bar"><div class="bar-fill bar-green" style="width:' + (p.approvalRate * 100) + '%"></div></div></td>'
      + '</tr>';
  }).join('');

  var permCard = '<div class="card">'
    + '<h2>Permission Approval Rates</h2>'
    + '<table><thead><tr><th>Type</th><th>Total</th><th>Rate</th><th></th></tr></thead>'
    + '<tbody>' + (permRows || '<tr><td colspan="4">No data</td></tr>') + '</tbody>'
    + '</table></div>';

  var trustRows = data.trustProfiles.map(function(t) {
    return '<tr>'
      + '<td>' + t.profile + '</td>'
      + '<td>' + t.count + '</td>'
      + '<td><div class="bar"><div class="bar-fill bar-blue" style="width:' + Math.min(t.count * 10, 100) + '%"></div></div></td>'
      + '</tr>';
  }).join('');

  var trustCard = '<div class="card">'
    + '<h2>Trust Profile Distribution</h2>'
    + '<table><thead><tr><th>Profile</th><th>Users</th><th></th></tr></thead>'
    + '<tbody>' + (trustRows || '<tr><td colspan="3">No data</td></tr>') + '</tbody>'
    + '</table></div>';

  var u = data.usage || {};
  var usagePct = u.limitUsd > 0 ? Math.min((u.totalCostUsd / u.limitUsd) * 100, 100) : 0;
  var barColor = usagePct >= 100 ? 'bar-red' : usagePct >= 80 ? 'bar-orange' : 'bar-green';
  var usageCard = '<div class="card">'
    + '<h2>LLM Usage (This Month)</h2>'
    + '<div class="stat">$' + (u.totalCostUsd || 0).toFixed(4) + '</div>'
    + '<div class="stat-label">of $' + (u.limitUsd || 30).toFixed(2) + ' ceiling</div>'
    + '<div class="stat-sub">'
    + '<div class="bar" style="margin:0.5rem 0"><div class="bar-fill ' + barColor + '" style="width:' + usagePct.toFixed(1) + '%"></div></div>'
    + '<div class="stat-label">' + usagePct.toFixed(1) + '% used</div>'
    + '<div class="stat-label">' + (u.activeUsers || 0) + ' active users &bull; ' + (u.totalRequests || 0) + ' requests</div>'
    + '<div class="stat-label">' + (u.usersAtLimit || 0) + ' users at limit</div>'
    + '</div></div>';

  content.innerHTML = '<div class="grid">' + usageCard + taskCard + permCard + trustCard + '</div>';
  content.classList.remove('loading');
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('load-btn').addEventListener('click', loadStats);
  document.getElementById('secret').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadStats();
  });
});
