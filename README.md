# Limey — Discord Moderation, Logging & Management Bot

A full-featured Discord bot with **comprehensive event logging, moderation tools, a verification system, an anti-bot trap, a ticket system, a modmail system, custom bot management, full backup/restore**, and a real-time OAuth-secured web dashboard.

## Features

### 📝 Event Logging
- **Logs ~60+ Discord events** — messages, voice, members, roles, channels, reactions, threads, invites, emoji, stickers, presence, scheduled events, auto-mod, webhooks, and more
- **Per-guild log channels** — set a dedicated channel where the bot sends rich embed logs
- **Event filtering** — enable/disable specific event types per guild (via `/logs` or dashboard)
- **Real-time SSE streaming** — live log feed in the web dashboard
- **Persistent storage** — logs saved to `logs.json`, survives restarts

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
- `/setupdm` — Get a link to install the bot to your account so it can DM you about punishments
- DM notifications sent to punished users (also works via user-installed app)

### ✅ Verification System
- `/verifysetup` — Configure a verified role and optional button panel
- `/verify` — Users can self-verify via slash command or button
- **Image captcha** — users see a distorted image with characters and must type them to verify (beats automated bots)
- **Anti-OCR noise** — interference lines, random dots, and character offset make OCR difficult
- Beautiful embed panel with server name, member count, and verified count

### 🪤 Trap System (Limey)
- `/trap setup` — Create a trap channel that auto-bans any user who posts in it
- **Two actions**: softban (clear messages + unban) or permanent ban
- **Chaos mode** — randomizes the trap channel name daily to evade blacklists
- **Channel warmer** — posts daily messages to keep the trap channel looking active
- **1-hour timeout option** — delay the ban by 1 hour to delay detection by malicious bots
- **Rejoin protection** — re-applies timeout if a caught user rejoins
- `/trap stats` — view catch statistics
- `/trap disable` — disable the trap

### 🎫 Ticket System
- **Full ticket lifecycle**: create (with questions), close, reopen, claim, unclaim, pin, unpin, delete
- **Panel system** with buttons or dropdowns for ticket creation
- **Customizable embed** messages for each panel
- **Modal questions** shown before ticket creation (subject, description, etc.)
- **Priority levels**: Low, Medium, High, Urgent
- **Blacklist system** to block users from creating tickets
- **Autoclose** after inactivity / **Autodelete** after days
- **Transcripts** generated on ticket deletion
- **Category support** for organizing tickets
- **18+ slash commands** for full ticket management
- **Dashboard management** — view, filter, and configure tickets

### 💾 Backup & Restore
- `/backup [label]` — Create a full snapshot of all bot data (server owner only)
- `/backups` — List all backups for this server
- `/restore id:<id> confirm:true` — Restore data from a backup
- **Backup dashboard** — create, restore, and delete backups from the web UI
- **Full snapshot** includes: config, warnings, ticket configs, ticket data, transcripts, custom bot metadata
- **GitHub synced** — backups persist across server restarts
- **Double confirmation** on restore to prevent accidental data loss

### 📬 Modmail System
- **Private staff contact** — users DM the bot to reach server staff privately
- **Automatic thread creation** — each conversation gets its own private channel in a designated category
- **Two-way messaging** — user DMs are forwarded to the staff channel; staff replies are forwarded back to the user via DM
- **Anonymous replies** — toggle per-thread so staff names remain hidden from users
- **Close / Reopen** — close threads with optional reason; reopen them if needed
- **Block / Unblock** — prevent specific users from using modmail entirely
- **Staff alerts** — role pings and log channel notifications when new modmail arrives
- **Auto-close** — threads close automatically after configurable hours of inactivity
- **Cooldown** — configurable time limit between thread creations
- **Custom greeting** — customize the embed title, description, and color shown in the staff channel
- **Auto-reply** — send an automatic acknowledgment when users first DM the bot
- **Transcripts** — generate a .txt transcript of any thread with `/modmail transcript`
- **Dashboard tab** — view stats, threads, blocked users, and configuration
- **18+ subcommands** — full setup and management via `/modmail`
- **Action buttons** — Close, Anonymous, and Block buttons in every staff channel

### 🤖 Custom Bot Management
- Run custom Discord bots alongside Limey on the same instance and port
- Each bot registers its own slash commands independently
- **Memory-only token storage** — never written to disk
- **Env var persistence** — use `BOT_TOKEN_GUILDID=<token>` for restart-safe tokens
- Dashboard UI for managing bot instances

### 💾 Backup & Restore System
- `/backup [label] [restoreusers]` — Create a full snapshot of all bot data (server owner only)
- `/backups` — List all backups for this server
- `/restore id:<id> confirm:true` — Restore data from a backup (with user restoration if enabled)
- **Restore Users** — Enable to DM all members with an OAuth link to authorize joining during restore
- **guilds.join OAuth flow** — Members authorize the bot to add them to servers on restore
- **Double confirmation** on restore to prevent accidental data loss
- Full snapshot includes: config, warnings, ticket configs, ticket data, transcripts, custom bot metadata
- **Dashboard management** — create, restore, delete backups, view authorized user counts
- **GitHub synced** — backups persist across server restarts

### 🌐 OAuth Web Dashboard
- **Discord OAuth login** — secure sign-in with Discord
- **Guild-scoped access** — server owners see only their own guilds; bot owner sees all
- **9 main tabs**: Live Feed, Explore Logs, Stats, Settings, Tickets, Ticket Config, Modmail, Custom Bots, Backups
- **Live Feed** — real-time streaming log entries as events happen
- **Explore Logs** — filterable, paginated log explorer (event type, guild, channel, user, search)
- **Stats** — summary cards, event type breakdown chart, rate limit details
- **Settings** — configure log channels per guild via the dashboard UI
- **Ticket Config** — JSON editor for general/panels/options/questions configs
- **Spawn Panel** — send ticket panels to any channel without typing commands
- **Backup Manager** — create, restore, delete backups visually, with user restore toggle
- **Custom Bots** — manage custom bot instances
- **Offline caching** — Service Worker caches dashboard assets for offline access
- **Offline banner** — shows when connection is lost, cached content remains visible
- **Interactive help guide** — press `?` anywhere in the dashboard
- `GET /health` — health check endpoint

## Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to **Bot** → **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent**
   - ✅ **Server Members Intent**
   - ✅ **Presence Intent**
5. Click **Reset Token** → copy your bot token

### 2. Invite the Bot

1. Go to **OAuth2** → **URL Generator**
2. Scopes: `bot`
3. Bot Permissions: See below for the minimum permissions the bot needs (Administrator is no longer required)
4. Copy and open the generated URL to invite the bot
   
   **Required bot permissions:**
   - `Kick Members`
   - `Ban Members`
   - `Manage Channels`
   - `Add Reactions`
   - `View Audit Log`
   - `View Channels`
   - `Send Messages`
   - `Manage Messages`
   - `Embed Links`
   - `Attach Files`
   - `Read Message History`
   - `Mention Everyone`
   - `Use External Emojis`
   - `Connect`
   - `Speak`
   - `Manage Roles`
   - `Manage Webhooks`
   - `Manage Emojis and Stickers`
   - `Use Application Commands`
   - `Manage Events`
   - `Manage Threads`
   - `Create Public Threads`
   - `Send Messages in Threads`
   - `Moderate Members`

### 3. Configure & Run

```bash
# Install dependencies
npm install

# Copy and fill in your token
cp .env.example .env
# Edit .env → paste your DISCORD_TOKEN

# Start the bot (development)
npm start

# Or with auto-reload (dev mode)
npm run dev
```

The dashboard will be at **http://localhost:3000**

### 4. Production Build

To build the bot for production with **maximum-security JavaScript obfuscation**:

```bash
# Build & obfuscate
npm run build

# Run the built version
npm run start:prod
```

The build script includes **multiple layers of protection**:

| Protection | Description |
|------------|-------------|
| 🌀 **Control Flow Flattening** | Restructures code into switch-case dispatchers (90% coverage) — mimics a VM |
| 💀 **Dead Code Injection** | Injects junk code paths (100% threshold) — confuses reverse engineering |
| 🔐 **String Array (RC4)** | All strings are RC4-encoded and stored in shuffled arrays with function wrappers |
| 🛡️ **Self-Defending** | Code breaks if beautified or reformatted — prevents deobfuscation tools |
| 🚫 **Debug Protection** | Inserts debugger traps that block step-through debugging when a debugger is attached |
| ⏱️ **Debug Protection Interval** | Re-checks for debugger connections every 2 seconds — prevents circumvention |
| 🔄 **Identifier Mangling** | All variable/function names are shuffled and mangled |
| 🔑 **Object Key Transformation** | Static property access is converted to dynamic lookups |
| 🔢 **Number Expressions** | Numeric literals become complex arithmetic expressions |
| ✂️ **String Splitting** | Strings are split into 5-character chunks — hides content from static analysis |

The build script:
- Obfuscates all `.js` files from `src/` into `dist/` using `javascript-obfuscator` with `target: 'node'`
- Copies static assets (HTML, CSS, JSON, images) as-is
- Preserves the full directory structure
- Reports a summary of files processed, obfuscated, copied, and skipped

> **Note:** The production build runs from `dist/` and requires the same `.env` configuration. Obfuscation increases code size and may impact startup time — this is expected with maximum protection enabled.

### 5. Optional: Discord OAuth for Dashboard

Set these environment variables to enable the login wall on the dashboard:

```env
DISCORD_CLIENT_ID=your_app_client_id
DISCORD_CLIENT_SECRET=your_app_client_secret
BOT_OWNER_ID=your_discord_user_id       # Optional: grants full access to all guilds
WEB_PORT=3000                           # Optional: change dashboard port
DASHBOARD_URL=http://localhost:3000      # Optional: OAuth redirect base URL
```

Then in the Discord Developer Portal:
1. Go to **OAuth2** → add `http://localhost:3000/auth/callback` as a redirect URI
2. Save changes

If OAuth env vars are not set, the dashboard is open to anyone (dev mode).

### 6. Git Sync (Persistent Data)

When your bot runs on an ephemeral filesystem, all data files are lost on restart. Git Sync automatically commits changes back to your GitHub repo so data persists across restarts. It also works on any server where you want config changes versioned.

**Required env vars:**

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | A GitHub **Personal Access Token (classic)** with repo write access ([create one](https://github.com/settings/tokens)) |
| `GITHUB_REPO` | Repo to push to, e.g. `"username/repo"`. If not set, auto-detected from the git remote. |
| `GITHUB_BRANCH` | Branch to push to (default: `"main"`) |

**How it works:** after any config change (log channel, verify setup, limey trap, warnings, ticket configs, backups), the bot writes the file locally and schedules a git commit+push within 5 seconds. Multiple rapid changes are batched into a single commit. Commits include `[skip ci]` to avoid re-deploy loops. On startup, the latest data is pulled from GitHub so previous deployments' changes are preserved.

### 7. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | ✅ Yes | — | Your bot's Discord token |
| `DISCORD_CLIENT_ID` | For OAuth | — | Discord app client ID for OAuth login |
| `DISCORD_CLIENT_SECRET` | For OAuth | — | Discord app client secret for OAuth |
| `BOT_OWNER_ID` | No | — | Your Discord user ID — grants full dashboard access + owner-only commands |
| `DASHBOARD_URL` | No | `http://localhost:3000` | Base URL for OAuth redirect |
| `WEB_PORT` | No | `3000` | Dashboard web server port |
| `GITHUB_TOKEN` | For persistence | — | GitHub PAT for auto-sync |
| `GITHUB_REPO` | For persistence | auto-detect | GitHub repo for auto-sync |
| `GITHUB_BRANCH` | No | `main` | Branch for git-sync |
| `GIT_AUTO_UPDATE` | No | `false` | Set to `true` to auto-restart the bot when new code is pushed to GitHub |
| `GIT_POLL_INTERVAL` | No | `60000` | How often (in ms) to check for new commits when auto-update is enabled |
| `TOPGG_WEBHOOK_SECRET` | For vote webhooks | — | Webhook secret from Top.gg (HMAC verification for vote notifications) |
| `DBL_WEBHOOK_SECRET` | For vote webhooks | — | Webhook secret from DiscordBotList.com (Authorization header verification) |

## Changelog

For a detailed history of changes, see the [CHANGELOG.md](./CHANGELOG.md) file.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /health` | GET | Health check |
| `GET /api/me` | GET | Current user info |
| `POST /api/logout` | POST | Logout |
| `GET /api/logs` | GET | Query logs (paginated) |
| `GET /api/events` | GET | List all event types |
| `GET /api/stats` | GET | Statistics |
| `POST /api/clear` | POST | Clear all logs |
| `GET /api/stream` | GET | SSE log stream |
| `GET /api/config/:guildId` | GET | Guild config (log channel) |
| `POST /api/config/:guildId` | POST | Set log channel |
| `GET /api/channels/:guildId` | GET | List text channels |
| `GET /api/tickets/:guildId` | GET | List tickets |
| `GET /api/tickets/config/:guildId` | GET | Ticket config |
| `POST /api/tickets/config/:guildId` | POST | Save ticket config |
| `GET /api/tickets/stats/:guildId` | GET | Ticket stats |
| `GET /api/tickets/transcripts/:guildId` | GET | Ticket transcripts |
| `GET /api/tickets/categories/:guildId` | GET | Guild categories |
| `POST /api/tickets/panels/spawn` | POST | Send panel to channel |
| `GET /api/modmail/:guildId` | GET | List modmail threads and stats |
| `GET /api/modmail/config/:guildId` | GET | Get modmail config |
| `POST /api/modmail/config/:guildId` | POST | Update modmail config |
| `GET /api/bots` | GET | List custom bots |
| `POST /api/bots/start` | POST | Start custom bot |
| `POST /api/bots/stop` | POST | Stop custom bot |
| `POST /api/bots/restart` | POST | Restart custom bot |
| `GET /api/backups/:guildId` | GET | List backups |
| `POST /api/backups/create` | POST | Create backup |
| `POST /api/backups/restore` | POST | Restore backup |
| `POST /api/backups/delete` | POST | Delete backup |

## Dashboard Guide

Press **`?`** anywhere in the dashboard to open the interactive help guide, which explains every tab and feature in detail.

## Dependencies

- [discord.js](https://discord.js.org/) v14 — Discord API client
- [express](https://expressjs.com/) — Web server & dashboard
- [dotenv](https://github.com/motdotla/dotenv) — Environment variable loading
- [javascript-obfuscator](https://obfuscator.io/) — Production build obfuscation (control flow, string encoding, debug protection)
- [jimp](https://github.com/jimp-dev/jimp) — Image captcha generation (pure JS, no native dependencies)

## License

MIT
