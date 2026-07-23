# Changelog

All notable changes to **Limey** — Discord Moderation, Logging & Management Bot.

---

## [2.0.2] — Render Port Detection Fix & Obfuscation Compatibility

### 🐛 Render Port Detection Fix

- **`src/index.js`** — Moved `gitSync.init()` to after `startWebServer()` so the synchronous `execFileSync('git fetch', ...)` call (up to 15-second timeout) does not block the HTTP port from opening. On Render, the port must be detected within seconds of process start — any synchronous delay before `app.listen()` causes a failed deploy with "No open HTTP ports detected."

### 🔧 Obfuscation Compatibility (Node.js)

- **`scripts/build.js`** — Disabled three obfuscation options that were causing silent crashes in Node.js environments:
  - `selfDefending: true` → `false` — The tamper-detection mechanism false-positives in Node.js, throwing an unhandled error that silently kills the process with no visible log output.
  - `debugProtection: true` → `false` — Browser-oriented debugger traps (`setInterval` with `new Function('debugger')`) are useless in Node.js and add unnecessary event loop overhead.
  - `controlFlowFlatteningThreshold: 0.9` → `0.3` — At 90%, control flow flattening restructures `async/await` and `try-catch` blocks into switch-case dispatchers that break Node.js error handling, causing unhandled promise rejections and silent crashes.
  - Removed `debugProtectionInterval` (depends on `debugProtection`).
- All other protections remain: RC4 string encoding (100% coverage), dead code injection (100%), identifier mangling, object key transformation, string splitting, and number expressions.

### 🐛 Coordinator Auth Bypass (Worker Registration Fix)

- **`src/web/server.js`** — Added `if (req.path.startsWith('/api/shard')) return next();` to the `requireAuth` middleware to bypass the OAuth session check for coordinator API routes. When `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are configured, the auth middleware was blocking all `/api/*` requests that lacked a session cookie — including worker shard registration (`POST /api/shard/register`), heartbeats (`POST /api/shard/heartbeat`), and listing (`GET /api/shard/list`). Worker shards don't have browser sessions, so they got a 401 "Unauthorized" before ever reaching the coordinator's `MASTER_API_KEY` verification.

### 📚 Documentation

- **`README.md`** — Updated Production Build section to reflect the fixed obfuscation options. Added a note explaining why `selfDefending`, `debugProtection`, and high `controlFlowFlattening` are disabled for Node.js compatibility. Updated the health endpoint description to mention the git-sync startup order.

---

## [1.0.0] — Initial Release

### ✨ Event Logging
- Logs ~60+ Discord events — messages, voice, members, roles, channels, reactions, threads, invites, emoji, stickers, presence, scheduled events, auto-mod, webhooks, and more
- Per-guild log channels with rich embed logs
- Event filtering — enable/disable specific event types per guild
- Real-time SSE streaming — live log feed in the web dashboard
- Persistent storage across restarts

### 🛡️ Moderation Commands
- `/ban` / `/unban` — Ban and unban users
- `/kick` — Kick a member
- `/timeout` / `/untimeout` — Timeout a member (up to 28 days)
- `/purge` — Bulk delete messages (up to 100)
- `/warn` / `/warnings` / `/clearwarnings` — Warning system with persistent storage
- `/lock` / `/unlock` — Lock/unlock channels from @everyone
- `/slowmode` — Set channel slowmode (0–21600 seconds)
- `/botinfo` — Bot statistics (uptime, ping, guild count, memory, rate limits)
- `/logchannel` — Configure log channel for event embeds
- `/logs` — Toggle individual event types on/off for the log channel
- `/setupdm` — Get a link to install the bot to your account for DM notifications
- DM notifications sent to punished users

### ✅ Verification System
- `/verifysetup` — Configure a verified role and optional button panel
- `/verify` — Users can self-verify via slash command or button
- **Image captcha** — users see a distorted image with characters and must type them to verify
- **Anti-OCR noise** — interference lines, random dots, and character offset

### 🪤 Trap System (Limey)
- `/trap setup` — Create a trap channel that auto-bans any user who posts in it
- **Two actions**: softban (clear messages + unban) or permanent ban
- **Chaos mode** — randomizes the trap channel name daily
- **Channel warmer** — posts daily messages to keep the trap looking active
- **1-hour timeout option** — delay the ban by 1 hour
- **Rejoin protection** — re-applies timeout if a caught user rejoins
- `/trap stats` — view catch statistics
- `/trap disable` — disable the trap

### 🎫 Ticket System
- Full ticket lifecycle: create, close, reopen, claim, unclaim, pin, unpin, delete
- Panel system with buttons or dropdowns for ticket creation
- Customizable embed messages for each panel
- Modal questions shown before ticket creation
- Priority levels: Low, Medium, High, Urgent
- Blacklist system to block users from creating tickets
- Autoclose after inactivity / Autodelete after days
- Transcripts generated on ticket deletion
- Category support for organizing tickets
- 18+ slash commands for full ticket management

### 📬 Modmail System
- Private staff contact — users DM the bot to reach server staff
- Automatic thread creation in a designated category
- Two-way messaging — user DMs forwarded to staff channel; staff replies forwarded back
- Anonymous replies — toggle per-thread
- Close / Reopen — close with optional reason; reopen if needed
- Block / Unblock — prevent specific users from using modmail
- Staff alerts — role pings and log channel notifications
- Auto-close — threads close after configurable hours of inactivity
- Cooldown — configurable time limit between thread creations
- Custom greeting — customize embed title, description, and color
- Auto-reply — send automatic acknowledgment when users first DM
- Transcripts — generate a .txt transcript of any thread

### 🤖 Custom Bot Management
- Run custom Discord bots alongside Limey on the same instance and port
- Each bot registers its own slash commands independently
- Memory-only token storage — never written to disk
- Env var persistence for restart-safe tokens
- Dashboard UI for managing bot instances

### 💾 Backup & Restore
- `/backup [label]` — Create a full snapshot of all bot data (server owner only)
- `/backups` — List all backups for this server
- `/restore` — Restore data from a backup
- **Restore Users** — DM all members with an OAuth link to authorize joining during restore
- **guilds.join OAuth flow** — Members authorize the bot to add them to servers on restore
- Double confirmation on restore
- Dashboard management — create, restore, delete backups visually

### 🌐 OAuth Web Dashboard
- Discord OAuth login — secure sign-in with Discord
- Guild-scoped access — server owners see only their own guilds
- **9 main tabs**: Live Feed, Explore Logs, Stats, Settings, Tickets, Ticket Config, Modmail, Custom Bots, Backups
- Live Feed — real-time streaming log entries
- Explore Logs — filterable, paginated log explorer
- Stats — summary cards, event type breakdown chart, rate limit details
- Settings — configure log channels via the dashboard
- Ticket Config — JSON editor for all ticket configs
- Spawn Panel — send ticket panels to any channel
- Backup Manager — create, restore, delete backups visually
- Custom Bots — manage custom bot instances
- Offline caching via Service Worker
- Interactive help guide (`?` key)
- `GET /health` — health check endpoint

### 🔄 Git Sync (Persistent Data)
- Auto-commits config changes to GitHub so data survives restarts
- Batches rapid changes into single commits
- On startup, pulls latest data from GitHub
- Supports auto-update — polls remote and restarts on new commits

### 🛡️ Production Build
- JavaScript obfuscation with javascript-obfuscator
- Control flow flattening (90% coverage)
- Dead code injection (100% threshold)
- RC4 string encoding with shuffled arrays
- Self-defending — code breaks if beautified
- Debug protection with 2-second re-check intervals
- Identifier mangling and object key transformation

---

## [1.1.0] — Changelog, Health, Update

### New Features
- Automatic update announcements sent to the support server announcement channel on new git commits
- CHANGELOG.md for tracking version history
- `/update` command — displays the latest changelog entry and recent git commits in a rich embed
- `/health` command — shows bot system health with color-coded status (ping, uptime, memory, servers, etc.)
- `/version` command — shows the current bot version and build information

---

## [1.2.1] — Captcha Timeout & Button Handler Fix

### Bug Fixes
- **Captcha verification timed out** — Fixed `sendCaptchaChallenge()` calling `interaction.reply()` after Jimp image generation, which could exceed Discord's 3-second interaction window. Now defers the reply immediately (`interaction.deferReply()`) so the user sees a loading state, then generates the image and edits the deferred reply (`interaction.editReply()`). Previous code had no error handler for this, so no logs appeared in the error channel.
- **"Enter Captcha" button was unresponsive** — The `interactionCreate` handler structure had a bug: the `verify_` button handler used an early `return` for non-matching custom IDs, which exited the entire handler before the `enter_captcha_` button handler could ever run. Restructured the button handling into a single `if (interaction.isButton())` block with else-if chaining so all button types are reachable.

---

## [1.3.0] — Auto-Update Shutdown Crash Fix

### Bug Fixes
- **`ERR_IPC_CHANNEL_CLOSED` during auto-update shutdown** — When `git-sync` detected a new commit and triggered a restart via `SIGTERM`, the ShardManager called `broadcastEval()` (which uses IPC) to tell shards to destroy their clients. During shutdown the IPC channel could close before all shards finished tearing down, causing an uncaught `ERR_IPC_CHANNEL_CLOSED` exception that produced an ugly stack trace.
  - **`src/index.js`**: Replaced `broadcastEval`-based shutdown with direct `SIGTERM` signals to each shard's child process. This avoids the IPC channel dependency entirely — each shard independently runs its own graceful shutdown handler.
  - **`src/shard-entry.js`**: Wrapped `client.destroy()` in a try-catch that gracefully handles `ERR_IPC_CHANNEL_CLOSED` as an expected condition during shutdown, without logging a noisy stack trace.
- **Version bumped** to 1.3.0 reflecting all changes.

### Deprecation Fixes
- **`'ready'` event renamed to `'clientReady'`** — Changed all `client.once('ready', ...)` calls to `client.once('clientReady', ...)` to eliminate the discord.js v14 deprecation warning. The `'ready'` event was renamed to distinguish it from the gateway `READY` event and will stop emitting altogether in v15.

---

## [2.0.0] — Distributed Sharding, Privacy & Terms Pages

### 🚀 Distributed Sharding (Major Architecture Change)
- **New distributed sharding model** — Shards can now run on separate machines instead of requiring all shards as child processes on a single server.
- **`src/shard-coordinator.js` (new)** — Central coordinator that runs on the main server. Manages shard registration, heartbeats, stats aggregation, and guild routing across all remote shards.
- **`src/shard-worker-server.js` (new)** — Minimal Express server for worker shards with health check, stats, guild/user/channel lookup, and panel spawn endpoints.
- **`src/worker.js` (new)** — Entry point for worker shard servers. Registers with the coordinator, gets assigned a shard ID, starts a Discord.js client for that shard, and sends periodic heartbeats.
- **`src/index.js`** — Replaced `ShardingManager` with a direct Discord.js Client for shard 0. Initializes the coordinator and passes it to the web server.
- **`src/shard-client.js`** — Replaced `broadcastEval` with the coordinator's aggregated data and direct HTTP queries to remote shards.
- **`src/web/server.js`** — Removed all `broadcastEval` and `ShardingManager` dependencies. Added coordinator API routes (`/api/shard/register`, `/api/shard/heartbeat`, `/api/shard/list`). DM sending now uses the local client directly.
- **`src/announce.js`** — `init()` now takes the local client instead of a manager, sends announcements directly without broadcastEval.
- **`.env.example`** — Added `SHARD_COUNT`, `MASTER_API_KEY`, `COORDINATOR_URL`, `WORKER_URL`, `WORKER_PORT`, `WORKER_HEARTBEAT_INTERVAL`.
- **`package.json`** — Added `start:worker` and `dev:worker` scripts.

### 🔇 Silenced Git-Sync Console Noise
- **`src/git-sync.js`** — Removed `console.log('[GitSync] ✅ Synced to...')` success log and `console.warn('[GitSync] ⚠️ sync skipped...')` warning that printed on every config file change. Error logs are preserved.

### 📄 Privacy & Terms Web Pages
- **`src/web/public/privacy.html` (new)** — Full privacy policy as a styled dark-theme webpage, converted from `PRIVACY.md`.
- **`src/web/public/terms.html` (new)** — Full terms of service as a styled webpage, converted from `TERMS.md`.
- **`src/web/server.js`** — Added `GET /privacy` and `GET /terms` routes. Both pages are accessible without authentication.
- **`src/web/public/index.html`** — Added Privacy and Terms links in the footer.
- **`src/web/public/login.html`** — Added Privacy Policy and Terms of Service links.

### 📚 Documentation
- **`README.md`** — Added a comprehensive Distributed Sharding section with architecture diagram, main server setup, worker server setup guide, and expanded environment variables reference table.

---

## [2.0.1] — Render Health Check, Double-Protocol Fix, Git-Sync Noise

### Bug Fixes
- **Render "No open ports detected"** — The Express web server was starting inside the async bootstrap block after `client.login()`, which could take several seconds. Render's port scanner would time out before any port was bound.
  - **`src/index.js`**: Moved `new ShardClient()` and `startWebServer()` to before `client.login()` so the HTTP server starts listening immediately on startup, before any async operations begin. The `/health` endpoint gracefully returns `bot: 'disconnected'` until the bot is logged in and switches to `bot: 'connected'` after.
  - **`src/index.js` (fixup)**: Removed `.then()` / `.catch()` chaining on `startWebServer()` — the function returns the Express `app` object, not a Promise. Calling `.then()` on a non-Promise object caused a `TypeError` in the production build. Now called as a direct (non-awaited) function, which is safe because `app.listen()` is non-blocking.
  - **`src/web/server.js`**: Added `process.env.PORT` to the port fallback chain (`process.env.PORT || process.env.WEB_PORT || 3000`), since Render injects the `PORT` environment variable (not `WEB_PORT`).
- **Worker `fetch failed` — double `https://` protocol in COORDINATOR_URL** — If the `COORDINATOR_URL` environment variable was accidentally set with a duplicate protocol prefix (e.g., `https://https://example.com`), the worker would fail to register with a malformed URL fetch error.
  - **`src/worker.js`**: Added a regex `/(https?:\/\/)+/i` to strip duplicate protocol prefixes from `COORDINATOR_URL`, normalizing it to a single protocol.
- **`error: No such remote 'origin'` console noise** — When running in environments without a git `origin` remote (e.g., Render deploy instances), the `getGithubRepo()` function in `git-sync.js` would print an error to stderr via `execSync`. While functionally harmless, the error message was confusing.
  - **`src/git-sync.js`**: Added `stdio: ['pipe', 'pipe', 'ignore']` to suppress stderr output from the `git remote get-url origin` command, since a missing origin remote is an expected condition in some environments.

---

*For a full list of changes, see the [git commit log](https://github.com/limey-bot/limey/commits/main).*
