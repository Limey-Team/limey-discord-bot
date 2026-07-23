/**
 * Limey — main entry point (Main Server).
 *
 * Architecture:
 *   src/index.js          → Main server (shard 0 + web dashboard + coordinator)
 *   src/worker.js         → Worker shard server (only Discord shard, no dashboard)
 *
 * The main server:
 *   - Creates a Discord bot Client for shard 0
 *   - Runs the Express web server (dashboard + coordinator API)
 *   - Manages custom bot tokens (botManager — independent Client instances)
 *   - Hosts the Shard Coordinator — worker shards register here
 *   - Handles git-sync and auto-update
 *   - Runs the backup system
 */
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const gitSync = require('./git-sync');


const announce = require('./announce');
const release = require('./release');
const { startWebServer } = require('./web/server');
const botManager = require('./botManager');
const backupSystem = require('./backup');
const votes = require('./votes');
const dblApi = require('./dblApi');
const { ShardClient } = require('./shard-client');
const coordinator = require('./shard-coordinator');

const setupBot = require('./bot');
const captchaGen = require('./captcha');
const { initTicketSystem } = require('./tickets');
const { initModmail } = require('./modmail');
const { registerCommands } = require('./commands');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set in .env file');
  process.exit(1);
}

// ─── Shard Configuration ──────────────────────────────────────────────
// Total shard count must be fixed at startup. Shard 0 runs locally,
// shards 1..N-1 are handled by remote worker servers.
const totalShards = parseInt(process.env.SHARD_COUNT, 10) || 2;

// Initialize the coordinator with the fixed shard count
coordinator.init(totalShards);

console.log(`[Main] Starting with ${totalShards} shards (shard 0 local, ${totalShards - 1} worker slots)`);

// ─── Create Shard 0 Client ───────────────────────────────────────────
const client = new Client({
  shards: [0],
  shardCount: totalShards,
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

// Register the local client with the coordinator
coordinator.setLocalClient(client);

// Setup all bot subsystems on shard 0's client
setupBot(client);
initTicketSystem(client);
initModmail(client);
captchaGen.initCaptcha().catch(err =>
  console.error('[Shard 0] [Captcha] Font init failed:', err.message)
);

// ── Create ShardClient & Start Web Server Early ──────────────────
// Start the Express server before client.login() so Render detects the port
// immediately. The health endpoint returns bot: 'disconnected' until login.
const shardClient = new ShardClient(client, coordinator);
// startWebServer returns the Express app (not a Promise) — app.listen() is non-blocking.
// The server starts listening immediately so Render detects the port.
startWebServer(client, shardClient, coordinator);

// Init git-sync AFTER the web server starts so Render detects the port immediately.
// The sync pulls latest config from GitHub; any delay here won't block the health check.
gitSync.init();

// ── Bootstrap ─────────────────────────────────────────────────────────
(async () => {
  try {
    // Login shard 0
    await client.login(token);
    console.log(`[Shard 0] Logged in as ${client.user.tag}`);

    // Refresh shard client cache now that the bot is logged in
    await shardClient.refresh();
    shardClient.markReady(true);

    // Register commands once ready
    client.once('clientReady', async () => {
      await registerCommands(client);
    });

    if (client.isReady()) {
      registerCommands(client).catch(err =>
        console.error('[Shard 0] Failed to register commands (fallback):', err.message)
      );
    }

    // Start subsystems that run in the main process
    votes.init();
    botManager.loadTokensFromEnv();
    botManager.startAllSavedBots();

    // Check for updates and send announcement to support server
    announce.init(client).catch(err =>
      console.error('[Announce] Error during init:', err.message)
    );

    // Check for version changes and auto-create GitHub Release
    release.init().catch(err =>
      console.error('[Release] Error during init:', err.message)
    );

    // Start watching for new git commits to auto-update
    gitSync.startAutoUpdate();

    // ─── Discord Bot List (DBL) API stats posting ─────────────────────
    if (dblApi.isConfigured()) {
      postDblStats(client, coordinator).catch(err =>
        console.error('[DBL API] Initial stats post failed:', err.message)
      );
      setInterval(async () => {
        await postDblStats(client, coordinator).catch(err =>
          console.error('[DBL API] Periodic stats post failed:', err.message)
        );
      }, 60 * 60 * 1000);
      console.log('[DBL API] Discord Bot List integration enabled (stats every hour)');
    } else {
      console.log('[DBL API] Not configured — set DBL_API_TOKEN to enable');
    }

    // Periodically refresh the shard client's cache for the web server
    setInterval(() => {
      shardClient.refresh().catch(err =>
        console.error('[ShardManager] Cache refresh error:', err.message)
      );
    }, 30_000);

    // Log coordinator status
    const shardList = coordinator.getAllShards();
    console.log(`[Main] ✅ All systems ready — ${shardList.length}/${totalShards} shards online`);

  } catch (err) {
    console.error('[Main] Failed to start:', err.message);
    process.exit(1);
  }
})();

/**
 * Collect stats from all shards and post them to Discord Bot List.
 */
async function postDblStats(localClient, coord) {
  const stats = coord.getAggregatedStats();
  const localInfo = coord.getLocalShardInfo();

  const botId = localClient.user?.id || null;
  if (!botId) {
    console.warn('[DBL API] Could not determine bot ID');
    return;
  }

  await dblApi.postStats(botId, {
    guilds: stats.guildCount,
    users: stats.userCount,
    shard_id: 0,
    shard_count: stats.shardCount,
  });
}

// Graceful shutdown
async function shutdown() {
  console.log('[Main] Shutting down...');
  try {
    await client.destroy();
  } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
