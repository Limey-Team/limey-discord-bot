const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');

const BOTS_FILE = path.join(__dirname, '..', 'database', 'bots.json');
const { registerCommands } = require('./commands');

// Prevent log injection by removing line breaks/control line separators.
function sanitizeForLog(value) {
  return String(value).replace(/[\r\n\u2028\u2029]/g, '');
}

// ─── Data Store ───────────────────────────────────────────────────────────
let botsData = [];

function loadBotsData() {
  try {
    if (fs.existsSync(BOTS_FILE)) {
      botsData = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[BotManager] Failed to load bots data:', err.message);
    botsData = [];
  }
  return botsData;
}

function saveBotsData() {
  try {
    // Strip tokens from the saved data — never write tokens to disk!
    const safe = botsData.map(b => ({
      guildId: b.guildId,
      name: b.name || 'Custom Bot',
      enabled: b.enabled !== false,
      status: b.status || 'stopped',
      createdAt: b.createdAt,
      clientId: b.clientId || null,
    }));
    fs.writeFileSync(BOTS_FILE, JSON.stringify(safe, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[BotManager] Failed to save bots data:', err.message);
    return false;
  }
}

// ─── Token Storage ────────────────────────────────────────────────────────
// Tokens are stored in memory only, populated from .env-style approach
// or via the dashboard API (which stores them in process memory)
const tokens = new Map(); // guildId → token

function setToken(guildId, token) {
  tokens.set(guildId, token);
}

function getToken(guildId) {
  return tokens.get(guildId) || null;
}

function removeToken(guildId) {
  tokens.delete(guildId);
}

// ─── Client Management ────────────────────────────────────────────────────
const clients = new Map(); // guildId → discord.Client

async function createClient(guildId, token) {
  if (clients.has(guildId)) {
    return { error: 'A bot is already running for this server. Stop it first.' };
  }

  // Validate token by trying to identify the bot
  let clientId;
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    const clientUser = await rest.get(Routes.user());
    clientId = clientUser.id;
  } catch (err) {
    return { error: `Invalid token: ${err.message}` };
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildEmojisAndStickers,
      GatewayIntentBits.GuildWebhooks,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
    ],
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      client.destroy();
      resolve({ error: 'Bot login timed out. Check your token and try again.' });
    }, 15000);

    client.once('ready', async () => {
      clearTimeout(timeout);
      console.log(
        `[BotManager] Custom bot logged in as ${sanitizeForLog(client.user.tag)} for guild ${sanitizeForLog(guildId)}`
      );

      // Store in memory
      setToken(guildId, token);
      clients.set(guildId, client);

      // Update data store
      const entry = botsData.find(b => b.guildId === guildId);
      if (entry) {
        entry.enabled = true;
        entry.status = 'running';
        entry.clientId = clientId;
        entry.name = client.user.tag;
      } else {
        botsData.push({
          guildId,
          name: client.user.tag,
          enabled: true,
          status: 'running',
          createdAt: Date.now(),
          clientId,
        });
      }
      saveBotsData();

      // Register slash commands for this guild
      await registerCommands(client);

      resolve({ success: true, clientId, tag: client.user.tag });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[BotManager] Custom bot error for guild %s:', sanitizeForLog(guildId), err.message);
      resolve({ error: err.message });
    });

    client.login(token).catch((err) => {
      clearTimeout(timeout);
      resolve({ error: err.message });
    });
  });
}

async function destroyClient(guildId) {
  const client = clients.get(guildId);
  if (!client) {
    return { error: 'No bot running for this server.' };
  }

  try {
    client.destroy();
  } catch (err) {
    console.error(
      '[BotManager] Error destroying client for guild %s: %s',
      sanitizeForLog(guildId),
      sanitizeForLog(err.message),
    );
  }

  clients.delete(guildId);
  removeToken(guildId);

  const entry = botsData.find(b => b.guildId === guildId);
  if (entry) {
    entry.enabled = false;
    entry.status = 'stopped';
  }
  saveBotsData();

  console.log(`[BotManager] Custom bot for guild ${guildId} stopped`);
  return { success: true };
}

function getClient(guildId) {
  return clients.get(guildId) || null;
}

function getAllClients() {
  const result = {};
  for (const [guildId, client] of clients) {
    result[guildId] = {
      tag: client.user?.tag || 'Unknown',
      id: client.user?.id || 'Unknown',
      ping: client.ws?.ping || 0,
    };
  }
  return result;
}

// ─── Start All Saved Bots ─────────────────────────────────────────────────
async function startAllSavedBots() {
  loadBotsData();
  let started = 0;
  let failed = 0;

  for (const bot of botsData) {
    if (!bot.enabled) continue;

    // Token should be set externally (e.g., via process.env or dashboard)
    const token = getToken(bot.guildId);
    if (!token) {
      console.log('[BotManager] No token available for guild %s — skipping', sanitizeForLog(bot.guildId));
      bot.status = 'no-token';
      failed++;
      continue;
    }

    const result = await createClient(bot.guildId, token);
    if (result.success) {
      started++;
    } else {
      console.error('[BotManager] Failed to start bot for guild %s:', sanitizeForLog(bot.guildId), result.error);
      bot.status = 'error';
      failed++;
    }
  }

  saveBotsData();

  if (started > 0 || failed > 0) {
    console.log(`[BotManager] Started ${started} custom bot(s), ${failed} failed`);
  }

  return { started, failed };
}

// ─── Load tokens from .env style config ──────────────────────────────────
// This allows admins to pre-configure custom bot tokens via environment variables
// Format: BOT_TOKEN_GUILDID=token (where guildid is the Discord guild ID)
function loadTokensFromEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('BOT_TOKEN_')) {
      const guildId = key.replace('BOT_TOKEN_', '');
      const token = process.env[key];
      if (guildId && token) {
        setToken(guildId, token);
        console.log(`[BotManager] Loaded token for guild ${guildId} from env`);
      }
    }
  }
}

module.exports = {
  loadBotsData,
  saveBotsData,
  getBotsData: () => botsData,
  setToken,
  getToken,
  removeToken,
  createClient,
  destroyClient,
  getClient,
  getAllClients,
  startAllSavedBots,
  loadTokensFromEnv,
};
