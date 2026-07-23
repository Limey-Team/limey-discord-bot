const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, version: djsVersion } = require('discord.js');
const logger = require('./logger');
const store = require('./store');
const backupSystem = require('./backup');
const announce = require('./announce');
const votes = require('./votes');
const captchaGen = require('./captcha');
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;

const DM_EVENTS = new Set([
  'messageCreate', 'messageUpdate', 'messageDelete',
  'messageReactionAdd', 'messageReactionRemove', 'messageReactionRemoveAll', 'messageReactionRemoveEmoji',
]);

// Limey warmer message pool
const WARMER_MESSAGES = [
  'Just checking in!', 'Another quiet day...', 'Nothing to see here!',
  'All clear!', 'Still awake?', 'Daily check-in!', 'Everything seems normal.',
  'Carry on!', 'Status: operational.', 'The cake is a lie.',
  'Beep boop.', 'System nominal.', '👀', '🤖', '✨',
];

function isDMEvent(eventName, args) {
  if (!DM_EVENTS.has(eventName)) return false;
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const channel = arg.channel || (arg.message?.channel);
    if (channel?.type === 1 || channel?.type === 3) return true;
  }
  return false;
}

function isBotAction(client, args) {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    if (arg.author?.id === client.user.id) return true;
    if (arg.user?.id === client.user.id) return true;
    if (arg.member?.user?.id === client.user.id || arg.member?.id === client.user.id) return true;
    if (arg.id === client.user.id && (arg.member || arg.channel !== undefined)) return true;
  }
  return false;
}

function extractContext(eventName, args) {
  const ctx = { guild: null, channel: null, user: null, guildId: null };
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    if (!ctx.guild && arg.guild && typeof arg.guild === 'object' && arg.guild.id) {
      ctx.guild = arg.guild.name || arg.guild.id;
      ctx.guildId = arg.guild.id;
    }
    if (!ctx.guild && arg.name && arg.memberCount !== undefined) {
      ctx.guild = arg.name;
      ctx.guildId = arg.id;
    }
    if (!ctx.channel && arg.channel && typeof arg.channel === 'object' && arg.channel.id) {
      ctx.channel = '#' + (arg.channel.name || arg.channel.id);
    }
    if (!ctx.channel && arg.name && (arg.type === 0 || arg.type === 2 || arg.type === 4 || arg.type === 5 || arg.type === 13 || arg.type === 15)) {
      ctx.channel = '#' + arg.name;
    }
    if (!ctx.user && arg.user && typeof arg.user === 'object' && arg.user.id) {
      ctx.user = arg.user.tag || arg.user.username || arg.user.id;
    }
    if (!ctx.user && arg.author && typeof arg.author === 'object' && arg.author.id) {
      ctx.user = arg.author.tag || arg.author.username || arg.author.id;
    }
    if (!ctx.user && arg.member && arg.member.user?.id) {
      ctx.user = arg.member.user.tag || arg.member.user.username || arg.member.user.id;
    }
  }
  return ctx;
}

function toEmbed(entry) {
  const embed = new EmbedBuilder()
    .setTitle(entry.event)
    .setColor(0x5865F2)
    .setTimestamp(new Date(entry.timestamp))
    .setFooter({ text: 'Log #' + entry.id });
  if (entry.guild) embed.addFields({ name: 'Guild', value: entry.guild, inline: true });
  if (entry.channel) embed.addFields({ name: 'Channel', value: entry.channel, inline: true });
  if (entry.user) embed.addFields({ name: 'User', value: entry.user, inline: true });
  const dataStr = JSON.stringify(entry.data);
  embed.setDescription(dataStr.length > 1024
    ? '```json\n' + dataStr.substring(0, 1000) + '\n...(truncated)\n```'
    : '```json\n' + dataStr + '\n```');
  return embed;
}

function logModAction(interaction, eventName, target, extra) {
  const guild = interaction.guild;
  logger.log(eventName, {
    guild: guild.name,
    guildId: guild.id,
    channel: '#' + (interaction.channel?.name || 'unknown'),
    user: interaction.user.tag,
    details: {
      moderator: interaction.user.tag,
      moderatorId: interaction.user.id,
      target: target?.tag || target?.username || target?.id || target,
      targetId: target?.id || target,
      ...extra,
    },
  });
}

function formatUptime(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (s || parts.length === 0) parts.push(s + 's');
  return parts.join(' ');
}

const pendingCaptchas = new Map(); // userId -> { guildId, answer, attempts, text? }
const CAPTCHA_TIMEOUT = 120_000; // 2 minutes to answer
const CAPTCHA_MAX_ATTEMPTS = 3;

async function sendPunishmentDM(user, guildName, action, reason, extra) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(action)
      .setColor(action === 'Warned' ? 0xFEE75C : action.includes('Timeout Removed') ? 0x57F287 : action === 'Limey Trap' ? 0xFFA500 : 0xED4245)
      .addFields(
        { name: 'Server', value: guildName, inline: true },
        { name: 'Reason', value: reason, inline: true },
      )
      .setTimestamp();
    if (extra) embed.addFields({ name: 'Details', value: extra });
    await user.send({ embeds: [embed] });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Send an image captcha challenge to the user
 * Step 1: Show captcha image + "Enter Captcha" button
 * Step 2: User clicks button → show modal to type the text
 *
 * NOTE: Defer the reply FIRST to avoid Discord's 3-second interaction timeout
 * while generating the captcha image (Jimp image processing can be slow).
 */
async function sendCaptchaChallenge(interaction, method) {
  // Defer immediately to prevent "This interaction failed" timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const text = captchaGen.generateCaptchaText();

  let imageBuffer;
  try {
    imageBuffer = await captchaGen.generateCaptchaImage(text);
  } catch (err) {
    console.error('[Captcha] Image generation failed:', err.message);
    return interaction.editReply({
      content: '❌ Failed to generate captcha image. Please try again later.',
    });
  }

  pendingCaptchas.set(interaction.user.id, {
    guildId: interaction.guild.id,
    answer: text.toUpperCase(),
    attempts: 0,
    method,
  });

  // Auto-expire after timeout
  setTimeout(() => {
    pendingCaptchas.delete(interaction.user.id);
  }, CAPTCHA_TIMEOUT);

  const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });

  const embed = new EmbedBuilder()
    .setTitle('🔐 Verification Challenge')
    .setColor(0x5865F2)
    .setDescription([
      'Please solve the captcha below to verify you are human.',
      '',
      '**Type the characters you see in the image.**',
      '',
      `You have **${CAPTCHA_MAX_ATTEMPTS} attempts** and **2 minutes**.`,
    ].join('\n'))
    .setImage('attachment://captcha.png')
    .setFooter({ text: 'Limey Verification System' })
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('enter_captcha_' + interaction.user.id)
        .setLabel('✏️ Enter Captcha')
        .setStyle(ButtonStyle.Primary)
    );

  await interaction.editReply({
    embeds: [embed],
    components: [row],
    files: [attachment],
  });
}

/** Build an embed/button row to prompt user-install for DM notifications */
function getDMInstallComponents(discordClientId) {
  const installUrl = `https://discord.com/oauth2/authorize?client_id=${discordClientId}&integration_type=1&scope=applications.commands`;
  const embed = new EmbedBuilder()
    .setTitle('📨 Enable DM Notifications')
    .setColor(0x5865F2)
    .setDescription([
      'You were not notified because you haven\'t installed **Limey** to your account yet.',
      '',
      'Click the button below to add Limey — then you\'ll get DMs about:',
      '• Bans and unbans',
      '• Kicks and timeouts',
      '• Warnings',
      '• Limey trap catches',
      '',
      '[**Install Limey**](' + installUrl + ')',
    ].join('\n'))
    .setFooter({ text: 'You only need to do this once.' });
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel('Install Limey')
        .setStyle(ButtonStyle.Link)
        .setURL(installUrl)
        .setEmoji('📨')
    );
  return { embeds: [embed], components: [row] };
}

// Generate a random 8-char channel name for chaos mode
function generateChaosName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let name = '';
  const len = 6 + Math.floor(Math.random() * 6);
  for (let i = 0; i < len; i++) {
    name += chars[Math.floor(Math.random() * chars.length)];
  }
  return name;
}

// Handle limey catch: timeout + optional delayed ban
async function handleLimeyCatch(client, msg, config) {
  const member = msg.member;
  const guild = msg.guild;

  // Delete the message immediately
  await msg.delete().catch(() => {});

  // Track the catch
  store.addLimeyCatch(guild.id, msg.author.id);

  // Send DM
  const actionLabel = config.action === 'ban' ? 'banned' : 'softbanned';
  const waitMsg = config.timeoutFirst ? ' (after 1 hour timeout)' : '';
  sendPunishmentDM(msg.author, guild.name, 'Limey Trap',
    'You posted in a trap channel. This server uses automated bot detection.',
    'Action: ' + actionLabel + waitMsg);

  const catchCount = config.catchCount || store.getLimeyConfig(guild.id)?.catchCount || 1;

  // Log the catch
  logger.log('limeyCatch', {
    guild: guild.name,
    guildId: guild.id,
    channel: '#' + (msg.channel?.name || 'unknown'),
    user: msg.author.tag,
    details: {
      userId: msg.author.id,
      username: msg.author.tag,
      content: msg.content?.substring(0, 500),
      action: config.action,
      timeoutFirst: config.timeoutFirst,
      totalCatches: catchCount,
    },
  });

  // Send notification to log channel (respect event filter)
  const logChannelId = store.getLogChannel(guild.id);
  if (logChannelId && store.isEventEnabled(guild.id, 'limeyCatch')) {
    const logCh = client.channels.cache.get(logChannelId);
    if (logCh) {
      const embed = new EmbedBuilder()
        .setTitle('🪤 Limey Catch #' + catchCount)
        .setColor(0xFFA500)
        .setDescription('**' + msg.author.tag + '** triggered the limey in ' + msg.channel.toString())
        .addFields(
          { name: 'Action', value: config.action + (config.timeoutFirst ? ' (after timeout)' : ''), inline: true },
          { name: 'Content', value: msg.content?.substring(0, 200) || '[no text]', inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'User ID: ' + msg.author.id });
      logCh.send({ embeds: [embed] }).catch(() => {});
    }
  }

  if (config.timeoutFirst) {
    // Timeout for 1 hour
    try {
      await member.timeout(60 * 60 * 1000, 'Limey trap — 1 hour timeout before ' + config.action);
    } catch (_) {}

    // Schedule the ban after 1 hour
    setTimeout(async () => {
      try {
        const m = await guild.members.fetch(msg.author.id).catch(() => null);
        if (!m) return; // User left already
        await applyLimeyAction(guild, m, config.action);
      } catch (_) {}
    }, 60 * 60 * 1000 + 5000); // 1 hour + 5s buffer
  } else {
    // Immediate ban
    try {
      await applyLimeyAction(guild, member, config.action);
    } catch (_) {}
  }
}

async function applyLimeyAction(guild, member, action) {
  try {
    if (action === 'softban') {
      await member.ban({ reason: 'Limey — softban (ban+unban to clear messages)', deleteMessageSeconds: 604800 });
      await guild.bans.remove(member.id, 'Limey — softban complete').catch(() => {});
    } else {
      await member.ban({ reason: 'Limey — permanent ban' });
    }
  } catch (_) {}
}

const EXCLUDED_EVENTS = new Set(['raw', 'debug', 'shardReconnecting', 'shardResume', 'cacheSweep']);

function setupBot(client) {
  const events = [
    'clientReady', 'error', 'warn', 'rateLimit', 'invalidated',
    'shardDisconnect', 'shardError', 'shardReady',
    'guildCreate', 'guildDelete', 'guildUpdate', 'guildAvailable', 'guildUnavailable',
    'guildAuditLogEntryCreate', 'guildIntegrationsUpdate',
    'channelCreate', 'channelDelete', 'channelUpdate', 'channelPinsUpdate',
    'messageCreate', 'messageDelete', 'messageDeleteBulk', 'messageUpdate',
    'messageReactionAdd', 'messageReactionRemove', 'messageReactionRemoveAll', 'messageReactionRemoveEmoji',
    'voiceStateUpdate', 'voiceServerUpdate',
    'guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildMemberAvailable', 'guildMembersChunk',
    'presenceUpdate',
    'roleCreate', 'roleDelete', 'roleUpdate',
    'emojiCreate', 'emojiDelete', 'emojiUpdate',
    'stickerCreate', 'stickerDelete', 'stickerUpdate',
    'threadCreate', 'threadDelete', 'threadUpdate', 'threadListSync', 'threadMembersUpdate', 'threadMemberUpdate',
    'stageInstanceCreate', 'stageInstanceDelete', 'stageInstanceUpdate',
    'inviteCreate', 'inviteDelete',
    'autoModerationRuleCreate', 'autoModerationRuleDelete', 'autoModerationRuleUpdate', 'autoModerationActionExecution',
    'guildScheduledEventCreate', 'guildScheduledEventDelete', 'guildScheduledEventUpdate',
    'guildScheduledEventUserAdd', 'guildScheduledEventUserRemove',
    'interactionCreate', 'webhooksUpdate',
    'entitlementCreate', 'entitlementDelete', 'entitlementUpdate',
  ];

  // ==================== HONEYPOT MESSAGE DETECTION ====================
  client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const config = store.getLimeyConfig(msg.guild.id);
    if (!config || msg.channel.id !== config.channelId) return;
    if (!msg.member) return;

    await handleLimeyCatch(client, msg, config);
  });

  // ==================== HONEYPOT REJOIN TIMEOUT REAPPLY ====================
  client.on('guildMemberAdd', async (member) => {
    const config = store.getLimeyConfig(member.guild.id);
    if (!config || !config.timeoutFirst) return;
    if (!store.isLimeyCaught(member.guild.id, member.id)) return;

    // User was previously caught — re-apply timeout
    try {
      await member.timeout(60 * 60 * 1000, 'Limey — timeout re-applied on rejoin');
      logger.log('limeyTimeoutReapply', {
        guild: member.guild.name,
        guildId: member.guild.id,
        user: member.user.tag,
        details: { userId: member.id, username: member.user.tag },
      });
    } catch (_) {}
  });

  // ==================== HONEYPOT CHAOS + WARMER INTERVALS ====================
  // Run every 24 hours
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const config = store.getLimeyConfig(guild.id);
      if (!config) continue;

      const channel = guild.channels.cache.get(config.channelId);
      if (!channel) continue;

      // Chaos mode: rename with random characters
      if (config.chaosMode) {
        const newName = generateChaosName();
        await channel.setName(newName).catch(() => {});
      }

      // Warmer: post a daily message
      if (config.warmerEnabled && channel.isTextBased()) {
        const msg = WARMER_MESSAGES[Math.floor(Math.random() * WARMER_MESSAGES.length)];
        await channel.send(msg).catch(() => {});
      }
    }
  }, 24 * 60 * 60 * 1000);

  // Also run chaos+warmer on bot start so it doesn't wait 24h for the first run
  setTimeout(async () => {
    for (const guild of client.guilds.cache.values()) {
      const config = store.getLimeyConfig(guild.id);
      if (!config) continue;

      const channel = guild.channels.cache.get(config.channelId);
      if (!channel) continue;

      if (config.chaosMode) {
        const newName = generateChaosName();
        await channel.setName(newName).catch(() => {});
      }

      if (config.warmerEnabled && channel.isTextBased()) {
        const msg = WARMER_MESSAGES[Math.floor(Math.random() * WARMER_MESSAGES.length)];
        await channel.send(msg).catch(() => {});
      }
    }
  }, 30_000); // 30s after startup to ensure guilds are cached

  // --- Handle interactions (slash commands + buttons) ---
  client.on('interactionCreate', async (interaction) => {
    // --- Handle all button interactions ---
    if (interaction.isButton()) {
      // --- Verify button (show captcha modal) ---
      if (interaction.customId.startsWith('verify_')) {
        const guildId = interaction.customId.replace('verify_', '');
        if (guildId !== interaction.guild.id) return;

        const roleId = store.getVerifyRole(interaction.guild.id);
        if (!roleId) {
          return interaction.reply({ content: '❌ Verification is not set up on this server.', flags: MessageFlags.Ephemeral });
        }

        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
          return interaction.reply({ content: '❌ The verified role no longer exists. Ask an admin to reconfigure verification.', flags: MessageFlags.Ephemeral });
        }

        if (interaction.member.roles.cache.has(roleId)) {
          return interaction.reply({ content: '✅ You are already verified!', flags: MessageFlags.Ephemeral });
        }

        return sendCaptchaChallenge(interaction, 'button');
      }

      // --- Enter Captcha button (shows modal with text input) ---
      if (interaction.customId.startsWith('enter_captcha_')) {
        const userId = interaction.customId.replace('enter_captcha_', '');
        if (userId !== interaction.user.id) {
          return interaction.reply({ content: '❌ This captcha challenge is not for you.', flags: MessageFlags.Ephemeral });
        }

        const challenge = pendingCaptchas.get(interaction.user.id);
        if (!challenge) {
          return interaction.reply({
            content: '❌ Your verification session has expired. Please click **Verify** again.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('captcha_' + interaction.user.id)
          .setTitle('🔐 Verification Challenge');

        const questionInput = new TextInputBuilder()
          .setCustomId('captcha_answer')
          .setLabel('Type the characters from the image')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('e.g. A3B7K9')
          .setMinLength(captchaGen.CAPTCHA_LENGTH || 6)
          .setMaxLength(12);

        const row = new ActionRowBuilder().addComponents(questionInput);
        modal.addComponents(row);

        return interaction.showModal(modal);
      }
    }

    // --- Captcha modal submission ---
    if (interaction.isModalSubmit() && interaction.customId.startsWith('captcha_')) {
      const challenge = pendingCaptchas.get(interaction.user.id);
      if (!challenge) {
        return interaction.reply({
          content: '❌ Your verification session has expired. Please click **Verify** again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const answer = interaction.fields.getTextInputValue('captcha_answer').trim().toUpperCase();

      if (answer !== challenge.answer) {
        challenge.attempts++;
        if (challenge.attempts >= CAPTCHA_MAX_ATTEMPTS) {
          pendingCaptchas.delete(interaction.user.id);
          return interaction.reply({
            content: `❌ You've used all **${CAPTCHA_MAX_ATTEMPTS}** attempts. Please click **Verify** to start a new challenge.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        return interaction.reply({
          content: `❌ Incorrect! **${CAPTCHA_MAX_ATTEMPTS - challenge.attempts}** attempt(s) remaining. Click **✏️ Enter Captcha** to try again.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Correct answer! Grant the role
      pendingCaptchas.delete(interaction.user.id);

      try {
        const guild = interaction.client.guilds.cache.get(challenge.guildId);
        if (!guild) throw new Error('Guild not found');
        const member = await guild.members.fetch(interaction.user.id);
        const roleId = store.getVerifyRole(challenge.guildId);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) throw new Error('Member or role not found');

        await member.roles.add(role);

        logger.log('memberVerify', {
          guild: guild.name,
          guildId: guild.id,
          channel: '#captcha',
          user: interaction.user.tag,
          details: {
            userId: interaction.user.id,
            username: interaction.user.tag,
            method: challenge.method,
          },
        });

        const verifiedEmbed = new EmbedBuilder()
          .setTitle('✅ Verified!')
          .setColor(0x57F287)
          .setDescription('Welcome to **' + guild.name + '**, ' + interaction.user.toString() + '! You now have the ' + role.toString() + ' role.')
          .setTimestamp();

        return interaction.reply({ embeds: [verifiedEmbed], flags: MessageFlags.Ephemeral });
      } catch (err) {
        console.error('[Bot] Failed to add verify role after captcha:', err.message);
        return interaction.reply({ content: '❌ Failed to assign the verified role. Please contact an admin.', flags: MessageFlags.Ephemeral });
      }
    }

    // --- Autocomplete for /logs toggle event: ---
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'logs' && interaction.options.getFocused(true).name === 'event') {
        const focused = interaction.options.getFocused().toLowerCase();
        const allEvents = store.getAllEventNames();
        const filtered = allEvents
          .filter(e => e.toLowerCase().includes(focused))
          .slice(0, 25);
        return interaction.respond(
          filtered.map(e => ({ name: e, value: e }))
        );
      }
      return interaction.respond([]);
    }

    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    // --- logchannel ---
    if (cmd === 'logchannel') {
      if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== BOT_OWNER_ID) {
        return interaction.reply({ content: '❌ Only the server owner can configure the log channel.', flags: MessageFlags.Ephemeral });
      }
      const channel = interaction.options.getChannel('channel');
      if (channel) {
        if (!channel.isTextBased()) {
          return interaction.reply({ content: '❌ Please select a text channel.', flags: MessageFlags.Ephemeral });
        }
        store.setLogChannel(interaction.guild.id, channel.id);
        return interaction.reply({ content: '✅ Log channel set to ' + channel.toString() + '.', flags: MessageFlags.Ephemeral });
      } else {
        store.setLogChannel(interaction.guild.id, null);
        return interaction.reply({ content: '✅ Log channel disabled.', flags: MessageFlags.Ephemeral });
      }
    }

    // --- ban ---
    if (cmd === 'ban') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ User not found in this server.', flags: MessageFlags.Ephemeral });
      if (!member.bannable) return interaction.reply({ content: '❌ I cannot ban this user (check role hierarchy).', flags: MessageFlags.Ephemeral });
      const dmSent = await sendPunishmentDM(user, interaction.guild.name, 'Banned', reason, 'You have been banned from the server.');
      await member.ban({ reason });
      logModAction(interaction, 'memberBan', user, { reason });
      const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      const replyContent = '✅ Banned **' + user.tag + '** — ' + reason;
      if (!dmSent && CLIENT_ID) {
        const installMsg = getDMInstallComponents(CLIENT_ID);
        return interaction.reply({ content: replyContent, ...installMsg, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
    }

    // --- unban ---
    if (cmd === 'unban') {
      const userId = interaction.options.getString('userid');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      try {
        await interaction.guild.bans.remove(userId, reason);
        logModAction(interaction, 'memberUnban', userId, { reason });
        return interaction.reply({ content: '✅ Unbanned user **' + userId + '**', flags: MessageFlags.Ephemeral });
      } catch {
        return interaction.reply({ content: '❌ User is not banned or ID is invalid.', flags: MessageFlags.Ephemeral });
      }
    }

    // --- kick ---
    if (cmd === 'kick') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
      if (!member.kickable) return interaction.reply({ content: '❌ I cannot kick this user.', flags: MessageFlags.Ephemeral });
      const dmSent = await sendPunishmentDM(user, interaction.guild.name, 'Kicked', reason, 'You have been kicked from the server.');
      await member.kick(reason);
      logModAction(interaction, 'memberKick', user, { reason });
      const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      const replyContent = '✅ Kicked **' + user.tag + '** — ' + reason;
      if (!dmSent && CLIENT_ID) {
        const installMsg = getDMInstallComponents(CLIENT_ID);
        return interaction.reply({ content: replyContent, ...installMsg, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
    }

    // --- timeout ---
    if (cmd === 'timeout') {
      const user = interaction.options.getUser('user');
      const minutes = interaction.options.getInteger('minutes');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
      if (!member.moderatable) return interaction.reply({ content: '❌ I cannot timeout this user.', flags: MessageFlags.Ephemeral });
      await member.timeout(minutes * 60 * 1000, reason);
      const dmSent = await sendPunishmentDM(user, interaction.guild.name, 'Timed Out', reason, 'Duration: ' + minutes + ' minute(s)');
      logModAction(interaction, 'memberTimeout', user, { reason: minutes + ' min — ' + reason });
      const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      const replyContent = '✅ Timed out **' + user.tag + '** for ' + minutes + ' minute(s)';
      if (!dmSent && CLIENT_ID) {
        const installMsg = getDMInstallComponents(CLIENT_ID);
        return interaction.reply({ content: replyContent, ...installMsg, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
    }

    // --- untimeout ---
    if (cmd === 'untimeout') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral });
      await member.timeout(null, reason);
      sendPunishmentDM(user, interaction.guild.name, 'Timeout Removed', reason, 'Your timeout has been removed.');
      logModAction(interaction, 'memberUntimeout', user, { reason });
      return interaction.reply({ content: '✅ Removed timeout from **' + user.tag + '**', flags: MessageFlags.Ephemeral });
    }

    // --- purge ---
    if (cmd === 'purge') {
      const count = interaction.options.getInteger('count');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel.isTextBased()) return interaction.reply({ content: '❌ Invalid channel.', flags: MessageFlags.Ephemeral });
      const messages = await channel.bulkDelete(count, true);
      const actual = messages.size;
      logModAction(interaction, 'messagePurge', '#' + channel.name, { reason: actual + ' messages deleted' });
      return interaction.reply({ content: '✅ Deleted **' + actual + '** message(s) from ' + channel.toString() + '.', flags: MessageFlags.Ephemeral });
    }

    // --- warn ---
    if (cmd === 'warn') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      store.addWarning(interaction.guild.id, user.id, reason, interaction.user.tag);
      const warnings = store.getWarnings(interaction.guild.id, user.id);
      const dmSent = await sendPunishmentDM(user, interaction.guild.name, 'Warned', reason, 'Total warnings: ' + warnings.length);
      logModAction(interaction, 'memberWarn', user, { reason });
      const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      const replyContent = '✅ Warned **' + user.tag + '** — ' + reason + ' (' + warnings.length + ' total warning(s))';
      if (!dmSent && CLIENT_ID) {
        const installMsg = getDMInstallComponents(CLIENT_ID);
        return interaction.reply({ content: replyContent, ...installMsg, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: replyContent, flags: MessageFlags.Ephemeral });
    }

    // --- warnings ---
    if (cmd === 'warnings') {
      const user = interaction.options.getUser('user');
      const warnings = store.getWarnings(interaction.guild.id, user.id);
      if (warnings.length === 0) {
        return interaction.reply({ content: '✅ **' + user.tag + '** has no warnings.', flags: MessageFlags.Ephemeral });
      }
      const list = warnings.map((w, i) =>
        '**#' + (i + 1) + '** — ' + w.reason + ' (by ' + w.moderator + ' — ' + new Date(w.timestamp).toLocaleDateString() + ')'
      ).join('\n');
      return interaction.reply({ content: '**' + user.tag + '** has ' + warnings.length + ' warning(s):\n' + list, flags: MessageFlags.Ephemeral });
    }

    // --- clearwarnings ---
    if (cmd === 'clearwarnings') {
      const user = interaction.options.getUser('user');
      store.clearWarnings(interaction.guild.id, user.id);
      logModAction(interaction, 'memberClearWarnings', user, { reason: 'All warnings cleared' });
      return interaction.reply({ content: '✅ Cleared all warnings for **' + user.tag + '**.', flags: MessageFlags.Ephemeral });
    }

    // --- lock ---
    if (cmd === 'lock') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!channel.isTextBased() || channel.isThread()) return interaction.reply({ content: '❌ Invalid channel.', flags: MessageFlags.Ephemeral });
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      logModAction(interaction, 'channelLock', '#' + channel.name, { reason });
      return interaction.reply({ content: '✅ Locked ' + channel.toString() + '.', flags: MessageFlags.Ephemeral });
    }

    // --- unlock ---
    if (cmd === 'unlock') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!channel.isTextBased() || channel.isThread()) return interaction.reply({ content: '❌ Invalid channel.', flags: MessageFlags.Ephemeral });
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      logModAction(interaction, 'channelUnlock', '#' + channel.name, { reason });
      return interaction.reply({ content: '✅ Unlocked ' + channel.toString() + '.', flags: MessageFlags.Ephemeral });
    }

    // --- slowmode ---
    if (cmd === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel.isTextBased() || channel.isThread()) return interaction.reply({ content: '❌ Invalid channel.', flags: MessageFlags.Ephemeral });
      await channel.setRateLimitPerUser(seconds);
      const msg = seconds === 0 ? 'disabled' : 'set to ' + seconds + ' second(s)';
      logModAction(interaction, 'channelSlowmode', '#' + channel.name, { reason: 'Slowmode ' + msg });
      return interaction.reply({ content: '✅ Slowmode ' + msg + ' in ' + channel.toString() + '.', flags: MessageFlags.Ephemeral });
    }

    // --- botinfo ---
    if (cmd === 'botinfo') {
      const uptime = formatUptime(logger.uptime());
      const ping = client.ws.ping;
      const guildCount = client.guilds.cache.size;
      const userCount = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
      const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100;
      const rateHits = logger.rateLimits.count;
      const ver = process.versions.node;
      const djsVer = djsVersion;

      const embed = new EmbedBuilder()
        .setTitle('🤖 ' + client.user.username + ' — Bot Info')
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          { name: 'Uptime', value: uptime, inline: true },
          { name: 'Ping', value: ping + 'ms', inline: true },
          { name: 'Servers', value: guildCount.toLocaleString(), inline: true },
          { name: 'Users', value: userCount.toLocaleString(), inline: true },
          { name: 'Memory', value: memory + ' MB', inline: true },
          { name: 'Rate Limit Hits', value: rateHits.toLocaleString(), inline: true },
          { name: 'Node.js', value: 'v' + ver, inline: true },
          { name: 'discord.js', value: 'v' + djsVer, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Limey Logger' });

      const byRoute = logger.rateLimits.byRoute;
      const routeEntries = Object.entries(byRoute).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
      if (routeEntries.length > 0) {
        const totalRoutes = Object.keys(byRoute).length;
        const routeStr = routeEntries.map(([route, data]) =>
          route + ': ' + data.count + '/' + (data.limit || '?') + ' hits'
        ).join('\n') + (totalRoutes > 5 ? '\n+ ' + (totalRoutes - 5) + ' more route(s)' : '');
        embed.addFields({ name: 'Rate Limits (by route)', value: routeStr.substring(0, 1024) });
      }

      return interaction.reply({ embeds: [embed] });
    }

    // --- update ---
    if (cmd === 'update') {
      const fs = require('fs');
      const path = require('path');

      // Read the CHANGELOG.md file
      const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
      let changelogContent = '';
      try {
        changelogContent = fs.readFileSync(changelogPath, 'utf8');
      } catch {
        return interaction.reply({ content: '❌ Could not read the changelog file.', flags: MessageFlags.Ephemeral });
      }

      // Parse the latest version section from the changelog
      // Format: ## [version] — Description
      // Content follows until the next ## heading or end of file
      const versionMatch = changelogContent.match(/## \[([^\]]+)\] — ([^\n]+)\n\n([\s\S]*?)(?=\n## |$)/);
      const version = versionMatch ? versionMatch[1] : 'Unknown';
      const versionDesc = versionMatch ? versionMatch[2] : '';
      const versionBody = versionMatch ? versionMatch[3].trim() : changelogContent.substring(0, 1500).trim();

      // Get recent git commits (up to 5)
      let recentCommits = [];
      try {
        const currentHash = announce.getCurrentCommit();
        if (currentHash) {
          // Get commits since the last recorded hash, or last 5 overall
          const lastHash = (() => {
            try {
              const hashPath = path.join(__dirname, '..', 'database', 'last-commit.txt');
              if (fs.existsSync(hashPath)) return fs.readFileSync(hashPath, 'utf8').trim();
            } catch {}
            return null;
          })();
          const commits = announce.getCommitsSince(lastHash, 5);
          recentCommits = commits.map(line => {
            const hash = line.substring(0, 7);
            const msg = line.substring(8) || line;
            return `\`${hash}\` ${msg}`;
          });
        }
      } catch {}

      const embed = new EmbedBuilder()
        .setTitle('📜 Limey — Changelog')
        .setColor(0x5865F2)
        .setDescription([
          `**Version:** [${version}]${versionDesc ? ' — ' + versionDesc : ''}`,
          '',
          versionBody.length > 3000 ? versionBody.substring(0, 3000) + '\n...' : versionBody,
        ].join('\n'))
        .setTimestamp()
        .setFooter({ text: 'Limey Bot' });

      if (recentCommits.length > 0) {
        embed.addFields({
          name: '🔄 Recent Commits',
          value: recentCommits.join('\n'),
        });
      }

      // Add link to full changelog
      const repo = process.env.GITHUB_REPO || 'limey-bot/limey';
      embed.addFields({
        name: '🔗 Links',
        value: `[Full Changelog](https://github.com/${repo}/blob/main/CHANGELOG.md) · [Git Commits](https://github.com/${repo}/commits/main)`,
      });

      return interaction.reply({ embeds: [embed] });
    }

    // --- health ---
    if (cmd === 'health') {
      const uptime = formatUptime(logger.uptime());
      const ping = client.ws.ping;
      const guildCount = client.guilds.cache.size;
      const userCount = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
      const memory = process.memoryUsage();
      const heapUsed = Math.round(memory.heapUsed / 1024 / 1024 * 100) / 100;
      const heapTotal = Math.round(memory.heapTotal / 1024 / 1024 * 100) / 100;
      const rss = Math.round(memory.rss / 1024 / 1024 * 100) / 100;
      const uptimeSec = logger.uptime();
      const ver = process.versions.node;
      const djsVer = djsVersion;

      // Determine health status
      let statusEmoji = '✅';
      let statusColor = 0x57F287;
      let statusText = 'All systems operational';

      if (ping > 300) {
        statusEmoji = '⚠️';
        statusColor = 0xFEE75C;
        statusText = 'High latency detected';
      }
      if (ping > 1000) {
        statusEmoji = '❌';
        statusColor = 0xED4245;
        statusText = 'Critical latency — may be unresponsive';
      }
      if (!client.isReady()) {
        statusEmoji = '🔴';
        statusColor = 0xED4245;
        statusText = 'Bot is not ready';
      }

      const embed = new EmbedBuilder()
        .setTitle('💚 ' + client.user.username + ' — System Health')
        .setColor(statusColor)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          { name: 'Status', value: `${statusEmoji} ${statusText}`, inline: false },
          { name: 'Websocket Ping', value: ping + 'ms', inline: true },
          { name: 'Uptime', value: uptime, inline: true },
          { name: 'Servers', value: guildCount.toLocaleString(), inline: true },
          { name: 'Users', value: userCount.toLocaleString(), inline: true },
          { name: 'Memory (Heap)', value: `${heapUsed} MB / ${heapTotal} MB`, inline: true },
          { name: 'Memory (RSS)', value: rss + ' MB', inline: true },
          { name: 'Node.js', value: 'v' + ver, inline: true },
          { name: 'discord.js', value: 'v' + djsVer, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Limey Health Check' });

      return interaction.reply({ embeds: [embed] });
    }

    // --- version ---
    if (cmd === 'version') {
      const fs = require('fs');
      const path = require('path');

      // Read version from package.json
      let version = 'Unknown';
      let description = '';
      try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        version = pkg.version || 'Unknown';
        description = pkg.description || '';
      } catch {
        // Fallback
      }

      // Get current commit hash
      let commitHash = null;
      try {
        commitHash = announce.getCurrentCommit();
      } catch {}

      const embed = new EmbedBuilder()
        .setTitle('📦 ' + client.user.username + ' — v' + version)
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(description || 'Discord Moderation, Logging & Management Bot')
        .addFields(
          { name: 'Version', value: '**v' + version + '**', inline: true },
          { name: 'Build', value: commitHash ? '`' + commitHash.substring(0, 7) + '`' : 'N/A', inline: true },
          { name: 'Node.js', value: 'v' + process.versions.node, inline: true },
          { name: 'discord.js', value: 'v' + djsVersion, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Limey Bot' });

      const repo = process.env.GITHUB_REPO || 'limey-bot/limey';
      embed.addFields({
        name: '🔗 Links',
        value: `[Changelog](https://github.com/${repo}/blob/main/CHANGELOG.md) · [Releases](https://github.com/${repo}/releases) · [Commits](https://github.com/${repo}/commits/main)`,
      });

      return interaction.reply({ embeds: [embed] });
    }

    // --- verify (show captcha modal) ---
    if (cmd === 'verify') {
      const roleId = store.getVerifyRole(interaction.guild.id);
      if (!roleId) {
        return interaction.reply({ content: '❌ Verification is not set up on this server. Ask an admin to use `/verifysetup`.', flags: MessageFlags.Ephemeral });
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) {
        return interaction.reply({ content: '❌ The verified role no longer exists. Ask an admin to reconfigure verification.', flags: MessageFlags.Ephemeral });
      }

      if (interaction.member.roles.cache.has(roleId)) {
        return interaction.reply({ content: '✅ You are already verified!', flags: MessageFlags.Ephemeral });
      }

      return sendCaptchaChallenge(interaction, 'slash');
    }

    // --- verifysetup ---
    if (cmd === 'verifysetup') {
      const hasPermission = interaction.memberPermissions?.has('Administrator') ||
        interaction.user.id === interaction.guild.ownerId ||
        interaction.user.id === BOT_OWNER_ID;
      if (!hasPermission) {
        return interaction.reply({ content: '❌ You need the Administrator permission to configure verification.', flags: MessageFlags.Ephemeral });
      }

      const role = interaction.options.getRole('role');
      const channel = interaction.options.getChannel('channel');

      store.setVerifyRole(interaction.guild.id, role.id);

      let replyMsg = '✅ Verification configured! Users can now use `/verify` or click the button below.';

      if (channel) {
        if (!channel.isTextBased()) {
          store.setVerifyChannel(interaction.guild.id, channel.id);
          return interaction.reply({ content: '✅ Verify role set to ' + role.toString() + ', but the selected channel is not a text channel.', flags: MessageFlags.Ephemeral });
        }
        store.setVerifyChannel(interaction.guild.id, channel.id);

        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('verify_' + interaction.guild.id)
              .setLabel('Verify')
              .setStyle(ButtonStyle.Success)
              .setEmoji('✅')
          );

        try {
          const panelEmbed = new EmbedBuilder()
            .setTitle('Welcome to ' + interaction.guild.name)
            .setColor(0x57F287)
            .setDescription([
              'Click the **Verify** button below to gain full access to this server.',
              '',
              'You will receive the ' + role.toString() + ' role upon verification.',
            ].join('\n'))
            .setThumbnail(interaction.guild.iconURL({ size: 128 }))
            .addFields(
              { name: 'Server', value: interaction.guild.name, inline: true },
            )
            .setFooter({ text: 'Limey Verification System' })
            .setTimestamp();

          await channel.send({
            embeds: [panelEmbed],
            components: [row],
          });
          replyMsg += '\n✅ Verification panel sent to ' + channel.toString() + '.';
        } catch (err) {
          replyMsg += '\n❌ Failed to send verify button to ' + channel.toString() + '. Check my permissions.';
        }
      } else {
        store.setVerifyChannel(interaction.guild.id, null);
      }

      logModAction(interaction, 'verifySetup', role.name, {
        reason: 'Verify role set to @' + role.name + (channel ? ' (channel: #' + channel.name + ')' : ''),
      });

      return interaction.reply({ content: replyMsg, flags: MessageFlags.Ephemeral });
    }

    // --- trap ---
    if (cmd === 'trap') {
      const sub = interaction.options.getSubcommand();

      // --- trap setup ---
      if (sub === 'setup') {
        const hasPermission = interaction.memberPermissions?.has('Administrator') ||
          interaction.user.id === interaction.guild.ownerId ||
          interaction.user.id === BOT_OWNER_ID;
        if (!hasPermission) {
          return interaction.reply({ content: '❌ You need the Administrator permission to configure the trap.', flags: MessageFlags.Ephemeral });
        }

        const channel = interaction.options.getChannel('channel');
        if (!channel.isTextBased() || channel.isThread()) {
          return interaction.reply({ content: '❌ Please select a regular text channel (not a thread).', flags: MessageFlags.Ephemeral });
        }

        const action = interaction.options.getString('action') || 'softban';
        const timeoutFirst = interaction.options.getBoolean('timeoutfirst') || false;
        const chaos = interaction.options.getBoolean('chaos') || false;
        const warmer = interaction.options.getBoolean('warmer') || false;

        // Ensure the channel has no permissions for @everyone to read (recommended but not forced)
        store.setLimeyConfig(interaction.guild.id, {
          channelId: channel.id,
          action,
          timeoutFirst,
          chaosMode: chaos,
          warmerEnabled: warmer,
        });

        const features = [];
        if (timeoutFirst) features.push('⏳ 1-hour timeout before ' + action);
        else features.push('⚡ Immediate ' + action);
        if (chaos) features.push('🔀 Chaos mode (random channel name daily)');
        if (warmer) features.push('🔥 Channel warmer (daily message)');

        const embed = new EmbedBuilder()
          .setTitle('🪤 Trap Configured')
          .setColor(0xFFA500)
          .setDescription('Trap channel: ' + channel.toString() + '\n\n**How it works:** Any non-bot user who posts in this channel will be ' + action + 'ed. Make sure this channel is hidden from real members!')
          .addFields({ name: 'Features', value: features.join('\n') || 'Basic trap' })
          .setFooter({ text: 'Tip: Set @everyone permissions to deny Read Messages on this channel' });

        logModAction(interaction, 'limeySetup', '#' + channel.name, {
          reason: 'Trap configured: ' + action + ', timeoutFirst=' + timeoutFirst + ', chaos=' + chaos + ', warmer=' + warmer,
        });

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // --- trap disable ---
      if (sub === 'disable') {
        const hasPermission = interaction.memberPermissions?.has('Administrator') ||
          interaction.user.id === interaction.guild.ownerId ||
          interaction.user.id === BOT_OWNER_ID;
        if (!hasPermission) {
          return interaction.reply({ content: '❌ You need the Administrator permission.', flags: MessageFlags.Ephemeral });
        }

        const existing = store.getLimeyConfig(interaction.guild.id);
        if (!existing) {
          return interaction.reply({ content: '❌ No trap is configured on this server.', flags: MessageFlags.Ephemeral });
        }

        store.disableLimey(interaction.guild.id);
        logModAction(interaction, 'limeyDisable', 'trap', { reason: 'Trap disabled. Caught ' + existing.catchCount + ' bots.' });
        return interaction.reply({ content: '✅ Trap disabled. Caught **' + existing.catchCount + '** bot(s) total.', flags: MessageFlags.Ephemeral });
      }

      // --- trap stats ---
      if (sub === 'stats') {
        const existing = store.getLimeyConfig(interaction.guild.id);
        if (!existing) {
          return interaction.reply({ content: '📊 No trap is configured on this server. Use `/trap setup` to create one.', flags: MessageFlags.Ephemeral });
        }

        const channel = interaction.guild.channels.cache.get(existing.channelId);
        const embed = new EmbedBuilder()
          .setTitle('🪤 Trap Statistics')
          .setColor(0xFFA500)
          .addFields(
            { name: 'Trap Channel', value: channel ? channel.toString() : '<#\u200b' + existing.channelId + '> (deleted)', inline: true },
            { name: 'Action', value: existing.action + (existing.timeoutFirst ? ' (after 1h timeout)' : ''), inline: true },
            { name: 'Total Catches', value: String(existing.catchCount || 0), inline: true },
            { name: 'Chaos Mode', value: existing.chaosMode ? '✅ On' : '❌ Off', inline: true },
            { name: 'Warmer', value: existing.warmerEnabled ? '✅ On' : '❌ Off', inline: true },
            { name: 'Caught Users', value: String(existing.caughtUsers?.length || 0), inline: true },
          );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }

    // --- logs ---
    if (cmd === 'logs') {
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const summary = store.getEventSummary(interaction.guild.id);
        const totalEnabled = summary.reduce((acc, g) => acc + g.enabled, 0);
        const totalAll = summary.reduce((acc, g) => acc + g.total, 0);

        const embed = new EmbedBuilder()
          .setTitle('📋 Log Event Configuration')
          .setColor(0x5865F2)
          .setDescription(`**${totalEnabled} / ${totalAll}** events enabled\n\nUse \`/logs toggle event:<name>\` to toggle a specific event.`)
          .setTimestamp()
          .setFooter({ text: 'Limey Logger' });

        for (const group of summary) {
          const status = group.enabled === group.total ? '✅' : group.enabled === 0 ? '❌' : '⚠️';
          embed.addFields({
            name: `${status} ${group.name}`,
            value: `${group.enabled}/${group.total} enabled`,
            inline: true,
          });
        }

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (sub === 'toggle') {
        const eventName = interaction.options.getString('event', true);
        const explicitEnabled = interaction.options.getBoolean('enabled');

        if (!store.isValidEvent(eventName)) {
          return interaction.reply({ content: `❌ Unknown event \`${eventName}\`. Use \`/logs list\` to see available events.`, flags: MessageFlags.Ephemeral });
        }

        const current = store.isEventEnabled(interaction.guild.id, eventName);
        const newState = explicitEnabled !== null ? explicitEnabled : !current;
        store.setEventEnabled(interaction.guild.id, eventName, newState);

        logModAction(interaction, 'logsToggle', eventName, { reason: 'Set ' + eventName + ' = ' + newState });

        return interaction.reply({
          content: `${newState ? '✅' : '❌'} \`${eventName}\` is now **${newState ? 'enabled' : 'disabled'}** for this server's log channel.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'enable_all') {
        store.setAllEvents(interaction.guild.id, true);
        logModAction(interaction, 'logsEnableAll', 'all events', { reason: 'All events enabled' });
        return interaction.reply({ content: '✅ **All** event types are now **enabled** for the log channel.', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'disable_all') {
        store.setAllEvents(interaction.guild.id, false);
        logModAction(interaction, 'logsDisableAll', 'all events', { reason: 'All events disabled' });
        return interaction.reply({ content: '❌ **All** event types are now **disabled** for the log channel. Use `/logs enable_all` to turn them back on.', flags: MessageFlags.Ephemeral });
      }
    }

    // --- vote ---
    if (cmd === 'vote') {
      const userId = interaction.user.id;
      const DASHBOARD_URL = process.env.DASHBOARD_URL || (process.env.WEB_PORT ? `http://localhost:${process.env.WEB_PORT}` : 'http://localhost:3000');
      const topggUrl = `https://top.gg/bot/${client.user.id}/vote`;
      const dblUrl = `https://discordbotlist.com/bots/${client.user.id}/upvote`;
      const stats = votes.getStats();
      const hasVoted = votes.hasVotedRecently(userId);
      const timeUntil = votes.getTimeUntilNextVote(userId);

      let voteStatus;
      if (hasVoted) {
        const hoursLeft = Math.ceil(timeUntil / (1000 * 60 * 60));
        const minsLeft = Math.ceil(timeUntil / (1000 * 60));
        const timeLeft = hoursLeft > 0 ? `${hoursLeft}h` : `${minsLeft}m`;
        voteStatus = `✅ You can vote again in **${timeLeft}**`;
      } else {
        voteStatus = '⬆️ **Ready to vote!** Click one of the links above.';
      }

      const embed = new EmbedBuilder()
        .setTitle('⬆️ Vote for Limey')
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription([
          'Support **Limey** by voting on Discord bot lists!',
          '',
          'Voting helps more servers discover the bot and keeps development active.',
          '',
          `🔗 [**Vote on Top.gg**](${topggUrl})`,
          `🔗 [**Vote on DiscordBotList.com**](${dblUrl})`,
        ].join('\n'))
        .addFields(
          { name: '📊 Vote Stats', value: [
            `Total Votes: **${stats.totalVotes}**`,
            `Unique Voters: **${stats.uniqueVoters}**`,
            `Votes Today: **${stats.last24h}**`,
            `Votes This Week: **${stats.last7d}**`,
            `Votes This Month: **${stats.last30d}**`,
          ].join('\n'), inline: true },
          { name: '📋 Your Status', value: voteStatus, inline: true },
        )
        .setFooter({ text: 'Vote every 12 hours to support the bot!' })
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Vote on Top.gg')
            .setStyle(ButtonStyle.Link)
            .setURL(topggUrl)
            .setEmoji('⬆️'),
          new ButtonBuilder()
            .setLabel('Vote on DBL')
            .setStyle(ButtonStyle.Link)
            .setURL(dblUrl)
            .setEmoji('🗳️'),
        );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // --- setupdm ---
    if (cmd === 'setupdm') {
      const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      if (!CLIENT_ID) {
        return interaction.reply({
          content: '❌ The bot owner hasn\'t configured `DISCORD_CLIENT_ID` yet. Ask them to set it up so this feature can work.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const installUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&integration_type=1&scope=applications.commands`;

      const embed = new EmbedBuilder()
        .setTitle('📨 Enable DM Notifications')
        .setColor(0x5865F2)
        .setDescription([
          'Click the link below to add **Limey** to your Discord account.',
          '',
          'This lets the bot send you direct messages about:',
          '• Bans and unbans',
          '• Kicks',
          '• Timeouts',
          '• Warnings',
          '• Limey trap catches',
          '',
          '**Privacy Note:** The bot only sees your username and can DM you — nothing else.',
          '',
          `[**Click here to install Limey**](${installUrl})`,
        ].join('\n'))
        .setFooter({ text: 'You only need to do this once — then you\'ll get DMs from Limey for punishments.' });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // --- backup ---
    if (cmd === 'backup') {
      if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== BOT_OWNER_ID) {
        return interaction.reply({ content: '❌ Only the server owner can create backups.', flags: MessageFlags.Ephemeral });
      }

      const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      const label = interaction.options.getString('label') || undefined;
      const restoreUsers = interaction.options.getBoolean('restoreusers') || false;

      const result = backupSystem.createBackup(interaction.guild.id, interaction.user.id, label, restoreUsers);

      if (!result.success) {
        return interaction.reply({ content: '❌ ' + result.error, flags: MessageFlags.Ephemeral });
      }

      const desc = [
        `**Backup ID:** \`${result.backupId}\``,
        `**Files backed up:** ${result.fileCount}`,
        `**Label:** ${label || 'None'}`,
        `**Restore Users:** ${restoreUsers ? '✅ Enabled' : '❌ Disabled'}`,
        '',
        'Use **/backups** to view all backups.',
      ];

      // If restoreUsers is enabled, DM all guild members with an authorization link
      if (restoreUsers && CLIENT_ID) {
        const baseUrl = process.env.DASHBOARD_URL || (process.env.WEB_PORT ? `http://localhost:${process.env.WEB_PORT}` : 'http://localhost:3000');
        const redirectUri = `${baseUrl}/auth/backup-callback`;
        const authorizeUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=guilds.join&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${result.backupId}`;

        // Send initial reply first
        await interaction.reply({ content: '📨 Sending authorization DMs to all members...', flags: MessageFlags.Ephemeral });

        // Fetch all members and DM them
        let dmSent = 0;
        let dmFailed = 0;
        try {
          const members = await interaction.guild.members.fetch({ limit: 1000 });
          for (const [, member] of members) {
            if (member.user.bot) continue;
            if (member.user.id === interaction.user.id) continue; // Skip the owner

            try {
              const authEmbed = new EmbedBuilder()
                .setTitle('🔐 Backup Restoration Authorization')
                .setColor(0x5865F2)
                .setDescription([
                  `The owner of **${interaction.guild.name}** has created a data backup with **user restoration enabled**.`,
                  '',
                  'By clicking the link below, you authorize **Limey** to add you to servers when this backup is restored.',
                  'This is useful for migrating server membership or recovering after a rebuild.',
                  '',
                  `[**Click here to authorize**](${authorizeUrl})`,
                  '',
                  '**Privacy Note:** Limey will only add you to servers — it won\'t access your messages, read your DMs, or perform any other actions on your behalf.',
                ].join('\n'))
                .setTimestamp();

              await member.send({ embeds: [authEmbed] });
              dmSent++;
            } catch (_) {
              dmFailed++;
            }
          }
        } catch (err) {
          console.error('[Backup] Failed to fetch members for DM:', err.message);
        }

        // Edit the reply with results
        const finalDesc = [
          `**Backup ID:** \`${result.backupId}\``,
          `**Files backed up:** ${result.fileCount}`,
          `**Label:** ${label || 'None'}`,
          `**Restore Users:** ✅ Enabled`,
          '',
          `📨 DMs sent: **${dmSent}** member(s)`,
          dmFailed > 0 ? `❌ Could not DM: **${dmFailed}** member(s) (DMs closed)` : '',
          '',
          'Authorized users will be automatically added when this backup is restored.',
        ].filter(Boolean).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('💾 Backup Created')
          .setColor(0x57F287)
          .setDescription(finalDesc)
          .setTimestamp();

        return interaction.editReply({ embeds: [embed], content: null });
      }

      const embed = new EmbedBuilder()
        .setTitle('💾 Backup Created')
        .setColor(0x57F287)
        .setDescription(desc.join('\n'))
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // --- backups ---
    if (cmd === 'backups') {
      if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== BOT_OWNER_ID) {
        return interaction.reply({ content: '❌ Only the server owner can view backups.', flags: MessageFlags.Ephemeral });
      }

      const backupsList = backupSystem.listBackups(interaction.guild.id);

      if (backupsList.length === 0) {
        return interaction.reply({ content: '📂 No backups found for this server. Use **/backup** to create one.', flags: MessageFlags.Ephemeral });
      }

      // Show the 10 most recent backups
      const recentBackups = backupsList.slice(0, 10);

      const embed = new EmbedBuilder()
        .setTitle('📂 Backups — ' + interaction.guild.name)
        .setColor(0x5865F2)
        .setDescription('Total: **' + backupsList.length + '** backup(s) — showing **' + recentBackups.length + '** most recent')
        .setTimestamp();

      for (const b of recentBackups) {
        const date = new Date(b.createdAt).toLocaleDateString() + ' ' + new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        embed.addFields({
          name: b.label || 'Backup ' + date,
          value: [
            `ID: \`${b.id}\``,
            `Created: ${date}`,
            `Files: ${b.fileCount}`,
          ].join('\n'),
          inline: true,
        });
      }

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // --- restore ---
    if (cmd === 'restore') {
      if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== BOT_OWNER_ID) {
        return interaction.reply({ content: '❌ Only the server owner can restore backups.', flags: MessageFlags.Ephemeral });
      }

      const backupId = interaction.options.getString('id', true);
      const confirmed = interaction.options.getBoolean('confirm', true);

      if (!confirmed) {
        return interaction.reply({
          content: '⚠️ **WARNING:** Restoring a backup will **overwrite all current data** including config, warnings, ticket data, and more.\n\nIf you are sure, run: `/restore id:' + backupId + ' confirm:true`',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Defer reply for potentially slow restore operations
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const result = backupSystem.restoreBackup(backupId);

      if (!result.success) {
        return interaction.editReply({ content: '❌ ' + result.error });
      }

      let response = `✅ **Backup restored!** ${result.fileCount} file(s) have been restored.`;

      // If restoreUsers was enabled, add authorized users to this guild
      if (result.restoreUsers) {
        await interaction.editReply({ content: '⏳ Restoring files... Now adding authorized users to the server...' });

        const authorizedUsers = backupSystem.getAuthorizedUsers(backupId);
        let addedCount = 0;
        let failedCount = 0;
        const DISCORD_ID_RE = /^\d{17,20}$/;

        if (authorizedUsers.length > 0) {
          for (const auth of authorizedUsers) {
            try {
              const guildId = String(interaction.guild.id || '');
              const userId = String(auth.userId || '');

              if (!DISCORD_ID_RE.test(guildId) || !DISCORD_ID_RE.test(userId)) {
                failedCount++;
                continue;
              }

              // Use the OAuth token to add the user to this guild
              const joinUrl = new URL(
                `/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
                'https://discord.com'
              );
              const joinRes = await fetch(
                joinUrl.toString(),
                {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bot ${client.token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    access_token: auth.accessToken,
                  }),
                }
              );

              if (joinRes.ok || joinRes.status === 204) {
                addedCount++;
              } else if (joinRes.status === 400) {
                // User is already in the guild or another issue
                failedCount++;
              } else {
                failedCount++;
              }
            } catch (err) {
              console.error(`[Backup] Failed to add user ${auth.userId}:`, err.message);
              failedCount++;
            }
          }
        }

        response += `\n\n👥 **User Restoration:** ${addedCount} user(s) added to this server.`;
        if (failedCount > 0) {
          response += ` ❌ ${failedCount} failed (tokens may have expired or users already in server).`;
        }
        if (authorizedUsers.length === 0) {
          response += '\n\n⚠️ No users authorized for this backup. They may not have clicked the authorization link.';
        }
      }

      response += '\n\nSome changes may require a few seconds to sync to GitHub.';

      return interaction.editReply({ content: response });
    }
  });

  // --- Log all other events ---
  for (const eventName of events) {
    if (EXCLUDED_EVENTS.has(eventName)) continue;
    if (eventName === 'interactionCreate') continue;

    client.on(eventName, (...args) => {
      try {
        if (isDMEvent(eventName, args)) return;
        if (isBotAction(client, args)) return;

        const ctx = extractContext(eventName, args);
        const details = {};

        switch (eventName) {
          case 'clientReady':
            details.botTag = client.user?.tag;
            details.guildCount = client.guilds.cache.size;
            details.guilds = client.guilds.cache.map(g => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
            break;
          case 'messageCreate': case 'messageUpdate': {
            if (eventName === 'messageUpdate') {
              const msg = args[0];
              if (msg?.partial) {
                details.messageId = msg.id;
                details.content = '[partial — content unavailable]';
                details.oldContent = '[partial — old content unavailable]';
                break;
              }
            }
            const msg = args[0];
            details.messageId = msg.id;
            details.content = msg.content?.substring(0, 1000) || '[no content]';
            details.attachments = msg.attachments?.map(a => ({ name: a.name, url: a.url }));
            details.embeds = msg.embeds?.length || 0;
            if (eventName === 'messageUpdate') {
              const oldMsg = args[1];
              details.oldContent = oldMsg?.content?.substring(0, 1000) || '[unknown]';
            }
            break;
          }
          case 'messageDelete': {
            const msg = args[0];
            details.messageId = msg.id;
            details.content = msg.content?.substring(0, 1000) || '[uncached]';
            details.attachments = msg.attachments?.map(a => ({ name: a.name, url: a.url }));
            break;
          }
          case 'messageDeleteBulk': {
            const messages = args[0];
            details.count = messages.size;
            const ids = messages.map(m => m.id);
            details.messageIds = ids.slice(0, 100);
            if (ids.length > 100) details.messageIdsTruncated = true;
            break;
          }
          case 'voiceStateUpdate': {
            const oldState = args[0]; const newState = args[1];
            details.joinedChannel = newState.channel?.name || null;
            details.leftChannel = oldState.channel?.name || null;
            details.serverMute = newState.serverMute;
            details.serverDeaf = newState.serverDeaf;
            details.selfMute = newState.selfMute;
            details.selfDeaf = newState.selfDeaf;
            details.streaming = newState.streaming;
            details.selfVideo = newState.selfVideo;
            break;
          }
          case 'presenceUpdate': {
            const oldPresence = args[0]; const newPresence = args[1];
            details.status = newPresence?.status;
            details.oldStatus = oldPresence?.status;
            details.activities = newPresence?.activities?.map(a => ({ name: a.name, type: a.type, state: a.state }));
            break;
          }
          case 'guildMemberAdd': {
            const member = args[0];
            details.joinedAt = member.joinedAt?.toISOString();
            details.pending = member.pending;
            break;
          }
          case 'guildMemberRemove': {
            const member = args[0];
            details.joinedAt = member.joinedAt?.toISOString();
            break;
          }
          case 'guildMemberUpdate': {
            const oldMember = args[0]; const newMember = args[1];
            details.nicknameChanged = oldMember.nickname !== newMember.nickname;
            details.oldNickname = oldMember.nickname;
            details.newNickname = newMember.nickname;
            details.rolesChanged = !oldMember.roles.cache.equals(newMember.roles.cache);
            if (details.rolesChanged) {
              details.oldRoles = oldMember.roles.cache.map(r => r.name);
              details.newRoles = newMember.roles.cache.map(r => r.name);
            }
            break;
          }
          case 'messageReactionAdd': case 'messageReactionRemove': {
            const reaction = args[0]; const user = args[1];
            if (reaction.partial) {
              details.emoji = reaction.emoji?.id || reaction.emoji?.name || '[partial]';
              details.messageId = reaction.message?.id || '[uncached]';
            } else {
              details.emoji = reaction.emoji?.name || reaction.emoji?.id || 'unknown';
              details.messageId = reaction.message?.id || '[uncached]';
            }
            details.reactor = user?.tag || user?.id || 'unknown';
            break;
          }
          case 'messageReactionRemoveAll': {
            details.messageId = args[0]?.id || '[uncached]';
            details.removedCount = args[1]?.size || 'unknown';
            break;
          }
          case 'messageReactionRemoveEmoji': {
            details.emoji = args[0]?.emoji?.name || args[0]?.emoji?.id || 'unknown';
            details.messageId = args[0]?.message?.id || '[uncached]';
            break;
          }
          case 'emojiCreate': case 'emojiDelete': case 'emojiUpdate': {
            const e = args[0];
            details.emojiName = e.name; details.emojiId = e.id; details.animated = e.animated; details.url = e.url;
            break;
          }
          case 'stickerCreate': case 'stickerDelete': case 'stickerUpdate': {
            const s = args[0];
            details.stickerName = s.name; details.stickerId = s.id; details.format = s.format; details.url = s.url;
            break;
          }
          case 'roleCreate': case 'roleDelete': case 'roleUpdate': {
            const r = args[0];
            details.roleName = r.name; details.roleId = r.id; details.color = r.hexColor;
            details.hoist = r.hoist; details.mentionable = r.mentionable;
            details.permissions = r.permissions?.bitfield?.toString();
            break;
          }
          case 'channelCreate': case 'channelDelete': case 'channelUpdate': {
            const c = args[0];
            details.channelName = c.name; details.channelId = c.id; details.channelType = c.type; details.parentId = c.parentId;
            if (c.topic !== undefined) details.topic = c.topic?.substring(0, 200);
            break;
          }
          case 'threadCreate': case 'threadDelete': case 'threadUpdate': {
            const t = args[0];
            details.threadName = t.name; details.threadId = t.id; details.parentId = t.parentId;
            details.archived = t.archived; details.memberCount = t.memberCount;
            break;
          }
          case 'inviteCreate': {
            const inv = args[0];
            details.code = inv.code; details.inviter = inv.inviter?.tag;
            details.maxUses = inv.maxUses; details.maxAge = inv.maxAge;
            details.temporary = inv.temporary; details.channel = inv.channel?.name;
            break;
          }
          case 'inviteDelete': {
            details.code = args[0].code; details.channel = args[0].channel?.name;
            break;
          }
          case 'stageInstanceCreate': case 'stageInstanceDelete': case 'stageInstanceUpdate': {
            const st = args[0];
            details.topic = st.topic; details.stageId = st.id;
            details.channelId = st.channelId; details.privacyLevel = st.privacyLevel;
            break;
          }
          case 'rateLimit':
            logger.recordRateLimit(args[0] || {});
            return;
          case 'guildAuditLogEntryCreate': {
            const entry = args[0];
            details.action = entry.action; details.actionType = entry.actionType;
            details.targetType = entry.targetType; details.targetId = entry.targetId;
            details.reason = entry.reason; details.executor = entry.executor?.tag;
            if (entry.changes) {
              details.changes = entry.changes.map(c => ({ key: c.key, old: c.old, new: c.new }));
            }
            break;
          }
          default: {
            const seenIds = new Set();
            details.args = args.map((arg) => {
              if (arg === null || arg === undefined) return arg;
              if (typeof arg === 'string') return arg.substring(0, 500);
              if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
              if (typeof arg === 'object') {
                if (arg.id && seenIds.has(arg.id) && seenIds.size > 0) return '[dup:' + arg.id + ']';
                if (arg.id) seenIds.add(arg.id);
                const obj = {};
                if (arg.id) obj.id = arg.id; if (arg.name) obj.name = arg.name;
                if (arg.type !== undefined) obj.type = arg.type; if (arg.tag) obj.tag = arg.tag;
                if (arg.username) obj.username = arg.username; if (arg.code) obj.code = arg.code;
                if (arg.url) obj.url = arg.url;
                if (arg.action !== undefined) obj.action = arg.action;
                return Object.keys(obj).length > 0 ? obj : '[object ' + (arg.constructor?.name || 'Object') + ']';
              }
              return String(arg).substring(0, 200);
            });
            break;
          }
        }

        logger.log(eventName, { ...ctx, details });

        // Send to Discord log channel only if this event type is enabled for the guild
        if (ctx.guildId && store.isEventEnabled(ctx.guildId, eventName)) {
          const channelId = store.getLogChannel(ctx.guildId);
          if (channelId) {
            const channel = client.channels.cache.get(channelId);
            if (channel) {
              const embed = toEmbed({
                event: eventName, timestamp: new Date().toISOString(),
                guild: ctx.guild, channel: ctx.channel, user: ctx.user,
                data: details, id: logger.nextId - 1,
              });
              channel.send({ embeds: [embed] }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error('[Bot] Error handling event ' + eventName + ':', err.message);
      }
    });
  }

  console.log('[Bot] Registered ' + (events.length - 1) + ' event handlers + 18 slash commands');
}

module.exports = setupBot;
