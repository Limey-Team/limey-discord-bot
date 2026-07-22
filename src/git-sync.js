const { execSync, execFileSync, spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let syncTimeout = null;
let lastSyncResult = { time: null, success: false, message: 'Never synced' };
const DEBOUNCE_MS = 5000; // batch changes within 5s into one commit

// Auto-detect GITHUB_REPO from git remote if not set via env
function getGithubRepo() {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;

  try {
    const origin = execSync('git remote get-url origin', {
      cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 5000,
    }).trim();
    // Handle https://github.com/user/repo.git or git@github.com:user/repo.git
    const match = origin.match(/github\\.com[:/](.+?)(?:\\.git)?$/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

const GITHUB_REPO = getGithubRepo();

function init() {
  if (!GITHUB_TOKEN) {
    console.error('[GitSync] ❌ GITHUB_TOKEN is not set! Config changes will NOT be synced to GitHub.');
    console.error('[GitSync] ❌ The bot will continue but config changes will be lost on restart.');
    return;
  }

  if (!GITHUB_REPO) {
    console.error('[GitSync] ❌ Could not determine GITHUB_REPO. Set it via env var or ensure the git remote origin is set.');
    console.error('[GitSync] ❌ The bot will continue but config changes will be lost on restart.');
    return;
  }

  console.log('[GitSync] ✅ Enabled — config, warnings & ticket data will auto-commit to', GITHUB_REPO);

  // Pull latest config from GitHub on startup so we don't lose changes from previous deploys
  pullConfig();
}

function scheduleSync() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn('[GitSync] ⚠️ sync skipped — GITHUB_TOKEN or GITHUB_REPO not configured');
    return;
  }

  // Debounce: reset the timer on each call so rapid saves batch into one commit
  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(() => {
    doSync();
  }, DEBOUNCE_MS);
}

function doSync() {
  // Use 'git' as the username for Personal Access Token authentication (classic PAT)
  // Format: https://git:PAT@github.com/owner/repo.git
  const repoUrl = `https://git:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;

  const runGit = (args) => spawnSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Ensure authenticated origin remote exists (add if missing, set URL if exists)
  const hasOrigin = runGit(['remote']);
  const originExists = hasOrigin.status === 0 && hasOrigin.stdout.split('\n').map(s => s.trim()).includes('origin');

  let remoteRes;
  if (originExists) {
    remoteRes = runGit(['remote', 'set-url', 'origin', repoUrl]);
  } else {
    remoteRes = runGit(['remote', 'add', 'origin', repoUrl]);
  }

  if (remoteRes.status !== 0) {
    const err = remoteRes.stderr || remoteRes.stdout || 'Failed to set git remote URL';
    console.error('[GitSync] ❌ Push failed:', err);
    lastSyncResult = { time: new Date().toISOString(), success: false, message: err.substring(0, 200) };
    return;
  }

  // Stage config files (tolerate missing files / unmatched paths)
  runGit(['add', 'config.json', 'warnings.json', 'config/tickets/*.json', 'database/tickets/*.json']);

  // Only commit+push if there are staged changes
  const diffRes = runGit(['diff', '--cached', '--quiet']);
  if (diffRes.status === 0) {
    lastSyncResult = { time: new Date().toISOString(), success: true, message: 'Nothing to sync — no changes' };
    return; // No staged changes
  }

  const commitRes = runGit([
    '-c', 'user.email=limey-bot@users.noreply.github.com',
    '-c', 'user.name=Limey Bot',
    'commit',
    '-m', 'chore: auto-sync config [skip ci]',
  ]);

  if (commitRes.status !== 0) {
    const out = `${commitRes.stdout || ''}\n${commitRes.stderr || ''}`;
    if (out.includes('nothing to commit')) {
      lastSyncResult = { time: new Date().toISOString(), success: true, message: 'Nothing to sync — no changes' };
      return; // No changes to push — this is normal
    }
    const err = (commitRes.stderr || commitRes.stdout || 'git commit failed').substring(0, 200);
    console.error('[GitSync] ❌ Push failed:', err);
    lastSyncResult = { time: new Date().toISOString(), success: false, message: err };
    return;
  }

  const pushRes = runGit(['push', 'origin', `HEAD:${GITHUB_BRANCH}`]);
  if (pushRes.status !== 0) {
    const err = (pushRes.stderr || pushRes.stdout || 'git push failed').substring(0, 200);
    console.error('[GitSync] ❌ Push failed:', err);
    lastSyncResult = { time: new Date().toISOString(), success: false, message: err };
    return;
  }

  console.log('[GitSync] ✅ Synced to', GITHUB_REPO);
  lastSyncResult = { time: new Date().toISOString(), success: true, message: 'Synced successfully' };
}

function pullConfig() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;

  const repoUrl = `https://git:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;

  // Step 1: Fetch from remote (must complete before store.load())
  try {
    execFileSync('git', ['fetch', repoUrl, GITHUB_BRANCH], {
      encoding: 'utf8', timeout: 15000, cwd: PROJECT_ROOT, stdio: 'pipe',
    });
  } catch (err) {
    console.warn('[GitSync] ⚠️ Could not fetch from GitHub:', (err.stderr || err.message).substring(0, 200));
    return;
  }

  // Step 2: Extract files using git show (reads directly from commit object —
  // more reliable than checkout in detached HEAD / shallow clone environments)
  let pulled = false;
  const trackedFiles = [
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
    'database/backups.json',
  ];
  for (const file of trackedFiles) {
    try {
      const content = execSync(`git show "FETCH_HEAD:${file}"`, {
        encoding: 'utf8', timeout: 10000, cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'ignore'], // capture stdout, ignore stderr/stdin
      });
      fs.writeFileSync(path.join(PROJECT_ROOT, file), content, 'utf8');
      pulled = true;
    } catch (err) {
      // File doesn't exist in fetched commit — OK for first deploy
    }
  }

  if (pulled) {
    console.log('[GitSync] ✅ Pulled latest config from GitHub');
  } else {
    console.log('[GitSync] ℹ️ No remote config files yet — starting fresh');
  }
}

function forceSync() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    lastSyncResult = { time: new Date().toISOString(), success: false, message: 'Git sync not configured' };
    return lastSyncResult;
  }
  doSync();
  return lastSyncResult;
}

function getStatus() {
  return {
    configured: !!(GITHUB_TOKEN && GITHUB_REPO),
    tokenSet: !!GITHUB_TOKEN,
    repo: GITHUB_REPO,
    branch: GITHUB_BRANCH,
    lastSync: lastSyncResult,
  };
}

function ensureOriginRemote(repoUrl) {
  const hasOrigin = spawnSync('git', ['remote'], {
    cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const originExists = hasOrigin.status === 0 &&
    hasOrigin.stdout.split('\n').map(s => s.trim()).includes('origin');
  if (originExists) {
    spawnSync('git', ['remote', 'set-url', 'origin', repoUrl], {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    spawnSync('git', ['remote', 'add', 'origin', repoUrl], {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

/**
 * Run a command asynchronously and return { stdout, stderr, code }
 * Non-blocking — the event loop stays responsive during execution
 */
function execAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout || 60000,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    proc.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}

function startAutoUpdate() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn('[GitSync] ⚠️ Auto-update skipped — GITHUB_TOKEN or GITHUB_REPO not configured');
    return;
  }

  if (!process.env.GIT_AUTO_UPDATE) {
    console.log('[GitSync] ℹ️ Auto-update disabled. Set GIT_AUTO_UPDATE=true to enable.');
    return;
  }

  const intervalMs = parseInt(process.env.GIT_POLL_INTERVAL, 10) || 60000;
  console.log(`[GitSync] 🔄 Auto-update enabled — polling remote every ${intervalMs / 1000}s for new commits`);

  const repoUrl = `https://git:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;
  ensureOriginRemote(repoUrl);

  let updating = false;

  setInterval(async () => {
    if (updating) return;
    updating = true;

    try {
      // Step 1: Fetch from remote (async, non-blocking)
      console.log('[GitSync] 🔍 Checking for updates...');
      const fetchRes = await execAsync('git', ['fetch', 'origin', GITHUB_BRANCH], { timeout: 30000 });
      if (fetchRes.code !== 0) {
        console.error('[GitSync] ❌ Fetch failed:', fetchRes.stderr.substring(0, 150));
        return;
      }

      // Step 2: Compare local vs remote HEAD
      const localRes = await execAsync('git', ['rev-parse', 'HEAD'], { timeout: 10000 });
      if (localRes.code !== 0) return;
      const localHead = localRes.stdout;

      const remoteRes = await execAsync('git', ['rev-parse', `origin/${GITHUB_BRANCH}`], { timeout: 10000 });
      if (remoteRes.code !== 0) return;
      const remoteHead = remoteRes.stdout;

      if (!localHead || !remoteHead || localHead === remoteHead) {
        return; // No new commits
      }

      console.log(`[GitSync] 🔄 New commit: ${localHead.substring(0, 7)}... → ${remoteHead.substring(0, 7)}...`);

      // Step 3: Stash any local changes (should be none, but be safe)
      await execAsync('git', ['stash'], { timeout: 10000 });

      // Step 4: Pull latest code (async, non-blocking)
      console.log('[GitSync] 📥 Pulling latest code...');
      const pullRes = await execAsync('git', ['pull', '--ff-only', 'origin', GITHUB_BRANCH], { timeout: 30000 });
      if (pullRes.code !== 0) {
        console.error('[GitSync] ❌ Pull failed:', pullRes.stderr.substring(0, 200));
        await execAsync('git', ['stash', 'pop'], { timeout: 10000 });
        return;
      }

      // Restore any stashed changes (no-op if nothing was stashed)
      await execAsync('git', ['stash', 'pop'], { timeout: 10000 });

      // Step 5: Install new dependencies (async, non-blocking — bot stays responsive)
      console.log('[GitSync] 📦 Installing dependencies...');
      const npmRes = await execAsync('npm', ['install', '--no-audit', '--no-fund', '--production'], { timeout: 120000 });
      if (npmRes.code !== 0) {
        console.error('[GitSync] ❌ npm install failed:');
        console.error('[GitSync] ❌', npmRes.stderr.substring(0, 300));
        console.log('[GitSync] ⚠️ Proceeding to restart anyway — the bot may crash if deps are missing.');
      } else {
        console.log('[GitSync] ✅ Dependencies installed');
      }

      // Step 6: Clean exit — Render will see exit code 0 and restart
      // The SIGTERM handler in index.js handles client.destroy() cleanup
      console.log('[GitSync] 🔄 Update complete — exiting for Render to restart...');
      // Don't reset updating — process exits via SIGTERM after 2s
      setTimeout(() => {
        process.kill(process.pid, 'SIGTERM');
      }, 2000);
    } catch (err) {
      console.error('[GitSync] ❌ Auto-update error:', err.message);
      updating = false; // Reset on error so next interval can try again
    }
  }, intervalMs);
}

module.exports = { init, scheduleSync, pullConfig, forceSync, getStatus, startAutoUpdate };
