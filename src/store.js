const fs = require('fs');
const path = require('path');
const gitSync = require('./git-sync');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const WARNINGS_FILE = path.join(__dirname, '..', 'warnings.json');

let config = Object.create(null);
let warnings = Object.create(null); // { [guildId]: { [userId]: [{ reason, moderator, timestamp }] } }

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = Object.assign(Object.create(null), parsedConfig && typeof parsedConfig === 'object' ? parsedConfig : {});
    }
    if (fs.existsSync(WARNINGS_FILE)) {
      const parsedWarnings = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
      warnings = Object.assign(Object.create(null), parsedWarnings && typeof parsedWarnings === 'object' ? parsedWarnings : {});
    }
  } catch (err) {
    console.error('[Store] Failed to load:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[Store] Failed to save config to disk:', err.message);
  }
  gitSync.scheduleSync();
}

function saveWarnings() {
  try {
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2));
  } catch (err) {
    console.error('[Store] Failed to save warnings to disk:', err.message);
  }
  gitSync.scheduleSync();
}

// --- Guild config ---

function getGuildConfig(guildId) {
  if (!config[guildId]) config[guildId] = { logChannel: null };
  return config[guildId];
}

function setLogChannel(guildId, channelId) {
  if (!config[guildId]) config[guildId] = { logChannel: null };
  config[guildId].logChannel = channelId;
  saveConfig();
}

function getLogChannel(guildId) {
  return config[guildId]?.logChannel || null;
}

// --- Verification ---

function setVerifyRole(guildId, roleId) {
  if (!config[guildId]) config[guildId] = { logChannel: null };
  config[guildId].verifyRole = roleId;
  saveConfig();
}

function getVerifyRole(guildId) {
  return config[guildId]?.verifyRole || null;
}

function setVerifyChannel(guildId, channelId) {
  if (!config[guildId]) config[guildId] = { logChannel: null };
  config[guildId].verifyChannel = channelId;
  saveConfig();
}

function getVerifyChannel(guildId) {
  return config[guildId]?.verifyChannel || null;
}

// --- Limey ---

function setLimeyConfig(guildId, opts) {
  if (!config[guildId]) config[guildId] = { logChannel: null };
  config[guildId].limey = {
    channelId: opts.channelId,
    action: opts.action || 'softban', // 'softban' | 'ban'
    timeoutFirst: !!opts.timeoutFirst,
    chaosMode: !!opts.chaosMode,
    warmerEnabled: !!opts.warmerEnabled,
    catchCount: config[guildId].limey?.catchCount || 0,
    caughtUsers: config[guildId].limey?.caughtUsers || [],
  };
  saveConfig();
}

function getLimeyConfig(guildId) {
  return config[guildId]?.limey || null;
}

function disableLimey(guildId) {
  if (config[guildId]) {
    delete config[guildId].limey;
    saveConfig();
  }
}

function addLimeyCatch(guildId, userId) {
  if (!config[guildId]?.limey) return;
  config[guildId].limey.catchCount = (config[guildId].limey.catchCount || 0) + 1;
  if (!config[guildId].limey.caughtUsers) config[guildId].limey.caughtUsers = [];
  if (!config[guildId].limey.caughtUsers.includes(userId)) {
    config[guildId].limey.caughtUsers.push(userId);
  }
  saveConfig();
}

function isLimeyCaught(guildId, userId) {
  return config[guildId]?.limey?.caughtUsers?.includes(userId) || false;
}

// --- Warnings ---

function addWarning(guildId, userId, reason, moderator) {
  if (!warnings[guildId]) warnings[guildId] = {};
  if (!warnings[guildId][userId]) warnings[guildId][userId] = [];
  warnings[guildId][userId].push({
    reason,
    moderator,
    timestamp: new Date().toISOString(),
  });
  saveWarnings();
}

function getWarnings(guildId, userId) {
  return warnings[guildId]?.[userId] || [];
}

function clearWarnings(guildId, userId) {
  if (warnings[guildId]) {
    delete warnings[guildId][userId];
    saveWarnings();
  }
}

// ─── Event Log Filtering ────────────────────────────────────────────────

// Canonical list of all loggable Discord events with their display categories
const ALL_LOG_EVENTS = [
  // Bot core
  'clientReady', 'error', 'warn', 'rateLimit', 'invalidated',
  'shardDisconnect', 'shardError', 'shardReady',
  // Guild
  'guildCreate', 'guildDelete', 'guildUpdate', 'guildAvailable', 'guildUnavailable',
  'guildAuditLogEntryCreate', 'guildIntegrationsUpdate',
  // Channel
  'channelCreate', 'channelDelete', 'channelUpdate', 'channelPinsUpdate',
  // Messages
  'messageCreate', 'messageDelete', 'messageDeleteBulk', 'messageUpdate',
  'messageReactionAdd', 'messageReactionRemove', 'messageReactionRemoveAll', 'messageReactionRemoveEmoji',
  // Voice
  'voiceStateUpdate', 'voiceServerUpdate',
  // Members
  'guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildMemberAvailable', 'guildMembersChunk',
  'presenceUpdate',
  // Roles
  'roleCreate', 'roleDelete', 'roleUpdate',
  // Emoji / Stickers
  'emojiCreate', 'emojiDelete', 'emojiUpdate',
  'stickerCreate', 'stickerDelete', 'stickerUpdate',
  // Threads
  'threadCreate', 'threadDelete', 'threadUpdate', 'threadListSync', 'threadMembersUpdate', 'threadMemberUpdate',
  // Stage
  'stageInstanceCreate', 'stageInstanceDelete', 'stageInstanceUpdate',
  // Invites
  'inviteCreate', 'inviteDelete',
  // Auto-mod
  'autoModerationRuleCreate', 'autoModerationRuleDelete', 'autoModerationRuleUpdate', 'autoModerationActionExecution',
  // Scheduled events
  'guildScheduledEventCreate', 'guildScheduledEventDelete', 'guildScheduledEventUpdate',
  'guildScheduledEventUserAdd', 'guildScheduledEventUserRemove',
  // Other
  'webhooksUpdate',
  'entitlementCreate', 'entitlementDelete', 'entitlementUpdate',
  // Mod actions (logged separately but displayed in log channel)
  'memberBan', 'memberUnban', 'memberKick', 'memberTimeout', 'memberUntimeout',
  'memberWarn', 'memberClearWarnings',
  'memberVerify', 'verifySetup',
  'channelLock', 'channelUnlock', 'channelSlowmode',
  'messagePurge',
  'limeySetup', 'limeyDisable', 'limeyCatch', 'limeyTimeoutReapply',
];

const EVENT_GROUPS = [
  { name: 'Bot Core', key: 'bot', events: ['clientReady', 'error', 'warn', 'rateLimit', 'invalidated', 'shardDisconnect', 'shardError', 'shardReady'] },
  { name: 'Guild', key: 'guild', events: ['guildCreate', 'guildDelete', 'guildUpdate', 'guildAvailable', 'guildUnavailable', 'guildAuditLogEntryCreate', 'guildIntegrationsUpdate'] },
  { name: 'Channels', key: 'channel', events: ['channelCreate', 'channelDelete', 'channelUpdate', 'channelPinsUpdate'] },
  { name: 'Messages', key: 'message', events: ['messageCreate', 'messageDelete', 'messageDeleteBulk', 'messageUpdate', 'messageReactionAdd', 'messageReactionRemove', 'messageReactionRemoveAll', 'messageReactionRemoveEmoji'] },
  { name: 'Voice', key: 'voice', events: ['voiceStateUpdate', 'voiceServerUpdate'] },
  { name: 'Members', key: 'member', events: ['guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildMemberAvailable', 'guildMembersChunk', 'presenceUpdate'] },
  { name: 'Roles', key: 'role', events: ['roleCreate', 'roleDelete', 'roleUpdate'] },
  { name: 'Emoji / Stickers', key: 'emoji', events: ['emojiCreate', 'emojiDelete', 'emojiUpdate', 'stickerCreate', 'stickerDelete', 'stickerUpdate'] },
  { name: 'Threads', key: 'thread', events: ['threadCreate', 'threadDelete', 'threadUpdate', 'threadListSync', 'threadMembersUpdate', 'threadMemberUpdate'] },
  { name: 'Stage', key: 'stage', events: ['stageInstanceCreate', 'stageInstanceDelete', 'stageInstanceUpdate'] },
  { name: 'Invites', key: 'invite', events: ['inviteCreate', 'inviteDelete'] },
  { name: 'Auto-mod', key: 'automod', events: ['autoModerationRuleCreate', 'autoModerationRuleDelete', 'autoModerationRuleUpdate', 'autoModerationActionExecution'] },
  { name: 'Scheduled Events', key: 'scheduled', events: ['guildScheduledEventCreate', 'guildScheduledEventDelete', 'guildScheduledEventUpdate', 'guildScheduledEventUserAdd', 'guildScheduledEventUserRemove'] },
  { name: 'Other', key: 'other', events: ['webhooksUpdate', 'entitlementCreate', 'entitlementDelete', 'entitlementUpdate'] },
  { name: 'Mod Actions', key: 'mod', events: ['memberBan', 'memberUnban', 'memberKick', 'memberTimeout', 'memberUntimeout', 'memberWarn', 'memberClearWarnings', 'memberVerify', 'verifySetup', 'channelLock', 'channelUnlock', 'channelSlowmode', 'messagePurge', 'limeySetup', 'limeyDisable', 'limeyCatch', 'limeyTimeoutReapply'] },
];

/** Build a default event config object (all enabled) */
function defaultEventConfig() {
  const cfg = {};
  for (const evt of ALL_LOG_EVENTS) {
    cfg[evt] = true;
  }
  return cfg;
}

/** Get the event filter config for a guild (auto-initialises with all enabled) */
function getEventConfig(guildId) {
  if (!config[guildId]) config[guildId] = { logChannel: null };
  if (!config[guildId].events) {
    config[guildId].events = defaultEventConfig();
    // Don't save here — let the first explicit mutation trigger save
  }
  return config[guildId].events;
}

/** Check if a specific event should be logged to the Discord log channel */
function isEventEnabled(guildId, eventName) {
  const evtCfg = config[guildId]?.events;
  if (!evtCfg) return true; // No config = default all enabled
  // If the event isn't in the config at all, default to enabled
  return evtCfg[eventName] !== false;
}

/** Toggle a single event on or off for a guild */
function setEventEnabled(guildId, eventName, enabled) {
  getEventConfig(guildId); // ensure initialised
  config[guildId].events[eventName] = enabled;
  saveConfig();
}

/** Enable or disable ALL events for a guild */
function setAllEvents(guildId, enabled) {
  const evtCfg = getEventConfig(guildId);
  for (const evt of ALL_LOG_EVENTS) {
    evtCfg[evt] = enabled;
  }
  saveConfig();
}

/** Reset all events to default (all enabled) */
function resetEventConfig(guildId) {
  config[guildId].events = defaultEventConfig();
  saveConfig();
}

/** Get a summary of enabled/disabled counts per group */
function getEventSummary(guildId) {
  const evtCfg = config[guildId]?.events || {};
  return EVENT_GROUPS.map(group => ({
    name: group.name,
    key: group.key,
    total: group.events.length,
    enabled: group.events.filter(e => evtCfg[e] !== false).length,
  }));
}

/** Check if an event name is valid (exists in our list) */
function isValidEvent(eventName) {
  return ALL_LOG_EVENTS.includes(eventName);
}

/** Get all event names for autocomplete */
function getAllEventNames() {
  return ALL_LOG_EVENTS;
}

load();

module.exports = {
  getGuildConfig, setLogChannel, getLogChannel,
  setVerifyRole, getVerifyRole, setVerifyChannel, getVerifyChannel,
  setLimeyConfig, getLimeyConfig, disableLimey, addLimeyCatch, isLimeyCaught,
  addWarning, getWarnings, clearWarnings,
  // Event filtering
  getEventConfig, isEventEnabled, setEventEnabled, setAllEvents,
  resetEventConfig, getEventSummary, isValidEvent, getAllEventNames,
  EVENT_GROUPS,
};
