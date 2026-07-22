/**
 * ShardClient — wraps a ShardingManager to provide a client-like API
 * for the web server. Under the hood it uses broadcastEval to query
 * data from all shard processes.
 */
class ShardClient {
  /**
   * @param {import('discord.js').ShardingManager} manager
   */
  constructor(manager) {
    this.manager = manager;
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
   * Cached for up to 30 seconds.
   */
  async _refreshCache() {
    if (this._refreshPromise) return this._refreshPromise;

    // Debounce: if cache is fresh (< 30s), skip
    if (Date.now() - this._cache.lastFetch < 30_000 && this._cache.guilds) {
      return;
    }

    this._refreshPromise = (async () => {
      try {
        const results = await this.manager.broadcastEval((c) => {
          const guilds = [...c.guilds.cache.values()].map(g => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            memberCount: g.memberCount,
            ownerId: g.ownerId,
          }));
          return {
            botId: c.user?.id || null,
            botTag: c.user?.tag || null,
            botAvatar: c.user?.avatar || null,
            ping: c.ws?.ping || 0,
            guilds,
          };
        });

        // Merge results from all shards
        const merged = { guilds: [] };
        for (const r of results) {
          if (r.botId) {
            merged.botId = merged.botId || r.botId;
            merged.botTag = merged.botTag || r.botTag;
            merged.botAvatar = merged.botAvatar || r.botAvatar;
            merged.ping = Math.max(merged.ping, r.ping);
          }
          if (r.guilds) merged.guilds.push(...r.guilds);
        }

        const guildMap = new Map();
        for (const g of merged.guilds) {
          guildMap.set(g.id, g);
        }

        this._cache.botId = merged.botId;
        this._cache.botTag = merged.botTag;
        this._cache.botAvatar = merged.botAvatar;
        this._cache.ping = merged.ping;
        this._cache.guilds = guildMap;
        this._cache.lastFetch = Date.now();
        this._ready = !!merged.botId;
      } catch (err) {
        console.error('[ShardClient] broadcastEval failed:', err.message);
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
        const ext = opts?.dynamic ? (avatar?.startsWith('a_') ? 'gif' : 'png') : 'png';
        const size = opts?.size || 128;
        if (avatar) {
          const format = avatar.startsWith('a_') ? 'gif' : 'png';
          return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${format}?size=${size}`;
        }
        const discrim = 0; // new Discord users don't have discriminators
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
   * Fetch a Discord user by ID (searches across all shards).
   * Returns the raw user object or null.
   */
  async fetchUser(userId) {
    const results = await this.manager.broadcastEval(
      (c, { uid }) => {
        return c.users.cache.get(uid) || null;
      },
      { context: { uid: userId } },
    );
    // Return the first non-null result
    for (const r of results) {
      if (r) return r;
    }
    // If not in cache, try fetching from API
    const fetchResults = await this.manager.broadcastEval(
      async (c, { uid }) => {
        try {
          const user = await c.users.fetch(uid);
          return { id: user.id, username: user.username, tag: user.tag };
        } catch {
          return null;
        }
      },
      { context: { uid: userId } },
    );
    for (const r of fetchResults) {
      if (r) return r;
    }
    return null;
  }

  /**
   * Fetch a guild by ID (searches across all shards).
   * Returns minimal guild data { id, name, icon, memberCount, ownerId } or null.
   */
  async fetchGuild(guildId) {
    // Try cache first
    if (this._cache.guilds?.has(guildId)) {
      return this._cache.guilds.get(guildId);
    }

    // Broadcast to all shards
    const results = await this.manager.broadcastEval(
      (c, { gid }) => {
        const g = c.guilds.cache.get(gid);
        if (!g) return null;
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          memberCount: g.memberCount,
          ownerId: g.ownerId,
        };
      },
      { context: { gid: guildId } },
    );

    for (const r of results) {
      if (r) {
        // Update cache
        if (this._cache.guilds) this._cache.guilds.set(guildId, r);
        return r;
      }
    }
    return null;
  }

  /**
   * Fetch channels for a guild (searches across all shards).
   */
  async fetchGuildChannels(guildId) {
    const results = await this.manager.broadcastEval(
      async (c, { gid }) => {
        const g = c.guilds.cache.get(gid);
        if (!g) return null;
        try {
          const channels = await g.channels.fetch();
          return [...channels.values()].map(ch => ({
            id: ch.id,
            name: ch.name,
            type: ch.type,
            isTextBased: ch.isTextBased?.() || false,
            isThread: ch.isThread?.() || false,
          }));
        } catch {
          return null;
        }
      },
      { context: { gid: guildId } },
    );

    for (const r of results) {
      if (r) return r;
    }
    return [];
  }

  /**
   * Refresh the cache. Call this periodically (e.g. every 30s)
   * and after significant events.
   */
  async refresh() {
    await this._refreshCache();
  }
}

module.exports = { ShardClient };
