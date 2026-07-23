/**
 * Shard Coordinator — manages distributed shard registration and state.
 *
 * Runs on the main server alongside the web dashboard and shard 0.
 * Worker shard servers register here to get assigned a shard ID
 * from a fixed pool, and periodically send heartbeats with their stats.
 *
 * IMPORTANT: Total shard count is fixed at startup and cannot change
 * dynamically because Discord.js uses (guildId >> 22) % shardCount to
 * determine which shard owns a guild.
 */

let _totalShards = 1;
const shards = new Map(); // shardId → ShardInfo
const availableIds = [];  // Pool of unclaimed shard IDs (1 to totalShards-1)
let _localClient = null;

/**
 * @typedef {object} ShardInfo
 * @property {number} id
 * @property {string} url       — The worker's public URL
 * @property {string} status    — 'running' | 'stopped' | 'starting' | 'stale' | 'error'
 * @property {number} lastHeartbeat — epoch ms
 * @property {number} guildCount
 * @property {number} userCount
 * @property {number} ping
 * @property {string} [botTag]
 * @property {string[]} [guildIds] — Guild IDs this shard manages (from heartbeat)
 * @property {string} [error]
 */

/**
 * Initialize the coordinator with a fixed total shard count.
 * Builds the pool of available shard IDs (1 through totalShards - 1).
 * @param {number} totalShards
 */
function init(totalShards) {
  _totalShards = Math.max(2, totalShards);
  availableIds.length = 0;
  for (let i = 1; i < _totalShards; i++) {
    availableIds.push(i);
  }
  console.log(`[ShardCoordinator] Initialized with ${_totalShards} shards (${_totalShards - 1} worker slots)`);
}

/**
 * Set the local (shard 0) Discord client reference.
 * @param {import('discord.js').Client} client
 */
function setLocalClient(client) {
  _localClient = client;
}

/**
 * Get local shard 0 info.
 * @returns {ShardInfo|null}
 */
function getLocalShardInfo() {
  if (!_localClient) return null;
  const guilds = _localClient.guilds?.cache;
  return {
    id: 0,
    url: 'local',
    status: _localClient.isReady() ? 'running' : 'starting',
    lastHeartbeat: Date.now(),
    guildCount: guilds ? guilds.size : 0,
    userCount: guilds
      ? [...guilds.values()].reduce((acc, g) => acc + (g.memberCount || 0), 0)
      : 0,
    ping: _localClient.ws?.ping || 0,
    botTag: _localClient.user?.tag || null,
    guildIds: guilds ? [...guilds.keys()] : [],
  };
}

/**
 * Register a new worker shard.
 * @param {string} shardUrl     — The worker's public URL
 * @param {string} authKey      — The shared MASTER_API_KEY for verification
 * @returns {{ ok: boolean, shardId?: number, totalShards?: number, error?: string }}
 */
function registerShard(shardUrl, authKey) {
  const masterKey = process.env.MASTER_API_KEY;
  if (masterKey && authKey !== masterKey) {
    return { ok: false, error: 'Invalid or missing MASTER_API_KEY' };
  }

  if (!shardUrl || typeof shardUrl !== 'string') {
    return { ok: false, error: 'shardUrl is required' };
  }

  const normalizedUrl = shardUrl.replace(/\/+$/, '');

  // Check if this URL already has a registered shard — deduplicate
  for (const [, shard] of shards) {
    if (shard.url === normalizedUrl) {
      console.log(`[ShardCoordinator] Re-registered shard ${shard.id} at ${shardUrl} (same URL, reused ID)`);
      shard.status = 'starting';
      shard.lastHeartbeat = Date.now();
      return {
        ok: true,
        shardId: shard.id,
        totalShards: _totalShards,
        reused: true,
      };
    }
  }

  // Find a free shard ID
  if (availableIds.length === 0) {
    return { ok: false, error: `No available shard IDs (all ${_totalShards - 1} worker slots are taken)` };
  }

  const id = availableIds.shift();
  const info = {
    id,
    url: normalizedUrl,
    status: 'starting',
    lastHeartbeat: Date.now(),
    guildCount: 0,
    userCount: 0,
    ping: 0,
    botTag: null,
    guildIds: [],
  };

  shards.set(id, info);
  console.log(`[ShardCoordinator] Registered shard ${id} at ${shardUrl} (${availableIds.length} slots remaining)`);

  return {
    ok: true,
    shardId: id,
    totalShards: _totalShards,
  };
}

/**
 * Receive a heartbeat/stats update from a worker shard.
 * @param {number} shardId
 * @param {object} stats  — { guildCount, userCount, ping, botTag, guildIds? }
 * @returns {{ ok: boolean, totalShards?: number, error?: string }}
 */
function receiveHeartbeat(shardId, stats) {
  const shard = shards.get(shardId);
  if (!shard) {
    return { ok: false, error: `Shard ${shardId} not registered` };
  }

  shard.status = 'running';
  shard.lastHeartbeat = Date.now();
  shard.guildCount = typeof stats.guildCount === 'number' ? stats.guildCount : 0;
  shard.userCount = typeof stats.userCount === 'number' ? stats.userCount : 0;
  shard.ping = typeof stats.ping === 'number' ? stats.ping : 0;
  if (stats.botTag) shard.botTag = stats.botTag;
  if (Array.isArray(stats.guildIds)) shard.guildIds = stats.guildIds;

  return {
    ok: true,
    totalShards: _totalShards,
  };
}

/**
 * Unregister a shard (on worker shutdown) — returns its ID to the pool.
 * @param {number} shardId
 */
function unregisterShard(shardId) {
  const shard = shards.get(shardId);
  if (shard) {
    shard.status = 'stopped';
    console.log(`[ShardCoordinator] Shard ${shardId} (${shard.url}) disconnected — ID returned to pool`);
    shards.delete(shardId);
    if (!availableIds.includes(shardId) && shardId > 0 && shardId < _totalShards) {
      availableIds.push(shardId);
      availableIds.sort((a, b) => a - b);
    }
  }
}

/**
 * Find which shard has a specific guild by ID.
 * Checks local shard 0 first, then registered workers' reported guild IDs.
 * @param {string} guildId
 * @returns {ShardInfo|null}
 */
function findGuildShard(guildId) {
  // Check local shard 0
  if (_localClient?.guilds?.cache?.has(guildId)) {
    return getLocalShardInfo();
  }

  // Check remote shards from their reported guild IDs
  for (const shard of shards.values()) {
    if (shard.guildIds?.includes(guildId)) {
      return shard;
    }
  }

  return null;
}

/**
 * HTTP-forward an action to the shard that owns the given guild.
 * @param {string} guildId
 * @param {string} endpoint  — e.g. '/api/action/send-panel'
 * @param {object} body      — JSON body to POST
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
async function forwardToGuildShard(guildId, endpoint, body) {
  const shard = findGuildShard(guildId);
  if (!shard) {
    return { ok: false, error: `Guild ${guildId} not found on any shard` };
  }

  // Local shard — can't forward, need the local client
  if (shard.id === 0) {
    return { ok: false, error: 'Guild is on local shard 0 — handle directly' };
  }

  try {
    const res = await fetch(`${shard.url}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: res.ok, data, error: data?.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get all registered shards (including local shard 0).
 * Marks shards without a heartbeat in 60s as 'stale'.
 * @returns {ShardInfo[]}
 */
function getAllShards() {
  const local = getLocalShardInfo();
  const result = local ? [local] : [];
  const now = Date.now();
  for (const shard of shards.values()) {
    const info = { ...shard };
    if (now - info.lastHeartbeat > 60_000) {
      info.status = 'stale';
    }
    result.push(info);
  }
  return result;
}

/**
 * Get the total shard count.
 * @returns {number}
 */
function getTotalShards() {
  return _totalShards;
}

/**
 * Get aggregated stats across all shards.
 * @returns {{ guildCount: number, userCount: number, shardCount: number }}
 */
function getAggregatedStats() {
  const allShards = getAllShards();
  let guildCount = 0;
  let userCount = 0;
  for (const s of allShards) {
    if (s.status === 'running') {
      guildCount += s.guildCount;
      userCount += s.userCount;
    }
  }
  return { guildCount, userCount, shardCount: allShards.length };
}

/**
 * Send a DM to a user via the local shard 0 client.
 * Works for any user (Discord API doesn't care about shard affinity for DMs).
 * @param {string} userId
 * @param {object} messageOptions — e.g. { embeds: [...] }
 * @returns {Promise<boolean>}
 */
async function sendDirectMessage(userId, messageOptions) {
  if (!_localClient) return false;
  try {
    const user = await _localClient.users.fetch(userId);
    await user.send(messageOptions);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an Express router with coordinator API endpoints.
 */
function createCoordinatorRouter() {
  const express = require('express');
  const router = express.Router();

  // POST /api/shard/register — worker shards register to get an ID
  router.post('/register', (req, res) => {
    const { url, authKey } = req.body;
    const result = registerShard(url, authKey);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /api/shard/heartbeat — worker shards report stats
  router.post('/heartbeat', (req, res) => {
    const { shardId, authKey, guildCount, userCount, ping, botTag, guildIds } = req.body;
    const masterKey = process.env.MASTER_API_KEY;
    if (masterKey && authKey !== masterKey) {
      return res.status(401).json({ ok: false, error: 'Invalid MASTER_API_KEY' });
    }
    if (shardId == null) {
      return res.status(400).json({ ok: false, error: 'shardId is required' });
    }
    const result = receiveHeartbeat(shardId, { guildCount, userCount, ping, botTag, guildIds });
    res.status(result.ok ? 200 : 404).json(result);
  });

  // GET /api/shard/list — list all registered shards
  router.get('/list', (_req, res) => {
    res.json({
      shards: getAllShards(),
      totalShards: _totalShards,
      stats: getAggregatedStats(),
    });
  });

  // DELETE /api/shard/:id — unregister a shard
  router.delete('/:id', (req, res) => {
    const masterKey = process.env.MASTER_API_KEY;
    const { authKey } = req.body || {};
    if (masterKey && authKey !== masterKey) {
      return res.status(401).json({ ok: false, error: 'Invalid MASTER_API_KEY' });
    }

    const shardId = parseInt(req.params.id, 10);
    if (isNaN(shardId) || shardId <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid shard ID' });
    }
    unregisterShard(shardId);
    res.json({ ok: true, totalShards: _totalShards });
  });

  return router;
}

module.exports = {
  init,
  setLocalClient,
  getLocalShardInfo,
  registerShard,
  receiveHeartbeat,
  unregisterShard,
  findGuildShard,
  forwardToGuildShard,
  getAllShards,
  getTotalShards,
  getAggregatedStats,
  sendDirectMessage,
  createCoordinatorRouter,
};
