/**
 * Shard Worker Server — minimal Express server for worker shard instances.
 *
 * Worker shards run their own lightweight HTTP server for:
 *   - Health checks (queried by the coordinator)
 *   - Stats reporting (guild count, ping, etc.)
 *   - Receiving commands from the coordinator (future)
 *
 * No web dashboard, no OAuth, no public pages — just API endpoints.
 */
const express = require('express');

/**
 * Create and start a minimal Express server for a worker shard.
 * @param {import('discord.js').Client} client — The shard's Discord client
 * @param {number} shardId
 * @param {number} shardCount
 * @param {number} [port] — Defaults to 3000 + shardId
 * @returns {Promise<import('http').Server>}
 */
async function startWorkerServer(client, shardId, shardCount, port) {
  port = port || (3000 + shardId);

  const app = express();
  app.use(express.json());

  // ── Health Check ──────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      shardId,
      shardCount,
      bot: client.isReady() ? 'connected' : 'disconnected',
      botTag: client.user?.tag || null,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────
  app.get('/api/stats', (_req, res) => {
    const guilds = [...(client.guilds?.cache?.values() || [])];
    const totalUsers = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0);
    res.json({
      shardId,
      shardCount,
      guildCount: guilds.length,
      userCount: totalUsers,
      ping: client.ws?.ping || 0,
      botTag: client.user?.tag || null,
      botId: client.user?.id || null,
      uptime: process.uptime(),
    });
  });

  // ── Find Guild ────────────────────────────────────────────────────
  app.get('/api/guild/:guildId', (req, res) => {
    const guild = client.guilds?.cache?.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found on this shard' });
    res.json({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      memberCount: guild.memberCount,
      ownerId: guild.ownerId,
    });
  });

  // ── Guild Channels ────────────────────────────────────────────────
  app.get('/api/channels/:guildId', async (req, res) => {
    const guild = client.guilds?.cache?.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found on this shard' });
    try {
      const channels = await guild.channels.fetch();
      const result = [...channels.values()].map(ch => ({
        id: ch.id, name: ch.name, type: ch.type,
        isTextBased: ch.isTextBased?.() || false,
        isThread: ch.isThread?.() || false,
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Find User ─────────────────────────────────────────────────────
  app.get('/api/user/:userId', async (req, res) => {
    const user = client.users?.cache?.get(req.params.userId);
    if (user) {
      return res.json({ id: user.id, username: user.username, tag: user.tag });
    }
    // Try fetching from API
    try {
      const fetched = await client.users.fetch(req.params.userId);
      return res.json({ id: fetched.id, username: fetched.username, tag: fetched.tag });
    } catch {
      return res.status(404).json({ error: 'User not found' });
    }
  });

  // ── Send Panel ────────────────────────────────────────────────────
  // Receives a panel spawn request forwarded from the coordinator
  app.post('/api/action/send-panel', async (req, res) => {
    const { channelId, panelId } = req.body;
    if (!channelId || !panelId) {
      return res.status(400).json({ error: 'Missing channelId or panelId' });
    }

    try {
      const channel = client.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Channel not found or not a text channel' });
      }

      const { ticketsCore } = require('./tickets');
      const panel = ticketsCore.getPanel(panelId);
      if (!panel) return res.status(404).json({ error: `Panel "${panelId}" not found` });

      const guild = channel.guild;
      const embed = ticketsCore.buildPanelEmbed(panel, guild);
      const components = ticketsCore.buildPanelComponents(panel);

      const sent = await channel.send({
        embeds: embed ? [embed] : [],
        components,
      });

      res.json({ ok: true, messageId: sent.id, channelId: sent.channelId });
    } catch (err) {
      res.status(500).json({ error: `Failed to send panel: ${err.message}` });
    }
  });

  // ── Shutdown Hook ────────────────────────────────────────────────
  app.post('/api/shutdown', (_req, res) => {
    res.json({ ok: true, message: 'Shutting down...' });
    // Give the response time to send before the process exits
    setTimeout(() => {
      process.emit('SIGTERM');
    }, 500);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[Shard ${shardId}] Worker server listening on port ${port}`);
      resolve(server);
    });
    server.on('error', (err) => {
      console.error(`[Shard ${shardId}] Failed to start worker server on port ${port}:`, err.message);
      reject(err);
    });
  });
}

module.exports = { startWorkerServer };
