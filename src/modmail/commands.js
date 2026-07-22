const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

// ═══════════════════════════════════════════════════════════════════════════
// Shared option builders
// ═══════════════════════════════════════════════════════════════════════════
const reasonOption = (o) =>
  o.setName('reason').setDescription('Reason for this action').setRequired(false);

const userOption = (o) =>
  o.setName('user').setDescription('The user').setRequired(true);

// ═══════════════════════════════════════════════════════════════════════════
// Modmail Setup Command
// ═══════════════════════════════════════════════════════════════════════════
const modmailSetupCommand = new SlashCommandBuilder()
  .setName('modmail')
  .setDescription('Configure and manage the Modmail system')
  .addSubcommandGroup((group) =>
    group
      .setName('setup')
      .setDescription('Configure modmail settings')
      .addSubcommand((sub) =>
        sub
          .setName('enable')
          .setDescription('Enable modmail for this server')
          .addChannelOption((o) =>
            o
              .setName('category')
              .setDescription('The category where modmail channels will be created')
              .setRequired(true)
          )
          .addRoleOption((o) =>
            o
              .setName('staffrole')
              .setDescription('The staff role that can access modmail')
              .setRequired(true)
          )
          .addChannelOption((o) =>
            o
              .setName('logchannel')
              .setDescription('Channel for modmail logs and alerts')
              .setRequired(false)
          )
          .addRoleOption((o) =>
            o
              .setName('alertrole')
              .setDescription('Role to ping when new modmail comes in')
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('disable')
          .setDescription('Disable modmail for this server')
      )
      .addSubcommand((sub) =>
        sub
          .setName('category')
          .setDescription('Set the modmail category')
          .addChannelOption((o) =>
            o
              .setName('category')
              .setDescription('The category channel')
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('staffrole')
          .setDescription('Add or remove a staff role')
          .addRoleOption((o) =>
            o
              .setName('role')
              .setDescription('The role to add/remove')
              .setRequired(true)
          )
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('Add or remove the role')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('logchannel')
          .setDescription('Set the log/alert channel')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('The channel for logs and alerts')
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('alertrole')
          .setDescription('Set the role to ping for new modmail')
          .addRoleOption((o) =>
            o
              .setName('role')
              .setDescription('The role to ping (leave empty to clear)')
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('cooldown')
          .setDescription('Set cooldown between modmail threads (in minutes)')
          .addIntegerOption((o) =>
            o
              .setName('minutes')
              .setDescription('Cooldown in minutes (0 to disable)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(10080)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('autoclose')
          .setDescription('Set auto-close hours for inactive threads')
          .addIntegerOption((o) =>
            o
              .setName('hours')
              .setDescription('Hours of inactivity before auto-close (0 to disable)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(720)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('greeting')
          .setDescription('Customize the greeting message')
          .addStringOption((o) =>
            o
              .setName('title')
              .setDescription('Greeting title')
              .setRequired(false)
          )
          .addStringOption((o) =>
            o
              .setName('description')
              .setDescription('Greeting description')
              .setRequired(false)
          )
          .addStringOption((o) =>
            o
              .setName('color')
              .setDescription('Embed color (hex, e.g. #5865F2)')
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('autoreply')
          .setDescription('Set auto-reply for first message')
          .addStringOption((o) =>
            o
              .setName('message')
              .setDescription('Auto-reply message (leave empty to disable)')
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('view')
          .setDescription('View current modmail configuration')
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Close this modmail thread')
      .addStringOption(reasonOption)
  )
  .addSubcommand((sub) =>
    sub
      .setName('reopen')
      .setDescription('Reopen a closed modmail thread')
  )
  .addSubcommand((sub) =>
    sub
      .setName('anon')
      .setDescription('Toggle anonymous replies in this thread')
      .addBooleanOption((o) =>
        o
          .setName('enabled')
          .setDescription('Enable or disable anonymous mode')
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('block')
      .setDescription('Block a user from using modmail')
      .addUserOption(userOption)
      .addStringOption(reasonOption)
  )
  .addSubcommand((sub) =>
    sub
      .setName('unblock')
      .setDescription('Unblock a user from using modmail')
      .addUserOption(userOption)
  )
  .addSubcommand((sub) =>
    sub
      .setName('blocked')
      .setDescription('List all blocked users')
  )
  .addSubcommand((sub) =>
    sub
      .setName('transcript')
      .setDescription('Generate a transcript of this modmail thread')
  )
  .addSubcommand((sub) =>
    sub
      .setName('stats')
      .setDescription('View modmail statistics')
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ═══════════════════════════════════════════════════════════════════════════
// Export all command definitions
// ═══════════════════════════════════════════════════════════════════════════
const modmailCommands = [modmailSetupCommand];

module.exports = { modmailCommands };
