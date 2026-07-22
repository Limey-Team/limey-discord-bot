/**
 * Announce — sends update announcements to the support server's announcement channel.
 *
 * Tracks the last known git commit hash in a file. On startup, compares with
 * the current HEAD. If a new commit is detected, sends a changelog-style
 * announcement to the configured support server announcement channel.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LAST_COMMIT_FILE = path.join(__dirname, '..', 'database', 'last-commit.txt');

// Support server announcement channel ID (the channel where updates are posted)
const ANNOUNCE_CHANNEL_ID = '1527208360095649807';

/**
 * Get the current commit hash from git.
 * Returns null if unavailable.
 */
function getCurrentCommit() {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      timeout: 5000,
      cwd: path.join(__dirname, '..'),
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the last N commit messages since the given hash (exclusive).
 */
function getCommitsSince(hash, maxCount = 10) {
  try {
    const range = hash ? `${hash}..HEAD` : 'HEAD';
    const output = execSync(`git log --oneline --no-decorate -${maxCount} ${range}`, {
      encoding: 'utf8',
      timeout: 5000,
      cwd: path.join(__dirname, '..'),
    }).trim();
    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}

/**
 * Read the last announced commit hash from disk.
 */
function readLastCommit() {
  try {
    if (fs.existsSync(LAST_COMMIT_FILE)) {
      return fs.readFileSync(LAST_COMMIT_FILE, 'utf8').trim();
    }
  } catch {}
  return null;
}

/**
 * Write the current commit hash to disk.
 */
function writeLastCommit(hash) {
  try {
    const dir = path.dirname(LAST_COMMIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_COMMIT_FILE, hash, 'utf8');
  } catch (err) {
    console.error('[Announce] Failed to write last commit:', err.message);
  }
}

/**
 * Build an announcement embed describing the new update.
 */
function buildAnnouncementEmbed(newCommits, currentHash) {
  const { EmbedBuilder } = require('discord.js');

  const commitLines = newCommits.map(line => {
    // Format: "abc1234 Fix something" → formatted line
    return `• \`${line.substring(0, 7)}\` ${line.substring(8) || line}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🔄 Limey Bot — Update Available')
    .setColor(0x5865F2)
    .setDescription([
      'A new update has been deployed! Here are the latest changes:',
      '',
      commitLines.join('\n'),
      '',
      '---',
      `🔗 [View full changelog](https://github.com/${process.env.GITHUB_REPO || 'limey-bot/limey'}/blob/main/CHANGELOG.md)`,
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: `Commit: ${currentHash.substring(0, 7)}` });

  return embed;
}

/**
 * Check for a new update and send an announcement to the support server.
 * This is called inside a shard process via broadcastEval.
 *
 * Returns a description of what happened, for logging.
 */
async function checkAndAnnounce(client) {
  const currentHash = getCurrentCommit();
  if (!currentHash) {
    return { announced: false, reason: 'Could not get current commit hash' };
  }

  const lastHash = readLastCommit();

  // First run — just record the hash, don't announce
  if (!lastHash) {
    writeLastCommit(currentHash);
    return { announced: false, reason: 'First run — recorded initial commit' };
  }

  // Same commit — nothing to announce
  if (lastHash === currentHash) {
    return { announced: false, reason: 'No new commits since last run' };
  }

  // New commit(s) detected — get the commit messages
  const newCommits = getCommitsSince(lastHash);

  if (newCommits.length === 0) {
    return { announced: false, reason: 'No commit messages available' };
  }

  // Look up the announcement channel directly by ID (works across all shards)
  try {
    const channel = client.channels.cache.get(ANNOUNCE_CHANNEL_ID);
    if (!channel) {
      return { announced: false, reason: 'Announcement channel not found on this shard' };
    }

    const embed = buildAnnouncementEmbed(newCommits, currentHash);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Announce] Failed to send announcement:', err.message);
    // Still record the commit so we don't re-announce
  }

  // Record the new hash
  writeLastCommit(currentHash);
  return { announced: true, commits: newCommits.length };
}

/**
 * Initialize the announcement check from the manager process.
 * Uses broadcastEval to have all shards attempt to send the announcement.
 */
async function init(manager) {
  const currentHash = getCurrentCommit();
  if (!currentHash) {
    console.log('[Announce] ℹ️ No git commit available — skipping update announcement');
    return;
  }

  const lastHash = readLastCommit();

  // First run — just record
  if (!lastHash) {
    writeLastCommit(currentHash);
    console.log('[Announce] ℹ️ First run — recorded initial commit');
    return;
  }

  // Same commit — nothing new
  if (lastHash === currentHash) {
    console.log('[Announce] ℹ️ No new commits since last run');
    return;
  }

  // New commits! Try to announce via broadcastEval
  console.log('[Announce] 🔄 New commits detected — attempting announcement...');

  // Pass the absolute path so it resolves correctly in the shard process
  const announcePath = path.join(__dirname, 'announce.js');

  const result = await manager.broadcastEval(async (c, { absPath }) => {
    const announce = require(absPath);
    const r = await announce.checkAndAnnounce(c);
    if (r.announced) {
      console.log(`[Announce] ✅ Update announcement sent to support server`);
    }
    return r;
  }, { context: { absPath: announcePath } });

  // Log the results
  const announced = result.find(r => r && r.announced);
  if (announced) {
    console.log(`[Announce] ✅ Update announcement sent (${announced.commits} commit(s))`);
  } else {
    const reasons = result.filter(r => r && !r.announced).map(r => r.reason).join('; ');
    console.log(`[Announce] ℹ️ ${reasons || 'No shard could send the announcement'}`);
  }
}

module.exports = { init, checkAndAnnounce, getCurrentCommit, getCommitsSince };
