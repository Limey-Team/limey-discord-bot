const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ticketCommands } = require('./tickets');
const { modmailCommands } = require('./modmail');
const votes = require('./votes');

const logChannelCommand = new SlashCommandBuilder()
  .setName('logchannel')
  .setDescription('Set the channel where the bot sends log messages')
  .addChannelOption(o => o.setName('channel').setDescription('The channel to send logs to. Leave empty to disable.').setRequired(false));

const banCommand = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a member from the server')
  .addUserOption(o => o.setName('user').setDescription('The user to ban').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for the ban').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

const unbanCommand = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user by their ID')
  .addStringOption(o => o.setName('userid').setDescription('The user ID to unban').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for the unban').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

const kickCommand = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a member from the server')
  .addUserOption(o => o.setName('user').setDescription('The user to kick').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for the kick').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

const timeoutCommand = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Timeout a member')
  .addUserOption(o => o.setName('user').setDescription('The user to timeout').setRequired(true))
  .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes (max 40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
  .addStringOption(o => o.setName('reason').setDescription('Reason for the timeout').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const untimeoutCommand = new SlashCommandBuilder()
  .setName('untimeout')
  .setDescription('Remove a timeout from a member')
  .addUserOption(o => o.setName('user').setDescription('The user to remove timeout from').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const purgeCommand = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk delete messages')
  .addIntegerOption(o => o.setName('count').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
  .addChannelOption(o => o.setName('channel').setDescription('Channel to purge (default: current)').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const warnCommand = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a member')
  .addUserOption(o => o.setName('user').setDescription('The user to warn').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const warningsCommand = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription('View warnings for a member')
  .addUserOption(o => o.setName('user').setDescription('The user to check').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const lockCommand = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Lock a channel (prevent @everyone from sending messages)')
  .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (default: current)').setRequired(false))
  .addStringOption(o => o.setName('reason').setDescription('Reason for locking').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const unlockCommand = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Unlock a previously locked channel')
  .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (default: current)').setRequired(false))
  .addStringOption(o => o.setName('reason').setDescription('Reason for unlocking').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const clearWarningsCommand = new SlashCommandBuilder()
  .setName('clearwarnings')
  .setDescription('Clear all warnings for a member')
  .addUserOption(o => o.setName('user').setDescription('The user to clear warnings for').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

const slowmodeCommand = new SlashCommandBuilder()
  .setName('slowmode')
  .setDescription('Set slowmode for a channel')
  .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode in seconds (0 to disable, max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
  .addChannelOption(o => o.setName('channel').setDescription('Channel (default: current)').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const botinfoCommand = new SlashCommandBuilder()
  .setName('botinfo')
  .setDescription('Show bot statistics and system information');

const updateCommand = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Show the latest changelog and recent updates for Limey');

const healthCommand = new SlashCommandBuilder()
  .setName('health')
  .setDescription('Check the bot\'s system health and status');

const versionCommand = new SlashCommandBuilder()
  .setName('version')
  .setDescription('Show the current bot version and build information');

const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify yourself to get the verified role');

const verifysetupCommand = new SlashCommandBuilder()
  .setName('verifysetup')
  .setDescription('Configure the verification system')
  .addRoleOption(o => o.setName('role').setDescription('The role to give verified users').setRequired(true))
  .addChannelOption(o => o.setName('channel').setDescription('Channel to send the verify button (optional)').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const voteCommand = new SlashCommandBuilder()
  .setName('vote')
  .setDescription('Vote for Limey on Discord bot lists and check your vote status');

const setupdmCommand = new SlashCommandBuilder()
  .setName('setupdm')
  .setDescription('Get a link to install Limey so it can DM you about punishments');

const trapCommand = new SlashCommandBuilder()
  .setName('trap')
  .setDescription('Configure the honey pot trap system')
  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Set up a trap channel')
      .addChannelOption(o => o.setName('channel').setDescription('The trap channel (keep hidden from real users!)').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('Action for caught bots').setRequired(false)
        .addChoices({ name: 'Softban (clear messages)', value: 'softban' }, { name: 'Permanent Ban', value: 'ban' }))
      .addBooleanOption(o => o.setName('timeoutfirst').setDescription('Timeout for 1 hour before banning?').setRequired(false))
      .addBooleanOption(o => o.setName('chaos').setDescription('Randomize channel name daily to evade blacklists?').setRequired(false))
      .addBooleanOption(o => o.setName('warmer').setDescription('Post daily messages to keep the channel active?').setRequired(false)))
  .addSubcommand(sub =>
    sub.setName('disable')
      .setDescription('Disable the trap for this server'))
  .addSubcommand(sub =>
    sub.setName('stats')
      .setDescription('Show trap catch statistics'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const logsCommand = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Configure which events are logged to the Discord log channel')
  .addSubcommand(sub =>
    sub.setName('toggle')
      .setDescription('Enable or disable a specific event type')
      .addStringOption(o => o.setName('event').setDescription('The event name to toggle').setRequired(true).setAutocomplete(true))
      .addBooleanOption(o => o.setName('enabled').setDescription('On or off? Leave empty to toggle').setRequired(false)))
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('Show which event types are enabled/disabled'))
  .addSubcommand(sub =>
    sub.setName('enable_all')
      .setDescription('Enable all event types'))
  .addSubcommand(sub =>
    sub.setName('disable_all')
      .setDescription('Disable all event types (not recommended)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const backupCommand = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Create a full data backup for this server')
  .addStringOption(o => o.setName('label').setDescription('Optional label for this backup').setRequired(false).setMaxLength(100))
  .addBooleanOption(o => o.setName('restoreusers').setDescription('DM members to authorize guild join (for user migration)').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const backupsCommand = new SlashCommandBuilder()
  .setName('backups')
  .setDescription('List all backups for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const restoreCommand = new SlashCommandBuilder()
  .setName('restore')
  .setDescription('Restore data from a backup')
  .addStringOption(o => o.setName('id').setDescription('Backup ID to restore').setRequired(true))
  .addBooleanOption(o => o.setName('confirm').setDescription('Set to true to confirm restoration').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const commands = [
  logChannelCommand, banCommand, unbanCommand, kickCommand,
  timeoutCommand, untimeoutCommand, purgeCommand, warnCommand,
  warningsCommand, clearWarningsCommand, lockCommand, unlockCommand, slowmodeCommand,
  botinfoCommand, updateCommand, healthCommand, versionCommand, voteCommand, verifyCommand, verifysetupCommand, trapCommand, setupdmCommand, logsCommand,
  backupCommand, backupsCommand, restoreCommand,
  ...ticketCommands,
  ...modmailCommands,
].map(c => c.toJSON());

async function registerCommands(client) {
  const rest = new REST({ version: '10' }).setToken(client.token);
  try {
    // Register global commands (available everywhere — DMs, user-install, etc.)
    console.log('[Commands] Registering global slash commands...');

    // Fetch existing global commands to preserve any Entry Point commands (type 4)
    // Discord rejects bulk PUTs that would remove Entry Point commands
    let finalCommands = [...commands];
    try {
      const existing = await rest.get(Routes.applicationCommands(client.user.id));
      const entryPointCommands = (Array.isArray(existing) ? existing : [])
        .filter(cmd => cmd.type === 4); // ApplicationCommandType.PrimaryEntryPoint = 4
      if (entryPointCommands.length > 0) {
        // Merge entry point commands into the update body (pass full object to preserve all fields)
        for (const ep of entryPointCommands) {
          finalCommands.push(ep);
        }
        console.log(`[Commands] Preserved ${entryPointCommands.length} Entry Point command(s)`);
      }
    } catch (fetchErr) {
      console.warn('[Commands] Could not fetch existing commands to check for Entry Points:', fetchErr.message);
    }

    await rest.put(Routes.applicationCommands(client.user.id), { body: finalCommands });
    console.log(`[Commands] Registered ${commands.length} global slash commands`);

    // Also register per-guild for instant availability
    console.log('[Commands] Registering per-guild slash commands...');
    const guilds = await client.guilds.fetch();
    for (const [guildId] of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    }
    console.log(`[Commands] Registered ${commands.length} slash commands in ${guilds.size} guild(s)`);
  } catch (err) {
    console.error('[Commands] Failed to register commands:', err.message);
  }
}

module.exports = { registerCommands };
