const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  SlashCommandSubcommandBuilder,
} = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════
// Shared option builders
// ═══════════════════════════════════════════════════════════════════════════
const reasonOption = (o) =>
  o.setName('reason').setDescription('Reason for this action').setRequired(false);

const userOption = (o) =>
  o.setName('user').setDescription('The user').setRequired(true);

const memberOption = (o) =>
  o.setName('member').setDescription('The member').setRequired(true);

// ═══════════════════════════════════════════════════════════════════════════
// Panel command — spawn a panel message
// ═══════════════════════════════════════════════════════════════════════════
const panelCommand = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Send a ticket panel to the current channel')
  .addStringOption((o) =>
    o
      .setName('panel')
      .setDescription('The panel ID from config')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ═══════════════════════════════════════════════════════════════════════════
// Close command
// ═══════════════════════════════════════════════════════════════════════════
const closeCommand = new SlashCommandBuilder()
  .setName('ticket-close')
  .setDescription('Close the current ticket')
  .addStringOption(reasonOption);

// ═══════════════════════════════════════════════════════════════════════════
// Reopen command
// ═══════════════════════════════════════════════════════════════════════════
const reopenCommand = new SlashCommandBuilder()
  .setName('ticket-reopen')
  .setDescription('Reopen a closed ticket')
  .addStringOption(reasonOption);

// ═══════════════════════════════════════════════════════════════════════════
// Claim command
// ═══════════════════════════════════════════════════════════════════════════
const claimCommand = new SlashCommandBuilder()
  .setName('ticket-claim')
  .setDescription('Claim this ticket');

// ═══════════════════════════════════════════════════════════════════════════
// Unclaim command
// ═══════════════════════════════════════════════════════════════════════════
const unclaimCommand = new SlashCommandBuilder()
  .setName('ticket-unclaim')
  .setDescription('Unclaim this ticket');

// ═══════════════════════════════════════════════════════════════════════════
// Pin command
// ═══════════════════════════════════════════════════════════════════════════
const pinCommand = new SlashCommandBuilder()
  .setName('ticket-pin')
  .setDescription('Pin this ticket');

// ═══════════════════════════════════════════════════════════════════════════
// Unpin command
// ═══════════════════════════════════════════════════════════════════════════
const unpinCommand = new SlashCommandBuilder()
  .setName('ticket-unpin')
  .setDescription('Unpin this ticket');

// ═══════════════════════════════════════════════════════════════════════════
// Add command
// ═══════════════════════════════════════════════════════════════════════════
const addCommand = new SlashCommandBuilder()
  .setName('ticket-add')
  .setDescription('Add a user to this ticket')
  .addUserOption(memberOption);

// ═══════════════════════════════════════════════════════════════════════════
// Remove command
// ═══════════════════════════════════════════════════════════════════════════
const removeCommand = new SlashCommandBuilder()
  .setName('ticket-remove')
  .setDescription('Remove a user from this ticket')
  .addUserOption(memberOption);

// ═══════════════════════════════════════════════════════════════════════════
// Rename command
// ═══════════════════════════════════════════════════════════════════════════
const renameCommand = new SlashCommandBuilder()
  .setName('ticket-rename')
  .setDescription('Rename this ticket channel')
  .addStringOption((o) =>
    o
      .setName('name')
      .setDescription('New channel name')
      .setRequired(true)
  );

// ═══════════════════════════════════════════════════════════════════════════
// Move command
// ═══════════════════════════════════════════════════════════════════════════
const moveCommand = new SlashCommandBuilder()
  .setName('ticket-move')
  .setDescription('Move this ticket to another category')
  .addChannelOption((o) =>
    o
      .setName('category')
      .setDescription('The category to move to')
      .setRequired(true)
  );

// ═══════════════════════════════════════════════════════════════════════════
// Priority command
// ═══════════════════════════════════════════════════════════════════════════
const priorityCommand = new SlashCommandBuilder()
  .setName('ticket-priority')
  .setDescription('Set the priority of this ticket')
  .addStringOption((o) =>
    o
      .setName('priority')
      .setDescription('The priority level')
      .setRequired(true)
      .addChoices(
        { name: '🟢 Low', value: 'low' },
        { name: '🟡 Medium', value: 'medium' },
        { name: '🔴 High', value: 'high' },
        { name: '🚨 Urgent', value: 'urgent' }
      )
  );

// ═══════════════════════════════════════════════════════════════════════════
// Transcript command
// ═══════════════════════════════════════════════════════════════════════════
const transcriptCommand = new SlashCommandBuilder()
  .setName('ticket-transcript')
  .setDescription('Save a transcript of this ticket');

// ═══════════════════════════════════════════════════════════════════════════
// Topic command
// ═══════════════════════════════════════════════════════════════════════════
const topicCommand = new SlashCommandBuilder()
  .setName('ticket-topic')
  .setDescription('Set the topic of this ticket')
  .addStringOption((o) =>
    o
      .setName('topic')
      .setDescription('The new topic')
      .setRequired(true)
  );

// ═══════════════════════════════════════════════════════════════════════════
// Delete command
// ═══════════════════════════════════════════════════════════════════════════
const deleteCommand = new SlashCommandBuilder()
  .setName('ticket-delete')
  .setDescription('Delete this ticket channel');

// ═══════════════════════════════════════════════════════════════════════════
// Stats command
// ═══════════════════════════════════════════════════════════════════════════
const statsCommand = new SlashCommandBuilder()
  .setName('ticket-stats')
  .setDescription('View ticket statistics');

// ═══════════════════════════════════════════════════════════════════════════
// Help command
// ═══════════════════════════════════════════════════════════════════════════
const helpCommand = new SlashCommandBuilder()
  .setName('ticket-help')
  .setDescription('Show help for the ticket system');

// ═══════════════════════════════════════════════════════════════════════════
// Blacklist commands (subcommand group)
// ═══════════════════════════════════════════════════════════════════════════
const blacklistCommand = new SlashCommandBuilder()
  .setName('ticket-blacklist')
  .setDescription('Manage the ticket blacklist')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a user to the blacklist')
      .addUserOption((o) =>
        o.setName('user').setDescription('The user to blacklist').setRequired(true)
      )
      .addStringOption(reasonOption)
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a user from the blacklist')
      .addUserOption((o) =>
        o.setName('user').setDescription('The user to unblacklist').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List all blacklisted users')
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ═══════════════════════════════════════════════════════════════════════════
// Export all command definitions
// ═══════════════════════════════════════════════════════════════════════════
const ticketCommands = [
  panelCommand,
  closeCommand,
  reopenCommand,
  claimCommand,
  unclaimCommand,
  pinCommand,
  unpinCommand,
  addCommand,
  removeCommand,
  renameCommand,
  moveCommand,
  priorityCommand,
  topicCommand,
  transcriptCommand,
  deleteCommand,
  statsCommand,
  helpCommand,
  blacklistCommand,
];

module.exports = { ticketCommands };
