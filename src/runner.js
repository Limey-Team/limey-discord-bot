/**
 * Runner — parent process that manages the bot as a child process.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────┐
 *   │  runner.js (parent — NEVER exits)       │
 *   │  ┌─────────────────────────────────────┐│
 *   │  │  HTTP proxy (port 10000)            ││  ← Always open — Render sees this
 *   │  │  - /health → responds directly      ││
 *   │  │  - Everything → proxy → child:15000 ││
 *   │  └─────────────────────────────────────┘│
 *   │         ↕ IPC ('update-ready')          │
 *   │  ┌─────────────────────────────────────┐│
 *   │  │  index.js (child, restarts)         ││
 *   │  │  Express on internal port           ││  ← Killed & re-forked on update
 *   │  └─────────────────────────────────────┘│
 *   └─────────────────────────────────────────┘
 *
 * The parent's proxy server NEVER closes. Render always sees the port open.
 * When the child detects a git update, it sends an IPC 'update-ready' message.
 * The parent kills the child, forks a new one, and the new child starts its
 * Express server on the internal port. The proxy seamlessly switches to it.
 *
 * Usage:
 *   npm run start:runner    (or set as Render start command)
 *
 * Falls through to the standalone behavior when RUNNER_PID is not set.
 */
const http = require('http');
const fs = require('fs');
const { fork } = require('child_process');
const path = require('path');

// Auto-detect: use dist/index.js if it exists (production build), else src/index.js
const SRC_SCRIPT = path.join(__dirname, 'index.js');
const DIST_SCRIPT = path.join(__dirname, '..', 'dist', 'index.js');
const CHILD_SCRIPT = fs.existsSync(DIST_SCRIPT) ? DIST_SCRIPT : SRC_SCRIPT;
const BUILD_MODE = CHILD_SCRIPT === DIST_SCRIPT ? 'production' : 'source';

const CHILD_KILL_TIMEOUT = 10_000;

// ─── Port Configuration ────────────────────────────────────────────────
// External port = what Render / users connect to (held by the runner)
// Internal port = what the child's Express server listens on (not exposed)
const EXTERNAL_PORT = parseInt(process.env.PORT, 10) || 3000;
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT, 10) || (EXTERNAL_PORT + 5000);

let child = null;
let restarting = false;
let childWebReady = false;

// ─── Proxy Server ──────────────────────────────────────────────────────
// This server ALWAYS stays open. Render never sees the port go down.
const proxy = http.createServer((req, res) => {
  // Handle /health directly — always returns 200 regardless of child state
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      runner: true,
      childAlive: child !== null && child.exitCode === null,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // If child isn't ready yet (process alive AND web server listening), return 503
  if (!child || child.exitCode !== null || !childWebReady) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'starting',
      message: 'Bot is starting or restarting...',
    }));
    return;
  }

  // Proxy the request to the child's internal Express server
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      'X-Forwarded-For': req.socket.remoteAddress || '',
      'X-Forwarded-Host': req.headers.host || '',
      'X-Forwarded-Port': String(EXTERNAL_PORT),
    },
    // Give the child some time to start handling
    timeout: 5000,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'error',
      message: 'Bot internal server unavailable',
    }));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        message: 'Bot internal server timeout',
      }));
    }
  });

  req.pipe(proxyReq);
});

// ─── Start Proxy (before forking — port opens immediately) ───────────
proxy.listen(EXTERNAL_PORT, '0.0.0.0', () => {
  console.log(`[Runner] 🔌 Proxy listening on port ${EXTERNAL_PORT} → internal :${INTERNAL_PORT}`);
  console.log(`[Runner] 📦 Running ${BUILD_MODE} build: ${path.relative(path.join(__dirname, '..'), CHILD_SCRIPT)}`);
  startBot();
});

// ─── Bot Lifecycle ────────────────────────────────────────────────────

function startBot() {
  if (child && child.exitCode === null) {
    console.warn('[Runner] ⚠️ Child already running — skipping');
    return;
  }

  child = fork(CHILD_SCRIPT, process.argv.slice(2), {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: {
      ...process.env,
      RUNNER_PID: String(process.pid),
      RUNNER_PORT: String(EXTERNAL_PORT),
      PORT: String(INTERNAL_PORT),  // Child listens on INTERNAL_PORT
    },
  });

  console.log(`[Runner] ✅ Bot started (pid: ${child.pid})`);

  child.on('message', (msg) => {
    if (msg === 'web-ready') {
      childWebReady = true;
      console.log('[Runner] ✅ Child web server ready');
    } else if (msg === 'update-ready') {
      childWebReady = false;
      console.log('[Runner] 🔄 Update signal received — hot-reloading bot...');
      restartBot();
    }
  });

  child.on('exit', (code, signal) => {
    const reason = signal
      ? `signal ${signal}`
      : `exit code ${code}`;
    console.log(`[Runner] ⚰️ Bot exited (${reason})`);

    childWebReady = false;

    if (restarting) {
      // Planned restart — start new child immediately
      child = null;
      restarting = false;
      startBot();
    } else if (code !== 0) {
      // Unexpected crash — restart after brief delay
      console.log('[Runner] 🔄 Bot crashed — restarting in 3s...');
      child = null;
      setTimeout(startBot, 3000);
    } else {
      // Clean exit (code 0) — shut down runner too
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
      console.warn('[Runner] ⚠️ No child to restart — starting fresh');
      startBot();
    }
    return;
  }

  restarting = true;

  // Graceful shutdown of the child
  child.kill('SIGTERM');

  // Force kill if child doesn't exit in time
  const forceKillTimer = setTimeout(() => {
    if (child) {
      console.warn('[Runner] ⚠️ Child did not exit in time — force killing');
      child.kill('SIGKILL');
    }
  }, CHILD_KILL_TIMEOUT);

  child.once('exit', () => {
    clearTimeout(forceKillTimer);
  });
}

// ── Runner Shutdown ────────────────────────────────────────────────────

function shutdown() {
  console.log('[Runner] Shutting down...');
  if (child) {
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
