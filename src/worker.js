/**
 * Worker Shard Entry Point — for distributed shard servers.
 *
 * This is the entry point for non-main shard servers. These machines
 * ONLY run a Discord shard + a minimal HTTP server — no web dashboard.
 *
 * Flow:
 *   1. Register with the main coordinator to get assigned a shard ID
 *   2. Create a Discord.js Client for that shard
 *   3. Start the minimal HTTP server (health/stats)
 *   4. Periodically send heartbeats to the coordinator
 *   5. On shutdown, unregister from the coordinator
 */
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const { startWorkerServer } = require('./shard-worker-server');
const setupBot = require('./bot');
const captchaGen = require('./captcha');
const { initTicketSystem } = require('./tickets');
const { initModmail } = require('./modmail');
const { registerCommands } = require('./commands');

// ── Configuration ─────────────────────────────────────────────────────
const COORDINATOR_URL = (process.env.COORDINATOR_URL || '')
  .replace(/(https?:\/\/)+/i, '$1') // strip duplicate protocol prefixes
  .replace(/\/+$/, ''); // strip trailing slashes
const MASTER_API_KEY = process.env.MASTER_API_KEY || '';
const WORKER_PORT = parseInt(process.env.WORKER_PORT, 10) || 0; // 0 = auto (3000 + shardId)
const HEARTBEAT_INTERVAL = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL, 10) || 30_000; // 30s

if (!COORDINATOR_URL) {
  console.error('[Worker] ❌ COORDINATOR_URL is not set. Point this to the main server URL.');
  console.error('[Worker] ❌ Example: COORDINATOR_URL=https://limey-discord-bot.onrender.com');
  process.exit(1);
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[Worker] ❌ DISCORD_TOKEN is not set');
  process.exit(1);
}

let assignedShardId = -1;
let assignedShardCount = 1;
let client = null;
let heartbeatInterval = null;
let workerServer = null;

// ── Coordinator Communication ─────────────────────────────────────────

async function registerWithCoordinator() {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    console.warn('[Worker] ⚠️ WORKER_URL not set — coordinator will not know how to reach this shard directly');
  }

  console.log(`[Worker] Registering with coordinator at ${COORDINATOR_URL}...`);

  const res = await fetch(`${COORDINATOR_URL}/api/shard/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: workerUrl || `${COORDINATOR_URL}/worker/${process.pid}`,
      authKey: MASTER_API_KEY,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Coordinator rejected registration: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  assignedShardId = data.shardId;
  assignedShardCount = data.totalShards;

  console.log(`[Worker] ✅ Assigned shard ID ${assignedShardId} (total: ${assignedShardCount})`);
}

async function sendHeartbeat() {
  if (!client || assignedShardId < 0) return;

  const guilds = [...(client.guilds?.cache?.values() || [])];
  const totalUsers = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0);
  const guildIds = guilds.map(g => g.id);

  try {
    const res = await fetch(`${COORDINATOR_URL}/api/shard/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shardId: assignedShardId,
        authKey: MASTER_API_KEY,
        guildCount: guilds.length,
        userCount: totalUsers,
        ping: client.ws?.ping || 0,
        botTag: client.user?.tag || null,
        guildIds,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.warn(`[Shard ${assignedShardId}] Heartbeat failed: ${err.error || res.statusText}`);
    } else {
      const data = await res.json();
      // Update shard count in case the coordinator changed it
      if (data.totalShards && data.totalShards !== assignedShardCount) {
        assignedShardCount = data.totalShards;
        console.log(`[Shard ${assignedShardId}] Shard count updated to ${assignedShardCount}`);
      }
    }
  } catch (err) {
    console.warn(`[Shard ${assignedShardId}] Heartbeat error: ${err.message}`);
  }
}

async function unregisterFromCoordinator() {
  if (assignedShardId < 0) return;

  try {
    await fetch(`${COORDINATOR_URL}/api/shard/${assignedShardId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authKey: MASTER_API_KEY }),
    });
    console.log(`[Worker] Unregistered shard ${assignedShardId} from coordinator`);
  } catch (err) {
    console.warn(`[Worker] Failed to unregister: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

(async () => {
  try {
    // Step 1: Register with the coordinator
    await registerWithCoordinator();

    // Step 2: Create the Discord client for this shard
    client = new Client({
      shards: [assignedShardId],
      shardCount: assignedShardCount,
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

    // Step 3: Setup all bot subsystems
    setupBot(client);
    initTicketSystem(client);
    initModmail(client);
    captchaGen.initCaptcha().catch(err =>
      console.error(`[Shard ${assignedShardId}] [Captcha] Font init failed:`, err.message)
    );

    // Step 4: Login
    await client.login(token);
    console.log(`[Shard ${assignedShardId}] Logged in as ${client.user.tag}`);

    // Step 5: Register commands once ready
    client.once('clientReady', async () => {
      await registerCommands(client);
    });

    if (client.isReady()) {
      registerCommands(client).catch(err =>
        console.error(`[Shard ${assignedShardId}] Failed to register commands (fallback):`, err.message)
      );
    }

    // Step 6: Start the minimal HTTP server
    try {
      workerServer = await startWorkerServer(client, assignedShardId, assignedShardCount, WORKER_PORT);
    } catch (err) {
      console.warn(`[Shard ${assignedShardId}] Worker server failed to start (non-fatal):`, err.message);
    }

    // Step 7: Start sending heartbeats
    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    console.log(`[Shard ${assignedShardId}] ✅ Worker shard fully operational`);
  } catch (err) {
    console.error('[Worker] Failed to start:', err.message);
    process.exit(1);
  }
})();

// ── Graceful Shutdown ─────────────────────────────────────────────────

async function shutdown() {
  console.log(`[Shard ${assignedShardId}] Shutting down...`);

  if (heartbeatInterval) clearInterval(heartbeatInterval);

  // Unregister from coordinator
  await unregisterFromCoordinator();

  // Destroy the Discord client
  if (client) {
    try {
      await client.destroy();
    } catch (err) {
      if (err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
        console.error(`[Shard ${assignedShardId}] Error during client destroy:`, err.message);
      }
    }
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
