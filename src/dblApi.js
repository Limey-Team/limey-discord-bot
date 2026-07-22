/**
 * Discord Bot List API — integration with discordbotlist.com
 *
 * Provides:
 * - POST /api/v1/bots/:id/stats    — update guild/user count
 * - POST /api/v1/bots/:id/commands  — sync slash commands to your bot's profile
 * - GET  /api/v1/bots/:id/upvotes   — fetch recent votes
 *
 * Requires the `DBL_API_TOKEN` environment variable to be set.
 * Get your token at https://discordbotlist.com/ under your bot's management page.
 */

const DBL_API_BASE = 'https://discordbotlist.com/api/v1';

/**
 * Get the DBL API token from env
 * @returns {string|null}
 */
function getApiToken() {
  return process.env.DBL_API_TOKEN || null;
}

/**
 * Check whether the DBL API is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!getApiToken();
}

/**
 * Internal helper: make an authenticated request to the DBL API
 * @param {'GET'|'POST'} method
 * @param {string} path  — e.g. `/bots/123456/stats`
 * @param {object} [body] — JSON body for POST requests
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function _apiCall(method, path, body) {
  const token = getApiToken();
  if (!token) {
    return { ok: false, error: 'DBL_API_TOKEN not configured' };
  }

  const url = `${DBL_API_BASE}${path}`;
  const headers = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorText = `HTTP ${response.status}`;
      try {
        const errBody = await response.text();
        if (errBody) errorText += ` — ${errBody.substring(0, 200)}`;
      } catch {}
      return { ok: false, error: errorText };
    }

    // For 204 No Content or empty responses
    const text = await response.text().catch(() => '');
    const data = text ? JSON.parse(text) : null;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Post bot stats (guild count, user count, shard info) to Discord Bot List.
 * Call this periodically (every hour) and/or on startup.
 *
 * @param {string} botId — The bot's Discord application ID
 * @param {object} stats
 * @param {number} stats.guilds — Number of guilds the bot is in
 * @param {number} [stats.users] — Total number of users across all guilds (optional)
 * @param {number} [stats.shard_id] — Current shard ID (omit for unsharded)
 * @param {number} [stats.shard_count] — Total number of shards
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function postStats(botId, stats) {
  if (!botId) {
    return { ok: false, error: 'botId is required' };
  }

  const body = {
    guilds: stats.guilds,
    users: stats.users || 0,
  };

  // Only include shard fields if shard_count is provided
  if (stats.shard_count != null) {
    body.shard_id = stats.shard_id != null ? stats.shard_id : 0;
    body.shard_count = stats.shard_count;
  }

  const result = await _apiCall('POST', `/bots/${botId}/stats`, body);

  if (result.ok) {
    console.log(`[DBL API] Stats posted: ${stats.guilds} guilds, ${stats.users || '?'} users`);
  } else {
    console.warn(`[DBL API] Failed to post stats: ${result.error}`);
  }

  return result;
}

/**
 * Sync slash commands to the bot's profile on Discord Bot List.
 * This only updates the command list shown on the website — it does NOT
 * register commands with Discord itself (that's handled separately).
 *
 * @param {string} botId — The bot's Discord application ID
 * @param {Array<object>} commands — Array of Discord slash command JSON objects
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function syncCommands(botId, commands) {
  if (!botId) {
    return { ok: false, error: 'botId is required' };
  }

  if (!Array.isArray(commands) || commands.length === 0) {
    return { ok: false, error: 'commands must be a non-empty array' };
  }

  const result = await _apiCall('POST', `/bots/${botId}/commands`, commands);

  if (result.ok) {
    console.log(`[DBL API] Synced ${commands.length} slash commands to bot profile`);
  } else {
    console.warn(`[DBL API] Failed to sync commands: ${result.error}`);
  }

  return result;
}

/**
 * Fetch the most recent upvotes for the bot from Discord Bot List.
 * Returns up to 500 recent votes and the total vote count for the past 12 hours.
 *
 * @param {string} botId — The bot's Discord application ID
 * @returns {Promise<{ok: boolean, data?: {votes: Array, total: number}, error?: string}>}
 */
async function fetchVotes(botId) {
  if (!botId) {
    return { ok: false, error: 'botId is required' };
  }

  const result = await _apiCall('GET', `/bots/${botId}/upvotes`);

  if (result.ok) {
    console.log(`[DBL API] Fetched ${result.data?.votes?.length || 0} recent votes`);
  }

  return result;
}

module.exports = {
  getApiToken,
  isConfigured,
  postStats,
  syncCommands,
  fetchVotes,
  DBL_API_BASE,
};
