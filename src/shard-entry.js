/**
 * Shard entry point — each shard process runs this file.
 * The ShardingManager (in index.js) spawns one or more of these.
 */
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Capture shard info passed by the manager via env
const SHARD_ID = parseInt(process.env.SHARD_ID || '0', 10);
const SHARD_COUNT = parseInt(process.env.SHARD_COUNT || '1', 10);

const setupBot = require('./bot');
const captchaGen = require('./captcha');
const { initTicketSystem } = require('./tickets');
const { initModmail } = require('./modmail');
const { registerCommands } = require('./commands');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error(`[Shard ${SHARD_ID}] ❌ DISCORD_TOKEN is not set`);
  process.exit(1);
}

const client = new Client({
  shards: [SHARD_ID],
  shardCount: SHARD_COUNT,
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

// Setup all bot subsystems on this shard's client
setupBot(client);
initTicketSystem(client);
initModmail(client);
captchaGen.initCaptcha().catch(err =>
  console.error(`[Shard ${SHARD_ID}] [Captcha] Font init failed:`, err.message)
);

(async () => {
  try {
    await client.login(token);
    console.log(`[Shard ${SHARD_ID}] Logged in as ${client.user.tag}`);

    // Register commands once the client is fully ready
    client.once('clientReady', async () => {
      await registerCommands(client);
    });
  } catch (err) {
    console.error(`[Shard ${SHARD_ID}] Failed to start:`, err.message);
    process.exit(1);
  }
})();

// Graceful shutdown
function shutdown() {
  console.log(`[Shard ${SHARD_ID}] Shutting down...`);
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
