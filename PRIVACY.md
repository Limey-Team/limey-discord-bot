# Privacy Policy

**Last updated:** July 22, 2026

## Overview

Limey ("the Bot", "we", "us", or "our") is a moderation, logging, and management Discord bot. This Privacy Policy explains how we collect, use, store, and protect your information when you use the Bot and its associated web dashboard.

By inviting Limey to your Discord server or using its features, you agree to the practices described in this policy.

## 1. Data We Collect

### 1.1 Data Collected Automatically

When the Bot is active in a Discord server, the following data may be logged and stored:

| Data Type | Examples | Purpose |
|-----------|----------|---------|
| **User IDs** | Discord user/snowflake IDs | Tracking warnings, mod actions, verification status, ticket participation, modmail conversations |
| **Guild IDs** | Discord server/snowflake IDs | Per-guild configuration, log storage, backup references |
| **Channel IDs** | Discord channel/snowflake IDs | Log channel configuration, ticket channels, modmail threads |
| **Role IDs** | Discord role/snowflake IDs | Verified role configuration, staff roles for modmail |
| **Message IDs** | Discord message/snowflake IDs | Ticket panel messages, log references |
| **Usernames & Tags** | e.g., `User#1234` or `@username` | Identifiers in moderation actions, logs, and audit trails |
| **Message Content** | Text from deleted/updated messages, trap channel messages | Event logging, auto-moderation, trap system detection |
| **Interaction Data** | Slash command inputs, button clicks, modal submissions | Command processing, ticket creation, verification |
| **IP Addresses** | Browser IP addresses | OAuth login sessions (stored in memory only, not persisted) |
| **Vote Records** | User IDs, vote timestamps, vote source | Vote tracking on Top.gg and DiscordBotList.com |

### 1.2 Data You Voluntarily Provide

- **Ticket & Modmail Messages:** Content you submit through ticket forms or modmail DMs is stored as transcripts.
- **Dashboard Login:** When you log into the web dashboard via Discord OAuth, we receive your Discord user ID, username, avatar, and guild list. This data is stored in an in-memory session (not written to disk) and expires after 24 hours.
- **Backup Authorizations:** If you authorize the Bot to add you to servers during restore operations, your OAuth access token and refresh token are stored until the backup is deleted.

## 2. How We Use Your Data

We use the collected data for the following purposes:

- **Server Management:** Processing moderation commands (ban, kick, timeout, warn), managing tickets, handling modmail conversations.
- **Event Logging:** Recording Discord server events for audit and transparency purposes.
- **Verification:** Running image captcha challenges to verify new members are human.
- **Anti-Bot Protection:** Operating the trap/honeypot system to detect and remove automated bot accounts.
- **Backup & Restore:** Creating and restoring server configuration snapshots.
- **Dashboard Functionality:** Providing the real-time log feed, configuration interface, and management tools.
- **Vote Tracking:** Recording votes on Discord bot lists to track community engagement.
- **Service Improvement:** Aggregated, anonymized analytics to improve Bot performance and features.

## 3. Data Storage & Retention

### 3.1 Storage Location

All data is stored on the server where the Bot is self-hosted. We do not use third-party cloud storage for data. If you use the optional Git Sync feature, configuration data may be pushed to a GitHub repository you control.

### 3.2 Retention Periods

| Data | Retention |
|------|-----------|
| Log entries | Last 5,000 entries persisted to disk; maximum 10,000 in memory |
| Warnings | Retained until manually cleared by a moderator |
| Guild configuration | Retained until the Bot is removed from the server |
| Modmail threads | Retained until the thread is manually deleted |
| Ticket data | Retained until the ticket is deleted |
| Vote records | Retained indefinitely for cumulative statistics |
| Dashboard sessions | 24 hours (in-memory only) |
| Backup OAuth tokens | Retained until the associated backup is deleted |
| Captcha challenge data | 2 minutes (in-memory only) |

### 3.3 Deletion

You can request data deletion by:
- Removing the Bot from your server (deletes guild-specific configuration)
- Using `/clearwarnings` to remove warning records
- Using dashboard or ticket commands to delete tickets and transcripts
- Contacting the Bot operator directly for additional deletion requests

## 4. Data Sharing

We do **not** sell, trade, or share your personal data with third parties except:

- **GitHub (optional):** If Git Sync is enabled, configuration files are pushed to a GitHub repository specified by the Bot operator.
- **Discord API:** The Bot communicates with Discord's API to function. Data exchanged with Discord is subject to [Discord's Privacy Policy](https://discord.com/privacy).
- **Top.gg / DiscordBotList.com (optional):** If vote webhooks are configured, these services send vote notification data to the Bot.

## 5. Data Security

We implement the following security measures:

- **No sensitive data in logs:** Bot tokens and secrets are never logged or exposed in plaintext.
- **Memory-only session storage:** OAuth tokens are stored in memory only, never written to disk.
- **CSRF protection:** Login state tokens prevent cross-site request forgery attacks.
- **HTTP-only cookies:** Session cookies are HTTP-only and not accessible via JavaScript.
- **Webhook verification:** Vote webhooks are cryptographically verified using HMAC-SHA256 signatures.
- **Optional production obfuscation:** JavaScript source can be obfuscated for self-hosted deployments.

However, no method of electronic storage is 100% secure. The Bot operator is responsible for maintaining the security of their own hosting environment.

## 6. Your Rights

Depending on your jurisdiction (e.g., GDPR, CCPA), you may have the following rights:

- **Right to Access:** Request a copy of data stored about you.
- **Right to Rectification:** Request correction of inaccurate data.
- **Right to Deletion:** Request deletion of your data (see Section 3.3).
- **Right to Restrict Processing:** Request limited use of your data.
- **Right to Data Portability:** Request transfer of your data in a machine-readable format.
- **Right to Object:** Object to the processing of your data.

To exercise these rights, contact the Bot operator of the instance you are using, or open an issue on the GitHub repository.

## 7. Children's Privacy

Limey is not intended for use by children under the age of 13 (or the applicable age of digital consent in your country). We do not knowingly collect data from children. If you believe a child has provided us with personal data, please contact us so we can delete it.

## 8. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be posted to the GitHub repository and reflected in the "Last updated" date at the top of this document. Continued use of the Bot after changes constitutes acceptance of the updated policy.

## 9. Contact

For questions about this Privacy Policy or data handling practices, please:

- Open an issue on the [GitHub repository](https://github.com/limey-bot/limey/issues)
- Contact the operator of the Bot instance you are using

---

**Note:** This Privacy Policy covers the default Limey Bot. Self-hosted instances may have different data handling practices. Please consult your instance operator for details specific to your deployment.
