# Changelog

All notable changes to **Limey** — Discord Moderation, Logging & Management Bot.

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

## [Unreleased]

### New Features
- Automatic update announcements sent to the support server announcement channel
- CHANGELOG.md for tracking version history

---

*For a full list of changes, see the [git commit log](https://github.com/limey-bot/limey/commits/main).*
