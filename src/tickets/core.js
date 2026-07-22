const ticketsStore = require('./store');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, channelMention, time } = require('discord.js');

// ─── Ticket Structure ────────────────────────────────────────────────────
function createTicketData(channelId, optionId, creatorId, answers = [], guildId) {
  return {
    channelId,
    optionId,
    guildId,
    creatorId,
    createdAt: Date.now(),
    open: true,
    closed: false,
    closedAt: null,
    closedBy: null,
    reopened: false,
    reopenedBy: null,
    reopenedAt: null,
    claimed: false,
    claimedBy: null,
    claimedAt: null,
    pinned: false,
    pinnedBy: null,
    pinnedAt: null,
    priority: null,
    topic: '',
    answers,
    participants: [],
    messageCount: 0,
    lastActivity: Date.now(),
    autocloseEnabled: false,
    autocloseHours: 24,
    autodeleteEnabled: false,
    autodeleteDays: 7,
    closedCategoryId: null,
  };
}

// ─── Permission Checking ─────────────────────────────────────────────────
function resolvePermissions(guild, member, permissionKey) {
  const config = ticketsStore.getConfig('general');
  if (!config || !config.permissions) return true;

  const permLevel = config.permissions[permissionKey] || 'admin';

  if (permLevel === 'none') return false;
  if (permLevel === 'everyone') return true;

  // Admin check
  if (permLevel === 'admin') {
    return isAdmin(guild, member);
  }

  // Custom role ID
  return member.roles.cache.has(permLevel);
}

function isAdmin(guild, member) {
  if (!member) return false;
  const config = ticketsStore.getConfig('general');
  if (!config) return false;

  // Server owner
  if (member.id === guild.ownerId) return true;

  // Global admins
  if (config.globalAdmins && config.globalAdmins.length > 0) {
    const hasAdminRole = config.globalAdmins.some(roleId => member.roles.cache.has(roleId));
    if (hasAdminRole) return true;
  }

  // Member has Administrator permission
  if (member.permissions && member.permissions.has('Administrator')) return true;

  return false;
}

function isTicketAdmin(guild, member, optionId) {
  if (isAdmin(guild, member)) return true;

  const options = ticketsStore.getConfig('options');
  if (!options) return false;

  const option = options.find(o => o.id === optionId);
  if (!option) return false;

  const adminRoles = option.ticketAdmins || [];
  return adminRoles.some(roleId => member.roles.cache.has(roleId));
}

function canCloseTicket(guild, member, ticket) {
  // Creator can always close their own ticket
  if (member.id === ticket.creatorId) return true;
  // Admins can close
  return isTicketAdmin(guild, member, ticket.optionId);
}

// ─── Panel Helpers ───────────────────────────────────────────────────────
function getOption(optionId) {
  const options = ticketsStore.getConfig('options');
  if (!options) return null;
  return options.find(o => o.id === optionId) || null;
}

function getPanel(panelId) {
  const panels = ticketsStore.getConfig('panels');
  if (!panels) return null;
  return panels.find(p => p.id === panelId) || null;
}

function getQuestion(questionId) {
  const questions = ticketsStore.getConfig('questions');
  if (!questions) return null;
  return questions.find(q => q.id === questionId) || null;
}

// ─── Stats ───────────────────────────────────────────────────────────────
async function getTicketStats(guildId = null) {
  let tickets = ticketsStore.getTickets();
  if (guildId) {
    tickets = tickets.filter(t => t.guildId === guildId);
  }

  return {
    totalTickets: tickets.length,
    openTickets: tickets.filter(t => t.open).length,
    closedTickets: tickets.filter(t => !t.open).length,
    claimedTickets: tickets.filter(t => t.claimed).length,
    pinnedTickets: tickets.filter(t => t.pinned).length,
  };
}

// ─── Ticket Embeds ───────────────────────────────────────────────────────
function buildTicketInfoEmbed(ticket, guild) {
  const config = ticketsStore.getConfig('general');
  const color = config?.mainColor || '#5865F2';
  const option = getOption(ticket.optionId);
  const priority = ticket.priority ? ticketsStore.getPriority(ticket.priority) : null;

  const embed = new EmbedBuilder()
    .setTitle(`${option?.name || 'Ticket'} #${ticket.channelId.slice(-4)}`)
    .setColor(parseInt(color.replace('#', ''), 16) || 0x5865F2)
    .addFields(
      { name: 'Status', value: ticket.open ? '🟢 Open' : '🔴 Closed', inline: true },
      { name: 'Creator', value: `<@${ticket.creatorId}>`, inline: true },
      { name: 'Created', value: time(Math.floor(ticket.createdAt / 1000), 'R'), inline: true },
    );

  if (ticket.claimed) {
    embed.addFields({ name: 'Claimed by', value: `<@${ticket.claimedBy}>`, inline: true });
  }

  if (ticket.pinned) {
    embed.addFields({ name: 'Pinned', value: '✅ Yes', inline: true });
  }

  if (priority) {
    embed.addFields({ name: 'Priority', value: `${priority.emoji} ${priority.name}`, inline: true });
  }

  if (ticket.topic) {
    embed.addFields({ name: 'Topic', value: ticket.topic.substring(0, 1024) });
  }

  embed.setFooter({ text: `Channel: #${ticket.channelId}` });
  embed.setTimestamp();

  return embed;
}

function buildPanelEmbed(panel, guild) {
  if (!panel.embed || !panel.embed.enabled) return null;

  const embed = new EmbedBuilder()
    .setColor(parseInt((panel.embed.color || '#5865F2').replace('#', ''), 16) || 0x5865F2);

  if (panel.embed.title) embed.setTitle(panel.embed.title);
  if (panel.embed.description) embed.setDescription(panel.embed.description);
  if (panel.embed.footer) embed.setFooter({ text: panel.embed.footer });
  if (panel.embed.timestamp) embed.setTimestamp();

  return embed;
}

function buildPanelComponents(panel) {
  const options = ticketsStore.getConfig('options');
  if (!options) return [];

  const panelOptions = (panel.options || [])
    .map(id => options.find(o => o.id === id))
    .filter(Boolean);

  if (panelOptions.length === 0) return [];

  if (panel.dropdown) {
    // Create a select menu
    const { StringSelectMenuBuilder } = require('discord.js');
    const select = new StringSelectMenuBuilder()
      .setCustomId(`ticket_panel_${panel.id}`)
      .setPlaceholder(panel.settings?.dropdownPlaceholder || 'Create a ticket...');

    for (const opt of panelOptions) {
      select.addOptions({
        label: opt.name,
        description: (opt.description || '').substring(0, 100),
        value: opt.id,
        emoji: opt.button?.emoji || undefined,
      });
    }

    return [new ActionRowBuilder().addComponents(select)];
  }

  // Create buttons
  const maxPerRow = Math.min(panel.settings?.maximumButtonsPerRow || 5, 5);
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const opt of panelOptions) {
    const colorMap = { gray: ButtonStyle.Secondary, red: ButtonStyle.Danger, green: ButtonStyle.Success, blue: ButtonStyle.Primary };
    const style = colorMap[opt.button?.color] || ButtonStyle.Primary;

    const button = new ButtonBuilder()
      .setCustomId(`ticket_option_${opt.id}`)
      .setStyle(style);

    if (opt.button?.emoji) button.setEmoji(opt.button.emoji);
    if (opt.button?.label) button.setLabel(opt.button.label);

    currentRow.addComponents(button);
    buttonCount++;

    if (buttonCount >= maxPerRow) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      buttonCount = 0;
    }
  }

  if (buttonCount > 0) rows.push(currentRow);
  return rows;
}

// ─── Ticket Action Buttons ───────────────────────────────────────────────
function buildTicketActionComponents(ticket) {
  const config = ticketsStore.getConfig('general');
  const enableClose = config?.ticketSystem?.enableTicketCloseButtons !== false;
  const enableClaim = config?.ticketSystem?.enableTicketClaimButtons !== false;
  const enablePin = config?.ticketSystem?.enableTicketPinButtons !== false;
  const enableDelete = config?.ticketSystem?.enableTicketDeleteButtons !== false;

  const buttons = [];

  if (ticket.open && enableClose) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ticket_action_close_${ticket.channelId}`)
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );
  } else if (!ticket.open) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ticket_action_reopen_${ticket.channelId}`)
        .setLabel('Reopen')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔓')
    );
  }

  if (enableClaim) {
    if (ticket.claimed) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ticket_action_unclaim_${ticket.channelId}`)
          .setLabel('Unclaim')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🙋')
      );
    } else {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ticket_action_claim_${ticket.channelId}`)
          .setLabel('Claim')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🙋')
      );
    }
  }

  if (enablePin) {
    if (ticket.pinned) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ticket_action_unpin_${ticket.channelId}`)
          .setLabel('Unpin')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📌')
      );
    } else {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ticket_action_pin_${ticket.channelId}`)
          .setLabel('Pin')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📌')
      );
    }
  }

  if (enableDelete) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ticket_action_delete_${ticket.channelId}`)
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );
  }

  // Split into rows of 5 max
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder();
    for (let j = i; j < i + 5 && j < buttons.length; j++) {
      row.addComponents(buttons[j]);
    }
    rows.push(row);
  }

  return rows;
}

module.exports = {
  createTicketData,
  resolvePermissions,
  isAdmin,
  isTicketAdmin,
  canCloseTicket,
  getOption,
  getPanel,
  getQuestion,
  getTicketStats,
  buildTicketInfoEmbed,
  buildPanelEmbed,
  buildPanelComponents,
  buildTicketActionComponents,
};
