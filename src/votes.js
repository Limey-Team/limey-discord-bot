const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VOTES_FILE = path.join(__dirname, '..', 'database', 'votes.json');

// ─── Cache ───────────────────────────────────────────────────────────────
let cache = {
  votes: [],
};

// ─── Constants ───────────────────────────────────────────────────────────
const VOTE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours, standard for most bot lists

// ─── File Helpers ────────────────────────────────────────────────────────
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
    console.error('[Votes] Write error:', err.message);
    return false;
  }
}

// ─── Vote Data ───────────────────────────────────────────────────────────
function loadVotes() {
  const data = readJSON(VOTES_FILE);
  if (data === null) return [];
  cache.votes = data;
  return cache.votes;
}

function getVotes() {
  if (cache.votes.length === 0 && !cache._loaded) {
    cache._loaded = true;
    loadVotes();
  }
  return cache.votes;
}

function saveVotes() {
  return writeJSON(VOTES_FILE, cache.votes);
}

// ─── Vote Management ─────────────────────────────────────────────────────

function addVote(userId, source = 'top.gg', isWeekend = false) {
  const votes = getVotes();
  const vote = {
    userId,
    source,
    isWeekend,
    timestamp: Date.now(),
  };
  votes.push(vote);
  saveVotes();
  return vote;
}

function hasVotedRecently(userId) {
  const votes = getVotes();
  const recent = votes.filter(v => v.userId === userId);
  if (recent.length === 0) return false;

  const latest = recent.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
  return (Date.now() - latest.timestamp) < VOTE_COOLDOWN_MS;
}

function getLastVote(userId) {
  const votes = getVotes().filter(v => v.userId === userId);
  if (votes.length === 0) return null;
  return votes.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
}

function getVoteCount() {
  return getVotes().length;
}

function getUniqueVoterCount() {
  const voters = new Set(getVotes().map(v => v.userId));
  return voters.size;
}

function getStats() {
  const votes = getVotes();
  const now = Date.now();
  const last24h = votes.filter(v => (now - v.timestamp) < 24 * 60 * 60 * 1000);
  const last7d = votes.filter(v => (now - v.timestamp) < 7 * 24 * 60 * 60 * 1000);
  const last30d = votes.filter(v => (now - v.timestamp) < 30 * 24 * 60 * 60 * 1000);

  // Count by source
  const bySource = {};
  for (const v of votes) {
    bySource[v.source] = (bySource[v.source] || 0) + 1;
  }

  // Count weekend votes
  const weekendVotes = votes.filter(v => v.isWeekend).length;

  return {
    totalVotes: votes.length,
    uniqueVoters: getUniqueVoterCount(),
    last24h: last24h.length,
    last7d: last7d.length,
    last30d: last30d.length,
    weekendVotes,
    bySource,
    cooldownHours: VOTE_COOLDOWN_MS / (1000 * 60 * 60),
  };
}

function getVoteHistory(limit = 50) {
  const votes = getVotes();
  return votes
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

function getTopVoters(limit = 10) {
  const votes = getVotes();
  const countMap = {};
  for (const v of votes) {
    if (!countMap[v.userId]) countMap[v.userId] = 0;
    countMap[v.userId]++;
  }
  return Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, count]) => ({ userId, count }));
}

function getTimeUntilNextVote(userId) {
  const lastVote = getLastVote(userId);
  if (!lastVote) return 0;
  const elapsed = Date.now() - lastVote.timestamp;
  const remaining = VOTE_COOLDOWN_MS - elapsed;
  return Math.max(0, remaining);
}

// ─── Webhook Verification ────────────────────────────────────────────────

/**
 * Verify a Top.gg webhook request
 * @param {string} rawBody - The raw request body as a string
 * @param {string} signature - The x-topgg-signature header value
 * @param {string} secret - The Top.gg webhook secret from env
 * @returns {boolean}
 */
function verifyTopggWebhook(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  try {
    // Top.gg signature format: "timestamp.signature_hex"
    const parts = signature.split('.');
    if (parts.length !== 2) return false;

    const timestamp = parts[0];
    const sig = parts[1];

    // Compute HMAC-SHA256 of "timestamp.body"
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}.${rawBody}`);
    const computed = hmac.digest('hex');

    // Constant-time comparison
    if (computed.length !== sig.length) return false;

    let match = true;
    for (let i = 0; i < computed.length; i++) {
      if (computed[i] !== sig[i]) match = false;
    }

    return match;
  } catch (err) {
    console.error('[Votes] Top.gg verification error:', err.message);
    return false;
  }
}

/**
 * Verify a DiscordBotList.com webhook request
 * @param {string} authHeader - The Authorization header value
 * @param {string} secret - The DBL webhook secret from env
 * @returns {boolean}
 */
function verifyDblWebhook(authHeader, secret) {
  if (!authHeader || !secret) return false;
  // Simple constant-time string comparison
  if (authHeader.length !== secret.length) return false;

  let match = true;
  for (let i = 0; i < authHeader.length; i++) {
    if (authHeader[i] !== secret[i]) match = false;
  }
  return match;
}

// ─── Init ────────────────────────────────────────────────────────────────
function init() {
  if (!fs.existsSync(VOTES_FILE)) {
    writeJSON(VOTES_FILE, []);
  }
  loadVotes();
  cache._loaded = true;
  console.log('[Votes] Store initialized');
}

module.exports = {
  init,
  addVote,
  hasVotedRecently,
  getLastVote,
  getVoteCount,
  getUniqueVoterCount,
  getStats,
  getVoteHistory,
  getTopVoters,
  getTimeUntilNextVote,
  saveVotes,
  verifyTopggWebhook,
  verifyDblWebhook,
  VOTE_COOLDOWN_MS,
};
