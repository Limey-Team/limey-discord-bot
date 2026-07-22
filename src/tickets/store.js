const fs = require('fs');
const path = require('path');
const gitSync = require('../git-sync');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config', 'tickets');
const DATABASE_DIR = path.join(__dirname, '..', '..', 'database', 'tickets');

// ─── Cache ───────────────────────────────────────────────────────────────
let cache = {
  configs: {},
  tickets: [],
  transcripts: [],
  stats: {},
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
  } catch {
    return false;
  }
}

function configPath(name) {
  return path.join(CONFIG_DIR, `${name}.json`);
}

function dbPath(name) {
  return path.join(DATABASE_DIR, `${name}.json`);
}

// ─── Config loading ──────────────────────────────────────────────────────
function loadConfig(name) {
  const data = readJSON(configPath(name));
  if (data === null) return null;
  cache.configs[name] = JSON.parse(JSON.stringify(data));
  return cache.configs[name];
}

function getConfig(name) {
  if (cache.configs[name] !== undefined) return cache.configs[name];
  return loadConfig(name);
}

function saveConfig(name) {
  if (cache.configs[name] === undefined) return false;
  const result = writeJSON(configPath(name), cache.configs[name]);
  if (result) gitSync.scheduleSync();
  return result;
}

function setConfig(name, data) {
  cache.configs[name] = JSON.parse(JSON.stringify(data));
  return saveConfig(name);
}

// ─── Tickets ─────────────────────────────────────────────────────────────
function loadTickets() {
  const data = readJSON(dbPath('tickets'));
  if (data === null) return [];
  cache.tickets = data;
  return cache.tickets;
}

function getTickets() {
  if (cache.tickets.length === 0) loadTickets();
  return cache.tickets;
}

function getTicket(channelId) {
  return getTickets().find(t => t.channelId === channelId) || null;
}

function getTicketsByUser(userId) {
  return getTickets().filter(t => t.creatorId === userId);
}

function getTicketsByOption(optionId) {
  return getTickets().filter(t => t.optionId === optionId);
}

function getOpenTickets() {
  return getTickets().filter(t => t.open);
}

function getClosedTickets() {
  return getTickets().filter(t => !t.open);
}

function addTicket(ticket) {
  const tickets = getTickets();
  // Check if ticket already exists
  const idx = tickets.findIndex(t => t.channelId === ticket.channelId);
  if (idx >= 0) {
    tickets[idx] = ticket;
  } else {
    tickets.push(ticket);
  }
  saveTickets();
}

function saveTickets() {
  const result = writeJSON(dbPath('tickets'), cache.tickets);
  if (result) gitSync.scheduleSync();
  return result;
}

function removeTicket(channelId) {
  const tickets = getTickets();
  const idx = tickets.findIndex(t => t.channelId === channelId);
  if (idx >= 0) {
    tickets.splice(idx, 1);
    saveTickets();
    return true;
  }
  return false;
}

function updateTicket(channelId, updates) {
  const tickets = getTickets();
  const ticket = tickets.find(t => t.channelId === channelId);
  if (!ticket) return false;
  Object.assign(ticket, updates);
  saveTickets();
  return true;
}

// ─── Transcripts ─────────────────────────────────────────────────────────
function loadTranscripts() {
  const data = readJSON(dbPath('transcripts'));
  if (data === null) return [];
  cache.transcripts = data;
  return cache.transcripts;
}

function getTranscripts() {
  if (cache.transcripts.length === 0) loadTranscripts();
  return cache.transcripts;
}

function addTranscript(transcript) {
  const transcripts = getTranscripts();
  transcripts.push(transcript);
  const result = writeJSON(dbPath('transcripts'), transcripts);
  if (result) gitSync.scheduleSync();
  return result;
}

function getTranscriptsByTicket(channelId) {
  return getTranscripts().filter(t => t.channelId === channelId);
}

// ─── Stats ───────────────────────────────────────────────────────────────
function loadStats() {
  const data = readJSON(dbPath('stats'));
  if (data === null) return {};
  cache.stats = data;
  return cache.stats;
}

function getStats() {
  if (Object.keys(cache.stats).length === 0) loadStats();
  return cache.stats;
}

function incrementStat(key, by = 1) {
  const stats = getStats();
  stats[key] = (stats[key] || 0) + by;
  const result = writeJSON(dbPath('stats'), stats);
  if (result) gitSync.scheduleSync();
  return result;
}

function setStat(key, value) {
  const stats = getStats();
  stats[key] = value;
  const result = writeJSON(dbPath('stats'), stats);
  if (result) gitSync.scheduleSync();
  return result;
}

// ─── Priority levels ─────────────────────────────────────────────────────
const DEFAULT_PRIORITIES = [
  { id: 'low', name: 'Low', color: '#57F287', emoji: '🟢', order: 0 },
  { id: 'medium', name: 'Medium', color: '#FEE75C', emoji: '🟡', order: 1 },
  { id: 'high', name: 'High', color: '#ED4245', emoji: '🔴', order: 2 },
  { id: 'urgent', name: 'Urgent', color: '#FF0000', emoji: '🚨', order: 3 },
];

function getPriorities() {
  return DEFAULT_PRIORITIES;
}

function getPriority(id) {
  return DEFAULT_PRIORITIES.find(p => p.id === id) || null;
}

// ─── Init ────────────────────────────────────────────────────────────────
function init() {
  // Ensure directories exist
  for (const dir of [CONFIG_DIR, DATABASE_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Load all data
  loadConfig('general');
  loadConfig('panels');
  loadConfig('options');
  loadConfig('questions');
  loadConfig('transcripts');
  loadTickets();
  loadTranscripts();
  loadStats();

  console.log('[Tickets] Store initialized');
}

module.exports = {
  init,
  // Config
  getConfig, setConfig, saveConfig, loadConfig,
  // Tickets
  getTickets, getTicket, getTicketsByUser, getTicketsByOption,
  getOpenTickets, getClosedTickets,
  addTicket, removeTicket, updateTicket, saveTickets,
  // Transcripts
  getTranscripts, addTranscript, getTranscriptsByTicket,
  // Stats
  getStats, incrementStat, setStat,
  // Priorities
  getPriorities, getPriority,
};
