const ticketsStore = require('./store');
const core = require('./core');
const actions = require('./actions');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  MessageFlags,
} = require('discord.js');

// ─── Handle Panel Button Click ───────────────────────────────────────────
async function handlePanelButton(interaction, optionId) {
  const option = core.getOption(optionId);
  if (!option) {
    return interaction.reply({
      content: '❌ This ticket option is no longer available.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (option.type === 'website') {
    return handleWebsiteOption(interaction, option);
  }

  if (option.type === 'role') {
    return handleReactionRoleOption(interaction, option);
  }

  if (option.type === 'sub-panel') {
    return handleSubPanelOption(interaction, option);
  }

  // Default: ticket type
  return handleTicketCreation(interaction, option);
}

// ─── Handle Panel Dropdown ───────────────────────────────────────────────
async function handlePanelDropdown(interaction, panelId, selectedOptionId) {
  const option = core.getOption(selectedOptionId);
  if (!option) {
    return interaction.reply({
      content: '❌ This ticket option is no longer available.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return handleTicketCreation(interaction, option, true);
}

// ─── Website Option ──────────────────────────────────────────────────────
async function handleWebsiteOption(interaction, option) {
  if (!option.url) {
    return interaction.reply({
      content: '❌ No URL configured for this option.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(option.button?.label || 'Visit Website')
      .setStyle(ButtonStyle.Link)
      .setURL(option.url)
      .setEmoji(option.button?.emoji || undefined)
  );

  return interaction.reply({
    content: `Click the button below to visit the website:`,
    components: [button],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Reaction Role Option ────────────────────────────────────────────────
async function handleReactionRoleOption(interaction, option) {
  const member = interaction.member;
  const mode = option.mode || 'add&remove';
  const roles = option.roles || [];

  if (roles.length === 0) {
    return interaction.reply({
      content: '❌ No roles configured for this option.',
      flags: MessageFlags.Ephemeral,
    });
  }

  let added = [];
  let removed = [];

  for (const roleId of roles) {
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) continue;

    const hasRole = member.roles.cache.has(roleId);

    if (mode === 'add' || (mode === 'add&remove' && !hasRole)) {
      try {
        await member.roles.add(roleId);
        added.push(role.name);
      } catch (err) {
        console.error('[Tickets] Error adding reaction role:', err.message);
      }
    } else if (mode === 'remove' || (mode === 'add&remove' && hasRole)) {
      try {
        await member.roles.remove(roleId);
        removed.push(role.name);
      } catch (err) {
        console.error('[Tickets] Error removing reaction role:', err.message);
      }
    }
  }

  // Handle removeRolesOnAdd
  if (option.removeRolesOnAdd && added.length > 0) {
    for (const removeRoleId of option.removeRolesOnAdd) {
      if (member.roles.cache.has(removeRoleId)) {
        try {
          await member.roles.remove(removeRoleId);
          removed.push(`(removed old role)`);
        } catch (err) {}
      }
    }
  }

  const parts = [];
  if (added.length > 0) parts.push(`Added: **${added.join(', ')}**`);
  if (removed.length > 0) parts.push(`Removed: **${removed.join(', ')}**`);

  return interaction.reply({
    content: parts.length > 0
      ? `✅ Roles updated!\n${parts.join('\n')}`
      : 'ℹ️ No role changes were made.',
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Sub Panel Option ────────────────────────────────────────────────────
async function handleSubPanelOption(interaction, option) {
  const subPanel = core.getPanel(option.subPanelId);
  if (!subPanel) {
    return interaction.reply({
      content: '❌ The sub-panel configuration is missing.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = core.buildPanelEmbed(subPanel, interaction.guild);
  const components = core.buildPanelComponents(subPanel);

  return interaction.reply({
    embeds: embed ? [embed] : [],
    components,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Ticket Creation ─────────────────────────────────────────────────────
async function handleTicketCreation(interaction, option, isDeferred = false) {
  const guild = interaction.guild;
  const user = interaction.user;
  const member = interaction.member;

  // Check if user is blacklisted
  if (!option.allowCreationByBlacklistedUsers) {
    const generalConfig = ticketsStore.getConfig('general');
    if (isUserBlacklisted(user.id)) {
      const msg = '❌ You are blacklisted from creating tickets.';
      return isDeferred
        ? interaction.editReply({ content: msg })
        : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }

  // Check limits
  const config = ticketsStore.getConfig('general');
  const limits = config?.ticketSystem?.limits;
  if (limits?.enabled) {
    const tickets = ticketsStore.getTickets();
    const openTickets = tickets.filter(t => t.open);

    // Global maximum
    if (limits.globalMaximum > 0 && openTickets.length >= limits.globalMaximum) {
      const msg = `❌ The server has reached its maximum of **${limits.globalMaximum}** open tickets.`;
      return isDeferred
        ? interaction.editReply({ content: msg })
        : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    // User maximum
    if (limits.userMaximum > 0) {
      const userTickets = openTickets.filter(t => t.creatorId === user.id);
      if (userTickets.length >= limits.userMaximum) {
        const msg = `❌ You already have **${limits.userMaximum}** open ticket(s). Please close an existing ticket before creating a new one.`;
        return isDeferred
          ? interaction.editReply({ content: msg })
          : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }

    // Option-specific limits
    if (option.limits?.enabled) {
      const optionTickets = openTickets.filter(t => t.optionId === option.id);
      if (option.limits.globalMaximum > 0 && optionTickets.length >= option.limits.globalMaximum) {
        const msg = `❌ This ticket type has reached its maximum of **${option.limits.globalMaximum}** open tickets.`;
        return isDeferred
          ? interaction.editReply({ content: msg })
          : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      if (option.limits.userMaximum > 0) {
        const userOptionTickets = optionTickets.filter(t => t.creatorId === user.id);
        if (userOptionTickets.length >= option.limits.userMaximum) {
          const msg = `❌ You already have **${option.limits.userMaximum}** open ticket(s) of this type.`;
          return isDeferred
            ? interaction.editReply({ content: msg })
            : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      }
    }
  }

  // Check cooldown
  if (option.cooldown?.enabled) {
    const tickets = ticketsStore.getTicketsByUser(user.id);
    const lastTicket = tickets
      .filter(t => t.optionId === option.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (lastTicket) {
      const elapsed = Date.now() - lastTicket.createdAt;
      const cooldownMs = option.cooldown.cooldownMinutes * 60 * 1000;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
        const msg = `❌ Please wait **${remaining}** minute(s) before creating another ticket of this type.`;
        return isDeferred
          ? interaction.editReply({ content: msg })
          : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  }

  // Check if we need to show questions
  const questions = (option.questions || [])
    .map(id => core.getQuestion(id))
    .filter(Boolean);

  if (questions.length > 0 && questions.some(q => q.type !== 'text-display')) {
    return showTicketModal(interaction, option, questions, isDeferred);
  }

  // No questions — create ticket directly
  if (!isDeferred) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  return createTicketChannel(interaction, option, [], guild, user, member);
}

// ─── Show Ticket Creation Modal ──────────────────────────────────────────
async function showTicketModal(interaction, option, questions, isDeferred) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${option.id}`)
    .setTitle(`Create ${option.name} Ticket`);

  for (const q of questions) {
    if (q.type === 'text-display') continue;

    const inputId = `tq_${q.id}`;
    let input;

    if (q.type === 'paragraph') {
      input = new TextInputBuilder()
        .setCustomId(inputId)
        .setLabel(q.name.substring(0, 45))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(q.required !== false)
        .setPlaceholder(q.placeholder || '')
        .setMinLength(q.length?.enabled ? q.length.min : undefined)
        .setMaxLength(q.length?.enabled ? q.length.max : 4000);
    } else {
      input = new TextInputBuilder()
        .setCustomId(inputId)
        .setLabel(q.name.substring(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(q.required !== false)
        .setPlaceholder(q.placeholder || '')
        .setMinLength(q.length?.enabled ? q.length.min : undefined)
        .setMaxLength(q.length?.enabled ? q.length.max : 4000);
    }

    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  // Store the option ID for later
  modal.setCustomId(`ticket_modal_${option.id}`);

  if (isDeferred) {
    await interaction.editReply({ content: 'Opening ticket creation form...', components: [] });
    // We can't show a modal after deferring - send instructions instead
    return interaction.followUp({
      content: '❌ Please click a direct button below to open the ticket creation form. Dropdown menus cannot open forms directly.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(modal);
}

// ─── Handle Modal Submit ─────────────────────────────────────────────────
async function handleModalSubmit(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('ticket_modal_')) return;

  const optionId = customId.replace('ticket_modal_', '');
  const option = core.getOption(optionId);
  if (!option) {
    return interaction.reply({
      content: '❌ This ticket option is no longer available.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const questions = (option.questions || [])
    .map(id => core.getQuestion(id))
    .filter(Boolean);

  const answers = [];
  for (const q of questions) {
    if (q.type === 'text-display') continue;
    const value = interaction.fields.getTextInputValue(`tq_${q.id}`);
    answers.push({
      question: q.name,
      answer: value,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  return createTicketChannel(
    interaction,
    option,
    answers,
    interaction.guild,
    interaction.user,
    interaction.member
  );
}

// ─── Create Ticket Channel ───────────────────────────────────────────────
async function createTicketChannel(interaction, option, answers, guild, user, member) {
  try {
    // Calculate channel name
    const suffixType = option.channel?.suffix || 'user-name';
    let suffix;

    switch (suffixType) {
      case 'user-name':
        suffix = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        break;
      case 'user-id':
        suffix = user.id;
        break;
      case 'random-number':
        suffix = Math.floor(Math.random() * 99999).toString();
        break;
      case 'random-hex':
        suffix = Math.floor(Math.random() * 16777215).toString(16);
        break;
      case 'counter-dynamic':
        suffix = (ticketsStore.getTickets().length + 1).toString();
        break;
      default:
        suffix = user.id.slice(-6);
    }

    const prefix = option.channel?.prefix || 'ticket-';
    let channelName = `${prefix}${suffix}`;
    channelName = channelName.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 100);

    // Calculate category
    let categoryId = option.channel?.category || undefined;

    // Check for backup category
    const config = ticketsStore.getConfig('general');
    if (categoryId && config?.ticketSystem?.backupCategory?.enabled) {
      const category = guild.channels.cache.get(categoryId);
      if (category && category.children && category.children.cache.size >= 49) {
        categoryId = config.ticketSystem.backupCategory.categoryId || categoryId;
      }
    }

    // Build permissions
    const permissions = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ];

    // Global admins
    const globalAdmins = config?.globalAdmins || [];
    for (const adminId of globalAdmins) {
      permissions.push({
        id: adminId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.EmbedLinks,
        ],
      });
    }

    // Ticket admins
    const ticketAdmins = option.ticketAdmins || [];
    for (const adminId of ticketAdmins) {
      if (globalAdmins.includes(adminId)) continue;
      permissions.push({
        id: adminId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.EmbedLinks,
        ],
      });
    }

    // Read-only admins
    const readonlyAdmins = option.readonlyAdmins || [];
    for (const adminId of readonlyAdmins) {
      if (globalAdmins.includes(adminId) || ticketAdmins.includes(adminId)) continue;
      permissions.push({
        id: adminId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.AttachFiles],
      });
    }

    // Ticket creator
    permissions.push({
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    });

    // Create the channel
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: permissions,
      topic: option.channel?.topic || `${option.name} Ticket`,
      rateLimitPerUser: option.slowMode?.enabled ? option.slowMode.slowModeSeconds : undefined,
      reason: `Ticket created by ${user.tag}`,
    });

    // Create ticket data
    const ticketData = core.createTicketData(channel.id, option.id, user.id, answers, guild.id);

    // Build participants list
    const participants = [];
    for (const admins of [globalAdmins, ticketAdmins]) {
      for (const adminId of admins) {
        if (!participants.find(p => p.id === adminId)) {
          participants.push({ type: 'role', id: adminId });
        }
      }
    }
    ticketData.participants = participants;

    ticketsStore.addTicket(ticketData);
    ticketsStore.incrementStat('ticketsCreated');

    // Send ticket message
    await sendTicketMessage(channel, option, user, answers);

    // Send DM if configured
    if (option.dmMessage?.enabled) {
      await sendTicketDM(user, option, channel);
    }

    // Log the creation
    await logCreation(guild, channel, user, option);

    // Reply to user
    const replyEmbed = new EmbedBuilder()
      .setTitle('✅ Ticket Created')
      .setColor(0x57F287)
      .setDescription(`Your ticket has been created in ${channel.toString()}!`)
      .addFields(
        { name: 'Channel', value: channel.toString(), inline: true },
        { name: 'Type', value: option.name, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [replyEmbed] });
  } catch (err) {
    console.error('[Tickets] Error creating ticket:', err);
    await interaction.editReply({
      content: `❌ Failed to create ticket: ${err.message}`,
    });
  }
}

// ─── Send Ticket Message ─────────────────────────────────────────────────
async function sendTicketMessage(channel, option, user, answers) {
  if (!option.ticketMessage?.enabled) return;

  const { embed, text, ping } = option.ticketMessage;

  // Build ping content
  let pingContent = `${user.toString()}`;
  if (ping) {
    if (ping['@here']) pingContent += ' @here';
    if (ping['@everyone']) pingContent += ' @everyone';
    if (ping.custom?.length > 0) {
      pingContent += ' ' + ping.custom.map(id => `<@&${id}>`).join(' ');
    }
  }

  // Build embed
  const embeds = [];
  if (embed?.enabled) {
    const ticketEmbed = new EmbedBuilder()
      .setColor(embed.color ? parseInt(embed.color.replace('#', ''), 16) : 0x5865F2)
      .setTimestamp();

    if (embed.title) ticketEmbed.setTitle(embed.title);
    if (embed.description) ticketEmbed.setDescription(embed.description);

    // Add answers as fields
    if (answers.length > 0) {
      for (const a of answers) {
        ticketEmbed.addFields({ name: a.question, value: a.answer.substring(0, 1024), inline: false });
      }
    }

    embeds.push(ticketEmbed);
  }

  // Build action components
  const ticket = ticketsStore.getTicket(channel.id);
  const components = ticket ? core.buildTicketActionComponents(ticket) : [];

  await channel.send({
    content: pingContent || undefined,
    embeds,
    components,
  });
}

// ─── Send DM ─────────────────────────────────────────────────────────────
async function sendTicketDM(user, option, channel) {
  try {
    const dmConfig = option.dmMessage;
    const embed = new EmbedBuilder()
      .setColor(
        dmConfig.embed?.color
          ? parseInt(dmConfig.embed.color.replace('#', ''), 16)
          : 0x5865F2
      );

    if (dmConfig.embed?.title) embed.setTitle(dmConfig.embed.title);
    if (dmConfig.embed?.description) embed.setDescription(dmConfig.embed.description);
    embed.addFields(
      { name: 'Channel', value: channel.toString(), inline: true },
      { name: 'Type', value: option.name, inline: true }
    );
    embed.setTimestamp();

    await user.send({
      content: dmConfig.text || undefined,
      embeds: dmConfig.embed?.enabled ? [embed] : [],
    });
  } catch (err) {
    // DM might be disabled by user, silently fail
  }
}

// ─── Log Creation ────────────────────────────────────────────────────────
async function logCreation(guild, channel, user, option) {
  const config = ticketsStore.getConfig('general');
  if (!config?.logs?.enabled || !config.logs.channel) return;
  if (!config.logs.logMessages?.creation?.logs) return;

  const logChannel = guild.channels.cache.get(config.logs.channel);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket Created')
    .setColor(0x57F287)
    .addFields(
      { name: 'Channel', value: channel.toString(), inline: true },
      { name: 'Creator', value: user.tag, inline: true },
      { name: 'Type', value: option.name, inline: true }
    )
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {}
}

// ─── Blacklist Management ────────────────────────────────────────────────
let blacklistCache = [];

function loadBlacklist() {
  const config = ticketsStore.getConfig('general');
  blacklistCache = config?.blacklist || [];
  return blacklistCache;
}

function isUserBlacklisted(userId) {
  if (blacklistCache.length === 0) loadBlacklist();
  return blacklistCache.includes(userId);
}

function addToBlacklist(userId) {
  const config = ticketsStore.getConfig('general');
  if (!config.blacklist) config.blacklist = [];
  if (!config.blacklist.includes(userId)) {
    config.blacklist.push(userId);
    ticketsStore.setConfig('general', config);
    loadBlacklist();
    return true;
  }
  return false;
}

function removeFromBlacklist(userId) {
  const config = ticketsStore.getConfig('general');
  if (!config.blacklist) return false;
  const idx = config.blacklist.indexOf(userId);
  if (idx >= 0) {
    config.blacklist.splice(idx, 1);
    ticketsStore.setConfig('general', config);
    loadBlacklist();
    return true;
  }
  return false;
}

module.exports = {
  handlePanelButton,
  handlePanelDropdown,
  handleModalSubmit,
  handleTicketCreation,
  // Blacklist
  loadBlacklist,
  isUserBlacklisted,
  addToBlacklist,
  removeFromBlacklist,
};
