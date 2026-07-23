/**
 * Runner — parent process that manages the bot as a child process.
 *
 * Forks `src/index.js` as a child. When the child detects a git update
 * via auto-update, it sends an IPC message. The runner gracefully kills
 * the child and forks a new one, achieving zero-downtime code updates
 * without killing the parent process.
 *
 * Usage:
 *   node src/runner.js
 *
 * This is the recommended entry point when GIT_AUTO_UPDATE=true.
 * Falls through to running src/index.js directly if forking fails.
 */
const { fork } = require('child_process');
const path = require('path');

const CHILD_SCRIPT = path.join(__dirname, 'index.js');
const CHILD_KILL_TIMEOUT = 10_000; // 10s max wait for graceful shutdown

let child = null;
let restarting = false;

function startBot() {
  if (child) {
    console.warn('[Runner] ⚠️ Child already running — skipping');
    return;
  }

  child = fork(CHILD_SCRIPT, process.argv.slice(2), {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, RUNNER_PID: String(process.pid) },
  });

  console.log(`[Runner] ✅ Bot started (pid: ${child.pid})`);

  child.on('message', (msg) => {
    if (msg === 'update-ready') {
      console.log('[Runner] 🔄 Update signal received — hot-reloading bot...');
      restartBot();
    }
  });

  child.on('exit', (code, signal) => {
    const reason = signal
      ? `signal ${signal}`
      : `exit code ${code}`;
    console.log(`[Runner] ⚰️ Bot exited (${reason})`);

    if (restarting) {
      // We're in a planned restart — start the new child
      child = null;
      restarting = false;
      startBot();
    } else if (code !== 0) {
      // Unexpected crash — restart after a brief delay
      console.log('[Runner] 🔄 Bot crashed — restarting in 3s...');
      child = null;
      setTimeout(startBot, 3000);
    } else {
      // Clean exit (code 0) — don't restart
      console.log('[Runner] Bot exited cleanly — shutting down runner.');
      child = null;
      process.exit(0);
    }
  });

  child.on('error', (err) => {
    console.error('[Runner] ❌ Child process error:', err.message);
    child = null;
    setTimeout(startBot, 3000);
  });
}

async function restartBot() {
  if (restarting || !child) {
    if (!child) {
      console.warn('[Runner] ⚠️ No child to restart');
      startBot();
    }
    return;
  }

  restarting = true;

  // Send SIGTERM for graceful shutdown
  child.kill('SIGTERM');

  // If child doesn't exit in time, force kill
  const forceKillTimer = setTimeout(() => {
    if (child) {
      console.warn('[Runner] ⚠️ Child did not exit in time — force killing');
      child.kill('SIGKILL');
    }
  }, CHILD_KILL_TIMEOUT);

  // Wait for child to exit (the 'exit' handler will start the new child)
  child.once('exit', () => {
    clearTimeout(forceKillTimer);
  });
}

// ── Startup ─────────────────────────────────────────────────────────────

startBot();

// Handle runner termination — pass through to child
function shutdown() {
  console.log('[Runner] Shutting down...');
  if (child) {
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
