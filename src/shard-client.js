/**
 * ShardClient — provides a client-like API for the web server.
 *
 * Instead of using broadcastEval (which requires a ShardingManager),
 * it aggregates data from:
 *   1. The local shard 0 client (for guilds on shard 0)
 *   2. The coordinator's aggregated stats
 *   3. Direct HTTP queries to remote shard workers
 */
class ShardClient {
  /**
   * @param {import('discord.js').Client} localClient — The shard 0 client
   * @param {object} coordinator — The shard coordinator module
   */
  constructor(localClient, coordinator) {
    this._localClient = localClient;
    this._coordinator = coordinator;
    this._ready = false;
    this._cache = {
      botId: null,
      botTag: null,
      botAvatar: null,
      ping: 0,
      guilds: null, // Map<guildId, { id, name, icon }>
      lastFetch: 0,
    };
    this._refreshPromise = null;
  }

  /** @returns {string} The bot token from env */
  get token() {
    return process.env.DISCORD_TOKEN || '';
  }

  /** @param {boolean} v */
  markReady(v) {
    this._ready = v;
  }

  isReady() {
    return this._ready;
  }

  /**
   * Fetch bot user info + all guilds from all shards.
   * Uses the coordinator's aggregated data.
   * Cached for up to 30 seconds.
   */
  async _refreshCache() {
    if (this._refreshPromise) return this._refreshPromise;

    if (Date.now() - this._cache.lastFetch < 30_000 && this._cache.guilds) {
      return;
    }

    this._refreshPromise = (async () => {
      try {
        // Get aggregated data from the coordinator
        const localInfo = this._coordinator.getLocalShardInfo();
        const allShards = this._coordinator.getAllShards();

        // Build the guild map from the local client (shard 0)
        // Remote shard guilds are fetched on-demand via fetchGuild()
        const guildMap = new Map();
        if (this._localClient?.guilds?.cache) {
          for (const [id, g] of this._localClient.guilds.cache) {
            guildMap.set(id, {
              id: g.id,
              name: g.name,
              icon: g.icon,
              memberCount: g.memberCount,
              ownerId: g.ownerId,
            });
          }
        }

        this._cache.botId = localInfo?.botTag?.split('#')[0] || null;
        this._cache.botTag = localInfo?.botTag || null;
        this._cache.botAvatar = this._localClient?.user?.avatar || null;
        this._cache.ping = Math.max(localInfo?.ping || 0, ...allShards.map(s => s.ping || 0));
        this._cache.guilds = guildMap;
        this._cache.lastFetch = Date.now();
        this._ready = !!this._cache.botId;
      } catch (err) {
        console.error('[ShardClient] Refresh failed:', err.message);
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  /** Access cached guilds */
  get guilds() {
    return {
      cache: this._guildsCacheProxy(),
    };
  }

  _guildsCacheProxy() {
    const self = this;
    return {
      get size() {
        return self._cache.guilds ? self._cache.guilds.size : 0;
      },
      get(guildId) {
        return self._cache.guilds?.get(guildId) || null;
      },
      map(fn) {
        if (!self._cache.guilds) return [];
        return [...self._cache.guilds.values()].map(fn);
      },
      reduce(fn, initial) {
        if (!self._cache.guilds) return initial;
        return [...self._cache.guilds.values()].reduce(fn, initial);
      },
      values() {
        if (!self._cache.guilds) return [][Symbol.iterator]();
        return self._cache.guilds.values();
      },
      forEach(fn) {
        if (!self._cache.guilds) return;
        self._cache.guilds.forEach(fn);
      },
      filter(fn) {
        if (!self._cache.guilds) return [];
        return [...self._cache.guilds.values()].filter(fn);
      },
    };
  }

  /** Get bot user object */
  get user() {
    const self = this;
    return {
      get id() { return self._cache.botId; },
      get tag() { return self._cache.botTag; },
      displayAvatarURL(opts) {
        const id = self._cache.botId;
        const avatar = self._cache.botAvatar;
        if (!id) return '';
        const size = opts?.size || 128;
        if (avatar) {
          const format = avatar.startsWith('a_') ? 'gif' : 'png';
          return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${format}?size=${size}`;
        }
        const defaultIndex = Number(BigInt(id) >> 22n) % 6;
        return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png?size=${size}`;
      },
    };
  }

  /** Get websocket ping from shards */
  get ws() {
    return { ping: this._cache.ping };
  }

  /**
   * Fetch a Discord user by ID.
   * Tries the local client first (shard 0), then queries remote shards via HTTP.
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  async fetchUser(userId) {
    // Try local client first
    if (this._localClient) {
      const user = this._localClient.users.cache.get(userId);
      if (user) return { id: user.id, username: user.username, tag: user.tag };
    }
    try {
      const user = await this._localClient.users.fetch(userId);
      return { id: user.id, username: user.username, tag: user.tag };
    } catch {}

    // Query remote shards
    const allShards = this._coordinator.getAllShards();
    for (const shard of allShards) {
      if (shard.id === 0 || shard.status !== 'running' || shard.url === 'local') continue;
      try {
        const res = await fetch(`${shard.url}/api/user/${userId}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.id) return data;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Fetch a guild by ID across all shards.
   * @param {string} guildId
   * @returns {Promise<object|null>}
   */
  async fetchGuild(guildId) {
    // Try cache first
    if (this._cache.guilds?.has(guildId)) {
      return this._cache.guilds.get(guildId);
    }

    // Check local client
    if (this._localClient?.guilds?.cache?.has(guildId)) {
      const g = this._localClient.guilds.cache.get(guildId);
      const data = {
        id: g.id, name: g.name, icon: g.icon,
        memberCount: g.memberCount, ownerId: g.ownerId,
      };
      if (this._cache.guilds) this._cache.guilds.set(guildId, data);
      return data;
    }

    // Check remote shards
    const shard = this._coordinator.findGuildShard(guildId);
    if (shard && shard.id !== 0 && shard.url !== 'local') {
      try {
        const res = await fetch(`${shard.url}/api/guild/${guildId}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.id) {
            if (this._cache.guilds) this._cache.guilds.set(guildId, data);
            return data;
          }
        }
      } catch {}
    }

    return null;
  }

  /**
   * Fetch channels for a guild.
   * @param {string} guildId
   * @returns {Promise<Array>}
   */
  async fetchGuildChannels(guildId) {
    // Try local client
    if (this._localClient?.guilds?.cache?.has(guildId)) {
      const guild = this._localClient.guilds.cache.get(guildId);
      try {
        const channels = await guild.channels.fetch();
        return [...channels.values()].map(ch => ({
          id: ch.id, name: ch.name, type: ch.type,
          isTextBased: ch.isTextBased?.() || false,
          isThread: ch.isThread?.() || false,
        }));
      } catch {
        return [];
      }
    }

    // Try remote shard
    const shard = this._coordinator.findGuildShard(guildId);
    if (shard && shard.id !== 0 && shard.url !== 'local') {
      try {
        const res = await fetch(`${shard.url}/api/channels/${guildId}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          return data.channels || data || [];
        }
      } catch {}
    }

    return [];
  }

  /** Refresh the cache. */
  async refresh() {
    await this._refreshCache();
  }
}

module.exports = { ShardClient };
