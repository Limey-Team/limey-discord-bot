# Security Policy

## Supported Versions

We prioritize security fixes for the latest stable release. Older versions may not receive security patches.

| Version | Supported          |
|---------|--------------------|
| 1.x     | ✅ Fully supported |
| < 1.0   | ❌ Not supported   |

## Reporting a Vulnerability

We take the security of Limey seriously. If you believe you've found a security vulnerability, please follow these guidelines for responsible disclosure.

### Do Not:

- **Do not** open a public GitHub issue reporting the vulnerability
- **Do not** discuss the vulnerability in public forums, Discord servers, or social media
- **Do not** exploit the vulnerability beyond what's necessary to demonstrate it

### Do:

1. **Open a draft security advisory** on GitHub:
   - Go to the repository's [Security Advisories](https://github.com/limey-bot/limey/security/advisories) page
   - Click "New draft security advisory"
   - Fill in the details of the vulnerability

2. **Alternatively, email the repository maintainer** directly (check the commit log for contact information).

### What to Include:

- Type of vulnerability (e.g., RCE, XSS, privilege escalation, token leakage)
- Steps to reproduce the issue
- Affected versions and components
- Potential impact
- Any suggested fixes (if available)

### Response Timeline

| Timeframe | Action |
|-----------|--------|
| **24-48 hours** | Initial acknowledgment of the report |
| **5-7 days** | Assessment and validation of the vulnerability |
| **14-30 days** | Development of a fix (depending on severity) |
| **Upon fix** | Release of a patched version with advisory |

We aim to resolve critical issues within 14 days and moderate issues within 30 days.

## Security Best Practices for Self-Hosting

If you self-host Limey, please follow these security recommendations:

### Environment Variables

- **Keep your `.env` file secure:** Never commit it to version control. Add it to `.gitignore`.
- **Rotate tokens periodically:** Generate new Discord bot tokens and GitHub tokens on a regular schedule.
- **Use environment-specific secrets:** Don't share production tokens with development environments.

### Discord Bot Configuration

- **Limit bot permissions:** Only grant the specific permissions listed in the README, not Administrator.
- **Use the production build:** Run `npm run build` and `npm run start:prod` in production environments. The obfuscation provides an additional layer of protection.
- **Enable OAuth for the dashboard:** Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DASHBOARD_URL` to restrict dashboard access.
- **Set a BOT_OWNER_ID:** This grants you full access and prevents unauthorized dashboard access.

### Network Security

- **Use a reverse proxy:** Place the web dashboard behind nginx or Caddy with HTTPS.
- **Restrict access to port 3000:** Don't expose the dashboard port to the public internet without a properly configured reverse proxy and authentication.
- **Configure webhook secrets:** Set `TOPGG_WEBHOOK_SECRET` and `DBL_WEBHOOK_SECRET` to verify vote webhooks.

### Data Security

- **Review what you log:** Event logging captures a large amount of server activity. Configure event filters appropriately.
- **Regular backups:** Use the built-in `/backup` command to create snapshots of your configuration.
- **Git Sync considerations:** If using Git Sync, ensure the GitHub repository is private.

## Known Security Features

The project includes the following built-in security measures:

- **HMAC-SHA256 webhook verification** for Top.gg vote webhooks
- **CSRF state token validation** for OAuth login flow
- **HTTP-only session cookies** (not accessible via JavaScript)
- **Memory-only token storage** for custom bot instances
- **In-memory session storage** (24-hour TTL, never written to disk)
- **Production build obfuscation** (control flow flattening, string encoding, debug protection, self-defending)
- **Constant-time string comparison** for webhook signature verification
- **CAPTCHA_MAX_ATTEMPTS** limit (3 attempts) to prevent brute-force verification bypass

## Scope

This security policy covers:

- The Limey Discord Bot source code
- The web dashboard and its API
- Authentication and authorization systems
- Data storage and handling

This security policy does **not** cover:

- Third-party dependencies (report these to their respective maintainers)
- Hosting infrastructure (cloud providers, VPS services)
- Discord's API or platform
- Modified/forked versions of the bot

## Recognition

We believe in recognizing security researchers who responsibly disclose vulnerabilities. With your permission, we will:

- Credit you in the security advisory
- Add your name to a contributors list (if desired)
- Acknowledge your contribution in release notes

Thank you for helping keep Limey and its users safe!
