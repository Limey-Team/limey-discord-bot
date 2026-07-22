const fs = require('fs');
const path = require('path');

const MODMAIL_DIR = path.join(__dirname, '..', '..', 'database', 'modmail');

// ─── Cache ───────────────────────────────────────────────────────────────
let cache = {
  threads: [],
  configs: {},
  blockedUsers: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Modmail Store] Write error:', err.message);
    return false;
  }
}

// ─── Threads ─────────────────────────────────────────────────────────────
function loadThreads() {
  const data = readJSON(path.join(MODMAIL_DIR, 'threads.json'));
  if (data === null) return [];
  cache.threads = data;
  return cache.threads;
}

function getThreads() {
  if (cache.threads.length === 0 && !cache._threadsLoaded) {
    cache._threadsLoaded = true;
    loadThreads();
  }
  return cache.threads;
}

function getThreadByChannel(channelId) {
  return getThreads().find(t => t.channelId === channelId) || null;
}

function getThreadByUser(userId, guildId) {
  return getThreads().find(t => t.userId === userId && t.guildId === guildId && t.open) || null;
}

function getOpenThreads(guildId) {
  return getThreads().filter(t => t.guildId === guildId && t.open);
}

function getClosedThreads(guildId) {
  return getThreads().filter(t => t.guildId === guildId && !t.open);
}

function getThreadsByGuild(guildId) {
  return getThreads().filter(t => t.guildId === guildId);
}

function addThread(thread) {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.channelId === thread.channelId);
  if (idx >= 0) {
    threads[idx] = thread;
  } else {
    threads.push(thread);
  }
  saveThreads();
}

function updateThread(channelId, updates) {
  const threads = getThreads();
  const thread = threads.find(t => t.channelId === channelId);
  if (!thread) return false;
  Object.assign(thread, updates);
  saveThreads();
  return true;
}

function removeThread(channelId) {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.channelId === channelId);
  if (idx >= 0) {
    threads.splice(idx, 1);
    saveThreads();
    return true;
  }
  return false;
}

function saveThreads() {
  return writeJSON(path.join(MODMAIL_DIR, 'threads.json'), cache.threads);
}

// ─── Guild Configs ───────────────────────────────────────────────────────
function loadConfigs() {
  const data = readJSON(path.join(MODMAIL_DIR, 'configs.json'));
  if (data === null) return {};
  cache.configs = data;
  return cache.configs;
}

function getConfig(guildId) {
  if (Object.keys(cache.configs).length === 0 && !cache._configsLoaded) {
    cache._configsLoaded = true;
    loadConfigs();
  }
  return cache.configs[guildId] || null;
}

function getDefaultConfig() {
  return {
    enabled: false,
    categoryId: null,
    staffRoleIds: [],
    logChannelId: null,
    cooldownMinutes: 60,
    autoCloseHours: 24,
    defaultAnonymous: false,
    alertRoleIds: [],
    greeting: {
      enabled: true,
      title: '📬 Modmail',
      description: 'Welcome to Modmail! A staff member will be with you shortly. Please describe your issue in detail.',
      color: '#5865F2',
    },
    closingMessage: {
      enabled: true,
      title: '🔒 Modmail Closed',
      description: 'This modmail conversation has been closed. If you need further assistance, feel free to send a new message.',
      color: '#ED4245',
    },
    autoReply: {
      enabled: false,
      message: 'Thank you for your message. A staff member will respond as soon as possible.',
    },
  };
}

function setConfig(guildId, data) {
  cache.configs[guildId] = data;
  saveConfigs();
}

function saveConfigs() {
  return writeJSON(path.join(MODMAIL_DIR, 'configs.json'), cache.configs);
}

// ─── Blocked Users ───────────────────────────────────────────────────────
function loadBlockedUsers() {
  const data = readJSON(path.join(MODMAIL_DIR, 'blocked.json'));
  if (data === null) return [];
  cache.blockedUsers = data;
  return cache.blockedUsers;
}

function getBlockedUsers(guildId) {
  if (cache.blockedUsers.length === 0 && !cache._blockedLoaded) {
    cache._blockedLoaded = true;
    loadBlockedUsers();
  }
  if (!guildId) return cache.blockedUsers;
  return cache.blockedUsers.filter(b => b.guildId === guildId);
}

function isUserBlocked(userId, guildId) {
  return getBlockedUsers(guildId).some(b => b.userId === userId);
}

function blockUser(userId, guildId, blockedBy, reason) {
  const blocked = getBlockedUsers();
  if (blocked.some(b => b.userId === userId && b.guildId === guildId)) return false;
  blocked.push({ userId, guildId, blockedBy, reason: reason || null, blockedAt: Date.now() });
  saveBlockedUsers();
  return true;
}

function unblockUser(userId, guildId) {
  const blocked = getBlockedUsers();
  const idx = blocked.findIndex(b => b.userId === userId && b.guildId === guildId);
  if (idx < 0) return false;
  blocked.splice(idx, 1);
  saveBlockedUsers();
  return true;
}

function saveBlockedUsers() {
  return writeJSON(path.join(MODMAIL_DIR, 'blocked.json'), cache.blockedUsers);
}

// ─── Stats ───────────────────────────────────────────────────────────────
function getStats(guildId) {
  const threads = getThreadsByGuild(guildId);
  const open = threads.filter(t => t.open);
  const closed = threads.filter(t => !t.open);
  return {
    total: threads.length,
    open: open.length,
    closed: closed.length,
    totalMessages: threads.reduce((sum, t) => sum + (t.messageCount || 0), 0),
    blockedCount: getBlockedUsers(guildId).length,
  };
}

// ─── Init ────────────────────────────────────────────────────────────────
function init() {
  if (!fs.existsSync(MODMAIL_DIR)) {
    fs.mkdirSync(MODMAIL_DIR, { recursive: true });
  }

  // Ensure files exist
  for (const file of ['threads.json', 'configs.json', 'blocked.json']) {
    const filePath = path.join(MODMAIL_DIR, file);
    if (!fs.existsSync(filePath)) {
      writeJSON(filePath, file === 'threads.json' ? [] : file === 'blocked.json' ? [] : {});
    }
  }

  loadThreads();
  cache._threadsLoaded = true;
  loadConfigs();
  cache._configsLoaded = true;
  loadBlockedUsers();
  cache._blockedLoaded = true;

  console.log('[Modmail] Store initialized');
}

module.exports = {
  init,
  // Threads
  getThreads, getThreadByChannel, getThreadByUser,
  getOpenThreads, getClosedThreads, getThreadsByGuild,
  addThread, updateThread, removeThread, saveThreads,
  // Configs
  getConfig, setConfig, getDefaultConfig,
  // Blocked
  getBlockedUsers, isUserBlocked, blockUser, unblockUser,
  // Stats
  getStats,
};
