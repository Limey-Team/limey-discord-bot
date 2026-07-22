const ticketsStore = require('./store');
const core = require('./core');
const actions = require('./actions');
const panels = require('./panels');
const { ticketCommands } = require('./commands');
const { EmbedBuilder, MessageFlags } = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════
// Ticket System Initialization
// ═══════════════════════════════════════════════════════════════════════════
const ERROR_CHANNEL_ID = '1527579743543885905';

async function reportError(client, context, error) {
  try {
    const channel = client.channels.cache.get(ERROR_CHANNEL_ID);
    if (!channel) return;

    const errorEmbed = new EmbedBuilder()
      .setTitle(`❌ Error: ${context}`)
      .setColor(0xED4245)
      .setDescription(`\`\`\`\n${(error.stack || error.message || String(error)).slice(0, 1900)}\n\`\`\``)
      .addFields(
        { name: 'Name', value: error.name || 'Error', inline: true },
        { name: 'Message', value: (error.message || String(error)).slice(0, 500), inline: true }
      )
      .setTimestamp()
      .setFooter({ text: `Node ${process.version}` });

    await channel.send({ embeds: [errorEmbed] });
  } catch (reportErr) {
    // Don't loop on report errors
  }
}

function initTicketSystem(client) {
  // Initialize the store (loads configs, database)
  ticketsStore.init();
  panels.loadBlacklist();

  console.log('[Tickets] System initialized');

  // ─── Global Error Reporting ────────────────────────────────────────────
  // uncaughtException must be sync — process state is unstable, exit after logging
  process.on('uncaughtException', (err) => {
    console.error('[Tickets] Uncaught exception:', err);
    process.exit(1);
  });

  // unhandledRejection can fire-and-forget; don't await to avoid blocking
  process.on('unhandledRejection', (reason) => {
    console.error('[Tickets] Unhandled rejection:', reason);
    reportError(client, 'Unhandled Rejection', reason instanceof Error ? reason : new Error(String(reason)));
  });

  // ─── Handle Interaction Create ──────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    try {
      // ── Buttons ──────────────────────────────────────────────────────────
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }
      // ── Select Menus ─────────────────────────────────────────────────────
      else if (interaction.isStringSelectMenu()) {
        await handleSelectMenuInteraction(interaction);
      }
      // ── Modals ───────────────────────────────────────────────────────────
      else if (interaction.isModalSubmit()) {
        await handleModalInteraction(interaction);
      }
      // ── Slash Commands ───────────────────────────────────────────────────
      else if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      }
    } catch (err) {
      console.error('[Tickets] Interaction error:', err);
      await reportError(client, `Interaction: ${interaction.commandName || interaction.customId || 'unknown'}`, err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        await interaction.followUp({
          content: '❌ An error occurred while processing your request.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  });

  // ─── Autoclose / Autodelete Check Interval ───────────────────────────────
  setInterval(() => {
    checkAutocloseTickets(client);
    checkAutodeleteTickets(client);
  }, 5 * 60 * 1000); // Check every 5 minutes
}

// ═══════════════════════════════════════════════════════════════════════════
// Button Interaction Handler
// ═══════════════════════════════════════════════════════════════════════════
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;

  // Panel option button — handlers manage their own reply/deferral
  if (customId.startsWith('ticket_option_')) {
    const optionId = customId.replace('ticket_option_', '');
    return panels.handlePanelButton(interaction, optionId);
  }

  // Panel spawn button (from /ticket-panel command)
  if (customId.startsWith('ticket_panel_spawn_')) {
    const panelId = customId.replace('ticket_panel_spawn_', '');
    const panel = core.getPanel(panelId);
    if (!panel) {
      return interaction.reply({ content: '❌ Panel not found.', flags: MessageFlags.Ephemeral });
    }

    const embed = core.buildPanelEmbed(panel, interaction.guild);
    const components = core.buildPanelComponents(panel);

    return interaction.reply({
      embeds: embed ? [embed] : [],
      components,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Ticket action buttons
  if (customId.startsWith('ticket_action_')) {
    const parts = customId.replace('ticket_action_', '').split('_');
    const action = parts[0];
    const channelId = parts.slice(1).join('_');

    const ticket = ticketsStore.getTicket(channelId);
    if (!ticket) {
      return interaction.reply({ content: '❌ Ticket not found in database.', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
      return interaction.reply({ content: '❌ Ticket channel not found.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let result;
    switch (action) {
      case 'close':
        result = await actions.closeTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      case 'reopen':
        result = await actions.reopenTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      case 'claim':
        result = await actions.claimTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      case 'unclaim':
        result = await actions.unclaimTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      case 'pin':
        result = await actions.pinTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      case 'unpin':
        result = await actions.unpinTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      case 'delete':
        result = await actions.deleteTicket(interaction.guild, channel, interaction.user, ticket);
        break;
      default:
        return interaction.editReply({ content: '❌ Unknown action.' });
    }

    if (result.error) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }

    return interaction.editReply({ content: '✅ Action completed successfully.' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Select Menu Interaction Handler
// ═══════════════════════════════════════════════════════════════════════════
async function handleSelectMenuInteraction(interaction) {
  const customId = interaction.customId;

  // Panel dropdown
  if (customId.startsWith('ticket_panel_')) {
    const panelId = customId.replace('ticket_panel_', '');
    const selectedOption = interaction.values[0];
    return panels.handlePanelDropdown(interaction, panelId, selectedOption);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Modal Interaction Handler
// ═══════════════════════════════════════════════════════════════════════════
async function handleModalInteraction(interaction) {
  const customId = interaction.customId;

  // Ticket creation modal
  if (customId.startsWith('ticket_modal_')) {
    return panels.handleModalSubmit(interaction);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Slash Command Handler
// ═══════════════════════════════════════════════════════════════════════════
async function handleSlashCommand(interaction) {
  const cmd = interaction.commandName;

  switch (cmd) {
    // ── Panel ──────────────────────────────────────────────────────────────
    case 'ticket-panel': {
      if (!core.resolvePermissions(interaction.guild, interaction.member, 'panel')) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const panelId = interaction.options.getString('panel');
      const panel = core.getPanel(panelId);
      if (!panel) {
        return interaction.reply({ content: `❌ Panel "${panelId}" not found in config.`, flags: MessageFlags.Ephemeral });
      }

      const embed = core.buildPanelEmbed(panel, interaction.guild);
      const components = core.buildPanelComponents(panel);

      await interaction.reply({
        embeds: embed ? [embed] : [],
        components,
      });

      break;
    }

    // ── Close ──────────────────────────────────────────────────────────────
    case 'ticket-close': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const reason = interaction.options.getString('reason');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.closeTicket(interaction.guild, interaction.channel, interaction.user, ticket, reason, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Ticket closed.' });
    }

    // ── Reopen ─────────────────────────────────────────────────────────────
    case 'ticket-reopen': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const reason = interaction.options.getString('reason');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.reopenTicket(interaction.guild, interaction.channel, interaction.user, ticket, reason, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Ticket reopened.' });
    }

    // ── Claim ──────────────────────────────────────────────────────────────
    case 'ticket-claim': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.claimTicket(interaction.guild, interaction.channel, interaction.user, ticket, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Ticket claimed.' });
    }

    // ── Unclaim ────────────────────────────────────────────────────────────
    case 'ticket-unclaim': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.unclaimTicket(interaction.guild, interaction.channel, interaction.user, ticket, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Ticket unclaimed.' });
    }

    // ── Pin ────────────────────────────────────────────────────────────────
    case 'ticket-pin': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.pinTicket(interaction.guild, interaction.channel, interaction.user, ticket, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Ticket pinned.' });
    }

    // ── Unpin ──────────────────────────────────────────────────────────────
    case 'ticket-unpin': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.unpinTicket(interaction.guild, interaction.channel, interaction.user, ticket, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Ticket unpinned.' });
    }

    // ── Add User ───────────────────────────────────────────────────────────
    case 'ticket-add': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const target = interaction.options.getUser('member');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.addUserToTicket(interaction.guild, interaction.channel, interaction.user, ticket, target, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: `✅ Added ${target.tag} to the ticket.` });
    }

    // ── Remove User ────────────────────────────────────────────────────────
    case 'ticket-remove': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const target = interaction.options.getUser('member');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.removeUserFromTicket(interaction.guild, interaction.channel, interaction.user, ticket, target, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: `✅ Removed ${target.tag} from the ticket.` });
    }

    // ── Rename ─────────────────────────────────────────────────────────────
    case 'ticket-rename': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const newName = interaction.options.getString('name');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.renameTicket(interaction.guild, interaction.channel, interaction.user, ticket, newName, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: `✅ Ticket renamed to "${newName}".` });
    }

    // ── Move ───────────────────────────────────────────────────────────────
    case 'ticket-move': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const category = interaction.options.getChannel('category');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.moveTicket(interaction.guild, interaction.channel, interaction.user, ticket, category.id, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: `✅ Ticket moved to ${category.name}.` });
    }

    // ── Priority ───────────────────────────────────────────────────────────
    case 'ticket-priority': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const priority = interaction.options.getString('priority');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.setTicketPriority(interaction.guild, interaction.channel, interaction.user, ticket, priority, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: `✅ Priority set to ${priority}.` });
    }

    // ── Topic ──────────────────────────────────────────────────────────────
    case 'ticket-topic': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      const topic = interaction.options.getString('topic');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.setTicketTopic(interaction.guild, interaction.channel, interaction.user, ticket, topic, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({ content: '✅ Topic updated.' });
    }

    // ── Transcript ─────────────────────────────────────────────────────────
    case 'ticket-transcript': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const messages = [];
        let lastId;
        for (let i = 0; i < 3; i++) {
          const fetched = await interaction.channel.messages.fetch({ limit: 100, before: lastId });
          if (fetched.size === 0) break;
          messages.push(...fetched.values());
          lastId = fetched.last()?.id;
        }
        messages.reverse();

        const transcriptContent = messages.map(m =>
          `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`
        ).join('\n');

        const { AttachmentBuilder } = require('discord.js');
        const attachment = new AttachmentBuilder(
          Buffer.from(transcriptContent, 'utf8'),
          { name: `transcript-${ticket.channelId.slice(-6)}.txt` }
        );

        await interaction.editReply({
          content: `📄 Transcript for ticket #${ticket.channelId.slice(-6)}:`,
          files: [attachment],
        });
      } catch (err) {
        await interaction.editReply({
          content: `❌ Failed to generate transcript: ${err.message}`,
        });
      }

      break;
    }

    // ── Delete ─────────────────────────────────────────────────────────────
    case 'ticket-delete': {
      const ticket = ticketsStore.getTicket(interaction.channel.id);
      if (!ticket) {
        return interaction.reply({ content: '❌ This channel is not a ticket.', flags: MessageFlags.Ephemeral });
      }

      if (!core.isAdmin(interaction.guild, interaction.member)) {
        return interaction.reply({ content: '❌ Only admins can delete tickets.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await actions.deleteTicket(interaction.guild, interaction.channel, interaction.user, ticket, 'command');
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      // Channel is deleted, so we can't edit the reply anymore
      break;
    }

    // ── Stats ──────────────────────────────────────────────────────────────
    case 'ticket-stats': {
      const stats = await core.getTicketStats();

      const embed = new EmbedBuilder()
        .setTitle('📊 Ticket Statistics')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Total Tickets', value: stats.totalTickets.toString(), inline: true },
          { name: 'Open', value: stats.openTickets.toString(), inline: true },
          { name: 'Closed', value: stats.closedTickets.toString(), inline: true },
          { name: 'Claimed', value: stats.claimedTickets.toString(), inline: true },
          { name: 'Pinned', value: stats.pinnedTickets.toString(), inline: true },
          { name: 'Transcripts', value: stats.transcriptsGenerated.toString(), inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ── Help ───────────────────────────────────────────────────────────────
    case 'ticket-help': {
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket System Commands')
        .setColor(0x5865F2)
        .setDescription('Here are all available ticket commands:')
        .addFields(
          { name: '📋 Commands', value: [
            '`/ticket-panel` - Send a ticket panel',
            '`/ticket-help` - Show this help message',
            '`/ticket-stats` - View ticket statistics',
          ].join('\n'), inline: false },
          { name: '🔧 Ticket Actions', value: [
            '`/ticket-close` - Close this ticket',
            '`/ticket-reopen` - Reopen this ticket',
            '`/ticket-claim` - Claim this ticket',
            '`/ticket-unclaim` - Unclaim this ticket',
            '`/ticket-pin` - Pin this ticket',
            '`/ticket-unpin` - Unpin this ticket',
            '`/ticket-delete` - Delete this ticket',
          ].join('\n'), inline: false },
          { name: '👥 User Management', value: [
            '`/ticket-add` - Add a user to this ticket',
            '`/ticket-remove` - Remove a user from this ticket',
          ].join('\n'), inline: false },
          { name: '⚙️ Settings', value: [
            '`/ticket-rename` - Rename this ticket',
            '`/ticket-move` - Move this ticket to another category',
            '`/ticket-priority` - Set ticket priority',
            '`/ticket-topic` - Set ticket topic',
            '`/ticket-transcript` - Generate a transcript',
          ].join('\n'), inline: false }
        )
        .setFooter({ text: 'Use commands inside a ticket channel' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ── Blacklist ──────────────────────────────────────────────────────────
    case 'ticket-blacklist': {
      const sub = interaction.options.getSubcommand();

      if (sub === 'add') {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const added = panels.addToBlacklist(target.id);
        if (added) {
          ticketsStore.incrementStat('usersBlacklisted');
          return interaction.reply({
            content: `✅ ${target.tag} has been blacklisted from creating tickets.${reason ? `\nReason: ${reason}` : ''}`,
            flags: MessageFlags.Ephemeral,
          });
        }
        return interaction.reply({ content: `ℹ️ ${target.tag} is already blacklisted.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === 'remove') {
        const target = interaction.options.getUser('user');
        const removed = panels.removeFromBlacklist(target.id);
        if (removed) {
          return interaction.reply({ content: `✅ ${target.tag} has been removed from the blacklist.`, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ content: `ℹ️ ${target.tag} is not blacklisted.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === 'list') {
        const config = ticketsStore.getConfig('general');
        const blacklist = config?.blacklist || [];
        if (blacklist.length === 0) {
          return interaction.reply({ content: 'ℹ️ No users are blacklisted.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: `🚫 Blacklisted users:\n${blacklist.map(id => `<@${id}>`).join('\n')}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Autoclose / Autodelete Checks
// ═══════════════════════════════════════════════════════════════════════════
async function checkAutocloseTickets(client) {
  const tickets = ticketsStore.getOpenTickets();
  const now = Date.now();

  for (const ticket of tickets) {
    if (!ticket.autocloseEnabled) continue;

    const hoursInactive = (now - ticket.lastActivity) / (1000 * 60 * 60);
    if (hoursInactive >= ticket.autocloseHours) {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(ticket.channelId);
      if (!channel) continue;

      try {
        await actions.closeTicket(guild, channel, client.user, ticket, 'Auto-closed due to inactivity', 'autoclose');
        console.log(`[Tickets] Auto-closed ticket ${ticket.channelId} due to inactivity`);
      } catch (err) {
        console.error(`[Tickets] Auto-close failed for ${ticket.channelId}:`, err.message);
      }
    }
  }
}

async function checkAutodeleteTickets(client) {
  const tickets = ticketsStore.getClosedTickets();
  const now = Date.now();

  for (const ticket of tickets) {
    if (!ticket.autodeleteEnabled) continue;

    const daysSinceClose = ticket.closedAt ? (now - ticket.closedAt) / (1000 * 60 * 60 * 24) : 0;
    if (daysSinceClose >= ticket.autodeleteDays) {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(ticket.channelId);
      if (!channel) continue;

      try {
        // Create transcript first
        const transcript = await actions.generateTranscript(channel, ticket);
        // Delete channel
        await channel.delete(`Auto-deleted ticket after ${ticket.autodeleteDays} days`);
        ticketsStore.removeTicket(ticket.channelId);
        console.log(`[Tickets] Auto-deleted ticket ${ticket.channelId}`);
      } catch (err) {
        console.error(`[Tickets] Auto-delete failed for ${ticket.channelId}:`, err.message);
      }
    }
  }
}

module.exports = {
  initTicketSystem,
  ticketCommands,
  getTickets: ticketsStore.getTickets,
  getTicket: ticketsStore.getTicket,
};
