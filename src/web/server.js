const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const store = require('../store');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${PORT}`;
const IS_SECURE = DASHBOARD_URL.startsWith('https://');
const REDIRECT_URI = `${DASHBOARD_URL}/auth/callback`;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;

// Bot permissions requested in the invite URL (computed as a bit field)
// Each entry uses Discord's permission flag bit positions
const BOT_PERMISSIONS = (
  (1n << 1n)  |  // Kick Members
  (1n << 2n)  |  // Ban Members
  (1n << 4n)  |  // Manage Channels
  (1n << 6n)  |  // Add Reactions
  (1n << 7n)  |  // View Audit Log
  (1n << 10n) |  // View Channels
  (1n << 11n) |  // Send Messages
  (1n << 13n) |  // Manage Messages
  (1n << 14n) |  // Embed Links
  (1n << 15n) |  // Attach Files
  (1n << 16n) |  // Read Message History
  (1n << 17n) |  // Mention Everyone
  (1n << 18n) |  // Use External Emojis
  (1n << 20n) |  // Connect
  (1n << 21n) |  // Speak
  (1n << 28n) |  // Manage Roles
  (1n << 29n) |  // Manage Webhooks
  (1n << 30n) |  // Manage Emojis and Stickers
  (1n << 31n) |  // Use Application Commands
  (1n << 33n) |  // Manage Events
  (1n << 34n) |  // Manage Threads
  (1n << 35n) |  // Create Public Threads
  (1n << 38n) |  // Send Messages in Threads
  (1n << 40n)    // Moderate Members
).toString();

// In-memory session store: token → { userId, username, avatar, expires }
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function pruneSessions() {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (data.expires < now) sessions.delete(token);
  }
}
setInterval(pruneSessions, 60 * 60 * 1000);

// Raw body capture for webhook signature verification (must run before express.json())
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/dbl') {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      req.rawBody = data;
      // Parse JSON and flag as already-parsed so express.json() skips
      try { req.body = JSON.parse(data); } catch (e) {}
      req._body = true; // Tells body-parser this request was already handled
      next();
    });
  } else {
    next();
  }
});

app.use(express.json());

// ---------- Health Check ----------
// Health check endpoint
app.get('/health', (_req, res) => {
  const sc = app.get('shardClient');
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    bot: sc?.isReady() ? 'connected' : 'disconnected',
    botTag: sc?.isReady() ? sc.user.tag : null,
    guildCount: sc?.isReady() ? sc.guilds.cache.size : 0,
  });
});

const gitSync = require('../git-sync');
const ticketsStore = require('../tickets/store');
const ticketsCore = require('../tickets/core');
const botManager = require('../botManager');
const backupSystem = require('../backup');
const modmailStore = require('../modmail/store');
const modmailCore = require('../modmail/core');
const votes = require('../votes');

// ---------- Helpers ----------

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...val] = pair.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(val.join('='));
  }
  return cookies;
}

function setSession(res, userData) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    ...userData,
    expires: Date.now() + SESSION_TTL,
  });
  pruneSessions();
  res.cookie('limey_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL,
  });
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.limey_session;
  if (!token) return null;
  const data = sessions.get(token);
  if (!data || data.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return data;
}

// ---------- Auth Middleware ----------

function requireAuth(req, res, next) {
  // Skip auth if OAuth is not configured (dev mode)
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return next();
  }

  const session = getSession(req);

    // Allow OAuth paths, homepage, and static assets through
  if (req.path === '/auth/login' || req.path === '/auth/callback' || req.path === '/auth/backup-callback') return next();
  if (req.path === '/login' || req.path === '/login.html') return next();
  if (req.path === '/' || req.path === '/index.html') return next();
  if (req.path === '/style.css' || req.path === '/dashboard.js') return next();
  if (req.path === '/dbl') return next();
  if (req.path === '/health') return next();

  if (!session) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }

  req.session = session;
  next();
}

app.use(requireAuth);

// ---------- Page Routes ----------

// Helper to render the homepage with CLIENT_ID injected
function renderHomepage(res, status = 200) {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const inviteUrl = CLIENT_ID
    ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${BOT_PERMISSIONS}&scope=bot%20applications.commands`
    : '#';
  html = html.replace(/\{\{INVITE_URL\}\}/g, inviteUrl);
  res.status(status).send(html);
}

// GET / — homepage
app.get('/', (_req, res) => renderHomepage(res));

// Redirect /index.html to /
app.get('/index.html', (_req, res) => {
  res.redirect(301, '/');
});

// GET /dashboard — dashboard (requires auth via middleware)
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// GET /login — show login page
app.get('/login', (_req, res) => {
  // If already logged in, redirect to dashboard
  const session = getSession(_req);
  if (session) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ---------- Static Assets ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- OAuth Routes ----------

// GET /auth/login — redirect to Discord OAuth
app.get('/auth/login', (_req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not configured');
  }
  // Generate CSRF state token
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    sameSite: IS_SECURE ? 'none' : 'lax',
    secure: IS_SECURE,
    maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// ─── Backup Auth OAuth Callback ──────────────────────────────────────
// Separate endpoint for guilds.join scope (authorize user migration)
app.get('/auth/backup-callback', async (req, res) => {
  const { code, state: backupId } = req.query;
  if (!code || !backupId) {
    return res.status(400).send('Missing authorization code or backup ID');
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${DASHBOARD_URL}/auth/backup-callback`,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[BackupAuth] Token exchange failed:', await tokenRes.text());
      return res.status(500).send('Authorization failed. Please try creating the backup again.');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    // Fetch user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return res.status(500).send('Failed to fetch user info.');
    }

    const user = await userRes.json();

    // Store the authorization
    backupSystem.storeAuthorization(backupId, user.id, accessToken, refreshToken, user.username);

    // Try to DM the user a confirmation via any shard
    const manager = app.get('discordManager');
    if (manager) {
      await manager.broadcastEval(
        async (c, { targetUserId, embedData }) => {
          const { EmbedBuilder } = require('discord.js');
          try {
            const discordUser = await c.users.fetch(targetUserId).catch(() => null);
            if (!discordUser) return;
            const embed = new EmbedBuilder()
              .setTitle(embedData.title)
              .setColor(embedData.color)
              .setDescription(embedData.description);
            await discordUser.send({ embeds: [embed] }).catch(() => {});
          } catch (_) {}
        },
        {
          context: {
            targetUserId: user.id,
            embedData: {
              title: '✅ Authorization Confirmed',
              color: 0x57F287,
              description: [
                'You have successfully authorized **Limey** to add you to servers during backup restoration.',
                '',
                'When the server owner runs **/restore** with this backup, you will automatically be added to the target server.',
                'You can revoke this at any time via your [Discord Authorized Apps](https://discord.com/settings/authorized-apps) settings.',
              ].join('\n'),
            },
          },
        },
      ).catch(() => {});
    }

    // Return a success page
    res.send(`
      <html><body style="background:#1a1b1e;color:#e4e5e7;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center;max-width:400px">
          <div style="font-size:64px;margin-bottom:16px">✅</div>
          <h1 style="font-size:24px;margin-bottom:8px">Authorization Confirmed!</h1>
          <p style="color:#a6a7ab;line-height:1.6">
            You've authorized Limey to add you to servers during backup restoration.
            You can close this window.
          </p>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error('[BackupAuth] Callback error:', err.message);
    res.status(500).send('Authorization failed: ' + err.message);
  }
});

// GET /auth/callback — handle OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Verify CSRF state
  const cookies = parseCookies(req.headers.cookie);
  const savedState = cookies.oauth_state;
  if (!state || state !== savedState) {
    return res.status(403).send('Invalid state parameter — possible CSRF attack');
  }
  res.clearCookie('oauth_state', { sameSite: IS_SECURE ? 'none' : 'lax', secure: IS_SECURE });

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[OAuth] Token exchange failed:', await tokenRes.text());
      return res.status(500).send('OAuth token exchange failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch user info
    const [userRes, guildsRes] = await Promise.all([
      fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    if (!userRes.ok || !guildsRes.ok) {
      return res.status(500).send('Failed to fetch user data');
    }

    const user = await userRes.json();
    const allGuilds = await guildsRes.json();

    // Determine authorized guilds
    const sc = app.get('shardClient');
    const botGuilds = sc?.isReady() ? sc.guilds.cache.map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: false })) : [];
    const botGuildIds = new Set(botGuilds.map(g => g.id));

    let authorizedGuilds;
    if (BOT_OWNER_ID && user.id === BOT_OWNER_ID) {
      // Bot owner sees EVERYTHING — all guilds the bot is in
      authorizedGuilds = botGuilds;
      console.log(`[OAuth] Bot owner ${user.username} logged in — full access to ${authorizedGuilds.length} guild(s)`);
    } else {
      // Normal user: only guilds they OWN and the bot is in
      const ownedGuilds = allGuilds
        .filter(g => g.owner)
        .map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: true }));
      authorizedGuilds = ownedGuilds.filter(g => botGuildIds.has(g.id));
    }

    setSession(res, {
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      guilds: authorizedGuilds,
    });

    res.redirect('/dashboard');
  } catch (err) {
    console.error('[OAuth] Callback error:', err.message);
    res.status(500).send('OAuth failed: ' + err.message);
  }
});

// GET /api/git-sync — check git sync status
app.get('/api/git-sync', (_req, res) => {
  const status = gitSync.getStatus();
  res.json(status);
});

// POST /api/git-sync/sync — force a git sync now
app.post('/api/git-sync/sync', (_req, res) => {
  const result = gitSync.forceSync();
  res.json(result);
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.limey_session;
  if (token) sessions.delete(token);
  res.clearCookie('limey_session', { sameSite: 'lax' });
  res.json({ ok: true });
});

// GET /api/me — current user info
app.get('/api/me', (req, res) => {
  res.json({
    userId: req.session.userId,
    username: req.session.username,
    avatar: req.session.avatar,
    guilds: req.session.guilds,
    isBotOwner: !!(BOT_OWNER_ID && req.session?.userId === BOT_OWNER_ID),
  });
});

// ---------- API Routes ----------

app.get('/api/logs', (req, res) => {
  const session = req.session;
  const { event, guild, channel, user, search, limit, offset } = req.query;

  // Build the guild filter: if user is logged in, restrict to their guilds
  let effectiveGuild = guild;
  if (session && !guild) {
    // If no specific guild filter, pass all authorized guild names as a pipe-separated "multi-guild" hint
    // The logger doesn't support multi-guild, so we filter after the fact but adjust total
    effectiveGuild = null;
  }

  const result = logger.query({
    event,
    guild: effectiveGuild,
    channel,
    user,
    search,
    limit: limit ? parseInt(limit, 10) : 200,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  // Filter logs to only user's authorized guilds (skip for bot owner)
  const isOwner = BOT_OWNER_ID && session?.userId === BOT_OWNER_ID;
  if (session && !guild && !isOwner) {
    const userGuildNames = new Set(session.guilds.map(g => g.name.toLowerCase()));
    const beforeCount = result.logs.length;
    result.logs = result.logs.filter(l =>
      !l.guild || userGuildNames.has(l.guild.toLowerCase())
    );
    // Adjust total: subtract what was filtered from this page
    const filteredFromPage = beforeCount - result.logs.length;
    result.total = Math.max(0, result.total - filteredFromPage);
  }

  res.json(result);
});

app.get('/api/events', (_req, res) => {
  res.json(logger.getEventTypes());
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  logger.subscribe(res);
});

app.post('/api/clear', (_req, res) => {
  logger.clear();
  res.json({ ok: true, message: 'All logs cleared' });
});

app.get('/api/stats', (_req, res) => {
  res.json({
    totalLogs: logger.logs.length,
    eventCounts: logger.eventCounts,
    oldestLog: logger.logs[0]?.timestamp || null,
    newestLog: logger.logs[logger.logs.length - 1]?.timestamp || null,
    rateLimits: logger.rateLimits,
  });
});

// GET /api/config/:guildId — get guild config (log channel)
app.get('/api/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const cfg = store.getGuildConfig(req.params.guildId);
  res.json({ logChannel: cfg.logChannel });
});

// POST /api/config/:guildId — set guild log channel
app.post('/api/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const { logChannel } = req.body;
  store.setLogChannel(req.params.guildId, logChannel || null);
  res.json({ ok: true, logChannel: logChannel || null });
});

// ═══════════════════════════════════════════════════════════════════════════
// Log Event Config API
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/logs/config/:guildId — get event config for a guild
app.get('/api/logs/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const eventConfig = store.getEventConfig(req.params.guildId);
  const summary = store.getEventSummary(req.params.guildId);
  const groups = store.EVENT_GROUPS;

  res.json({
    eventConfig,
    summary,
    groups,
  });
});

// POST /api/logs/config/:guildId — update event config for a guild
app.post('/api/logs/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const { eventName, enabled, action } = req.body;

  if (action === 'enable_all') {
    store.setAllEvents(req.params.guildId, true);
    return res.json({ ok: true, message: 'All events enabled' });
  }

  if (action === 'disable_all') {
    store.setAllEvents(req.params.guildId, false);
    return res.json({ ok: true, message: 'All events disabled' });
  }

  if (action === 'toggle_group') {
    const { groupEvents, groupEnabled } = req.body;
    if (Array.isArray(groupEvents)) {
      for (const evt of groupEvents) {
        store.setEventEnabled(req.params.guildId, evt, groupEnabled);
      }
      return res.json({ ok: true, message: `Group ${groupEnabled ? 'enabled' : 'disabled'}` });
    }
  }

  if (eventName) {
    if (!store.isValidEvent(eventName)) {
      return res.status(400).json({ error: 'Invalid event name' });
    }
    const current = store.isEventEnabled(req.params.guildId, eventName);
    const newState = enabled !== undefined ? enabled : !current;
    store.setEventEnabled(req.params.guildId, eventName, newState);
    return res.json({ ok: true, eventName, enabled: newState });
  }

  res.status(400).json({ error: 'Missing eventName or action' });
});

// GET /api/channels/:guildId — list text channels for a guild
app.get('/api/channels/:guildId', async (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const sc = app.get('shardClient');
  if (!sc?.isReady()) return res.status(500).json({ error: 'Bot not connected' });

  const channels = await sc.fetchGuildChannels(req.params.guildId);
  const textChannels = channels
    .filter(c => c.isTextBased && !c.isThread)
    .map(c => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ channels: textChannels });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ticket API Routes
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/tickets/:guildId — get all tickets for a guild
app.get('/api/tickets/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const allTickets = ticketsStore.getTickets();
  const guildTickets = allTickets.filter(t => t.guildId === req.params.guildId);

  res.json({
    tickets: guildTickets,
    stats: {
      total: guildTickets.length,
      open: guildTickets.filter(t => t.open).length,
      closed: guildTickets.filter(t => !t.open).length,
      claimed: guildTickets.filter(t => t.claimed).length,
      pinned: guildTickets.filter(t => t.pinned).length,
    },
  });
});

// GET /api/tickets/config/:guildId — get ticket config for a guild
app.get('/api/tickets/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const generalConfig = ticketsStore.getConfig('general');
  const panels = ticketsStore.getConfig('panels');
  const options = ticketsStore.getConfig('options');
  const questions = ticketsStore.getConfig('questions');
  const priorities = ticketsStore.getPriorities();

  res.json({
    general: generalConfig,
    panels: panels || [],
    options: options || [],
    questions: questions || [],
    priorities,
  });
});

// POST /api/tickets/config/:guildId — update ticket config
app.post('/api/tickets/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const { configType, data } = req.body;

  const validTypes = ['general', 'panels', 'options', 'questions'];
  if (!validTypes.includes(configType)) {
    return res.status(400).json({ error: 'Invalid config type' });
  }

  const result = ticketsStore.setConfig(configType, data);
  if (result) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// GET /api/tickets/stats/:guildId — get ticket stats
app.get('/api/tickets/stats/:guildId', async (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const stats = await ticketsCore.getTicketStats(req.params.guildId);
  res.json(stats);
});

// GET /api/tickets/transcripts/:guildId — get ticket transcripts
app.get('/api/tickets/transcripts/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const transcripts = ticketsStore.getTranscripts();
  res.json({ transcripts });
});

// GET /api/tickets/categories/:guildId — list categories for a guild
app.get('/api/tickets/categories/:guildId', async (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const sc = app.get('shardClient');
  if (!sc?.isReady()) return res.status(500).json({ error: 'Bot not connected' });

  const channels = await sc.fetchGuildChannels(req.params.guildId);
  const categories = channels
    .filter(c => c.type === 4) // ChannelType.GuildCategory
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ categories });
});

// POST /api/tickets/panels/spawn — send a panel message to a Discord channel
app.post('/api/tickets/panels/spawn', async (req, res) => {
  const session = req.session;
  const { guildId, panelId, channelId } = req.body;

  if (!guildId || !panelId || !channelId) {
    return res.status(400).json({ error: 'Missing required fields: guildId, panelId, channelId' });
  }

  const hasAccess = session.guilds.some(g => g.id === guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const sc = app.get('shardClient');
  const manager = app.get('discordManager');
  if (!sc?.isReady()) return res.status(500).json({ error: 'Bot not connected' });

  // Send the panel via broadcastEval so the correct shard handles it
  const results = await manager.broadcastEval(
    async (c, { gid, chid, pid }) => {
      const guild = c.guilds.cache.get(gid);
      if (!guild) return null;
      const channel = guild.channels.cache.get(chid);
      if (!channel || !channel.isTextBased()) return { error: 'Channel not found or not a text channel' };

      const { ticketsCore } = require('./tickets');
      const panel = ticketsCore.getPanel(pid);
      if (!panel) return { error: `Panel "${pid}" not found` };

      const embed = ticketsCore.buildPanelEmbed(panel, guild);
      const components = ticketsCore.buildPanelComponents(panel);

      try {
        const sent = await channel.send({
          embeds: embed ? [embed] : [],
          components,
        });
        return { ok: true, messageId: sent.id, channelId: sent.channelId };
      } catch (err) {
        return { error: `Failed to send panel: ${err.message}` };
      }
    },
    { context: { gid: guildId, chid: channelId, pid: panelId } },
  );

  // Find the first non-null result
  const result = results.find(r => r !== null);
  if (!result) return res.status(404).json({ error: 'Guild not found in any shard' });
  if (result.error) return res.status(500).json({ error: result.error });
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════
// Custom Bot Management API
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/bots — list all custom bots (for bot owner)
app.get('/api/bots', (req, res) => {
  const isOwner = BOT_OWNER_ID && req.session?.userId === BOT_OWNER_ID;
  if (!isOwner) return res.status(403).json({ error: 'Only the bot owner can manage custom bots.' });

  const allBots = botManager.getBotsData();
  const runningClients = botManager.getAllClients();

  const result = allBots.map(b => ({
    guildId: b.guildId,
    name: b.name || 'Custom Bot',
    enabled: b.enabled !== false,
    status: b.status || 'stopped',
    createdAt: b.createdAt,
    clientId: b.clientId,
    running: runningClients[b.guildId] ? {
      tag: runningClients[b.guildId].tag,
      ping: runningClients[b.guildId].ping,
    } : null,
  }));

  res.json({ bots: result });
});

// POST /api/bots/start — start a custom bot for a guild
app.post('/api/bots/start', async (req, res) => {
  const isOwner = BOT_OWNER_ID && req.session?.userId === BOT_OWNER_ID;
  if (!isOwner) return res.status(403).json({ error: 'Only the bot owner can manage custom bots.' });

  const { guildId, token } = req.body;
  if (!guildId || !token) {
    return res.status(400).json({ error: 'Missing required fields: guildId, token' });
  }

  const result = await botManager.createClient(guildId, token);
  if (result.success) {
    res.json({ ok: true, clientId: result.clientId, tag: result.tag });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// POST /api/bots/stop — stop a custom bot for a guild
app.post('/api/bots/stop', async (req, res) => {
  const isOwner = BOT_OWNER_ID && req.session?.userId === BOT_OWNER_ID;
  if (!isOwner) return res.status(403).json({ error: 'Only the bot owner can manage custom bots.' });

  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });

  const result = await botManager.destroyClient(guildId);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// POST /api/bots/restart — restart a custom bot for a guild
app.post('/api/bots/restart', async (req, res) => {
  const isOwner = BOT_OWNER_ID && req.session?.userId === BOT_OWNER_ID;
  if (!isOwner) return res.status(403).json({ error: 'Only the bot owner can manage custom bots.' });

  const { guildId, token } = req.body;
  if (!guildId || !token) {
    return res.status(400).json({ error: 'Missing required fields: guildId, token' });
  }

  await botManager.destroyClient(guildId);
  const result = await botManager.createClient(guildId, token);
  if (result.success) {
    res.json({ ok: true, clientId: result.clientId, tag: result.tag });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Backup API Routes
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/backups/:guildId — list backups for a guild
app.get('/api/backups/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const backups = backupSystem.listBackups(req.params.guildId);
  res.json({ backups });
});

// POST /api/backups/create — create a new backup
app.post('/api/backups/create', (req, res) => {
  const session = req.session;
  const { guildId, label } = req.body;

  if (!guildId) return res.status(400).json({ error: 'Missing guildId' });

  const hasAccess = session.guilds.some(g => g.id === guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const result = backupSystem.createBackup(guildId, session.userId, label);
  if (result.success) {
    res.json({ ok: true, backupId: result.backupId, fileCount: result.fileCount });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// POST /api/backups/restore — restore from a backup
app.post('/api/backups/restore', (req, res) => {
  const session = req.session;
  const { backupId } = req.body;

  if (!backupId) return res.status(400).json({ error: 'Missing backupId' });

  // Verify the backup exists and user has access to its guild
  const backup = backupSystem.getBackup(backupId);
  if (!backup) return res.status(404).json({ error: 'Backup not found' });

  const hasAccess = session.guilds.some(g => g.id === backup.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const result = backupSystem.restoreBackup(backupId);
  if (result.success) {
    res.json({ ok: true, fileCount: result.fileCount });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// POST /api/backups/delete — delete a backup
app.post('/api/backups/delete', (req, res) => {
  const session = req.session;
  const { backupId } = req.body;

  if (!backupId) return res.status(400).json({ error: 'Missing backupId' });

  const backup = backupSystem.getBackup(backupId);
  if (!backup) return res.status(404).json({ error: 'Backup not found' });

  const hasAccess = session.guilds.some(g => g.id === backup.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const result = backupSystem.deleteBackup(backupId);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Modmail API Routes
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/modmail/:guildId — get modmail threads for a guild
app.get('/api/modmail/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const threads = modmailStore.getThreadsByGuild(req.params.guildId);
  const config = modmailStore.getConfig(req.params.guildId);
  const blocked = modmailStore.getBlockedUsers(req.params.guildId);

  // Sort by last activity descending
  threads.sort((a, b) => b.lastActivity - a.lastActivity);

  res.json({
    threads: threads.slice(0, 100),
    stats: modmailStore.getStats(req.params.guildId),
    config,
    blocked,
  });
});

// GET /api/modmail/config/:guildId — get modmail config
app.get('/api/modmail/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const config = modmailStore.getConfig(req.params.guildId);
  res.json({ config: config || modmailStore.getDefaultConfig() });
});

// POST /api/modmail/config/:guildId — update modmail config
app.post('/api/modmail/config/:guildId', (req, res) => {
  const session = req.session;
  const hasAccess = session.guilds.some(g => g.id === req.params.guildId);
  if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

  const { config } = req.body;
  if (!config) return res.status(400).json({ error: 'Missing config data' });

  modmailStore.setConfig(req.params.guildId, config);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// DBL Vote Webhook
// ═══════════════════════════════════════════════════════════════════════════

app.post('/dbl', async (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const sc = app.get('shardClient');
    const isTopgg = !!req.headers['x-topgg-signature'];
    const isDbl = !!req.headers['authorization'];

    // Verify authenticity based on source
    let verified = false;
    let source = '';
    let userId = '';
    let isWeekend = false;

    if (isTopgg) {
      // Top.gg webhook
      const signature = req.headers['x-topgg-signature'];
      const secret = process.env.TOPGG_WEBHOOK_SECRET;
      verified = votes.verifyTopggWebhook(rawBody, signature, secret);
      source = 'top.gg';
      userId = body.user || '';
      isWeekend = body.isWeekend === true;
    } else if (isDbl) {
      // DiscordBotList.com webhook
      const authHeader = req.headers['authorization'];
      const secret = process.env.DBL_WEBHOOK_SECRET;
      verified = votes.verifyDblWebhook(authHeader, secret);
      source = 'discordbotlist.com';
      userId = body.id || '';
    }

    if (!verified) {
      console.warn('[Votes] Unauthorized webhook attempt from:', req.ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'Missing user ID in payload' });
    }

    // Record the vote
    votes.addVote(userId, source, isWeekend);

    const stats = votes.getStats();
    console.log(`[Votes] Vote recorded: ${userId} via ${source} (total: ${stats.totalVotes})`);

    // Try to DM the user a thank-you message via any shard
    const manager = app.get('discordManager');
    if (manager) {
      const botId = sc?.user?.id || '';
      const topggUrl = `https://top.gg/bot/${botId}/vote`;
      const dblUrl = `https://discordbotlist.com/bots/${botId}/upvote`;
      const sourceLabel = source;
      const weekendBonus = isWeekend;

      await manager.broadcastEval(
        async (c, { targetUserId, embedData }) => {
          const { EmbedBuilder } = require('discord.js');
          try {
            const discordUser = await c.users.fetch(targetUserId).catch(() => null);
            if (!discordUser) return;
            const embed = new EmbedBuilder()
              .setTitle(embedData.title)
              .setColor(embedData.color)
              .setDescription(embedData.description)
              .setTimestamp()
              .setFooter({ text: embedData.footer });
            await discordUser.send({ embeds: [embed] }).catch(() => {});
          } catch (_) {}
        },
        {
          context: {
            targetUserId: userId,
            embedData: {
              title: '🎉 Thank You for Voting!',
              color: 0x57F287,
              description: [
                'Your vote for **Limey** has been received and counted!',
                '',
                `You voted via **${sourceLabel}**${weekendBonus ? ' *(weekend bonus!)*' : ''}.`,
                '',
                'Voting helps us grow and keeps development active.',
                'You can vote again in **12 hours**!',
                '',
                `⬆️ [Vote on Top.gg](${topggUrl})`,
                `🗳️ [Vote on DiscordBotList.com](${dblUrl})`,
              ].join('\n'),
              footer: 'Thank you for supporting Limey! 💚',
            },
          },
        },
      ).catch(dmErr => {
        console.error('[Votes] Failed to send thank-you DM:', dmErr.message);
      });
    }

    return res.json({ ok: true, totalVotes: stats.totalVotes });
  } catch (err) {
    console.error('[Votes] Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /dbl — show vote info (used as the vote landing page)
app.get('/dbl', (_req, res) => {
  const stats = votes.getStats();
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vote for Limey</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0d0e12 0%, #1a1b20 100%);
      color: #e4e5e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1e1f26;
      border: 1px solid #2e2f34;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    }
    h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
    .sub { color: #a6a7ab; font-size: 15px; margin-bottom: 32px; line-height: 1.6; }
    .stats { display: flex; gap: 16px; justify-content: center; margin-bottom: 32px; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-num { font-size: 26px; font-weight: 800; background: linear-gradient(135deg, #5865F2, #57F287); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .stat-label { font-size: 11px; color: #6b6c70; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; font-weight: 600; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 14px 28px; border-radius: 10px; font-size: 15px; font-weight: 700;
      text-decoration: none; transition: transform 150ms ease, box-shadow 150ms ease;
      margin: 6px; min-width: 200px;
    }
    .btn-primary { background: #5865F2; color: #fff; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(88,101,242,0.4); }
    .btn-secondary { background: #25262b; color: #e4e5e7; border: 1px solid #2e2f34; }
    .btn-secondary:hover { transform: translateY(-2px); border-color: #5865F2; }
    .note { font-size: 12px; color: #6b6c70; margin-top: 24px; line-height: 1.6; }
    .note a { color: #5865F2; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⬆️ Vote for Limey</h1>
    <p class="sub">Support the bot by voting on Discord bot lists. Every vote helps us grow!</p>

    <div class="stats">
      <div class="stat">
        <div class="stat-num">${stats.totalVotes}</div>
        <div class="stat-label">Total Votes</div>
      </div>
      <div class="stat">
        <div class="stat-num">${stats.uniqueVoters}</div>
        <div class="stat-label">Voters</div>
      </div>
      <div class="stat">
        <div class="stat-num">${stats.last7d}</div>
        <div class="stat-label">This Week</div>
      </div>
    </div>

    <a href="https://top.gg/bot/${CLIENT_ID || ''}/vote" class="btn btn-primary" target="_blank" rel="noopener">⬆️ Vote on Top.gg</a>
    <a href="https://discordbotlist.com/bots/${CLIENT_ID || ''}/upvote" class="btn btn-secondary" target="_blank" rel="noopener">🗳️ Vote on DBL</a>

    <p class="note">
      This is the webhook endpoint for Discord Bot List vote notifications.<br>
      Use <code>/vote</code> in Discord to check your status.<br>
      <a href="/">← Back to Home</a>
    </p>
  </div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// 404 fallback
app.get('*', (_req, res) => renderHomepage(res, 404));

function startWebServer(manager, shardClient) {
  app.set('discordManager', manager);
  app.set('shardClient', shardClient);
  app.listen(PORT, () => {
    console.log(`[Web] Dashboard running at ${DASHBOARD_URL}`);
    if (CLIENT_ID && CLIENT_SECRET) {
      console.log(`[Web] Auth: Discord OAuth (Login with Discord)`);
    } else {
      console.log(`[Web] Auth: DISABLED (set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to enable)`);
    }
  });
  return app;
}

module.exports = { startWebServer, app };
