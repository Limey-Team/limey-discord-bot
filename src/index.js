/**
 * Limey — main entry point.
 *
 * Architecture:
 *   src/index.js          → ShardingManager (manager process)
 *   src/shard-entry.js    → Worker that each shard process runs
 *
 * The manager process:
 *   - Spawns shard processes via discord.js ShardingManager
 *   - Runs the Express web server (uses broadcastEval to query shards)
 *   - Manages custom bot tokens (botManager — independent Client instances)
 *   - Handles git-sync and auto-update
 *   - Runs the backup system
 */
require('dotenv').config();
const { ShardingManager } = require('discord.js');

// Init git-sync BEFORE anything that loads config files
const gitSync = require('./git-sync');
gitSync.init();

const announce = require('./announce');
const release = require('./release');
const { startWebServer } = require('./web/server');
const botManager = require('./botManager');
const backupSystem = require('./backup');
const votes = require('./votes');
const dblApi = require('./dblApi');
const { ShardClient } = require('./shard-client');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set in .env file');
  process.exit(1);
}

// Determine shard count (auto = discord.js decides based on guild count)
const totalShards = process.env.SHARD_COUNT || 'auto';

const manager = new ShardingManager('./src/shard-entry.js', {
  token,
  totalShards,
  respawn: true,
});

manager.on('shardCreate', (shard) => {
  console.log(`[ShardManager] Launched shard ${shard.id} (PID: ${shard.process?.pid || '?'})`);
});

// ── Bootstrap after all shards are ready ──────────────────────────────
(async () => {
  try {
    // Spawn all shards (timeout = -1 means wait forever)
    await manager.spawn({ timeout: -1 });
    console.log('[ShardManager] All shards are ready');

    // Create a shard client proxy for the web server
    const shardClient = new ShardClient(manager);
    await shardClient.refresh();
    shardClient.markReady(true);

    // Start subsystems that run in the manager process
    votes.init();
    botManager.loadTokensFromEnv();
    botManager.startAllSavedBots();

    // Start the web dashboard (pass the shard proxy instead of a raw client)
    startWebServer(manager, shardClient);

    // Check for updates and send announcement to support server
    announce.init(manager).catch(err =>
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
      // Post stats immediately on startup
      postDblStats(manager).catch(err =>
        console.error('[DBL API] Initial stats post failed:', err.message)
      );

      // Then every hour
      setInterval(async () => {
        await postDblStats(manager).catch(err =>
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

    console.log('[ShardManager] All systems ready');
  } catch (err) {
    console.error('[ShardManager] Failed to start:', err.message);
    process.exit(1);
  }
})();

/**
 * Collect stats from all shards and post them to Discord Bot List.
 */
async function postDblStats(manager) {
  const results = await manager.broadcastEval((c) => {
    const guilds = [...c.guilds.cache.values()];
    const totalUsers = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0);
    return {
      botId: c.user?.id || null,
      guildCount: guilds.length,
      userCount: totalUsers,
      shardId: c.shard?.id ?? 0,
    };
  });

  if (!results || results.length === 0) {
    console.warn('[DBL API] No shard data collected');
    return;
  }

  // Merge stats from all shards
  let botId = null;
  let totalGuilds = 0;
  let totalUsers = 0;
  for (const r of results) {
    if (r.botId) botId = botId || r.botId;
    totalGuilds += r.guildCount || 0;
    totalUsers += r.userCount || 0;
  }

  if (!botId) {
    console.warn('[DBL API] Could not determine bot ID');
    return;
  }

  await dblApi.postStats(botId, {
    guilds: totalGuilds,
    users: totalUsers,
    shard_id: 0,
    shard_count: results.length,
  });
}

// Graceful shutdown — forward SIGTERM/SIGINT to all shards
async function shutdown() {
  console.log('[ShardManager] Shutting down all shards...');
  try {
    await manager.broadcastEval((c) => {
      c.destroy();
    });
  } catch (_) {
    // Shards may already be shutting down
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
