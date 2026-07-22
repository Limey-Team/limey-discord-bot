const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gitSync = require('./git-sync');

const BACKUPS_FILE = path.join(__dirname, '..', 'database', 'backups.json');
const AUTH_FILE = path.join(__dirname, '..', 'database', 'backup-auth.json');

// Files that are snapshotted in each backup
const BACKUP_PATHS = [
  'config.json',
  'warnings.json',
  'config/tickets/general.json',
  'config/tickets/panels.json',
  'config/tickets/options.json',
  'config/tickets/questions.json',
  'config/tickets/transcripts.json',
  'database/tickets/tickets.json',
  'database/tickets/transcripts.json',
  'database/tickets/stats.json',
  'database/bots.json',
];

const PROJECT_ROOT = path.join(__dirname, '..');

// ─── In-memory stores ────────────────────────────────────────────────────
let backups = [];
let authRecords = [];

function load() {
  try {
    if (fs.existsSync(BACKUPS_FILE)) {
      backups = JSON.parse(fs.readFileSync(BACKUPS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[Backup] Failed to load backups:', err.message);
    backups = [];
  }
  try {
    if (fs.existsSync(AUTH_FILE)) {
      authRecords = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[Backup] Failed to load auth records:', err.message);
    authRecords = [];
  }
}

function save() {
  try {
    fs.writeFileSync(BACKUPS_FILE, JSON.stringify(backups, null, 2), 'utf8');
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authRecords, null, 2), 'utf8');
    gitSync.scheduleSync();
  } catch (err) {
    console.error('[Backup] Failed to save:', err.message);
  }
}

// ─── Backup CRUD ─────────────────────────────────────────────────────────

function createBackup(guildId, creatorId, label, restoreUsers) {
  const snapshot = {};
  let fileCount = 0;

  for (const relPath of BACKUP_PATHS) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    try {
      if (fs.existsSync(absPath)) {
        snapshot[relPath] = fs.readFileSync(absPath, 'utf8');
        fileCount++;
      } else {
        snapshot[relPath] = null;
      }
    } catch (err) {
      console.error(`[Backup] Failed to read ${relPath}:`, err.message);
      snapshot[relPath] = null;
    }
  }

  if (fileCount === 0) {
    return { success: false, error: 'No data files found to back up.' };
  }

  const backupId = crypto.randomBytes(8).toString('hex');
  const entry = {
    id: backupId,
    guildId,
    creatorId,
    label: label || `Backup ${new Date().toLocaleDateString()}`,
    createdAt: Date.now(),
    fileCount,
    files: BACKUP_PATHS.filter(p => snapshot[p] !== null),
    restoreUsers: restoreUsers === true,
    authorizedCount: 0,
    snapshot,
  };

  backups.push(entry);
  save();

  return { success: true, backupId, fileCount, restoreUsers: entry.restoreUsers };
}

function listBackups(guildId) {
  return backups
    .filter(b => b.guildId === guildId)
    .map(b => ({
      id: b.id,
      guildId: b.guildId,
      creatorId: b.creatorId,
      label: b.label,
      createdAt: b.createdAt,
      fileCount: b.fileCount,
      files: b.files,
      restoreUsers: b.restoreUsers === true,
      authorizedCount: b.authorizedCount || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getBackup(backupId) {
  return backups.find(b => b.id === backupId) || null;
}

function restoreBackup(backupId) {
  const entry = backups.find(b => b.id === backupId);
  if (!entry) {
    return { success: false, error: 'Backup not found.' };
  }

  let restoredCount = 0;
  for (const [relPath, content] of Object.entries(entry.snapshot)) {
    if (content === null) continue;
    const absPath = path.join(PROJECT_ROOT, relPath);
    try {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');
      restoredCount++;
    } catch (err) {
      console.error(`[Backup] Failed to restore ${relPath}:`, err.message);
    }
  }

  if (restoredCount === 0) {
    return { success: false, error: 'Failed to restore any files.' };
  }

  gitSync.scheduleSync();
  return { success: true, fileCount: restoredCount, restoreUsers: entry.restoreUsers === true };
}

function deleteBackup(backupId) {
  const idx = backups.findIndex(b => b.id === backupId);
  if (idx === -1) return { success: false, error: 'Backup not found.' };

  // Also remove auth records for this backup
  authRecords = authRecords.filter(a => a.backupId !== backupId);
  backups.splice(idx, 1);
  save();
  return { success: true };
}

function getAllBackups() {
  return backups.map(b => ({
    id: b.id,
    guildId: b.guildId,
    creatorId: b.creatorId,
    label: b.label,
    createdAt: b.createdAt,
    fileCount: b.fileCount,
    files: b.files,
    restoreUsers: b.restoreUsers === true,
    authorizedCount: b.authorizedCount || 0,
  })).sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Authorization Management ───────────────────────────────────────────

function storeAuthorization(backupId, userId, accessToken, refreshToken, username) {
  // Remove any previous auth for this user+backup
  authRecords = authRecords.filter(a => !(a.backupId === backupId && a.userId === userId));

  authRecords.push({
    backupId,
    userId,
    accessToken,
    refreshToken: refreshToken || null,
    username: username || userId,
    createdAt: Date.now(),
  });

  // Update the count on the backup entry
  const entry = backups.find(b => b.id === backupId);
  if (entry) {
    const count = authRecords.filter(a => a.backupId === backupId).length;
    entry.authorizedCount = count;
  }

  save();
  return true;
}

function getAuthorizedUsers(backupId) {
  return authRecords
    .filter(a => a.backupId === backupId)
    .map(a => ({
      userId: a.userId,
      username: a.username,
      accessToken: a.accessToken,
      createdAt: a.createdAt,
    }));
}

function getAuthCount(backupId) {
  return authRecords.filter(a => a.backupId === backupId).length;
}

function removeAuthorization(backupId, userId) {
  authRecords = authRecords.filter(a => !(a.backupId === backupId && a.userId === userId));
  const entry = backups.find(b => b.id === backupId);
  if (entry) {
    entry.authorizedCount = authRecords.filter(a => a.backupId === backupId).length;
  }
  save();
}

// Load on startup
load();

module.exports = {
  createBackup,
  listBackups,
  getBackup,
  restoreBackup,
  deleteBackup,
  getAllBackups,
  storeAuthorization,
  getAuthorizedUsers,
  getAuthCount,
  removeAuthorization,
};
