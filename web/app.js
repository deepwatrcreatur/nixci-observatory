const $ = (selector) => document.querySelector(selector);
const cpuHistory = [];
const workerHistory = [];
const HISTORY_LIMIT = 72;
const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function escaped(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${numberFmt.format(value)} ${units[unit]}`;
}

function humanDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function drawSparkline(canvas, history, color) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#ece7dd';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(0, height - 1);
  ctx.lineTo(width, height - 1);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!history.length) return;
  const points = history.slice(-HISTORY_LIMIT);
  const xStep = points.length > 1 ? width / (points.length - 1) : 0;
  const yFor = (value) => height - 3 - Math.min(100, Math.max(0, value)) / 100 * (height - 7);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `${color}33`);
  gradient.addColorStop(1, `${color}00`);
  ctx.beginPath();
  points.forEach((value, index) => {
    const x = index * xStep;
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  points.forEach((value, index) => {
    const x = index * xStep;
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (['success', 'passed', 'complete', 'completed', 'cached', 'skipped'].includes(value)) return 'success';
  if (['failure', 'failed', 'error', 'cancelled'].includes(value)) return 'failure';
  if (['running', 'started', 'in_progress'].includes(value)) return 'running';
  return 'queued';
}

function timeLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function safeLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && ['nix-ci.com', 'api.nix-ci.com', 'github.com'].includes(parsed.hostname)) return parsed.href;
  } catch {}
  return '#';
}

function renderResources(data) {
  const host = data.host || {};
  const memory = host.memory || {};
  const disk = host.disk || {};
  const worker = data.worker || {};
  const cpu = Math.max(0, Math.min(100, Number(host.cpuPercent) || 0));
  const memoryPct = memory.total ? Math.max(0, Math.min(100, memory.used / memory.total * 100)) : 0;
  const diskPct = disk.total ? Math.max(0, Math.min(100, disk.used / disk.total * 100)) : 0;

  $('#hostname').textContent = host.hostname || '—';
  $('#uptime').textContent = Number.isFinite(host.uptimeSeconds) ? humanDuration(host.uptimeSeconds) : '—';
  $('#cpu-value').textContent = numberFmt.format(cpu);
  $('#load-averages').textContent = `1m ${numberFmt.format(host.load?.[0] || 0)} · 5m ${numberFmt.format(host.load?.[1] || 0)} · 15m ${numberFmt.format(host.load?.[2] || 0)}`;
  cpuHistory.push(cpu);
  if (cpuHistory.length > HISTORY_LIMIT) cpuHistory.shift();
  drawSparkline($('#cpu-chart'), cpuHistory, '#b8684f');

  const cores = host.cores || [];
  $('#core-grid').innerHTML = cores.map((core) => {
    const level = Math.min(4, Math.floor((core.usage || 0) / 20));
    const color = ['#eee9df', '#dce5d9', '#bdcdbd', '#91aa94', '#647f6c'][level];
    return `<span class="core-cell" title="Core ${core.index}: ${numberFmt.format(core.usage || 0)}%" style="background:${color}"></span>`;
  }).join('');
  $('#core-caption').textContent = `${cores.length || host.logicalCores || 0} logical cores · per-core utilization`;

  $('#memory-value').textContent = numberFmt.format(memoryPct);
  $('#memory-fill').style.width = `${memoryPct}%`;
  $('#memory-used').textContent = humanBytes(memory.used);
  $('#memory-total').textContent = `${humanBytes(memory.total)} total`;
  $('#memory-available').textContent = `${humanBytes(memory.available)} available to the system`;
  $('#disk-used').textContent = `${numberFmt.format(diskPct)}% used`;
  $('#load-one').textContent = numberFmt.format(host.load?.[0] || 0);

  const active = worker.state === 'active';
  $('#worker-state').className = `state-pill ${active ? 'state-active' : worker.state === 'inactive' ? 'state-inactive' : 'state-unknown'}`;
  $('#worker-state').innerHTML = `<i></i> ${escaped(active ? 'SERVICE ACTIVE' : String(worker.state || 'UNKNOWN').toUpperCase())}`;
  $('#host-dot').style.background = active ? 'var(--sage)' : 'var(--gold)';
  $('#worker-substate').textContent = worker.substate || worker.error || '—';
  $('#worker-restarts').textContent = Number.isFinite(worker.restarts) ? String(worker.restarts) : '—';
  $('#worker-since').textContent = (worker.activeSince || '—').replace(/^[A-Za-z]{3}\s+/, '');
  $('#worker-memory').textContent = humanBytes(worker.memoryBytes);
  const workerCpu = Math.max(0, Math.min(100, Number(worker.cpuPercentHost) || 0));
  $('#worker-cpu').textContent = numberFmt.format(workerCpu);
  workerHistory.push(workerCpu);
  if (workerHistory.length > HISTORY_LIMIT) workerHistory.shift();
  const gaugeAngle = workerCpu / 100 * 360;
  $('#worker-gauge').style.background = `conic-gradient(var(--rust) 0deg, var(--rust) ${gaugeAngle}deg, var(--rust-soft) ${gaugeAngle}deg 360deg)`;

  const processes = data.processes || [];
  $('#process-count').textContent = `${processes.length} visible / refresh 2s`;
  $('#process-rows').innerHTML = processes.length ? processes.map((process) => {
    const cpuShare = Math.max(0, Math.min(100, Number(process.cpu) || 0));
    const memoryShare = memory.total ? Math.max(0, Math.min(100, process.rss / memory.total * 100)) : 0;
    return `<tr><td><span class="process-name"><i class="process-dot ${process.worker ? 'worker' : ''}"></i>${escaped(process.name)}</span></td><td class="mono">${escaped(process.pid)}</td><td class="mono">${numberFmt.format(cpuShare)}%</td><td class="mono">${humanBytes(process.rss)}</td><td><span class="process-bar ${process.worker ? 'worker' : ''}"><i style="width:${memoryShare}%"></i></span></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-state">No readable process samples.</td></tr>';
  $('#last-updated').textContent = `Sampled ${new Date().toLocaleTimeString()}`;
}

function renderSuites(ci) {
  const suites = ci.suites || [];
  $('#suite-count').textContent = suites.length ? `${suites.length} suites observed` : 'No suites found';
  if (ci.error) $('#feed-status').textContent = `Suite feed partial: ${ci.error}`;
  else $('#feed-status').textContent = 'Local resource sample · GitHub and NixCI suite status';
  if (!suites.length) {
    $('#build-tree').innerHTML = `<p class="empty-state">No recent NixCI statuses found for the watched pull requests.</p>`;
    return;
  }
  $('#build-tree').innerHTML = suites.map((suite, suiteIndex) => {
    const suiteClass = statusClass(suite.status);
    const runs = Array.isArray(suite.runs) ? suite.runs : [];
    const sha = (suite.sha || '').slice(0, 8);
    const title = suite.pullRequest ? `#${suite.pullRequest} · ${suite.title}` : suite.title;
    const byType = new Map();
    runs.forEach((run) => {
      const key = run.type || 'task';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(run);
    });
    const groups = [...byType.entries()].map(([type, tasks], groupIndex, allGroups) => {
      const taskClasses = tasks.map((task) => statusClass(task.status));
      const groupClass = taskClasses.includes('failure') ? 'failure' : taskClasses.includes('running') ? 'running' : taskClasses.includes('queued') ? 'queued' : 'success';
      const groupName = ({ config: 'Configuration', show: 'Evaluation', build: 'Build outputs' })[type] || type;
      const taskRows = tasks.slice(0, 10).map((run, runIndex) => {
        const runClass = statusClass(run.status);
        const runName = run.attribute || run.name || run.type || 'Build task';
        const runHref = safeLink(run.url || suite.url);
        const node = `<a class="job-title" href="${escaped(runHref)}" target="_blank" rel="noreferrer">${escaped(runName)}</a>`;
        const glyph = runIndex === Math.min(tasks.length, 10) - 1 && tasks.length <= 10 ? '└' : '├';
        return `<div class="job-node"><span class="job-glyph">${glyph}</span>${node}<span class="node-meta">${timeLabel(run.started || run.queued)}</span><span class="node-state ${runClass}"><i></i>${escaped(run.status || 'queued')}</span></div>`;
      }).join('');
      const more = tasks.length > 10 ? `<div class="job-node more-node"><span class="job-glyph">└</span><a class="job-title" href="${escaped(safeLink(suite.url))}" target="_blank" rel="noreferrer">${tasks.length - 10} more outputs on NixCI</a><span></span><span></span></div>` : '';
      const groupGlyph = groupIndex === allGroups.length - 1 ? '└' : '├';
      return `<details class="task-group" ${suiteIndex === 0 || groupClass === 'running' || groupClass === 'queued' ? 'open' : ''}><summary><span class="tree-toggle">›</span><span class="group-title">${groupGlyph} ${escaped(groupName)} <span class="node-meta">(${tasks.length})</span></span><span></span><span class="node-state ${groupClass}"><i></i>${escaped(groupClass)}</span></summary><div class="task-children">${taskRows}${more}</div></details>`;
    }).join('');
    const children = runs.length ? groups : `<div class="job-node"><span class="job-glyph">└</span><span class="job-title">Suite details are available on NixCI</span><span class="node-meta">${timeLabel(suite.started)}</span><span class="node-state ${suiteClass}"><i></i>${escaped(suite.status || 'unknown')}</span></div>`;
    return `<details class="suite-node" ${suiteIndex === 0 || suiteClass === 'running' || suiteClass === 'queued' ? 'open' : ''}><summary class="suite-summary"><span class="tree-toggle">›</span><span class="node-title"><a href="${escaped(safeLink(suite.url))}" target="_blank" rel="noreferrer">${escaped(title)}</a></span><span class="node-meta">${escaped(suite.repository)} · ${escaped(sha)}</span><span class="node-state ${suiteClass}"><i></i>${escaped(suite.status || 'unknown')}</span></summary><div class="node-children">${children}</div></details>`;
  }).join('');
}

async function update() {
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    renderResources(snapshot.resources || {});
    renderSuites(snapshot.ci || {});
  } catch (error) {
    $('#last-updated').textContent = 'Live sample unavailable';
    $('#feed-status').textContent = `Observatory API: ${error.message}`;
  }
}

update();
window.setInterval(update, 2000);
window.addEventListener('resize', () => {
  drawSparkline($('#cpu-chart'), cpuHistory, '#b8684f');
});

const themeSelect = $('#theme-select');
const savedTheme = localStorage.getItem('nixci-observatory-theme') || 'warm';
document.body.dataset.theme = savedTheme;
themeSelect.value = savedTheme;
themeSelect.addEventListener('change', () => {
  document.body.dataset.theme = themeSelect.value;
  localStorage.setItem('nixci-observatory-theme', themeSelect.value);
});
