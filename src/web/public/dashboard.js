/* global EventSource */

// ========== Auth guard ==========
function redirectToLogin() {
  window.location.href = '/login';
}

async function authFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('Unauthorized');
  }
  return res;
}

// ========== State ==========
const state = {
  activeTab: 'overview',
  livePaused: false,
  liveEntries: [],
  maxLiveEntries: 500,
  explorePage: 0,
  explorePageSize: 50,
  currentModalEntry: null,
  user: null,
  selectedGuild: null,
};

// ========== DOM refs ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========== Init: load user info ==========
async function init() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) throw new Error('Server error');
    state.user = await res.json();
    renderUserInfo();
    loadGitSyncStatus();
  } catch (_) {
    // Only redirect on auth failure; server errors are silently ignored
  }
}

function renderUserInfo() {
  if (!state.user) return;

  // Add user + logout to sidebar
  const footer = $('.sidebar-footer');
  footer.innerHTML = `
    <div class="user-info">
      ${state.user.avatar
        ? `<img src="https://cdn.discordapp.com/avatars/${state.user.userId}/${state.user.avatar}.png?size=32" alt="" class="user-avatar">`
        : '<div class="user-avatar default">?</div>'}
      <span class="user-name">${escapeHtml(state.user.username)}</span>
    </div>
    <div class="connection-status" id="connectionStatus">
      <span class="status-dot disconnected"></span>
      <span>Disconnected</span>
    </div>
    <button class="btn btn-outline logout-btn" onclick="logout()">Sign out</button>
  `;

  // Populate guild selector if there are multiple guilds
  if (state.user.guilds.length > 1) {
    const sel = document.createElement('select');
    sel.className = 'filter-input guild-select';
    sel.innerHTML = '<option value="">All your servers</option>' +
      state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    sel.addEventListener('change', () => {
      state.selectedGuild = sel.value || null;
      if (state.activeTab === 'explore') applyExploreFilters(1);
    });
    $('.live-filters').prepend(sel);
    const sel2 = sel.cloneNode(true);
    sel2.addEventListener('change', () => {
      state.selectedGuild = sel2.value || null;
      applyExploreFilters(1);
    });
    $('.filter-bar').prepend(sel2);
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  redirectToLogin();
}

// ========== Tab switching ==========
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    state.activeTab = tab;
    $$('.tab-content').forEach(t => t.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');
    if (tab === 'overview') loadOverview();
    if (tab === 'logs') { loadLogsLiveSub(); }
    if (tab === 'settings') { loadSettings(); loadLogConfig(); }
    if (tab === 'tickets') loadTicketDashboard();
    if (tab === 'ticket-config') loadTicketConfig();
    if (tab === 'bots') loadBots();
    if (tab === 'backups') loadBackups();
    if (tab === 'modmail') loadModmail();
  });
});

function loadLogsLiveSub() {
  // Activate the live sub-tab by default when entering Logs
  const activeSub = $('#logsSubnav .subnav-btn.active');
  if (!activeSub || activeSub.dataset.subtab === 'logs-live') {
    // Already on live, just ensure it's active
    $$('#logsSubnav .subnav-btn').forEach(b => b.classList.remove('active'));
    const liveBtn = $('#logsSubnav .subnav-btn[data-subtab="logs-live"]');
    if (liveBtn) liveBtn.classList.add('active');
    $$('#tab-logs .subtab-content').forEach(t => t.classList.remove('active'));
    const livePane = $('#subtab-logs-live');
    if (livePane) livePane.classList.add('active');
  }
}

// ========== Tab Sub-navigation ==========
$$('.subnav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const parentTab = btn.closest('.tab-content');
    const subnavContainer = btn.parentElement;
    
    // Only deactivate buttons within the same subnav
    subnavContainer.querySelectorAll('.subnav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const sub = btn.dataset.subtab;
    
    // Only hide sub-contents within the same parent tab
    if (parentTab) {
      parentTab.querySelectorAll('.subtab-content').forEach(t => t.classList.remove('active'));
    } else {
      $$('.subtab-content').forEach(t => t.classList.remove('active'));
    }
    $(`#subtab-${sub}`)?.classList.add('active');
    
    // Logs sub-tabs
    if (sub === 'logs-explore') { loadEventFilter(); applyExploreFilters(); }
    if (sub === 'logs-stats') loadStats();
    
    // Settings sub-tabs
    if (sub === 'settings-events') loadLogConfig();
    
    // Ticket config sub-tabs
    if (sub === 'ticket-general') loadConfigEditor('general', 'generalConfigEditor');
    if (sub === 'ticket-panels') loadConfigEditor('panels', 'panelsConfigEditor');
    if (sub === 'ticket-options') loadConfigEditor('options', 'optionsConfigEditor');
    if (sub === 'ticket-questions') loadConfigEditor('questions', 'questionsConfigEditor');
    if (sub === 'ticket-priorities') loadPrioritiesDisplay();
    if (sub === 'ticket-transcripts') loadTranscriptsDisplay();
    if (sub === 'ticket-spawn') loadSpawnPanel();
  });
});

// ========== Overview Tab ==========

async function loadOverview() {
  // Load quick stats
  if (state.user) {
    $('#quickServerCount').textContent = state.user.guilds.length;
  }

  // Update connection status
  const connEl = $('#connectionStatus');
  if (connEl) {
    const isConnected = connEl.querySelector('.status-dot.connected');
    $('#quickConnStatus').textContent = isConnected ? 'Connected' : 'Disconnected';
    $('#quickConnStatus').className = 'quick-stat-value ' + (isConnected ? 'connected' : 'disconnected');
  }

  // Load stats
  try {
    const res = await authFetch('/api/stats');
    const stats = await res.json();

    $('#ovStatTotal').textContent = stats.totalLogs.toLocaleString();
    $('#ovStatTypes').textContent = Object.keys(stats.eventCounts).length;
    $('#quickRateLimits').textContent = stats.rateLimits?.count?.toLocaleString() || '0';
    $('#quickNewestLog').textContent = stats.newestLog ? formatTime(stats.newestLog) : '—';

    // Show recent entries in the overview
    try {
      const logsRes = await authFetch('/api/logs?limit=5');
      const logsData = await logsRes.json();
      const recentContainer = $('#overviewRecent');
      if (recentContainer && logsData.logs?.length > 0) {
        recentContainer.innerHTML = logsData.logs.map(entry => `
          <div class="overview-log-entry" onclick="openLogDetail(${entry.id}, false)">
            <span class="log-time">${formatTime(entry.timestamp)}</span>
            <span class="log-event-badge ${eventClass(entry.event)}">${entry.event}</span>
            <span class="ov-log-summary">${escapeHtml(summarizeData(entry.data))}</span>
          </div>
        `).join('');
      }
    } catch (_) {}
  } catch (_) {
    $('#ovStatTotal').textContent = '—';
    $('#ovStatTypes').textContent = '—';
    $('#quickRateLimits').textContent = '—';
    $('#quickNewestLog').textContent = '—';
  }

  // Load ticket & modmail overview stats
  if (state.user?.guilds?.length > 0) {
    const firstGuild = state.user.guilds[0].id;
    try {
      const tRes = await authFetch(`/api/tickets/${firstGuild}`);
      const tData = await tRes.json();
      $('#ovStatTickets').textContent = tData.stats?.open || '0';
    } catch (_) {
      $('#ovStatTickets').textContent = '—';
    }
    try {
      const mRes = await authFetch(`/api/modmail/threads/${firstGuild}`);
      const mData = await mRes.json();
      const openCount = mData.threads?.filter(t => !t.closed)?.length || 0;
      $('#ovStatModmail').textContent = openCount;
    } catch (_) {
      $('#ovStatModmail').textContent = '—';
    }
  }
}

// Update overview connection status when SSE changes
const _origSSEOnOpen = EventSource && EventSource.prototype.constructor;
// We'll patch this via the connectSSE function

// ========== Live Feed ==========
const liveLogs = $('#liveLogs');
const liveCount = $('#liveCount');
const pauseCheckbox = $('#pauseLive');
let eventSource = null;

function connectSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    const el = $('#connectionStatus');
    if (el) el.innerHTML = '<span class="status-dot connected"></span><span>Connected</span>';
    const qs = $('#quickConnStatus');
    if (qs) { qs.textContent = 'Connected'; qs.className = 'quick-stat-value connected'; }
  };

  eventSource.onerror = async () => {
    const el = $('#connectionStatus');
    if (el) el.innerHTML = '<span class="status-dot disconnected"></span><span>Disconnected</span>';
    const qs = $('#quickConnStatus');
    if (qs) { qs.textContent = 'Disconnected'; qs.className = 'quick-stat-value disconnected'; }
    try {
      const res = await fetch('/api/stats');
      if (res.status === 401) { redirectToLogin(); return; }
    } catch (_) {}
    setTimeout(connectSSE, 5000);
  };

  setInterval(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.status === 401) redirectToLogin();
    } catch (_) {}
  }, 60_000);

  eventSource.onmessage = (e) => {
    if (state.livePaused) return;
    try {
      const entry = JSON.parse(e.data);
      // Filter by selected guild
      if (state.selectedGuild) {
        const userGuild = state.user?.guilds?.find(g => g.id === state.selectedGuild);
        if (userGuild && entry.guild && entry.guild.toLowerCase() !== userGuild.name.toLowerCase()) return;
      }
      addLiveEntry(entry);
    } catch (_) {}
  };
}

// ========== Git Sync Status ==========

async function loadGitSyncStatus() {
  try {
    const res = await fetch('/api/git-sync');
    if (!res.ok) return;
    const status = await res.json();
    
    const dot = $('#gitSyncDot');
    const text = $('#gitSyncText');
    const lastEl = $('#gitSyncLast');
    const btn = $('#gitSyncBtn');

    if (!dot || !text) return;

    if (status.configured) {
      dot.className = 'status-dot connected';
      text.textContent = `Git sync: ✅ ${status.repo}`;
      text.title = `Branch: ${status.branch}`;
      if (btn) btn.disabled = false;
      
      // Show last sync info
      if (lastEl && status.lastSync) {
        const sync = status.lastSync;
        if (sync.time) {
          const d = new Date(sync.time);
          const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const icon = sync.success ? '✅' : '❌';
          lastEl.textContent = `${icon} ${timeStr} — ${sync.message}`;
          lastEl.className = 'git-sync-row git-sync-last ' + (sync.success ? 'sync-ok' : 'sync-err');
        } else {
          lastEl.textContent = '— No sync yet';
        }
      }
    } else if (status.tokenSet && !status.repo) {
      dot.className = 'status-dot disconnected';
      text.textContent = 'Git sync: ⚠️ No repo';
      text.title = 'GITHUB_TOKEN is set but no GITHUB_REPO. Set GITHUB_REPO env var or ensure git remote origin is configured.';
      if (btn) btn.disabled = true;
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = 'Git sync: ❌ Not configured';
      text.title = 'Set GITHUB_TOKEN environment variable to enable auto-sync to GitHub.';
      if (btn) btn.disabled = true;
    }
  } catch (_) {
    const dot = $('#gitSyncDot');
    const text = $('#gitSyncText');
    if (dot) dot.className = 'status-dot disconnected';
    if (text) text.textContent = 'Git sync: ❌ Error';
  }
}

async function triggerGitSync() {
  const btn = $('#gitSyncBtn');
  const lastEl = $('#gitSyncLast');
  if (!btn) return;
  
  btn.disabled = true;
  btn.textContent = '↻ Syncing…';
  
  try {
    const res = await fetch('/api/git-sync/sync', { method: 'POST' });
    const result = await res.json();
    
    // Update last sync display immediately
    if (lastEl) {
      const d = new Date(result.time);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const icon = result.success ? '✅' : '❌';
      lastEl.textContent = `${icon} ${timeStr} — ${result.message}`;
      lastEl.className = 'git-sync-row git-sync-last ' + (result.success ? 'sync-ok' : 'sync-err');
    }
    
    // Refresh full status
    loadGitSyncStatus();
  } catch (err) {
    if (lastEl) {
      lastEl.textContent = '❌ Sync request failed';
      lastEl.className = 'git-sync-row git-sync-last sync-err';
    }
  } finally {
    btn.textContent = '↻ Sync Now';
    btn.disabled = false;
  }
}

$('#gitSyncBtn')?.addEventListener('click', triggerGitSync);

function addLiveEntry(entry) {
  state.liveEntries.unshift(entry);
  if (state.liveEntries.length > state.maxLiveEntries) state.liveEntries.pop();
  renderLiveEntries();
}

function renderLiveEntries() {
  const filterEvent = ($('#liveFilterEvent')?.value || '').toLowerCase();
  const filterSearch = ($('#liveFilterSearch')?.value || '').toLowerCase();

  let entries = state.liveEntries;
  if (filterEvent) entries = entries.filter(e => e.event.toLowerCase().includes(filterEvent));
  if (filterSearch) entries = entries.filter(e => JSON.stringify(e.data).toLowerCase().includes(filterSearch));

  if (liveCount) liveCount.textContent = `${entries.length} logs`;

  if (entries.length === 0) {
    liveLogs.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3>Waiting for events…</h3>
        <p>Events will appear here in real time as the bot detects them.</p>
      </div>`;
    return;
  }

  liveLogs.innerHTML = entries.map(entry => `
    <div class="log-entry" data-id="${entry.id}" onclick="openLogDetail(${entry.id}, true)">
      <span class="log-time">${formatTime(entry.timestamp)}</span>
      <span class="log-event-badge ${eventClass(entry.event)}">${entry.event}</span>
      <div class="log-context">
        ${entry.guild ? `<span class="ctx-item">🏠 ${escapeHtml(entry.guild)}</span>` : ''}
        ${entry.channel ? `<span class="ctx-item">💬 ${escapeHtml(entry.channel)}</span>` : ''}
        ${entry.user ? `<span class="ctx-item">👤 ${escapeHtml(entry.user)}</span>` : ''}
      </div>
      <span class="log-summary">${summarizeData(entry.data)}</span>
    </div>
  `).join('');
}

$('#liveFilterEvent')?.addEventListener('input', renderLiveEntries);
$('#liveFilterSearch')?.addEventListener('input', renderLiveEntries);
pauseCheckbox?.addEventListener('change', () => { state.livePaused = pauseCheckbox.checked; });
$('#clearLive')?.addEventListener('click', () => {
  state.liveEntries = [];
  renderLiveEntries();
});

// ========== Explore Tab ==========
async function loadEventFilter() {
  try {
    const res = await authFetch('/api/events');
    const events = await res.json();
    const sel = $('#filterEvent');
    if (sel) sel.innerHTML = '<option value="">All events</option>' +
      events.map(e => `<option value="${e}">${e}</option>`).join('');
  } catch (_) {}
}

async function applyExploreFilters(page = 1) {
  state.explorePage = page;
  const params = new URLSearchParams();
  const event = $('#filterEvent')?.value;
  const guild = $('#filterGuild')?.value;
  const channel = $('#filterChannel')?.value;
  const user = $('#filterUser')?.value;
  const search = $('#filterSearch')?.value;

  if (event) params.set('event', event);
  if (guild) params.set('guild', guild);
  if (channel) params.set('channel', channel);
  if (user) params.set('user', user);
  if (search) params.set('search', search);
  params.set('limit', state.explorePageSize);
  params.set('offset', (page - 1) * state.explorePageSize);

  try {
    const res = await authFetch(`/api/logs?${params}`);
    const data = await res.json();

    const tbody = $('#exploreBody');
    const empty = $('#exploreEmpty');
    const tableWrap = $('.log-table-wrap');

    if (!tbody) return;

    if (data.logs.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      if (tableWrap) tableWrap.style.display = 'none';
    } else {
      if (empty) empty.style.display = 'none';
      if (tableWrap) tableWrap.style.display = 'block';
      exploreEntryCache.clear();
      tbody.innerHTML = data.logs.map(l => {
        exploreEntryCache.set(l.id, l);
        return `
        <tr onclick="openLogDetail(${l.id}, false)" title="Click for details">
          <td class="col-id">${l.id}</td>
          <td class="col-time">${formatTime(l.timestamp)}</td>
          <td class="col-event"><span class="log-event-badge ${eventClass(l.event)}">${l.event}</span></td>
          <td class="col-guild">${escapeHtml(l.guild || '—')}</td>
          <td class="col-channel">${escapeHtml(l.channel || '—')}</td>
          <td class="col-user">${escapeHtml(l.user || '—')}</td>
          <td class="col-data">${escapeHtml(summarizeData(l.data))}</td>
        </tr>
      `}).join('');
    }

    const totalPages = Math.max(1, Math.ceil(data.total / state.explorePageSize));
    const pagEl = $('#pagination');
    if (pagEl) pagEl.innerHTML = `
      <button ${page <= 1 ? 'disabled' : ''} onclick="applyExploreFilters(${page - 1})">← Prev</button>
      <span class="page-info">Page ${page} of ${totalPages} (${data.total} logs)</span>
      <button ${page >= totalPages ? 'disabled' : ''} onclick="applyExploreFilters(${page + 1})">Next →</button>
    `;
  } catch (err) {
    console.error('Explore query failed:', err);
  }
}

$('#applyFilters')?.addEventListener('click', () => applyExploreFilters(1));
$$('#filterSearch, #filterEvent, #filterGuild, #filterChannel, #filterUser').forEach(el =>
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyExploreFilters(1); })
);

// ========== Clear all logs ==========
$('#clearAllLogs')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete ALL logs? This cannot be undone.')) return;
  await authFetch('/api/clear', { method: 'POST' });
  state.liveEntries = [];
  renderLiveEntries();
  applyExploreFilters(1);
  loadStats();
});

// ========== Stats ==========
async function loadStats() {
  try {
    const res = await authFetch('/api/stats');
    const stats = await res.json();

    $('#statTotal').textContent = stats.totalLogs.toLocaleString();
    $('#statTypes').textContent = Object.keys(stats.eventCounts).length;
    $('#statOldest').textContent = stats.oldestLog ? formatTime(stats.oldestLog) : '—';
    $('#statNewest').textContent = stats.newestLog ? formatTime(stats.newestLog) : '—';

    // Rate limits
    if (stats.rateLimits) {
      const rl = stats.rateLimits;
      $('#statRateLimits').textContent = rl.count.toLocaleString();
      if (rl.lastTime) {
        $('#statRateLimits').title = 'Last: ' + new Date(rl.lastTime).toLocaleString();
      }

      // Show detailed rate limit info
      const detailEl = $('#rateLimitDetail');
      const infoEl = $('#rateLimitInfo');
      const bodyEl = $('#rateLimitBody');
      if (rl.count > 0 && detailEl && infoEl && bodyEl) {
        detailEl.style.display = 'block';
        infoEl.innerHTML = [
          rl.lastLimit ? 'Last limit: <strong>' + rl.lastLimit + ' requests</strong>' : '',
          rl.lastTimeout ? 'Timeout: <strong>' + rl.lastTimeout + 'ms</strong>' : '',
          rl.lastRoute ? 'Route: <code>' + escapeHtml(rl.lastRoute) + '</code>' : '',
        ].filter(Boolean).join(' &nbsp;|&nbsp; ');

        const byRoute = rl.byRoute || {};
        const sorted = Object.entries(byRoute).sort((a, b) => b[1].count - a[1].count);
        if (sorted.length > 0) {
          bodyEl.innerHTML = sorted.map(([route, data]) =>
            '<tr>' +
            '<td><code>' + escapeHtml(route) + '</code></td>' +
            '<td>' + data.count.toLocaleString() + '</td>' +
            '<td>' + (data.limit || '?') + '/burst</td>' +
            '<td>' + (data.lastTime ? formatTime(data.lastTime) : '—') + '</td>' +
            '</tr>'
          ).join('');
        } else {
          bodyEl.innerHTML = '';
        }
      } else if (detailEl) {
        detailEl.style.display = 'none';
      }
    }

    const sorted = Object.entries(stats.eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const maxVal = sorted[0]?.[1] || 1;
    const chart = $('#eventChart');
    if (chart) chart.innerHTML = sorted.map(([name, count]) => `
      <div class="bar-row">
        <span class="bar-label">${name}</span>
        <div class="bar-fill-wrap">
          <div class="bar-fill" style="width:${(count / maxVal) * 100}%"></div>
        </div>
        <span class="bar-count">${count.toLocaleString()}</span>
      </div>
    `).join('');
  } catch (_) {}
}

// ========== Log Detail Modal ==========
const exploreEntryCache = new Map();

function openLogDetail(id, fromLive) {
  if (fromLive) {
    const entry = state.liveEntries.find(e => e.id === id);
    if (entry) { showModal(entry); return; }
  } else {
    const entry = exploreEntryCache.get(id);
    if (entry) { showModal(entry); return; }
  }
  showModal({ id, timestamp: '', event: 'unknown', guild: '', channel: '', user: '', data: { note: 'Entry not found in cache' } });
}

function showModal(entry) {
  state.currentModalEntry = entry;
  $('#modalBody').textContent = JSON.stringify(entry, null, 2);
  $('#logModal').showModal();
}

$('#modalClose')?.addEventListener('click', () => $('#logModal').close());
$('#logModal')?.addEventListener('click', (e) => { if (e.target === $('#logModal')) $('#logModal').close(); });
$('#modalCopy')?.addEventListener('click', () => {
  if (!state.currentModalEntry) return;
  navigator.clipboard.writeText(JSON.stringify(state.currentModalEntry, null, 2));
  const btn = $('#modalCopy');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#logModal')?.open) $('#logModal').close();
});

// ========== Helpers ==========
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function eventClass(eventName) {
  const e = eventName.toLowerCase();
  if (e.includes('message') || e.includes('reaction')) return 'event-msg';
  if (e.includes('voice')) return 'event-voice';
  if (e.includes('member') || e.includes('ban')) return 'event-member';
  if (e.includes('guild')) return 'event-guild';
  if (e.includes('channel') || e.includes('webhook')) return 'event-channel';
  if (e.includes('role')) return 'event-role';
  if (e.includes('thread') || e.includes('stage')) return 'event-thread';
  if (e.includes('reaction')) return 'event-reaction';
  if (e.includes('emoji') || e.includes('sticker')) return 'event-emote';
  if (e.includes('presence')) return 'event-presence';
  return 'event-other';
}

function summarizeData(data) {
  if (!data || Object.keys(data).length === 0) return '—';
  const keys = Object.keys(data).filter(k => k !== 'args');
  if (keys.length === 0 && data.args) return `[${data.args.length} args]`;
  const firstKey = keys[0];
  if (keys.length === 1 && typeof data[firstKey] === 'string') {
    return data[firstKey].substring(0, 80);
  }
  return keys.slice(0, 4).map(k => {
    const v = data[k];
    if (typeof v === 'string') return `${k}: ${v.substring(0, 40)}`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}: [${v.length}]`;
    if (v && typeof v === 'object') return `${k}: {…}`;
    return `${k}`;
  }).join(' · ') || '[complex]';
}

// ========== Settings Tab ==========
async function loadSettings() {
  if (!state.user?.guilds) return;

  const guildSel = $('#settingsGuild');
  const channelSel = $('#settingsChannel');
  const saveBtn = $('#saveSettings');
  const disableBtn = $('#disableSettings');
  const statusEl = $('#settingsStatus');

  // Populate guild selector
  guildSel.innerHTML = '<option value="">Select a server…</option>' +
    state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

  guildSel.onchange = async () => {
    const guildId = guildSel.value;
    channelSel.innerHTML = '<option value="">Loading…</option>';
    channelSel.disabled = true;
    saveBtn.disabled = true;
    disableBtn.disabled = true;
    statusEl.textContent = '';

    if (!guildId) {
      channelSel.innerHTML = '<option value="">Select a guild first…</option>';
      return;
    }

    try {
      // Fetch channels and current config in parallel
      const [chRes, cfgRes] = await Promise.all([
        authFetch(`/api/channels/${guildId}`),
        authFetch(`/api/config/${guildId}`),
      ]);
      const { channels } = await chRes.json();
      const { logChannel } = await cfgRes.json();

      channelSel.innerHTML = '<option value="">None (disabled)</option>' +
        channels.map(c => `<option value="${c.id}" ${c.id === logChannel ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
      channelSel.disabled = false;
      saveBtn.disabled = false;
      disableBtn.disabled = false;
    } catch (_) {
      channelSel.innerHTML = '<option value="">Failed to load channels</option>';
      statusEl.textContent = 'Failed to load channels. Is the bot online?';
    }
  };

  saveBtn.onclick = async () => {
    const guildId = guildSel.value;
    const channelId = channelSel.value || null;
    if (!guildId) return;

    saveBtn.disabled = true;
    statusEl.textContent = 'Saving…';
    try {
      await authFetch(`/api/config/${guildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logChannel: channelId }),
      });
      const chName = channelId ? channelSel.options[channelSel.selectedIndex].text : 'None';
      statusEl.textContent = `✅ Log channel set to ${chName}`;
      statusEl.className = 'settings-status success';
    } catch (_) {
      statusEl.textContent = 'Failed to save settings.';
      statusEl.className = 'settings-status error';
    } finally {
      saveBtn.disabled = false;
    }
  };

  disableBtn.onclick = async () => {
    const guildId = guildSel.value;
    if (!guildId) return;

    disableBtn.disabled = true;
    statusEl.textContent = 'Disabling…';
    try {
      await authFetch(`/api/config/${guildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logChannel: null }),
      });
      channelSel.value = '';
      statusEl.textContent = '✅ Logging disabled for this server.';
      statusEl.className = 'settings-status success';
    } catch (_) {
      statusEl.textContent = 'Failed to disable logging.';
      statusEl.className = 'settings-status error';
    } finally {
      disableBtn.disabled = false;
    }
  };

  // Trigger load for first guild
  if (state.user.guilds.length === 1) {
    guildSel.value = state.user.guilds[0].id;
    guildSel.onchange();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Log Config Tab
// ═══════════════════════════════════════════════════════════════════════════

async function loadLogConfig() {
  if (!state.user?.guilds) return;

  const guildSel = $('#logConfigGuildFilter');
  if (!guildSel) return;

  // Populate guild selector
  if (guildSel.options.length <= 1) {
    guildSel.innerHTML = '<option value="">Select a server…</option>' +
      state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    guildSel.addEventListener('change', loadLogConfig);
    
    if (state.user.guilds.length === 1) {
      guildSel.value = state.user.guilds[0].id;
    }
  }

  const guildId = guildSel.value;
  if (!guildId) {
    $('#logConfigGroups').innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><h3>Select a server</h3><p>Select a server above to configure which events are sent to its log channel.</p></div>';
    $('#logConfigCount').textContent = '0/0 enabled';
    return;
  }

  try {
    const res = await authFetch(`/api/logs/config/${guildId}`);
    const data = await res.json();

    const eventConfig = data.eventConfig || {};
    const groups = data.groups || [];
    const summary = data.summary || [];

    // Update summary badge
    const totalEnabled = summary.reduce((acc, g) => acc + g.enabled, 0);
    const totalAll = summary.reduce((acc, g) => acc + g.total, 0);
    $('#logConfigCount').textContent = `${totalEnabled}/${totalAll} enabled`;

    const container = $('#logConfigGroups');

    container.innerHTML = groups.map(group => {
      const groupSummary = summary.find(s => s.key === group.key) || { total: group.events.length, enabled: group.events.filter(e => eventConfig[e] !== false).length };
      const allEnabled = groupSummary.enabled === groupSummary.total;
      const noneEnabled = groupSummary.enabled === 0;
      const groupStatus = allEnabled ? '✅' : noneEnabled ? '❌' : '⚠️';

      return `<div class="log-config-group">
        <div class="log-config-group-header">
          <span class="log-config-group-name">${groupStatus} ${escapeHtml(group.name)}</span>
          <span class="log-config-group-summary">${groupSummary.enabled}/${groupSummary.total} enabled</span>
          <button class="log-config-group-toggle btn btn-outline" data-group-key="${escapeHtml(group.key)}" data-group-events='${escapeHtml(JSON.stringify(group.events))}' data-group-enabled="${allEnabled ? 'false' : 'true'}">
            ${allEnabled ? '❌ Disable all' : '✅ Enable all'}
          </button>
        </div>
        <div class="log-config-event-list">
          ${group.events.map(evt => {
            const enabled = eventConfig[evt] !== false;
            return `<label class="log-config-event-toggle">
              <input type="checkbox" class="log-config-event-checkbox" data-event="${escapeHtml(evt)}" ${enabled ? 'checked' : ''}>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="log-config-event-name">${escapeHtml(evt)}</span>
            </label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    // Attach event listeners for individual toggles
    container.querySelectorAll('.log-config-event-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const eventName = cb.dataset.event;
        const enabled = cb.checked;
        cb.disabled = true;
        await toggleLogEvent(guildId, eventName, enabled);
        cb.disabled = false;
        // Refresh to get updated state
        loadLogConfig();
      });
    });

    // Attach event listeners for group toggles
    container.querySelectorAll('.log-config-group-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupEvents = JSON.parse(btn.dataset.groupEvents);
        const groupEnabled = btn.dataset.groupEnabled === 'true';
        btn.disabled = true;
        await toggleLogEventGroup(guildId, groupEvents, groupEnabled);
        btn.disabled = false;
        loadLogConfig();
      });
    });
  } catch (err) {
    console.error('Failed to load log config:', err);
    $('#logConfigGroups').innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><h3>Failed to load configuration</h3><p>Make sure the bot is online.</p></div>';
  }
}

async function toggleLogEvent(guildId, eventName, enabled) {
  const statusEl = $('#logConfigStatus');
  try {
    const res = await authFetch(`/api/logs/config/${guildId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName, enabled }),
    });
    const result = await res.json();
    if (result.ok) {
      statusEl.textContent = `✅ ${eventName} ${enabled ? 'enabled' : 'disabled'}`;
      statusEl.className = 'config-status success';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'config-status error';
  }
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'config-status'; }, 2000);
}

async function toggleLogEventGroup(guildId, groupEvents, enabled) {
  const statusEl = $('#logConfigStatus');
  try {
    const res = await authFetch(`/api/logs/config/${guildId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_group', groupEvents, groupEnabled: enabled }),
    });
    const result = await res.json();
    if (result.ok) {
      statusEl.textContent = `✅ Group ${enabled ? 'enabled' : 'disabled'}`;
      statusEl.className = 'config-status success';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'config-status error';
  }
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'config-status'; }, 2000);
}

// Enable/Disable All buttons
$('#logConfigEnableAll')?.addEventListener('click', async () => {
  const guildSel = $('#logConfigGuildFilter');
  const guildId = guildSel?.value;
  if (!guildId) return;
  const statusEl = $('#logConfigStatus');
  try {
    const res = await authFetch(`/api/logs/config/${guildId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable_all' }),
    });
    const result = await res.json();
    if (result.ok) {
      statusEl.textContent = '✅ All events enabled!';
      statusEl.className = 'config-status success';
      loadLogConfig();
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'config-status error';
  }
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'config-status'; }, 3000);
});

$('#logConfigDisableAll')?.addEventListener('click', async () => {
  const guildSel = $('#logConfigGuildFilter');
  const guildId = guildSel?.value;
  if (!guildId) return;
  const statusEl = $('#logConfigStatus');
  try {
    const res = await authFetch(`/api/logs/config/${guildId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable_all' }),
    });
    const result = await res.json();
    if (result.ok) {
      statusEl.textContent = '❌ All events disabled!';
      statusEl.className = 'config-status success';
      loadLogConfig();
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'config-status error';
  }
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'config-status'; }, 3000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Ticket Dashboard
// ═══════════════════════════════════════════════════════════════════════════

async function loadTicketDashboard() {
  if (!state.user?.guilds) return;

  const guildSel = $('#ticketGuildFilter');
  if (!guildSel) return;

  // Populate guild selector (only once)
  if (guildSel.options.length <= 1) {
    guildSel.innerHTML = '<option value="">Select a server…</option>' +
      state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    
  }

  // Auto-select if only one guild
  if (state.user.guilds.length === 1 && !guildSel.value) {
    guildSel.value = state.user.guilds[0].id;
  }

  const guildId = guildSel.value;
  if (!guildId) {
    $('#ticketList').innerHTML = '<div class="empty-state"><div class="empty-icon">🎫</div><h3>No server selected</h3><p>Select a server to view its tickets.</p></div>';
    return;
  }

  const statusFilter = $('#ticketStatusFilter')?.value || 'all';
  const searchQuery = ($('#ticketSearch')?.value || '').toLowerCase();

  try {
    const res = await authFetch(`/api/tickets/${guildId}`);
    const data = await res.json();
    
    // Update stats
    $('#ticketStatTotal').textContent = data.stats.total;
    $('#ticketStatOpen').textContent = data.stats.open;
    $('#ticketStatClosed').textContent = data.stats.closed;
    $('#ticketStatClaimed').textContent = data.stats.claimed;
    $('#ticketStatPinned').textContent = data.stats.pinned;
    $('#ticketCount').textContent = `${data.stats.total} tickets`;

    let tickets = data.tickets || [];

    // Apply filters
    if (statusFilter === 'open') tickets = tickets.filter(t => t.open);
    else if (statusFilter === 'closed') tickets = tickets.filter(t => !t.open);
    else if (statusFilter === 'claimed') tickets = tickets.filter(t => t.claimed);
    else if (statusFilter === 'pinned') tickets = tickets.filter(t => t.pinned);

    if (searchQuery) {
      tickets = tickets.filter(t =>
        t.creatorId?.toLowerCase().includes(searchQuery) ||
        t.channelId?.toLowerCase().includes(searchQuery) ||
        t.optionId?.toLowerCase().includes(searchQuery)
      );
    }

    // Sort by most recent first
    tickets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const container = $('#ticketList');
    if (tickets.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎫</div><h3>No tickets found</h3><p>Try adjusting your filters.</p></div>';
      return;
    }

    container.innerHTML = tickets.map(t => `
      <div class="ticket-card ${t.open ? 'ticket-open' : 'ticket-closed'} ${t.claimed ? 'ticket-claimed' : ''}">
        <div class="ticket-card-header">
          <span class="ticket-status-indicator ${t.open ? 'status-open' : 'status-closed'}"></span>
          <span class="ticket-type">${escapeHtml(t.optionId || 'ticket')}</span>
          <span class="ticket-creator">👤 <code>${escapeHtml(t.creatorId ? t.creatorId.slice(0, 8) + '...' : '?')}</code></span>
        </div>
        <div class="ticket-card-body">
          <div class="ticket-channel">📢 Channel: <code>${escapeHtml(t.channelId || '?')}</code></div>
          ${t.claimed ? `<div class="ticket-claimed-by">🙋 Claimed by: <code>${escapeHtml(t.claimedBy ? t.claimedBy.slice(0, 8) + '...' : '?')}</code></div>` : ''}
          ${t.pinned ? '<div class="ticket-pinned-tag">📌 Pinned</div>' : ''}
          ${t.priority ? `<div class="ticket-priority-tag">${t.priority}</div>` : ''}
        </div>
        <div class="ticket-card-footer">
          <span class="ticket-time">🕐 ${formatFullDate(t.createdAt)}</span>
          ${t.closedAt ? `<span class="ticket-time">🔒 ${formatFullDate(t.closedAt)}</span>` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

// Filter change listeners for tickets
$('#ticketGuildFilter')?.addEventListener('change', loadTicketDashboard);
$('#ticketStatusFilter')?.addEventListener('change', loadTicketDashboard);
$('#ticketSearch')?.addEventListener('input', debounce(loadTicketDashboard, 300));
$('#ticketRefreshBtn')?.addEventListener('click', loadTicketDashboard);

// ═══════════════════════════════════════════════════════════════════════════
// Ticket Configuration
// ═══════════════════════════════════════════════════════════════════════════

async function loadTicketConfig() {
  const guildSel = $('#ticketConfigGuildFilter');
  if (!guildSel) return;

  // Populate guild selector (self-sufficient — doesn't rely on Tickets tab)
  if (state.user?.guilds && guildSel.options.length <= 1) {
    guildSel.innerHTML = '<option value="">Select a server…</option>' +
      state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    
    // Attach change handler
    guildSel.addEventListener('change', loadTicketConfig);

    // Auto-select if only one guild
    if (state.user.guilds.length === 1) {
      guildSel.value = state.user.guilds[0].id;
    }
  }

  const guildId = guildSel.value;
  if (!guildId) {
    // Show message asking user to select a server
    const editors = ['generalConfigEditor', 'panelsConfigEditor', 'optionsConfigEditor', 'questionsConfigEditor'];
    for (const id of editors) {
      const el = $(`#${id}`);
      if (el && !el.value) el.value = '// Select a server above to load configuration';
    }
    // Clear statuses
    $$('.config-status').forEach(el => el.textContent = '');
    // Show empty states for priorities and transcripts
    const prio = $('#prioritiesDisplay');
    if (prio && !prio.querySelector('.priority-card')) prio.innerHTML = '<p class="text-muted">Select a server first.</p>';
    const trans = $('#transcriptsList');
    if (trans && !trans.querySelector('.transcript-item')) trans.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><h3>Select a server</h3><p>Select a server to view transcripts.</p></div>';
    return;
  }

  // Load the active sub-tab
  const activeSub = $('#tab-ticket-config .subnav-btn.active');
  if (activeSub) {
    const sub = activeSub.dataset.subtab;
    if (sub === 'ticket-general') loadConfigEditor('general', 'generalConfigEditor');
    else if (sub === 'ticket-panels') loadConfigEditor('panels', 'panelsConfigEditor');
    else if (sub === 'ticket-options') loadConfigEditor('options', 'optionsConfigEditor');
    else if (sub === 'ticket-questions') loadConfigEditor('questions', 'questionsConfigEditor');
    else if (sub === 'ticket-priorities') loadPrioritiesDisplay();
    else if (sub === 'ticket-transcripts') loadTranscriptsDisplay();
  }
}

async function loadConfigEditor(configType, editorId) {
  const guildSel = $('#ticketConfigGuildFilter');
  const guildId = guildSel?.value;
  if (!guildId) return;

  const editor = $(`#${editorId}`);
  if (!editor) return;

  try {
    const res = await authFetch(`/api/tickets/config/${guildId}`);
    const data = await res.json();
    let configData = data[configType];
    
    if (configType === 'priorities') {
      configData = data.priorities;
    }

    editor.value = JSON.stringify(configData, null, 2);
  } catch (err) {
    console.error(`Failed to load ${configType} config:`, err);
    editor.value = 'Error loading configuration';
  }
}

// Save config buttons
$('#saveGeneralConfig')?.addEventListener('click', () => saveConfig('general', 'generalConfigEditor', 'generalConfigStatus'));
$('#savePanelsConfig')?.addEventListener('click', () => saveConfig('panels', 'panelsConfigEditor', 'panelsConfigStatus'));
$('#saveOptionsConfig')?.addEventListener('click', () => saveConfig('options', 'optionsConfigEditor', 'optionsConfigStatus'));
$('#saveQuestionsConfig')?.addEventListener('click', () => saveConfig('questions', 'questionsConfigEditor', 'questionsConfigStatus'));

async function saveConfig(configType, editorId, statusId) {
  const guildSel = $('#ticketConfigGuildFilter');
  const guildId = guildSel?.value;
  if (!guildId) return;

  const editor = $(`#${editorId}`);
  const statusEl = $(`#${statusId}`);
  if (!editor || !statusEl) return;

  let data;
  try {
    data = JSON.parse(editor.value);
  } catch (err) {
    statusEl.textContent = '❌ Invalid JSON: ' + err.message;
    statusEl.className = 'config-status error';
    return;
  }

  statusEl.textContent = 'Saving…';
  statusEl.className = 'config-status';

  try {
    const res = await authFetch(`/api/tickets/config/${guildId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configType, data }),
    });
    
    if (res.ok) {
      statusEl.textContent = '✅ Configuration saved!';
      statusEl.className = 'config-status success';
    } else {
      statusEl.textContent = '❌ Failed to save configuration';
      statusEl.className = 'config-status error';
    }
  } catch (err) {
    statusEl.textContent = '❌ Error: ' + err.message;
    statusEl.className = 'config-status error';
  }

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'config-status';
  }, 3000);
}

// ─── Priorities Display ───────────────────────────────────────────────────
async function loadPrioritiesDisplay() {
  const container = $('#prioritiesDisplay');
  if (!container) return;

  const guildSel = $('#ticketConfigGuildFilter');
  const guildId = guildSel?.value;
  if (!guildId) {
    container.innerHTML = '<p class="text-muted">Select a server first.</p>';
    return;
  }

  try {
    const res = await authFetch(`/api/tickets/config/${guildId}`);
    const data = await res.json();
    const priorities = data.priorities || [];

    container.innerHTML = priorities.map(p => `
      <div class="priority-card" style="border-left: 4px solid ${escapeHtml(p.color)}">
        <div class="priority-emoji">${p.emoji || '🏷️'}</div>
        <div class="priority-info">
          <div class="priority-name">${escapeHtml(p.name)}</div>
          <div class="priority-id"><code>${escapeHtml(p.id)}</code></div>
        </div>
        <div class="priority-color">${escapeHtml(p.color)}</div>
        <div class="priority-order">Level ${p.order}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p class="text-muted">Failed to load priorities.</p>';
  }
}

// ─── Transcripts Display ──────────────────────────────────────────────────
async function loadTranscriptsDisplay() {
  const container = $('#transcriptsList');
  if (!container) return;

  const guildSel = $('#ticketConfigGuildFilter');
  const guildId = guildSel?.value;
  if (!guildId) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><h3>Select a server</h3><p>Select a server to view transcripts.</p></div>';
    return;
  }

  try {
    const res = await authFetch(`/api/tickets/transcripts/${guildId}`);
    const data = await res.json();
    const transcripts = data.transcripts || [];

    if (transcripts.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><h3>No transcripts yet</h3><p>Transcripts are generated when tickets are deleted.</p></div>';
      return;
    }

    // Filter by guild
    const guildTranscripts = transcripts.filter(t => t.guildId === guildId || !t.guildId);

    container.innerHTML = `<div class="transcript-count">${guildTranscripts.length} transcript(s)</div>` +
      guildTranscripts.slice(0, 50).map(t => `
        <div class="transcript-item">
          <div class="transcript-header">
            <span class="transcript-id">📄 #${escapeHtml(t.id?.slice(-8) || '?')}</span>
            <span class="transcript-messages">${t.messageCount || 0} messages</span>
          </div>
          <div class="transcript-meta">
            <span>Channel: <code>${escapeHtml(t.channelId?.slice(0, 8) || '?')}...</code></span>
            <span>Type: ${escapeHtml(t.optionId || '?')}</span>
            <span>${formatFullDate(t.generatedAt)}</span>
          </div>
        </div>
      `).join('');
  } catch (err) {
    container.innerHTML = '<p class="text-muted">Failed to load transcripts.</p>';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Spawn Panel (send a panel to a Discord channel from the dashboard)
// ═══════════════════════════════════════════════════════════════════════════

async function loadSpawnPanel() {
  const guildSel = $('#ticketConfigGuildFilter');
  const panelSel = $('#spawnPanelSelect');
  const channelSel = $('#spawnChannelSelect');
  const spawnBtn = $('#spawnPanelBtn');
  const statusEl = $('#spawnPanelStatus');

  if (!guildSel || !panelSel) return;

  // Ensure guild selector is populated
  if (state.user?.guilds && guildSel.options.length <= 1) {
    loadTicketConfig();
  }

  const guildId = guildSel.value;
  if (!guildId) {
    panelSel.innerHTML = '<option value="">Select a server first…</option>';
    panelSel.disabled = true;
    channelSel.innerHTML = '<option value="">Select a server first…</option>';
    channelSel.disabled = true;
    spawnBtn.disabled = true;
    return;
  }

  panelSel.disabled = false;

  // Load panels into dropdown
  try {
    const res = await authFetch(`/api/tickets/config/${guildId}`);
    const data = await res.json();
    const panels = data.panels || [];

    panelSel.innerHTML = '<option value="">Select a panel…</option>' +
      panels.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)} (${escapeHtml(p.id)})</option>`).join('');

    if (panels.length === 0) {
      panelSel.innerHTML = '<option value="">No panels configured</option>';
      panelSel.disabled = true;
    }
  } catch (err) {
    panelSel.innerHTML = '<option value="">Failed to load panels</option>';
    panelSel.disabled = true;
  }

  // Load channels into dropdown
  try {
    const res = await authFetch(`/api/channels/${guildId}`);
    const data = await res.json();
    const channels = data.channels || [];

    channelSel.innerHTML = '<option value="">Select a channel…</option>' +
      channels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
    channelSel.disabled = false;
  } catch (err) {
    channelSel.innerHTML = '<option value="">Failed to load channels</option>';
    channelSel.disabled = true;
  }

  // Enable button only when both are selected
  function updateBtn() {
    spawnBtn.disabled = !panelSel.value || !channelSel.value;
  }
  panelSel.onchange = updateBtn;
  channelSel.onchange = updateBtn;
  updateBtn();
}

// Send panel button handler
$('#spawnPanelBtn')?.addEventListener('click', async () => {
  const guildSel = $('#ticketConfigGuildFilter');
  const panelSel = $('#spawnPanelSelect');
  const channelSel = $('#spawnChannelSelect');
  const statusEl = $('#spawnPanelStatus');

  const guildId = guildSel?.value;
  const panelId = panelSel?.value;
  const channelId = channelSel?.value;

  if (!guildId || !panelId || !channelId) return;

  statusEl.textContent = 'Sending panel…';
  statusEl.className = 'settings-status';

  try {
    const res = await authFetch('/api/tickets/panels/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, panelId, channelId }),
    });

    const result = await res.json();

    if (result.ok) {
      const channelName = channelSel.options[channelSel.selectedIndex]?.text || channelId;
      statusEl.textContent = `✅ Panel sent to ${channelName}!`;
      statusEl.className = 'settings-status success';
    } else {
      statusEl.textContent = `❌ ${result.error || 'Failed to send panel'}`;
      statusEl.className = 'settings-status error';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'settings-status error';
  }

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'settings-status';
  }, 5000);
});

// Also reload the spawn panel tab when the guild selector changes
// (the existing change handler on ticketConfigGuildFilter calls loadTicketConfig,
//  which checks active sub-tab — but we need to hook into spawn explicitly)
$('#ticketConfigGuildFilter')?.addEventListener('change', () => {
  if (state.activeTab === 'ticket-config') {
    const activeSub = $('#tab-ticket-config .subnav-btn.active');
    if (activeSub && activeSub.dataset.subtab === 'ticket-spawn') {
      loadSpawnPanel();
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Custom Bots
// ═══════════════════════════════════════════════════════════════════════════

async function loadBots() {
  if (!state.user?.guilds) return;

  const guildSel = $('#botsGuildSelect');
  if (!guildSel) return;

  // Populate guild selector
  guildSel.innerHTML = '<option value="">Select a server…</option>' +
    state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

  // Load existing bots
  try {
    const res = await authFetch('/api/bots');
    const data = await res.json();
    const bots = data.bots || [];

    const container = $('#botsList');
    const empty = $('#botsEmpty');

    if (bots.length === 0) {
      container.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    container.innerHTML = bots.map(b => {
      const isRunning = b.running !== null;
      const statusClass = isRunning ? 'bot-running' : 'bot-stopped';
      const statusText = isRunning ? `🟢 Running as ${escapeHtml(b.running.tag)}` : '🔴 Stopped';
      const pingText = isRunning ? `・ ${b.running.ping}ms ping` : '';

      return `<div class="bot-card ${statusClass}">
        <div class="bot-card-header">
          <span class="bot-name">🤖 ${escapeHtml(b.name)}</span>
          <span class="bot-status">${statusText} ${pingText}</span>
        </div>
        <div class="bot-card-body">
          <span>Server: <code>${escapeHtml(b.guildId)}</code></span>
          ${b.clientId ? `<span>Bot ID: <code>${escapeHtml(b.clientId)}</code></span>` : ''}
          ${b.createdAt ? `<span>Added: ${formatFullDate(b.createdAt)}</span>` : ''}
        </div>
        <div class="bot-card-actions">
          ${isRunning
            ? `<button class="btn btn-outline" onclick="stopBot('${b.guildId}')">⏹ Stop</button>`
            : `<span style="font-size:12px;color:var(--text-muted)">Use the form above to start this bot (token required)</span>`
          }
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load bots:', err);
    $('#botsList').innerHTML = '<p class="text-muted">Failed to load bot instances.</p>';
  }
}

async function startBot(guildId) {
  const statusEl = $('#botsAddStatus');
  const tokenInput = $('#botsTokenInput');
  const token = tokenInput?.value;

  if (!token && !guildId) return;

  statusEl.textContent = 'Starting bot…';
  statusEl.className = 'settings-status';

  try {
    const res = await authFetch('/api/bots/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, token }),
    });

    const result = await res.json();

    if (result.ok) {
      statusEl.textContent = `✅ Bot started as ${result.tag}!`;
      statusEl.className = 'settings-status success';
      tokenInput.value = ''; // Clear token for security
      loadBots(); // Refresh the list
    } else {
      statusEl.textContent = `❌ ${result.error || 'Failed to start bot'}`;
      statusEl.className = 'settings-status error';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'settings-status error';
  }

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'settings-status';
  }, 8000);
}

async function stopBot(guildId) {
  const statusEl = $('#botsAddStatus');
  if (!guildId) return;

  statusEl.textContent = 'Stopping bot…';
  statusEl.className = 'settings-status';

  try {
    const res = await authFetch('/api/bots/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId }),
    });

    const result = await res.json();

    if (result.ok) {
      statusEl.textContent = '✅ Bot stopped.';
      statusEl.className = 'settings-status success';
      loadBots(); // Refresh the list
    } else {
      statusEl.textContent = `❌ ${result.error || 'Failed to stop bot'}`;
      statusEl.className = 'settings-status error';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'settings-status error';
  }

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'settings-status';
  }, 5000);
}

// Event handlers for the custom bots page
$('#startCustomBotBtn')?.addEventListener('click', async () => {
  const guildSel = $('#botsGuildSelect');
  const tokenInput = $('#botsTokenInput');
  const guildId = guildSel?.value;
  const token = tokenInput?.value;

  if (!guildId) {
    $('#botsAddStatus').textContent = '❌ Please select a server.';
    $('#botsAddStatus').className = 'settings-status error';
    return;
  }
  if (!token || token.length < 10) {
    $('#botsAddStatus').textContent = '❌ Please enter a valid bot token.';
    $('#botsAddStatus').className = 'settings-status error';
    return;
  }

  await startBot(guildId);
});

$('#refreshBotsBtn')?.addEventListener('click', loadBots);

// ═══════════════════════════════════════════════════════════════════════════
// Backups
// ═══════════════════════════════════════════════════════════════════════════

async function loadBackups() {
  if (!state.user?.guilds) return;

  const guildSel = $('#backupGuildFilter');
  if (!guildSel) return;

  // Populate guild selector
  if (guildSel.options.length <= 1) {
    guildSel.innerHTML = '<option value="">Select a server…</option>' +
      state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    guildSel.addEventListener('change', loadBackups);
    
    if (state.user.guilds.length === 1) {
      guildSel.value = state.user.guilds[0].id;
    }
  }

  const guildId = guildSel.value;
  if (!guildId) {
    const container = $('#backupsList');
    const empty = $('#backupsEmpty');
    if (container) container.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    $('#createBackupBtn').disabled = true;
    return;
  }

  $('#createBackupBtn').disabled = false;

  try {
    const res = await authFetch(`/api/backups/${guildId}`);
    const data = await res.json();
    const backups = data.backups || [];

    const container = $('#backupsList');
    const empty = $('#backupsEmpty');

    if (backups.length === 0) {
      container.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    container.innerHTML = backups.map(b => {
      const date = new Date(b.createdAt);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isRestoreUsers = b.restoreUsers === true;
      const authBadge = isRestoreUsers ? `<span class="backup-auth-badge">👥 ${b.authorizedCount || 0} authorized</span>` : '';

      return `<div class="backup-card ${isRestoreUsers ? 'backup-card-auth' : ''}">
        <div class="backup-card-header">
          <span class="backup-label">💾 ${escapeHtml(b.label || 'Unnamed Backup')} ${authBadge}</span>
          <span class="backup-date">${dateStr}</span>
        </div>
        <div class="backup-card-body">
          <span class="backup-id">ID: <code>${escapeHtml(b.id)}</code></span>
          <span class="backup-files">📁 ${b.fileCount} file(s)</span>
          ${isRestoreUsers ? '<span class="backup-restore-users-tag">🔄 Users Enabled</span>' : ''}
        </div>
        <div class="backup-card-footer">
          <div class="backup-actions">
            <button class="btn btn-outline" onclick="showBackupDetail('${b.id}')">📋 Details</button>
            <button class="btn btn-danger" onclick="deleteBackup('${b.id}')">🗑 Delete</button>
          </div>
          <div class="backup-restore">
            <button class="btn btn-primary" onclick="restoreBackupConfirm('${b.id}', '${escapeHtml(b.label || 'Backup ' + dateStr)}')">⏪ Restore</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load backups:', err);
    $('#backupsList').innerHTML = '<p class="text-muted">Failed to load backups.</p>';
  }
}

// Create backup (header button)
$('#createBackupBtn')?.addEventListener('click', async () => {
  const guildSel = $('#backupGuildFilter');
  const guildId = guildSel?.value;
  const labelInput = $('#backupLabelInput');
  const label = labelInput?.value || undefined;

  if (!guildId) {
    $('#backupCreateStatus').textContent = '❌ Select a server first.';
    $('#backupCreateStatus').className = 'settings-status error';
    return;
  }

  await doCreateBackup(guildId, label);
});

// Create backup (form button)
$('#createBackupFormBtn')?.addEventListener('click', async () => {
  const guildSel = $('#backupGuildFilter');
  const guildId = guildSel?.value;
  const labelInput = $('#backupLabelInput');
  const label = labelInput?.value || undefined;

  if (!guildId) {
    $('#backupCreateStatus').textContent = '❌ Select a server first.';
    $('#backupCreateStatus').className = 'settings-status error';
    return;
  }

  await doCreateBackup(guildId, label);
});

async function doCreateBackup(guildId, label) {
  const statusEl = $('#backupCreateStatus');
  const labelInput = $('#backupLabelInput');
  const restoreUsersCheck = $('#backupRestoreUsers');
  const restoreUsers = restoreUsersCheck?.checked === true;

  statusEl.textContent = restoreUsers ? 'Creating backup with user restore enabled — this may take a moment...' : 'Creating backup…';
  statusEl.className = 'settings-status';

  try {
    const res = await authFetch('/api/backups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, label: label || '', restoreUsers }),
    });

    const result = await res.json();

    if (result.ok) {
      statusEl.textContent = `✅ Backup created! (${result.fileCount} files, ID: ${result.backupId})`;
      statusEl.className = 'settings-status success';
      if (labelInput) labelInput.value = '';
      loadBackups();
    } else {
      statusEl.textContent = `❌ ${result.error || 'Failed to create backup'}`;
      statusEl.className = 'settings-status error';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'settings-status error';
  }

  setTimeout(() => {
    if (statusEl.textContent.startsWith('✅')) {
      statusEl.textContent = '';
      statusEl.className = 'settings-status';
    }
  }, 6000);
}

// Show backup detail (modal)
async function showBackupDetail(backupId) {
  try {
    // Fetch backup details from the list
    const guildSel = $('#backupGuildFilter');
    const guildId = guildSel?.value;
    if (!guildId) return;

    const res = await authFetch(`/api/backups/${guildId}`);
    const data = await res.json();
    const backup = (data.backups || []).find(b => b.id === backupId);
    if (!backup) {
      alert('Backup not found.');
      return;
    }

    const date = new Date(backup.createdAt);
    const fileList = (backup.files || []).join('\n');

    alert([
      `📋 Backup: ${backup.label || 'Unnamed'}`,
      `ID: ${backup.id}`,
      `Created: ${date.toLocaleString()}`,
      `Files: ${backup.fileCount}`,
      '',
      'Files included:',
      fileList || '(none)',
    ].join('\n'));
  } catch (err) {
    console.error('Failed to load backup detail:', err);
  }
}

// Restore backup with confirmation
async function restoreBackupConfirm(backupId, label) {
  if (!confirm(`⚠️ RESTORE BACKUP\n\nThis will OVERWRITE all current data with the snapshot from:\n\n"${label}"\n\nThis cannot be undone! Are you sure?`)) return;

  if (!confirm(`⚠️ FINAL CONFIRMATION\n\nAre you absolutely sure you want to restore backup ${backupId}?\n\nAll current config, warnings, and ticket data will be replaced.`)) return;

  const statusEl = $('#backupCreateStatus');
  statusEl.textContent = 'Restoring backup…';
  statusEl.className = 'settings-status';

  try {
    const res = await authFetch('/api/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId }),
    });

    const result = await res.json();

    if (result.ok) {
      statusEl.textContent = `✅ Backup restored! (${result.fileCount} files restored)`;
      statusEl.className = 'settings-status success';
      loadBackups();
    } else {
      statusEl.textContent = `❌ ${result.error || 'Failed to restore backup'}`;
      statusEl.className = 'settings-status error';
    }
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.className = 'settings-status error';
  }

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'settings-status';
  }, 8000);
}

// Delete backup
async function deleteBackup(backupId) {
  if (!confirm('Delete this backup? This cannot be undone.')) return;

  try {
    const res = await authFetch('/api/backups/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId }),
    });

    const result = await res.json();

    if (result.ok) {
      loadBackups();
    } else {
      alert('Failed to delete backup: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

$('#refreshBackupsBtn')?.addEventListener('click', loadBackups);

// ═══════════════════════════════════════════════════════════════════════════
// Modmail Dashboard
// ═══════════════════════════════════════════════════════════════════════════

async function loadModmail() {
  if (!state.user?.guilds) return;

  const guildSel = $('#modmailGuildFilter');
  if (!guildSel) return;

  // Populate guild selector (only once)
  if (guildSel.options.length <= 1) {
    guildSel.innerHTML = '<option value="">Select a server…</option>' +
      state.user.guilds.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    guildSel.addEventListener('change', loadModmail);

    if (state.user.guilds.length === 1) {
      guildSel.value = state.user.guilds[0].id;
    }
  }

  const guildId = guildSel.value;
  if (!guildId) {
    $('#modmailList').innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><h3>No server selected</h3><p>Select a server to view its modmail conversations.</p></div>';
    $('#modmailConfigSection').style.display = 'none';
    return;
  }

  try {
    const res = await authFetch(`/api/modmail/${guildId}`);
    const data = await res.json();
    
    // Update stats
    $('#modmailStatTotal').textContent = data.stats?.total || 0;
    $('#modmailStatOpen').textContent = data.stats?.open || 0;
    $('#modmailStatClosed').textContent = data.stats?.closed || 0;
    $('#modmailStatMessages').textContent = data.stats?.totalMessages || 0;
    $('#modmailStatBlocked').textContent = data.stats?.blockedCount || 0;

    // Update config section
    const config = data.config;
    if (config) {
      $('#modmailConfigSection').style.display = 'block';
      $('#modmailConfigStatus').textContent = config.enabled ? '✅ Enabled' : '❌ Disabled';
      $('#modmailConfigStatus').style.color = config.enabled ? 'var(--success)' : 'var(--danger)';
      $('#modmailConfigCategory').textContent = `Category ID: ${config.categoryId || 'Not set'}`;
      $('#modmailConfigStaffRoles').textContent = (config.staffRoleIds || []).length > 0 
        ? `${config.staffRoleIds.length} role(s) configured` 
        : 'None';
      $('#modmailConfigLogChannel').textContent = config.logChannelId 
        ? `Channel ID: ${config.logChannelId}` 
        : 'Not set';
      $('#modmailConfigCooldown').textContent = config.cooldownMinutes > 0 
        ? `${config.cooldownMinutes} min` 
        : 'Disabled';
      $('#modmailConfigAutoClose').textContent = config.autoCloseHours > 0 
        ? `${config.autoCloseHours} hours` 
        : 'Disabled';
      $('#modmailConfigBlockedCount').textContent = (data.blocked || []).length;
    } else {
      $('#modmailConfigSection').style.display = 'block';
      $('#modmailConfigStatus').textContent = '❌ Not configured';
      $('#modmailConfigStatus').style.color = 'var(--danger)';
    }

    let threads = data.threads || [];

    // Apply filters
    const statusFilter = $('#modmailStatusFilter')?.value || 'all';
    const searchQuery = ($('#modmailSearch')?.value || '').toLowerCase();

    if (statusFilter === 'open') threads = threads.filter(t => t.open);
    else if (statusFilter === 'closed') threads = threads.filter(t => !t.open);

    if (searchQuery) {
      threads = threads.filter(t =>
        (t.userTag || '').toLowerCase().includes(searchQuery) ||
        (t.userId || '').toLowerCase().includes(searchQuery) ||
        (t.channelId || '').toLowerCase().includes(searchQuery)
      );
    }

    // Sort by last activity descending
    threads.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

    const container = $('#modmailList');
    if (threads.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><h3>No modmail threads found</h3><p>Users can DM the bot to start a conversation. Try adjusting your filters.</p></div>';
      return;
    }

    container.innerHTML = threads.map(t => {
      const isOpen = t.open;
      const age = Math.floor((Date.now() - (t.createdAt || Date.now())) / (1000 * 60 * 60));
      const ageStr = age < 1 ? 'Just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
      
      return `
      <div class="modmail-card ${isOpen ? 'modmail-open' : 'modmail-closed'}">
        <div class="modmail-card-header">
          <span class="modmail-status-indicator ${isOpen ? 'status-open' : 'status-closed'}"></span>
          <span class="modmail-user">👤 ${escapeHtml(t.userTag || 'Unknown User')}</span>
          <span class="modmail-age">${ageStr}</span>
        </div>
        <div class="modmail-card-body">
          <div class="modmail-user-id">🆔 <code>${escapeHtml(t.userId || '?')}</code></div>
          <div class="modmail-channel-id">📢 <code>${escapeHtml(t.channelId || '?')}</code></div>
          ${t.closedBy ? `<div class="modmail-closed-by">🔒 Closed by: <code>${escapeHtml(typeof t.closedBy === 'string' ? t.closedBy.slice(0, 12) + '...' : '?')}</code></div>` : ''}
          ${t.anonymousReplies ? '<div class="modmail-anon-tag">👤 Anonymous Mode</div>' : ''}
        </div>
        <div class="modmail-card-footer">
          <span class="modmail-messages">💬 ${t.messageCount || 0} messages</span>
          <span class="modmail-time">🕐 Created: ${formatFullDate(t.createdAt)}</span>
          ${t.closedAt ? `<span class="modmail-time">🔒 Closed: ${formatFullDate(t.closedAt)}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load modmail:', err);
    $('#modmailList').innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><h3>Failed to load modmail data</h3><p>Check that the bot is online and try again.</p></div>';
  }
}

// Filter change listeners for modmail
$('#modmailGuildFilter')?.addEventListener('change', loadModmail);
$('#modmailStatusFilter')?.addEventListener('change', loadModmail);
$('#modmailSearch')?.addEventListener('input', debounce(loadModmail, 300));
$('#modmailRefreshBtn')?.addEventListener('click', loadModmail);

// ═══════════════════════════════════════════════════════════════════════════
// Tutorial / Dashboard Guide
// ═══════════════════════════════════════════════════════════════════════════

function openTutorial(section) {
  const modal = $('#tutorialModal');
  if (!modal) return;

  modal.showModal();

  // If a specific section was requested, activate it
  if (section) {
    $$('.tutorial-tab').forEach(b => b.classList.remove('active'));
    $$('.tutorial-pane').forEach(p => p.classList.remove('active'));

    const tabBtn = $(`.tutorial-tab[data-guide="${section}"]`);
    const pane = $(`#guide-${section}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (pane) pane.classList.add('active');
  }

  // Scroll the content to top
  const content = $('.tutorial-content');
  if (content) content.scrollTop = 0;
}

function closeTutorial() {
  $('#tutorialModal')?.close();
}

// Tutorial sidebar tab switching
$$('.tutorial-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tutorial-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const guide = btn.dataset.guide;
    $$('.tutorial-pane').forEach(p => p.classList.remove('active'));
    $(`#guide-${guide}`)?.classList.add('active');
    // Scroll content to top
    const content = $('.tutorial-content');
    if (content) content.scrollTop = 0;
  });
});

// Close tutorial on backdrop click
$('#tutorialModal')?.addEventListener('click', (e) => {
  if (e.target === $('#tutorialModal')) closeTutorial();
});

// Keyboard shortcut: ? opens the guide (click is handled via onclick= in HTML)
document.addEventListener('keydown', (e) => {
  // Escape closes tutorial
  if (e.key === 'Escape' && $('#tutorialModal')?.open) {
    closeTutorial();
    return;
  }
  // ? key anywhere opens tutorial (not in input fields)
  if (e.key === '?' && !e.ctrlKey && !e.metaKey &&
      !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
    e.preventDefault();
    // Try to auto-select current tab's section
    const tabMap = {
      'live': 'live',
      'explore': 'explore',
      'stats': 'stats',
      'settings': 'settings',
      'tickets': 'tickets',
      'ticket-config': 'ticket-config',
      'bots': 'bots',
      'backups': 'backups',
      'modmail': 'modmail',
    };
    const section = tabMap[state.activeTab] || null;
    openTutorial(section);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Utility Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatFullDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ========== Offline / Online Detection ==========
const offlineBanner = $('#offlineBanner');

function updateOfflineBanner() {
  if (!offlineBanner) return;
  if (!navigator.onLine) {
    offlineBanner.style.display = 'flex';
    offlineBanner.innerHTML = '<span class="offline-icon">📡</span><span class="offline-text">No internet connection — showing cached data</span>';
  } else {
    offlineBanner.style.display = 'none';
  }
}

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

// Also check on page loads after coming back online
updateOfflineBanner();

// ========== Start ==========
init().then(() => {
  connectSSE();
  if (state.activeTab === 'explore') { loadEventFilter(); applyExploreFilters(); }
});
