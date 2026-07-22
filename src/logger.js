const fs = require('fs');
const path = require('path');

const MAX_IN_MEMORY = 10_000;
const LOG_FILE = path.join(__dirname, '..', 'logs.json');

class Logger {
  constructor() {
    /** @type {Array<{id: number, timestamp: string, event: string, guild: string|null, channel: string|null, user: string|null, data: object}>} */
    this.logs = [];
    this.nextId = 1;
    this.eventCounts = {};        // event -> count
    this.listeners = new Set();   // SSE clients
    this.rateLimits = { count: 0, lastTime: null, lastLimit: null, lastTimeout: null, lastRoute: null, byRoute: {} };
    this.botStartTime = Date.now();

    // Load persisted logs from disk
    this._loadFromDisk();
  }

  /** Add a log entry */
  log(eventName, { guild, channel, user, details }) {
    const entry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      event: eventName,
      guild: guild || null,
      channel: channel || null,
      user: user || null,
      data: this._safeClone(details),
    };

    this.logs.push(entry);
    this.eventCounts[eventName] = (this.eventCounts[eventName] || 0) + 1;

    // Ring-buffer: trim in batches for performance (avoids O(n) shift on every insert)
    if (this.logs.length > MAX_IN_MEMORY + 500) {
      this.logs = this.logs.slice(-MAX_IN_MEMORY);
    }

    // Persist every 50 entries (batch writes)
    if (this.nextId % 50 === 0) {
      this._saveToDisk();
    }

    // Notify SSE clients
    for (const res of this.listeners) {
      try {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      } catch (_) {
        this.listeners.delete(res);
      }
    }
  }

  /** Get logs with optional filtering */
  query({ event, guild, channel, user, search, limit = 200, offset = 0 } = {}) {
    let results = [...this.logs];

    if (event)    results = results.filter(l => l.event === event);
    if (guild)    results = results.filter(l => l.guild?.toLowerCase().includes(guild.toLowerCase()));
    if (channel)  results = results.filter(l => l.channel?.toLowerCase().includes(channel.toLowerCase()));
    if (user)     results = results.filter(l => l.user?.toLowerCase().includes(user.toLowerCase()));
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(l => JSON.stringify(l.data).toLowerCase().includes(s));
    }

    const total = results.length;
    // Reverse chronological by default
    results.reverse();
    results = results.slice(offset, offset + limit);

    return {
      total,
      offset,
      limit,
      logs: results,
      counts: this.eventCounts,
    };
  }

  /** Get all unique event names that have been logged */
  getEventTypes() {
    return Object.keys(this.eventCounts).sort();
  }

  /** Subscribe an SSE response stream (with heartbeat to prevent proxy timeouts) */
  subscribe(res) {
    this.listeners.add(res);

    // Send heartbeat every 30s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      try { res.write(':ping\n\n'); } catch (_) { /* connection closed */ }
    }, 30_000);

    res.on('close', () => {
      clearInterval(heartbeat);
      this.listeners.delete(res);
    });
  }

  /** Record a rate limit hit with full details */
  recordRateLimit(data) {
    this.rateLimits.count++;
    this.rateLimits.lastTime = new Date().toISOString();
    if (data) {
      this.rateLimits.lastLimit = data.limit || null;
      this.rateLimits.lastTimeout = data.timeout || null;
      this.rateLimits.lastRoute = data.route || data.path || null;
      // Track per-route
      const route = data.route || data.path || 'unknown';
      if (!this.rateLimits.byRoute[route]) {
        this.rateLimits.byRoute[route] = { count: 0, limit: data.limit || 0, lastTime: null };
      }
      this.rateLimits.byRoute[route].count++;
      this.rateLimits.byRoute[route].limit = data.limit || this.rateLimits.byRoute[route].limit;
      this.rateLimits.byRoute[route].lastTime = new Date().toISOString();
    }
  }

  /** Get bot uptime in milliseconds */
  uptime() {
    return Date.now() - this.botStartTime;
  }

  /** Clear all logs (danger zone) */
  clear() {
    this.logs = [];
    this.nextId = 1;
    this.eventCounts = {};
    this.rateLimits = { count: 0, lastTime: null, lastLimit: null, lastTimeout: null, lastRoute: null, byRoute: {} };
    this._saveToDisk();
  }

  // ---------- persistence ----------

  _saveToDisk() {
    try {
      // Only persist the last 5000 to keep file manageable
      const toSave = this.logs.slice(-5000);
      fs.writeFileSync(LOG_FILE, JSON.stringify(toSave, null, 2));
    } catch (err) {
      console.error('[Logger] Failed to save logs:', err.message);
    }
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        const raw = fs.readFileSync(LOG_FILE, 'utf8');
        const loaded = JSON.parse(raw);
        if (Array.isArray(loaded) && loaded.length > 0) {
          this.logs = loaded;
          this.nextId = (loaded[loaded.length - 1]?.id ?? 0) + 1;
          // Rebuild event counts
          for (const entry of loaded) {
            this.eventCounts[entry.event] = (this.eventCounts[entry.event] || 0) + 1;
          }
          console.log(`[Logger] Loaded ${loaded.length} logs from disk`);
        }
      }
    } catch (err) {
      console.error('[Logger] Failed to load logs:', err.message);
    }
  }

  /** Clone an object, removing circular refs & non-serializable values */
  _safeClone(obj, depth = 0) {
    if (depth > 3) return '[max depth]';
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'function') return '[function]';
    if (typeof obj === 'bigint') return obj.toString();
    if (typeof obj === 'symbol') return obj.toString();
    if (obj instanceof Map) return { _type: 'Map', entries: [...obj.entries()].map(([k, v]) => [this._safeClone(k, depth + 1), this._safeClone(v, depth + 1)]) };
    if (obj instanceof Set) return { _type: 'Set', values: [...obj].map(v => this._safeClone(v, depth + 1)) };
    if (obj instanceof Date) return obj.toISOString();
    if (Buffer.isBuffer(obj)) return { _type: 'Buffer', length: obj.length };
    if (Array.isArray(obj)) return obj.map(v => this._safeClone(v, depth + 1));
    if (typeof obj === 'object') {
      try {
        const clone = {};
        for (const key of Object.keys(obj)) {
          if (key === 'client') continue; // skip circular refs
          try {
            clone[key] = this._safeClone(obj[key], depth + 1);
          } catch {
            clone[key] = '[unserializable]';
          }
        }
        return clone;
      } catch {
        return '[object]';
      }
    }
    return obj;
  }
}

module.exports = new Logger();
