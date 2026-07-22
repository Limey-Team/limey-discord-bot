const modmailStore = require('./store');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════
// Modmail Permissions
// ═══════════════════════════════════════════════════════════════════════════

function canUseModmail(guild, member) {
  if (!member) return false;
  const config = modmailStore.getConfig(guild.id);
  if (!config || !config.enabled) return false;

  // Server owner and admins can always use modmail
  if (member.id === guild.ownerId) return true;
  if (member.permissions && member.permissions.has('Administrator')) return true;

  // Check staff roles
  const staffRoleIds = config.staffRoleIds || [];
  if (staffRoleIds.length === 0) return false;

  return staffRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function canManageModmail(guild, member) {
  if (!member) return false;
  // Only admins and server owners can configure modmail
  if (member.id === guild.ownerId) return true;
  if (member.permissions && member.permissions.has('Administrator')) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Create Modmail Thread
// ═══════════════════════════════════════════════════════════════════════════

async function createModmailThread(client, guild, user, firstMessage) {
  const config = modmailStore.getConfig(guild.id);
  if (!config || !config.enabled) return null;

  // Check if user is blocked
  if (modmailStore.isUserBlocked(user.id, guild.id)) {
    try {
      const blockEmbed = new EmbedBuilder()
        .setTitle('⛔ Blocked')
        .setColor(0xED4245)
        .setDescription('You have been blocked from using Modmail in this server. If you believe this is a mistake, please contact a server administrator through other means.')
        .setTimestamp();
      await user.send({ embeds: [blockEmbed] }).catch(() => {});
    } catch (_) {}
    return null;
  }

  // Check for existing open thread
  const existingThread = modmailStore.getThreadByUser(user.id, guild.id);
  if (existingThread) {
    const existingChannel = client.channels.cache.get(existingThread.channelId);
    if (existingChannel) {
      // Forward the message to the existing thread
      await forwardUserMessage(existingChannel, user, firstMessage, existingThread);
      return existingThread;
    } else {
      // Channel was deleted, remove old thread and create new one
      modmailStore.removeThread(existingThread.channelId);
    }
  }

  // Check cooldown
  if (config.cooldownMinutes > 0) {
    const closedThreads = modmailStore.getClosedThreads(guild.id)
      .filter(t => t.userId === user.id)
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));

    if (closedThreads.length > 0) {
      const lastClosed = closedThreads[0].closedAt || 0;
      const elapsed = Date.now() - lastClosed;
      const cooldownMs = config.cooldownMinutes * 60 * 1000;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
        try {
          const cooldownEmbed = new EmbedBuilder()
            .setTitle('⏳ Cooldown')
            .setColor(0xFEE75C)
            .setDescription(`Please wait **${remaining}** minute(s) before starting a new modmail conversation.`)
            .setTimestamp();
          await user.send({ embeds: [cooldownEmbed] }).catch(() => {});
        } catch (_) {}
        return null;
      }
    }
  }

  // Create the staff channel
  const categoryId = config.categoryId;
  const guildChannels = guild.channels.cache;

  // Check if category exists
  if (categoryId && !guildChannels.has(categoryId)) {
    console.error(`[Modmail] Category ${categoryId} not found in guild ${guild.id}`);
    return null;
  }

  // Build channel name
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20) || user.id.slice(-6);
  const channelName = `modmail-${safeName}`;

  // Build permissions
  const permissions = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
      ],
    },
  ];

  // Staff roles
  const staffRoleIds = config.staffRoleIds || [];
  for (const roleId of staffRoleIds) {
    permissions.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
      ],
    });
  }

  // Server owner
  permissions.push({
    id: guild.ownerId,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.AddReactions,
    ],
  });

  try {
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId || undefined,
      permissionOverwrites: permissions,
      topic: `Modmail conversation with ${user.tag} (${user.id})`,
      reason: `Modmail thread created for ${user.tag}`,
    });

    // Create thread data
    const thread = {
      channelId: channel.id,
      userId: user.id,
      userTag: user.tag,
      guildId: guild.id,
      createdAt: Date.now(),
      open: true,
      closedAt: null,
      closedBy: null,
      closedReason: null,
      blocked: false,
      anonymousReplies: false,
      messageCount: 0,
      lastActivity: Date.now(),
    };

    modmailStore.addThread(thread);

    // Send greeting embed
    await sendGreeting(channel, user, config);

    // Forward the first message
    await forwardUserMessage(channel, user, firstMessage, thread);

    // Send alert to staff
    await sendStaffAlert(client, guild, channel, user, config);

    // Log creation
    await logAction(client, guild, 'modmailCreated', {
      userId: user.id,
      userTag: user.tag,
      channelId: channel.id,
    });

    return thread;
  } catch (err) {
    console.error(`[Modmail] Failed to create thread channel:`, err.message);
    try {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setColor(0xED4245)
        .setDescription('Failed to create a modmail thread. Please try again later or contact a server administrator.')
        .setTimestamp();
      await user.send({ embeds: [errorEmbed] }).catch(() => {});
    } catch (_) {}
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Send Greeting
// ═══════════════════════════════════════════════════════════════════════════

async function sendGreeting(channel, user, config) {
  if (!config.greeting?.enabled) return;

  const greetingEmbed = new EmbedBuilder()
    .setTitle(config.greeting.title || '📬 Modmail')
    .setColor(parseInt((config.greeting.color || '#5865F2').replace('#', ''), 16) || 0x5865F2)
    .setDescription(config.greeting.description || 'Welcome to Modmail! A staff member will be with you shortly.')
    .addFields(
      { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
      { name: 'Status', value: '🟢 Open', inline: true }
    )
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setTimestamp()
    .setFooter({ text: 'Modmail System' });

  // Add anonymous reply notice
  const anonNote = '💬 Staff can use `/modmail anon` to toggle anonymous replies.';

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('modmail_close')
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
      new ButtonBuilder()
        .setCustomId('modmail_anon')
        .setLabel('Anonymous')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👤'),
      new ButtonBuilder()
        .setCustomId('modmail_block')
        .setLabel('Block User')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⛔')
    ),
  ];

  await channel.send({
    content: anonNote,
    embeds: [greetingEmbed],
    components,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Send Staff Alert
// ═══════════════════════════════════════════════════════════════════════════

async function sendStaffAlert(client, guild, channel, user, config) {
  const logChannelId = config.logChannelId;
  if (!logChannelId) return;

  const logChannel = client.channels.cache.get(logChannelId);
  if (!logChannel) return;

  const alertEmbed = new EmbedBuilder()
    .setTitle('📬 New Modmail')
    .setColor(0x57F287)
    .setDescription(`A new modmail conversation has been opened by **${user.tag}**`)
    .addFields(
      { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
      { name: 'Channel', value: channel.toString(), inline: true }
    )
    .setThumbnail(user.displayAvatarURL({ size: 64 }))
    .setTimestamp()
    .setFooter({ text: 'Modmail System' });

  const alertRoles = config.alertRoleIds || [];
  let alertContent;
  if (alertRoles.length > 0) {
    alertContent = alertRoles.map(id => `<@&${id}>`).join(' ');
  }

  await logChannel.send({
    content: alertContent || undefined,
    embeds: [alertEmbed],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Forward User Message to Staff Channel
// ═══════════════════════════════════════════════════════════════════════════

async function forwardUserMessage(channel, user, message, thread) {
  if (!message) return;

  // Build the user message embed
  const userEmbed = new EmbedBuilder()
    .setAuthor({
      name: user.tag,
      iconURL: user.displayAvatarURL({ size: 64 }),
    })
    .setColor(0x57F287)
    .setDescription(message.content || '*[no text content]*')
    .setTimestamp()
    .setFooter({ text: `User ID: ${user.id}` });

  const files = [];
  if (message.attachments && message.attachments.size > 0) {
    const attachmentList = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
    userEmbed.addFields({ name: 'Attachments', value: attachmentList });

    // Download attachments and re-upload to the staff channel
    for (const [, attachment] of message.attachments) {
      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        files.push(new AttachmentBuilder(buffer, { name: attachment.name }));
      } catch (err) {
        console.error(`[Modmail] Failed to download attachment:`, err.message);
      }
    }
  }

  const sent = await channel.send({
    embeds: [userEmbed],
    files: files.length > 0 ? files : undefined,
  });

  // Update thread stats
  modmailStore.updateThread(channel.id, {
    messageCount: (thread.messageCount || 0) + 1,
    lastActivity: Date.now(),
  });

  return sent;
}

// ═══════════════════════════════════════════════════════════════════════════
// Forward Staff Reply to User DM
// ═══════════════════════════════════════════════════════════════════════════

async function forwardStaffReply(client, channel, message, thread) {
  const config = modmailStore.getConfig(thread.guildId);
  if (!config) return;

  const guild = client.guilds.cache.get(thread.guildId);
  if (!guild) return;

  const user = await client.users.fetch(thread.userId).catch(() => null);
  if (!user) {
    await channel.send('❌ Could not find the user. They may have left Discord or deleted their account.').catch(() => {});
    return;
  }

  const isAnonymous = thread.anonymousReplies;
  const authorName = isAnonymous ? 'Staff Member' : message.member?.displayName || message.author.username;
  const authorIcon = isAnonymous
    ? 'https://cdn.discordapp.com/embed/avatars/0.png'
    : message.author.displayAvatarURL({ size: 64 });

  const replyEmbed = new EmbedBuilder()
    .setAuthor({ name: authorName, iconURL: authorIcon })
    .setColor(isAnonymous ? 0x808080 : 0x5865F2)
    .setDescription(message.content || '*[no text content]*')
    .setTimestamp()
    .setFooter({ text: isAnonymous ? 'Anonymous Reply' : `Staff: ${message.author.tag}` });

  const files = [];
  if (message.attachments && message.attachments.size > 0) {
    const attachmentList = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
    replyEmbed.addFields({ name: 'Attachments', value: attachmentList });

    for (const [, attachment] of message.attachments) {
      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        files.push(new AttachmentBuilder(buffer, { name: attachment.name }));
      } catch (err) {
        console.error(`[Modmail] Failed to download attachment for reply:`, err.message);
      }
    }
  }

  try {
    const dmSent = await user.send({
      embeds: [replyEmbed],
      files: files.length > 0 ? files : undefined,
    });

    // Mark the staff message as forwarded
    const forwardedEmoji = '📨';
    await message.react(forwardedEmoji).catch(() => {});

    // Update thread stats
    modmailStore.updateThread(channel.id, {
      messageCount: (thread.messageCount || 0) + 1,
      lastActivity: Date.now(),
    });

    return dmSent;
  } catch (err) {
    await channel.send(`❌ Failed to send DM to **${thread.userTag}**. They may have DMs disabled or have left the server.`).catch(() => {});
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Close Modmail Thread
// ═══════════════════════════════════════════════════════════════════════════

async function closeThread(channel, user, thread, reason) {
  if (!thread.open) {
    return { error: 'This modmail thread is already closed.' };
  }

  const guild = channel.guild;

  // Update thread data
  thread.open = false;
  thread.closedAt = Date.now();
  thread.closedBy = user.id;
  thread.closedReason = reason || null;

  modmailStore.updateThread(thread.channelId, thread);

  // Send closing embed in staff channel
  const config = modmailStore.getConfig(thread.guildId);
  const closeEmbed = new EmbedBuilder()
    .setTitle('🔒 Modmail Closed')
    .setColor(0xED4245)
    .setDescription(`This modmail conversation has been closed by **${user.tag}**.`)
    .setTimestamp();

  if (reason) {
    closeEmbed.addFields({ name: 'Reason', value: reason });
  }

  await channel.send({ embeds: [closeEmbed] });

  // Update channel permissions (read-only for staff)
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
    });

    // Make it read-only for staff roles
    const staffRoleIds = config?.staffRoleIds || [];
    for (const roleId of staffRoleIds) {
      const overwrite = channel.permissionOverwrites.cache.get(roleId);
      if (overwrite) {
        await channel.permissionOverwrites.edit(roleId, {
          SendMessages: false,
          AddReactions: false,
        });
      }
    }

    await channel.permissionOverwrites.edit(guild.ownerId, {
      SendMessages: false,
      AddReactions: false,
    });

    await channel.permissionOverwrites.edit(guild.client.user.id, {
      SendMessages: false,
      AddReactions: false,
    });
  } catch (err) {
    console.error('[Modmail] Error updating permissions on close:', err.message);
  }

  // Update channel topic
  try {
    await channel.setTopic(`[CLOSED] Modmail with ${thread.userTag} (${thread.userId})`);
  } catch (_) {}

  // Send DM to user
  try {
    const userDiscord = await guild.client.users.fetch(thread.userId).catch(() => null);
    if (userDiscord && config?.closingMessage?.enabled) {
      const closingEmbed = new EmbedBuilder()
        .setTitle(config.closingMessage.title || '🔒 Modmail Closed')
        .setColor(parseInt((config.closingMessage.color || '#ED4245').replace('#', ''), 16) || 0xED4245)
        .setDescription(config.closingMessage.description || 'This modmail conversation has been closed. If you need further assistance, feel free to send a new message.')
        .setTimestamp();

      if (reason) {
        closingEmbed.addFields({ name: 'Reason', value: reason });
      }

      await userDiscord.send({ embeds: [closingEmbed] }).catch(() => {});
    }
  } catch (_) {}

  // Log the close
  await logAction(guild.client, guild, 'modmailClosed', {
    userId: thread.userId,
    userTag: thread.userTag,
    channelId: thread.channelId,
    closedBy: user.tag,
    reason: reason || 'No reason provided',
  });

  return { success: true, thread };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reopen Modmail Thread
// ═══════════════════════════════════════════════════════════════════════════

async function reopenThread(channel, user, thread) {
  if (thread.open) {
    return { error: 'This modmail thread is already open.' };
  }

  if (!canManageModmail(channel.guild, channel.guild.members.cache.get(user.id))) {
    return { error: 'Only administrators can reopen modmail threads.' };
  }

  const guild = channel.guild;
  const config = modmailStore.getConfig(thread.guildId);

  // Update thread data
  thread.open = true;
  thread.closedAt = null;
  thread.closedBy = null;
  thread.closedReason = null;

  modmailStore.updateThread(thread.channelId, thread);

  // Restore permissions
  try {
    const staffRoleIds = config?.staffRoleIds || [];
    for (const roleId of staffRoleIds) {
      const overwrite = channel.permissionOverwrites.cache.get(roleId);
      if (overwrite) {
        await channel.permissionOverwrites.edit(roleId, {
          SendMessages: true,
          AddReactions: true,
        });
      }
    }

    await channel.permissionOverwrites.edit(guild.ownerId, {
      SendMessages: true,
      AddReactions: true,
    });

    await channel.permissionOverwrites.edit(guild.client.user.id, {
      SendMessages: true,
      AddReactions: true,
    });
  } catch (err) {
    console.error('[Modmail] Error restoring permissions on reopen:', err.message);
  }

  // Update channel topic
  try {
    await channel.setTopic(`Modmail conversation with ${thread.userTag} (${thread.userId})`);
  } catch (_) {}

  const reopenEmbed = new EmbedBuilder()
    .setTitle('🔓 Modmail Reopened')
    .setColor(0x57F287)
    .setDescription(`This modmail conversation has been reopened by **${user.tag}**.`)
    .setTimestamp();

  await channel.send({ embeds: [reopenEmbed] });

  return { success: true, thread };
}

// ═══════════════════════════════════════════════════════════════════════════
// Toggle Anonymous Replies
// ═══════════════════════════════════════════════════════════════════════════

async function toggleAnonymous(channel, user, thread, forceState) {
  const newState = forceState !== undefined ? forceState : !thread.anonymousReplies;
  thread.anonymousReplies = newState;
  modmailStore.updateThread(thread.channelId, { anonymousReplies: newState });

  const embed = new EmbedBuilder()
    .setTitle(newState ? '👤 Anonymous Mode ON' : '👤 Anonymous Mode OFF')
    .setColor(newState ? 0x808080 : 0x5865F2)
    .setDescription(
      newState
        ? 'Replies will now be sent **anonymously** — the user will see "Staff Member" instead of your name.'
        : 'Replies will now show your **username and avatar** to the user.'
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});

  return { success: true, anonymous: newState };
}

// ═══════════════════════════════════════════════════════════════════════════
// Block / Unblock User
// ═══════════════════════════════════════════════════════════════════════════

async function blockUser(channel, user, thread, reason) {
  const guild = channel.guild;
  const alreadyBlocked = modmailStore.isUserBlocked(thread.userId, guild.id);

  if (alreadyBlocked) {
    return { error: 'This user is already blocked from using modmail.' };
  }

  modmailStore.blockUser(thread.userId, guild.id, user.id, reason);

  const embed = new EmbedBuilder()
    .setTitle('⛔ User Blocked')
    .setColor(0xED4245)
    .setDescription(`**${thread.userTag}** has been blocked from using modmail by **${user.tag}**.`)
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason });
  }

  await channel.send({ embeds: [embed] });

  // Close the thread if open
  if (thread.open) {
    await closeThread(channel, user, thread, reason || 'User blocked');
  }

  await logAction(guild.client, guild, 'modmailBlocked', {
    userId: thread.userId,
    userTag: thread.userTag,
    blockedBy: user.tag,
    channelId: thread.channelId,
    reason: reason || 'No reason provided',
  });

  return { success: true };
}

async function unblockUser(guildId, targetUserId, user) {
  const unblocked = modmailStore.unblockUser(targetUserId, guildId);
  if (!unblocked) {
    return { error: 'This user is not blocked.' };
  }

  const guild = user.client.guilds.cache.get(guildId);
  if (guild) {
    await logAction(user.client, guild, 'modmailUnblocked', {
      userId: targetUserId,
      unblockedBy: user.tag,
    });
  }

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Handle DM from User
// ═══════════════════════════════════════════════════════════════════════════

async function handleUserDM(client, message) {
  const user = message.author;
  if (user.bot) return;

  // Find which guild the user shares with the bot that has modmail enabled
  const mutualGuilds = client.guilds.cache.filter(guild => {
    const config = modmailStore.getConfig(guild.id);
    return config && config.enabled && guild.members.cache.has(user.id);
  });

  if (mutualGuilds.size === 0) {
    // No guild with modmail enabled that the user is in
    const embed = new EmbedBuilder()
      .setTitle('📬 Modmail')
      .setColor(0x5865F2)
      .setDescription(
        'Hello! This bot uses Modmail, but no server you\'re in has it enabled.\n\n' +
        'If you\'re trying to contact a specific server\'s staff, please join that server first and then DM me again.'
      )
      .setTimestamp();
    await message.author.send({ embeds: [embed] }).catch(() => {});
    return;
  }

  // If user is only in one guild with modmail, use that one
  // Otherwise, we need to handle multiple guilds - for simplicity, use the first one
  // Or we could ask the user which guild they want to contact

  let targetGuild;

  if (mutualGuilds.size === 1) {
    targetGuild = mutualGuilds.first();
  } else {
    // Multiple guilds - try to find the most recent thread or use the first one
    const threads = modmailStore.getThreads();
    const recentThread = threads
      .filter(t => t.userId === user.id && mutualGuilds.has(t.guildId))
      .sort((a, b) => b.lastActivity - a.lastActivity)[0];

    if (recentThread) {
      targetGuild = mutualGuilds.get(recentThread.guildId) || mutualGuilds.first();
    } else {
      targetGuild = mutualGuilds.first();
    }
  }

  // Handle auto-reply (for first message)
  const config = modmailStore.getConfig(targetGuild.id);
  if (config?.autoReply?.enabled) {
    try {
      const autoEmbed = new EmbedBuilder()
        .setTitle('📬 Modmail')
        .setColor(0x5865F2)
        .setDescription(config.autoReply.message)
        .setTimestamp();
      await message.author.send({ embeds: [autoEmbed] }).catch(() => {});
    } catch (_) {}
  }

  // Create or find existing thread
  await createModmailThread(client, targetGuild, user, message);
}

// ═══════════════════════════════════════════════════════════════════════════
// Generate Transcript
// ═══════════════════════════════════════════════════════════════════════════

async function generateTranscript(channel, thread) {
  try {
    const messages = [];
    let lastId;
    for (let i = 0; i < 5; i++) {
      const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
      if (fetched.size === 0) break;
      messages.push(...fetched.values());
      lastId = fetched.last()?.id;
    }

    // Sort chronological
    messages.reverse();

    const lines = [
      `╔═══════════════════════════════════════════╗`,
      `║         MODMAIL TRANSCRIPT                ║`,
      `╚═══════════════════════════════════════════╝`,
      ``,
      `User: ${thread.userTag} (${thread.userId})`,
      `Guild ID: ${thread.guildId}`,
      `Opened: ${new Date(thread.createdAt).toLocaleString()}`,
      `Closed: ${thread.closedAt ? new Date(thread.closedAt).toLocaleString() : 'Still open'}`,
      `Closed By: ${thread.closedBy || 'N/A'}`,
      `Total Messages: ${messages.length}`,
      `Anonymous Mode: ${thread.anonymousReplies ? 'Yes' : 'No'}`,
      ``,
      `─────────────────────────────────────────────`,
      ``,
    ];

    for (const msg of messages) {
      const timestamp = new Date(msg.createdTimestamp).toISOString();
      const author = msg.author.bot
        ? `[BOT] ${msg.author.tag}`
        : msg.author.tag;
      const content = msg.content || '[embed/sticker/system message]';

      lines.push(`[${timestamp}] ${author}`);
      if (content) lines.push(`  ${content}`);

      // Attachments
      if (msg.attachments.size > 0) {
        for (const [, attachment] of msg.attachments) {
          lines.push(`  📎 ${attachment.name}: ${attachment.url}`);
        }
      }

      // Embeds
      if (msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          if (embed.title) lines.push(`  📄 ${embed.title}`);
          if (embed.description) lines.push(`     ${embed.description}`);
        }
      }

      lines.push('');
    }

    lines.push(`─────────────────────────────────────────────`);
    lines.push(`Transcript generated: ${new Date().toISOString()}`);
    lines.push(`Modmail System`);

    const content = lines.join('\n');
    const attachment = new AttachmentBuilder(
      Buffer.from(content, 'utf8'),
      { name: `modmail-${thread.channelId.slice(-6)}.txt` }
    );

    return attachment;
  } catch (err) {
    console.error('[Modmail] Error generating transcript:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════

async function logAction(client, guild, action, data) {
  const config = modmailStore.getConfig(guild.id);
  const logChannelId = config?.logChannelId;
  if (!logChannelId) return;

  const logChannel = client.channels.cache.get(logChannelId);
  if (!logChannel) return;

  const actionLabels = {
    modmailCreated: '📬 Modmail Created',
    modmailClosed: '🔒 Modmail Closed',
    modmailReopened: '🔓 Modmail Reopened',
    modmailBlocked: '⛔ User Blocked',
    modmailUnblocked: '✅ User Unblocked',
  };

  const embed = new EmbedBuilder()
    .setTitle(actionLabels[action] || `📋 ${action}`)
    .setColor(0x5865F2)
    .setTimestamp();

  if (data.userTag) embed.addFields({ name: 'User', value: data.userTag, inline: true });
  if (data.userId) embed.addFields({ name: 'User ID', value: data.userId, inline: true });
  if (data.channelId) embed.addFields({ name: 'Channel', value: `<#${data.channelId}>`, inline: true });
  if (data.closedBy) embed.addFields({ name: 'Closed By', value: data.closedBy, inline: true });
  if (data.blockedBy) embed.addFields({ name: 'Blocked By', value: data.blockedBy, inline: true });
  if (data.unblockedBy) embed.addFields({ name: 'Unblocked By', value: data.unblockedBy, inline: true });
  if (data.reason) embed.addFields({ name: 'Reason', value: data.reason.substring(0, 1024) });

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Modmail] Log error:', err.message);
  }
}

module.exports = {
  canUseModmail,
  canManageModmail,
  createModmailThread,
  forwardUserMessage,
  forwardStaffReply,
  closeThread,
  reopenThread,
  toggleAnonymous,
  blockUser,
  unblockUser,
  handleUserDM,
  generateTranscript,
  logAction,
};
