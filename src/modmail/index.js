const modmailStore = require('./store');
const core = require('./core');
const { modmailCommands } = require('./commands');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════
// Initialize Modmail System
// ═══════════════════════════════════════════════════════════════════════════

function initModmail(client) {
  modmailStore.init();
  console.log('[Modmail] System initialized');

  // ─── Handle DM Messages ──────────────────────────────────────────────────
  client.on('messageCreate', async (message) => {
    try {
      // Only handle DMs from users (not bots)
      if (message.author.bot) return;
      if (message.channel.type !== 1) return; // DM channel type

      await core.handleUserDM(client, message);
    } catch (err) {
      console.error('[Modmail] DM handling error:', err.message);
    }
  });

  // ─── Handle Modmail Channel Messages (Staff Replies) ─────────────────────
  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (message.channel.type !== 0) return; // Guild text channel

      // Check if this is a modmail channel
      const thread = modmailStore.getThreadByChannel(message.channel.id);
      if (!thread || !thread.open) return;

      // Don't forward bot messages or system messages
      if (message.author.bot) return;
      if (message.content.startsWith('/')) return;

      // Forward the staff reply to the user
      await core.forwardStaffReply(client, message.channel, message, thread);
    } catch (err) {
      console.error('[Modmail] Staff reply handling error:', err.message);
    }
  });

  // ─── Handle Interaction Create (Buttons, Commands, Modals) ──────────────
  client.on('interactionCreate', async (interaction) => {
    try {
      // Buttons
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }
      // Modals
      else if (interaction.isModalSubmit()) {
        await handleModalInteraction(interaction);
      }
      // Slash Commands
      else if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      }
    } catch (err) {
      console.error('[Modmail] Interaction error:', err.message);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  });

  // ─── Auto-close Check Interval ──────────────────────────────────────────
  setInterval(() => {
    checkAutoClose(client);
  }, 15 * 60 * 1000); // Every 15 minutes
}

// ═══════════════════════════════════════════════════════════════════════════
// Button Interaction Handler
// ═══════════════════════════════════════════════════════════════════════════

async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;

  // Close button
  if (customId === 'modmail_close') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    if (!core.canUseModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to close modmail threads.', flags: MessageFlags.Ephemeral });
    }

    // Show a modal to ask for reason
    const modal = new ModalBuilder()
      .setCustomId('modmail_close_reason')
      .setTitle('Close Modmail');

    const reasonInput = new TextInputBuilder()
      .setCustomId('close_reason')
      .setLabel('Reason (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Enter a reason for closing...')
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }

  // Anonymous toggle button
  if (customId === 'modmail_anon') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    if (!core.canUseModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.toggleAnonymous(interaction.channel, interaction.user, thread);
    return interaction.editReply({ content: result.anonymous ? '✅ Anonymous mode enabled.' : '✅ Anonymous mode disabled.' });
  }

  // Block button
  if (customId === 'modmail_block') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    if (!core.canManageModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ Only administrators can block users.', flags: MessageFlags.Ephemeral });
    }

    // Show a modal to ask for reason
    const modal = new ModalBuilder()
      .setCustomId('modmail_block_reason')
      .setTitle('Block User from Modmail');

    const reasonInput = new TextInputBuilder()
      .setCustomId('block_reason')
      .setLabel('Reason (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Enter a reason for blocking...')
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return interaction.showModal(modal);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Modal Interaction Handler
// ═══════════════════════════════════════════════════════════════════════════

async function handleModalInteraction(interaction) {
  // Close reason modal
  if (interaction.customId === 'modmail_close_reason') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    const reason = interaction.fields.getTextInputValue('close_reason') || undefined;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.closeThread(interaction.channel, interaction.user, thread, reason);
    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }
    return interaction.editReply({ content: '✅ Modmail thread closed.' });
  }

  // Block reason modal
  if (interaction.customId === 'modmail_block_reason') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    const reason = interaction.fields.getTextInputValue('block_reason') || undefined;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.blockUser(interaction.channel, interaction.user, thread, reason);
    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }
    return interaction.editReply({ content: '✅ User blocked from modmail.' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Slash Command Handler
// ═══════════════════════════════════════════════════════════════════════════

async function handleSlashCommand(interaction) {
  if (interaction.commandName !== 'modmail') return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  // ═══════════════════════════════════════════════════════════════════════
  // Setup Subcommand Group
  // ═══════════════════════════════════════════════════════════════════════
  if (subcommandGroup === 'setup') {
    if (!core.canManageModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ You need the Administrator permission to configure modmail.', flags: MessageFlags.Ephemeral });
    }

    // ── Enable ─────────────────────────────────────────────────────────────
    if (subcommand === 'enable') {
      const category = interaction.options.getChannel('category');
      const staffRole = interaction.options.getRole('staffrole');
      const logChannel = interaction.options.getChannel('logchannel');
      const alertRole = interaction.options.getRole('alertrole');

      if (!category || category.type !== 4) {
        return interaction.reply({ content: '❌ Please select a valid category channel.', flags: MessageFlags.Ephemeral });
      }

      const config = {
        ...modmailStore.getDefaultConfig(),
        enabled: true,
        categoryId: category.id,
        staffRoleIds: [staffRole.id],
        logChannelId: logChannel ? logChannel.id : null,
        alertRoleIds: alertRole ? [alertRole.id] : [],
      };

      modmailStore.setConfig(interaction.guild.id, config);

      const embed = new EmbedBuilder()
        .setTitle('✅ Modmail Enabled')
        .setColor(0x57F287)
        .setDescription('Modmail has been configured successfully!')
        .addFields(
          { name: 'Category', value: category.toString(), inline: true },
          { name: 'Staff Role', value: staffRole.toString(), inline: true },
          { name: 'Log Channel', value: logChannel ? logChannel.toString() : 'Not set', inline: true },
          { name: 'Alert Role', value: alertRole ? alertRole.toString() : 'Not set', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Users can now DM the bot to contact staff' });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── Disable ────────────────────────────────────────────────────────────
    if (subcommand === 'disable') {
      const config = modmailStore.getConfig(interaction.guild.id);
      if (!config || !config.enabled) {
        return interaction.reply({ content: '❌ Modmail is not enabled on this server.', flags: MessageFlags.Ephemeral });
      }

      // Close all open threads
      const openThreads = modmailStore.getOpenThreads(interaction.guild.id);
      let closedCount = 0;
      for (const thread of openThreads) {
        const channel = interaction.guild.channels.cache.get(thread.channelId);
        if (channel) {
          await core.closeThread(channel, interaction.client.user, thread, 'Modmail disabled');
          closedCount++;
        }
      }

      config.enabled = false;
      modmailStore.setConfig(interaction.guild.id, config);

      return interaction.reply({
        content: `✅ Modmail disabled. ${closedCount} open thread(s) were closed.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Category ───────────────────────────────────────────────────────────
    if (subcommand === 'category') {
      const category = interaction.options.getChannel('category');
      if (!category || category.type !== 4) {
        return interaction.reply({ content: '❌ Please select a valid category channel.', flags: MessageFlags.Ephemeral });
      }

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      config.categoryId = category.id;
      modmailStore.setConfig(interaction.guild.id, config);

      return interaction.reply({ content: `✅ Modmail category set to ${category.toString()}.`, flags: MessageFlags.Ephemeral });
    }

    // ── Staff Role ─────────────────────────────────────────────────────────
    if (subcommand === 'staffrole') {
      const role = interaction.options.getRole('role');
      const action = interaction.options.getString('action');

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      if (!config.staffRoleIds) config.staffRoleIds = [];

      if (action === 'add') {
        if (!config.staffRoleIds.includes(role.id)) {
          config.staffRoleIds.push(role.id);
          modmailStore.setConfig(interaction.guild.id, config);
          return interaction.reply({ content: `✅ ${role.toString()} added as a staff role.`, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ content: `ℹ️ ${role.toString()} is already a staff role.`, flags: MessageFlags.Ephemeral });
      } else {
        const idx = config.staffRoleIds.indexOf(role.id);
        if (idx >= 0) {
          config.staffRoleIds.splice(idx, 1);
          modmailStore.setConfig(interaction.guild.id, config);
          return interaction.reply({ content: `✅ ${role.toString()} removed from staff roles.`, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ content: `ℹ️ ${role.toString()} is not a staff role.`, flags: MessageFlags.Ephemeral });
      }
    }

    // ── Log Channel ────────────────────────────────────────────────────────
    if (subcommand === 'logchannel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ content: '❌ Please select a valid text channel.', flags: MessageFlags.Ephemeral });
      }

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      config.logChannelId = channel.id;
      modmailStore.setConfig(interaction.guild.id, config);

      return interaction.reply({ content: `✅ Log channel set to ${channel.toString()}.`, flags: MessageFlags.Ephemeral });
    }

    // ── Alert Role ─────────────────────────────────────────────────────────
    if (subcommand === 'alertrole') {
      const role = interaction.options.getRole('role');

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      if (role) {
        config.alertRoleIds = [role.id];
      } else {
        config.alertRoleIds = [];
      }
      modmailStore.setConfig(interaction.guild.id, config);

      return interaction.reply({
        content: role
          ? `✅ Alert role set to ${role.toString()}.`
          : '✅ Alert role cleared (no more pings on new modmail).',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Cooldown ───────────────────────────────────────────────────────────
    if (subcommand === 'cooldown') {
      const minutes = interaction.options.getInteger('minutes');

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      config.cooldownMinutes = minutes;
      modmailStore.setConfig(interaction.guild.id, config);

      const msg = minutes === 0
        ? '✅ Cooldown disabled. Users can create modmail threads immediately after one is closed.'
        : `✅ Cooldown set to **${minutes}** minute(s) between modmail threads.`;

      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    // ── Auto-Close ─────────────────────────────────────────────────────────
    if (subcommand === 'autoclose') {
      const hours = interaction.options.getInteger('hours');

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      config.autoCloseHours = hours;
      modmailStore.setConfig(interaction.guild.id, config);

      const msg = hours === 0
        ? '✅ Auto-close disabled. Threads will stay open until manually closed.'
        : `✅ Auto-close set to **${hours}** hour(s) of inactivity.`;

      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    // ── Greeting ───────────────────────────────────────────────────────────
    if (subcommand === 'greeting') {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color = interaction.options.getString('color');

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      if (!config.greeting) config.greeting = { enabled: true, title: '📬 Modmail', description: '', color: '#5865F2' };

      if (title) config.greeting.title = title;
      if (description) config.greeting.description = description;
      if (color) {
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
          config.greeting.color = color;
        } else {
          return interaction.reply({ content: '❌ Invalid color format. Use hex format like #5865F2.', flags: MessageFlags.Ephemeral });
        }
      }

      modmailStore.setConfig(interaction.guild.id, config);
      return interaction.reply({ content: '✅ Greeting message updated.', flags: MessageFlags.Ephemeral });
    }

    // ── Auto-Reply ─────────────────────────────────────────────────────────
    if (subcommand === 'autoreply') {
      const message = interaction.options.getString('message');

      const config = modmailStore.getConfig(interaction.guild.id) || modmailStore.getDefaultConfig();
      if (!config.autoReply) config.autoReply = { enabled: false, message: '' };

      if (message) {
        config.autoReply.enabled = true;
        config.autoReply.message = message;
      } else {
        config.autoReply.enabled = false;
        config.autoReply.message = '';
      }

      modmailStore.setConfig(interaction.guild.id, config);

      return interaction.reply({
        content: message
          ? `✅ Auto-reply enabled. Users will receive: "${message}"`
          : '✅ Auto-reply disabled.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── View Configuration ─────────────────────────────────────────────────
    if (subcommand === 'view') {
      const config = modmailStore.getConfig(interaction.guild.id);
      if (!config || !config.enabled) {
        return interaction.reply({
          content: '❌ Modmail is not enabled on this server. Use `/modmail setup enable` to set it up.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const category = interaction.guild.channels.cache.get(config.categoryId);
      const logChannel = config.logChannelId ? interaction.guild.channels.cache.get(config.logChannelId) : null;
      const staffRoles = (config.staffRoleIds || []).map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);
      const alertRoles = (config.alertRoleIds || []).map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);

      const stats = modmailStore.getStats(interaction.guild.id);

      const embed = new EmbedBuilder()
        .setTitle('📬 Modmail Configuration')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Category', value: category ? category.toString() : 'Not set', inline: true },
          { name: 'Log Channel', value: logChannel ? logChannel.toString() : 'Not set', inline: true },
          { name: 'Staff Roles', value: staffRoles.length > 0 ? staffRoles.map(r => r.toString()).join(', ') : 'None set', inline: false },
          { name: 'Alert Roles', value: alertRoles.length > 0 ? alertRoles.map(r => r.toString()).join(', ') : 'None set', inline: false },
          { name: 'Cooldown', value: config.cooldownMinutes > 0 ? `${config.cooldownMinutes} min` : 'Disabled', inline: true },
          { name: 'Auto-Close', value: config.autoCloseHours > 0 ? `${config.autoCloseHours} hours` : 'Disabled', inline: true },
          { name: 'Anonymous Default', value: config.defaultAnonymous ? 'Yes' : 'No', inline: true },
          { name: 'Auto-Reply', value: config.autoReply?.enabled ? 'Yes' : 'No', inline: true },
          { name: 'Total Threads', value: String(stats.total), inline: true },
          { name: 'Open Threads', value: String(stats.open), inline: true },
          { name: 'Blocked Users', value: String(stats.blockedCount), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Modmail System' });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({ content: '❌ Unknown setup subcommand.', flags: MessageFlags.Ephemeral });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Standalone Subcommands
  // ═══════════════════════════════════════════════════════════════════════

  // ── Close ────────────────────────────────────────────────────────────────
  if (subcommand === 'close') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    if (!core.canUseModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to close modmail threads.', flags: MessageFlags.Ephemeral });
    }

    const reason = interaction.options.getString('reason') || undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.closeThread(interaction.channel, interaction.user, thread, reason);
    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }
    return interaction.editReply({ content: '✅ Modmail thread closed.' });
  }

  // ── Reopen ──────────────────────────────────────────────────────────────
  if (subcommand === 'reopen') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.reopenThread(interaction.channel, interaction.user, thread);
    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }
    return interaction.editReply({ content: '✅ Modmail thread reopened.' });
  }

  // ── Anon ─────────────────────────────────────────────────────────────────
  if (subcommand === 'anon') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    if (!core.canUseModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: MessageFlags.Ephemeral });
    }

    const forceState = interaction.options.getBoolean('enabled');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.toggleAnonymous(interaction.channel, interaction.user, thread, forceState);
    return interaction.editReply({ content: result.anonymous ? '✅ Anonymous mode enabled.' : '✅ Anonymous mode disabled.' });
  }

  // ── Block ────────────────────────────────────────────────────────────────
  if (subcommand === 'block') {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || undefined;

    if (!core.canManageModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ Only administrators can block users.', flags: MessageFlags.Ephemeral });
    }

    // Find an open thread for this user
    const thread = modmailStore.getThreadByUser(targetUser.id, interaction.guild.id);
    if (!thread) {
      return interaction.reply({ content: `❌ No open modmail thread found for **${targetUser.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.guild.channels.cache.get(thread.channelId);
    if (!channel) {
      return interaction.reply({ content: '❌ The modmail channel no longer exists.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.blockUser(channel, interaction.user, thread, reason);
    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }
    return interaction.editReply({ content: `✅ **${targetUser.tag}** blocked from modmail.` });
  }

  // ── Unblock ──────────────────────────────────────────────────────────────
  if (subcommand === 'unblock') {
    const targetUser = interaction.options.getUser('user');

    if (!core.canManageModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ Only administrators can unblock users.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await core.unblockUser(interaction.guild.id, targetUser.id, interaction.user);
    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }
    return interaction.editReply({ content: `✅ **${targetUser.tag}** unblocked from modmail.` });
  }

  // ── Blocked List ─────────────────────────────────────────────────────────
  if (subcommand === 'blocked') {
    const blockedUsers = modmailStore.getBlockedUsers(interaction.guild.id);

    if (blockedUsers.length === 0) {
      return interaction.reply({ content: '✅ No users are blocked from modmail.', flags: MessageFlags.Ephemeral });
    }

    const list = blockedUsers.map(b => {
      const date = new Date(b.blockedAt).toLocaleDateString();
      return `• <@${b.userId}> — Blocked: ${date}${b.reason ? ` (${b.reason})` : ''}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('⛔ Blocked Users')
      .setColor(0xED4245)
      .setDescription(list)
      .setFooter({ text: `${blockedUsers.length} user(s) blocked` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── Transcript ──────────────────────────────────────────────────────────
  if (subcommand === 'transcript') {
    const thread = modmailStore.getThreadByChannel(interaction.channel.id);
    if (!thread) {
      return interaction.reply({ content: '❌ This is not a modmail channel.', flags: MessageFlags.Ephemeral });
    }

    if (!core.canUseModmail(interaction.guild, interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const transcript = await core.generateTranscript(interaction.channel, thread);
    if (!transcript) {
      return interaction.editReply({ content: '❌ Failed to generate transcript.' });
    }

    await interaction.editReply({
      content: `📄 Modmail transcript for **${thread.userTag}**:`,
      files: [transcript],
    });
  }

  // ── Stats ───────────────────────────────────────────────────────────────
  if (subcommand === 'stats') {
    const config = modmailStore.getConfig(interaction.guild.id);
    if (!config || !config.enabled) {
      return interaction.reply({ content: '❌ Modmail is not enabled on this server.', flags: MessageFlags.Ephemeral });
    }

    const stats = modmailStore.getStats(interaction.guild.id);

    // Get active thread details
    const openThreads = modmailStore.getOpenThreads(interaction.guild.id);
    const activeList = openThreads.slice(0, 10).map(t => {
      const age = Math.floor((Date.now() - t.createdAt) / (1000 * 60 * 60));
      return `• **${t.userTag}** — ${age}h ago`;
    }).join('\n') || 'No open threads';

    const embed = new EmbedBuilder()
      .setTitle('📊 Modmail Statistics')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Total Threads', value: String(stats.total), inline: true },
        { name: 'Open', value: String(stats.open), inline: true },
        { name: 'Closed', value: String(stats.closed), inline: true },
        { name: 'Total Messages', value: String(stats.totalMessages), inline: true },
        { name: 'Blocked Users', value: String(stats.blockedCount), inline: true },
        { name: 'Active Threads', value: activeList, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Modmail System' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({ content: `❌ Unknown subcommand: ${subcommand}`, flags: MessageFlags.Ephemeral });
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-close Check
// ═══════════════════════════════════════════════════════════════════════════

async function checkAutoClose(client) {
  const threads = modmailStore.getThreads();
  const now = Date.now();

  for (const thread of threads) {
    if (!thread.open) continue;

    const config = modmailStore.getConfig(thread.guildId);
    if (!config || !config.enabled) continue;
    if (!config.autoCloseHours || config.autoCloseHours <= 0) continue;

    const hoursInactive = (now - thread.lastActivity) / (1000 * 60 * 60);
    if (hoursInactive >= config.autoCloseHours) {
      const guild = client.guilds.cache.get(thread.guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(thread.channelId);
      if (!channel) continue;

      try {
        await core.closeThread(channel, client.user, thread, `Auto-closed after ${config.autoCloseHours} hours of inactivity`);
        console.log(`[Modmail] Auto-closed thread ${thread.channelId} due to inactivity`);
      } catch (err) {
        console.error(`[Modmail] Auto-close failed for ${thread.channelId}:`, err.message);
      }
    }
  }
}

module.exports = {
  initModmail,
  modmailCommands,
  getStore: modmailStore,
  getCore: core,
};
