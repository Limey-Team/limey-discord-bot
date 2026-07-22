const ticketsStore = require('./store');
const core = require('./core');
const { EmbedBuilder, channelMention } = require('discord.js');

// ─── Close Ticket ────────────────────────────────────────────────────────
async function closeTicket(guild, channel, user, ticket, reason, origin = 'button') {
  if (!ticket.open) {
    return { error: 'This ticket is already closed.' };
  }

  // Check permissions
  if (!core.canCloseTicket(guild, user, ticket)) {
    return { error: 'You do not have permission to close this ticket.' };
  }

  // Update ticket data
  ticket.open = false;
  ticket.closed = true;
  ticket.closedAt = Date.now();
  ticket.closedBy = user.id;
  ticket.reopened = false;

  ticketsStore.updateTicket(ticket.channelId, ticket);
  ticketsStore.incrementStat('ticketsClosed');

  // Get config for permission updates and closed category
  const config = ticketsStore.getConfig('general');

  // Update channel permissions for non-admins (read-only)
  try {
    if (config?.ticketSystem?.removeParticipantsOnClose) {
      await channel.permissionOverwrites.edit(ticket.creatorId, {
        ViewChannel: true,
        SendMessages: false,
        AddReactions: false,
        ReadMessageHistory: true,
      });
    } else {
      await channel.permissionOverwrites.edit(ticket.creatorId, {
        ViewChannel: true,
        SendMessages: false,
        AddReactions: false,
        ReadMessageHistory: true,
      });
    }
  } catch (err) {
    console.error('[Tickets] Error updating permissions on close:', err.message);
  }

  // Move to closed category if configured
  if (config?.ticketSystem?.closedCategory?.enabled && config.ticketSystem.closedCategory.categoryId) {
    try {
      await channel.setParent(config.ticketSystem.closedCategory.categoryId, { lockPermissions: false });
      ticket.closedCategoryId = config.ticketSystem.closedCategory.categoryId;
      ticketsStore.updateTicket(ticket.channelId, ticket);
    } catch (err) {
      console.error('[Tickets] Error moving to closed category:', err.message);
    }
  }

  // Update channel topic
  await updateChannelTopic(channel, ticket);

  // Send close message
  const embed = new EmbedBuilder()
    .setTitle('🔒 Ticket Closed')
    .setColor(0xED4245)
    .setDescription(`This ticket has been closed by <@${user.id}>.`)
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason });
  }

  await channel.send({ embeds: [embed] });

  // Log the action
  await logTicketAction(guild, channel, user, ticket, 'close', reason);

  return { success: true, ticket };
}

// ─── Reopen Ticket ───────────────────────────────────────────────────────
async function reopenTicket(guild, channel, user, ticket, reason, origin = 'button') {
  if (ticket.open) {
    return { error: 'This ticket is already open.' };
  }

  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can reopen tickets.' };
  }

  ticket.open = true;
  ticket.closed = false;
  ticket.closedAt = null;
  ticket.closedBy = null;
  ticket.reopened = true;
  ticket.reopenedBy = user.id;
  ticket.reopenedAt = Date.now();

  ticketsStore.updateTicket(ticket.channelId, ticket);

  // Restore permissions
  try {
    // Give creator send permissions again
    await channel.permissionOverwrites.edit(ticket.creatorId, {
      ViewChannel: true,
      SendMessages: true,
      AddReactions: true,
      ReadMessageHistory: true,
    });
  } catch (err) {
    console.error('[Tickets] Error updating permissions on reopen:', err.message);
  }

  // Move back to original category
  const option = core.getOption(ticket.optionId);
  if (option?.channel?.category) {
    try {
      await channel.setParent(option.channel.category, { lockPermissions: false });
    } catch (err) {
      console.error('[Tickets] Error moving to original category:', err.message);
    }
  }

  await updateChannelTopic(channel, ticket);

  const embed = new EmbedBuilder()
    .setTitle('🔓 Ticket Reopened')
    .setColor(0x57F287)
    .setDescription(`This ticket has been reopened by <@${user.id}>.`)
    .setTimestamp();

  if (reason) embed.addFields({ name: 'Reason', value: reason });
  await channel.send({ embeds: [embed] });

  await logTicketAction(guild, channel, user, ticket, 'reopen', reason);
  return { success: true, ticket };
}

// ─── Claim Ticket ────────────────────────────────────────────────────────
async function claimTicket(guild, channel, user, ticket, origin = 'button') {
  if (ticket.claimed) {
    return { error: `This ticket is already claimed by <@${ticket.claimedBy}>.` };
  }

  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can claim tickets.' };
  }

  ticket.claimed = true;
  ticket.claimedBy = user.id;
  ticket.claimedAt = Date.now();

  ticketsStore.updateTicket(ticket.channelId, ticket);
  await updateChannelTopic(channel, ticket);

  const embed = new EmbedBuilder()
    .setTitle('🙋 Ticket Claimed')
    .setColor(0x5865F2)
    .setDescription(`This ticket has been claimed by <@${user.id}>.`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await logTicketAction(guild, channel, user, ticket, 'claim');
  return { success: true, ticket };
}

// ─── Unclaim Ticket ──────────────────────────────────────────────────────
async function unclaimTicket(guild, channel, user, ticket, origin = 'button') {
  if (!ticket.claimed) {
    return { error: 'This ticket is not claimed.' };
  }

  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can unclaim tickets.' };
  }

  ticket.claimed = false;
  ticket.claimedBy = null;
  ticket.claimedAt = null;

  ticketsStore.updateTicket(ticket.channelId, ticket);
  await updateChannelTopic(channel, ticket);

  const embed = new EmbedBuilder()
    .setTitle('🙋 Ticket Unclaimed')
    .setColor(0x5865F2)
    .setDescription(`This ticket has been unclaimed by <@${user.id}>.`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await logTicketAction(guild, channel, user, ticket, 'unclaim');
  return { success: true, ticket };
}

// ─── Pin Ticket ──────────────────────────────────────────────────────────
async function pinTicket(guild, channel, user, ticket, origin = 'button') {
  if (ticket.pinned) {
    return { error: 'This ticket is already pinned.' };
  }

  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can pin tickets.' };
  }

  ticket.pinned = true;
  ticket.pinnedBy = user.id;
  ticket.pinnedAt = Date.now();

  ticketsStore.updateTicket(ticket.channelId, ticket);
  await updateChannelTopic(channel, ticket);

  // Update channel name with pin emoji
  const config = ticketsStore.getConfig('general');
  const pinEmoji = config?.ticketSystem?.pinEmoji || '📌';
  if (!channel.name.startsWith(pinEmoji)) {
    try {
      await channel.setName(`${pinEmoji}${channel.name}`);
    } catch (err) {
      console.error('[Tickets] Error renaming channel for pin:', err.message);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📌 Ticket Pinned')
    .setColor(0xFEE75C)
    .setDescription(`This ticket has been pinned by <@${user.id}>.`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await logTicketAction(guild, channel, user, ticket, 'pin');
  return { success: true, ticket };
}

// ─── Unpin Ticket ────────────────────────────────────────────────────────
async function unpinTicket(guild, channel, user, ticket, origin = 'button') {
  if (!ticket.pinned) {
    return { error: 'This ticket is not pinned.' };
  }

  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can unpin tickets.' };
  }

  ticket.pinned = false;
  ticket.pinnedBy = null;
  ticket.pinnedAt = null;

  ticketsStore.updateTicket(ticket.channelId, ticket);
  await updateChannelTopic(channel, ticket);

  // Remove pin emoji from channel name
  const config = ticketsStore.getConfig('general');
  const pinEmoji = config?.ticketSystem?.pinEmoji || '📌';
  if (channel.name.startsWith(pinEmoji)) {
    try {
      await channel.setName(channel.name.replace(pinEmoji, ''));
    } catch (err) {
      console.error('[Tickets] Error renaming channel for unpin:', err.message);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📌 Ticket Unpinned')
    .setColor(0xFEE75C)
    .setDescription(`This ticket has been unpinned by <@${user.id}>.`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await logTicketAction(guild, channel, user, ticket, 'unpin');
  return { success: true, ticket };
}

// ─── Delete Ticket ───────────────────────────────────────────────────────
async function deleteTicket(guild, channel, user, ticket, origin = 'button') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can delete tickets.' };
  }

  // Generate transcript before deleting
  const transcript = await generateTranscript(channel, ticket);

  // Remove from store
  ticketsStore.removeTicket(ticket.channelId);
  ticketsStore.incrementStat('transcriptsGenerated');

  // Delete the channel
  try {
    await channel.delete(`Ticket deleted by ${user.tag}`);
  } catch (err) {
    console.error('[Tickets] Error deleting channel:', err.message);
    return { error: 'Failed to delete the channel.' };
  }

  return { success: true, transcript };
}

// ─── Add User to Ticket ──────────────────────────────────────────────────
async function addUserToTicket(guild, channel, user, ticket, targetUser, origin = 'command') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can add users to tickets.' };
  }

  try {
    await channel.permissionOverwrites.edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AddReactions: true,
    });

    // Add to participants
    if (!ticket.participants) ticket.participants = [];
    if (!ticket.participants.includes(targetUser.id)) {
      ticket.participants.push(targetUser.id);
      ticketsStore.updateTicket(ticket.channelId, ticket);
    }

    const embed = new EmbedBuilder()
      .setTitle('👤 User Added')
      .setColor(0x57F287)
      .setDescription(`<@${targetUser.id}> has been added to this ticket by <@${user.id}>.`)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await logTicketAction(guild, channel, user, ticket, 'add', targetUser.id);
    return { success: true };
  } catch (err) {
    return { error: `Failed to add user: ${err.message}` };
  }
}

// ─── Remove User from Ticket ─────────────────────────────────────────────
async function removeUserFromTicket(guild, channel, user, ticket, targetUser, origin = 'command') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can remove users from tickets.' };
  }

  // Can't remove the creator
  if (targetUser.id === ticket.creatorId) {
    return { error: 'Cannot remove the ticket creator.' };
  }

  try {
    await channel.permissionOverwrites.delete(targetUser.id);

    // Remove from participants
    if (ticket.participants) {
      ticket.participants = ticket.participants.filter(id => id !== targetUser.id);
      ticketsStore.updateTicket(ticket.channelId, ticket);
    }

    const embed = new EmbedBuilder()
      .setTitle('👤 User Removed')
      .setColor(0xED4245)
      .setDescription(`<@${targetUser.id}> has been removed from this ticket by <@${user.id}>.`)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await logTicketAction(guild, channel, user, ticket, 'remove', targetUser.id);
    return { success: true };
  } catch (err) {
    return { error: `Failed to remove user: ${err.message}` };
  }
}

// ─── Rename Ticket ───────────────────────────────────────────────────────
async function renameTicket(guild, channel, user, ticket, newName, origin = 'command') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can rename tickets.' };
  }

  try {
    const oldName = channel.name;
    await channel.setName(newName);

    const embed = new EmbedBuilder()
      .setTitle('✏️ Ticket Renamed')
      .setColor(0x5865F2)
      .setDescription(`This ticket has been renamed by <@${user.id}>.`)
      .addFields(
        { name: 'Old Name', value: oldName, inline: true },
        { name: 'New Name', value: newName, inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await logTicketAction(guild, channel, user, ticket, 'rename', `${oldName} → ${newName}`);
    return { success: true };
  } catch (err) {
    return { error: `Failed to rename channel: ${err.message}` };
  }
}

// ─── Move Ticket ─────────────────────────────────────────────────────────
async function moveTicket(guild, channel, user, ticket, categoryId, origin = 'command') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can move tickets.' };
  }

  try {
    const oldCategory = channel.parent?.name || 'None';
    await channel.setParent(categoryId, { lockPermissions: false });

    const embed = new EmbedBuilder()
      .setTitle('📂 Ticket Moved')
      .setColor(0x5865F2)
      .setDescription(`This ticket has been moved by <@${user.id}>.`)
      .addFields(
        { name: 'From', value: oldCategory, inline: true },
        { name: 'To', value: channel.parent?.name || 'Unknown', inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await logTicketAction(guild, channel, user, ticket, 'move', categoryId);
    return { success: true };
  } catch (err) {
    return { error: `Failed to move ticket: ${err.message}` };
  }
}

// ─── Set Priority ────────────────────────────────────────────────────────
async function setTicketPriority(guild, channel, user, ticket, priorityId, origin = 'command') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can set priority.' };
  }

  const priority = ticketsStore.getPriority(priorityId);
  if (!priority) {
    return { error: `Invalid priority: ${priorityId}` };
  }

  ticket.priority = priorityId;
  ticketsStore.updateTicket(ticket.channelId, ticket);
  await updateChannelTopic(channel, ticket);

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Priority Changed')
    .setColor(parseInt(priority.color.replace('#', ''), 16) || 0x5865F2)
    .setDescription(`Priority set to ${priority.emoji} **${priority.name}** by <@${user.id}>.`)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await logTicketAction(guild, channel, user, ticket, 'priority', priorityId);
  return { success: true };
}

// ─── Set Topic ───────────────────────────────────────────────────────────
async function setTicketTopic(guild, channel, user, ticket, newTopic, origin = 'command') {
  if (!core.isAdmin(guild, user)) {
    return { error: 'Only admins can set topic.' };
  }

  const oldTopic = ticket.topic;
  ticket.topic = newTopic;
  ticketsStore.updateTicket(ticket.channelId, ticket);
  await updateChannelTopic(channel, ticket);

  const embed = new EmbedBuilder()
    .setTitle('📝 Topic Changed')
    .setColor(0x5865F2)
    .setDescription(`Topic updated by <@${user.id}>.`)
    .addFields(
      { name: 'New Topic', value: newTopic.substring(0, 1024) }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await logTicketAction(guild, channel, user, ticket, 'topic', newTopic);
  return { success: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────
async function updateChannelTopic(channel, ticket) {
  const config = ticketsStore.getConfig('general');
  const topicConfig = config?.ticketSystem?.channelTopic;
  if (!topicConfig) return;

  const parts = [];
  const option = core.getOption(ticket.optionId);

  if (topicConfig.showOptionName && option) parts.push(option.name);
  if (topicConfig.showClosed) parts.push(ticket.open ? '🟢 Open' : '🔴 Closed');
  if (topicConfig.showClaimed && ticket.claimed) parts.push(`🙋 <@${ticket.claimedBy}>`);
  if (topicConfig.showPinned && ticket.pinned) parts.push('📌 Pinned');
  if (topicConfig.showPriority && ticket.priority) {
    const p = ticketsStore.getPriority(ticket.priority);
    if (p) parts.push(`${p.emoji} ${p.name}`);
  }

  try {
    await channel.setTopic(parts.join(' • '));
  } catch (err) {
    // Silently fail - topic update is non-critical
  }
}

async function logTicketAction(guild, channel, user, ticket, action, extra) {
  const config = ticketsStore.getConfig('general');
  if (!config?.logs?.enabled || !config.logs.channel) return;

  const logConfig = config.logs.logMessages;
  const shouldLog = logConfig?.[action];

  if (!shouldLog || !shouldLog.logs) return;

  const logChannel = guild.channels.cache.get(config.logs.channel);
  if (!logChannel) return;

  const actionLabels = {
    close: 'Ticket Closed',
    reopen: 'Ticket Reopened',
    claim: 'Ticket Claimed',
    unclaim: 'Ticket Unclaimed',
    pin: 'Ticket Pinned',
    unpin: 'Ticket Unpinned',
    add: 'User Added',
    remove: 'User Removed',
    rename: 'Ticket Renamed',
    move: 'Ticket Moved',
    priority: 'Priority Changed',
    topic: 'Topic Changed',
    transfer: 'Ticket Transferred',
    blacklist: 'User Blacklisted',
    create: 'Ticket Created',
    delete: 'Ticket Deleted',
  };

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${actionLabels[action] || action}`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Channel', value: channelMention(channel.id), inline: true },
      { name: 'User', value: `<@${user.id}>`, inline: true },
      { name: 'Action', value: action, inline: true }
    )
    .setTimestamp();

  if (extra) {
    embed.addFields({ name: 'Details', value: String(extra).substring(0, 1024) });
  }

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    // Silently fail for log errors
  }
}

async function generateTranscript(channel, ticket) {
  const messages = [];
  try {
    let lastId;
    for (let i = 0; i < 3; i++) {
      const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
      if (fetched.size === 0) break;
      messages.push(...fetched.values());
      lastId = fetched.last()?.id;
    }
  } catch (err) {
    console.error('[Tickets] Error fetching messages for transcript:', err.message);
  }

  messages.reverse();

  const transcript = {
    id: `${ticket.channelId}_${Date.now()}`,
    channelId: ticket.channelId,
    optionId: ticket.optionId,
    creatorId: ticket.creatorId,
    createdAt: ticket.createdAt,
    closedAt: ticket.closedAt,
    closedBy: ticket.closedBy,
    claimedBy: ticket.claimedBy,
    messageCount: messages.length,
    participants: ticket.participants || [],
    generatedAt: Date.now(),
  };

  ticketsStore.addTranscript(transcript);
  return transcript;
}

module.exports = {
  closeTicket,
  reopenTicket,
  claimTicket,
  unclaimTicket,
  pinTicket,
  unpinTicket,
  deleteTicket,
  addUserToTicket,
  removeUserFromTicket,
  renameTicket,
  moveTicket,
  setTicketPriority,
  setTicketTopic,
  generateTranscript,
};
