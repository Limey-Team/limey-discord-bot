# Contributing to Limey

Thank you for your interest in contributing to Limey! We welcome contributions from the community, whether it's bug reports, feature requests, code changes, documentation improvements, or other feedback.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Coding Guidelines](#coding-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Feature Requests](#feature-requests)
- [Security Issues](#security-issues)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior by opening an issue on the repository.

## Getting Started

1. **Fork the repository** to your GitHub account.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/limey.git
   cd limey
   ```
3. **Add the upstream remote** to keep your fork in sync:
   ```bash
   git remote add upstream https://github.com/limey-bot/limey.git
   ```
4. **Create a new branch** for your changes:
   ```bash
   git checkout -b feature/my-feature
   ```

## Development Setup

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- A **Discord bot token** from the [Discord Developer Portal](https://discord.com/developers/applications)

### Installation

```bash
# Install dependencies
npm install

# Copy the environment file
cp .env.example .env

# Edit .env and add your Discord bot token
# DISCORD_TOKEN=your_token_here
```

### Running in Development Mode

```bash
# Start with auto-reload on file changes
npm run dev
```

The web dashboard will be available at `http://localhost:3000`.

### Production Build

```bash
npm run build
npm run start:prod
```

## Coding Guidelines

### Language & Style

- **JavaScript (Node.js):** The project uses vanilla JavaScript with CommonJS modules (`require`/`module.exports`).
- **ES2021+ features** are welcome, but avoid experimental or stage-0 proposals.
- Follow the existing code style in the repository. There is no formal linter configuration, but try to match the surrounding code.

### File Structure

- `src/` — Main application source code
  - `index.js` — Entry point (ShardingManager)
  - `shard-entry.js` — Worker process for each shard
  - `bot.js` — Core bot logic, event handling, commands
  - `store.js` — Configuration and warning persistence
  - `logger.js` — Event logging engine
  - `captcha.js` — Image captcha generation
  - `backup.js` — Backup and restore system
  - `votes.js` — Vote tracking and webhook verification
  - `botManager.js` — Custom bot instance management
  - `announce.js` — Update announcement system
  - `release.js` — GitHub Release automation
  - `git-sync.js` — Git auto-sync for data persistence
  - `commands.js` — Slash command registration
  - `tickets/` — Ticket system (commands, core, panels, store, actions)
  - `modmail/` — Modmail system (commands, core, store)
  - `web/` — Web dashboard (server.js, public/ assets)
- `config/` — Configuration files (ticket configs, etc.)
- `database/` — Persistent data storage
- `scripts/` — Build and utility scripts

### Naming Conventions

- **Files:** Use kebab-case (`store.js`, `git-sync.js`)
- **Variables & Functions:** Use camelCase (`getLogChannel`, `sendCaptchaChallenge`)
- **Constants:** Use UPPER_SNAKE_CASE (`CAPTCHA_LENGTH`, `MAX_IN_MEMORY`)
- **Classes:** Use PascalCase (`Logger`, `ShardClient`)

### Best Practices

- **Async/await** is preferred over raw Promises for readability
- **Handle errors** gracefully with try/catch — don't let errors crash the bot
- **Log important events** using the `logger.log()` function
- **Avoid breaking changes** to the Web API unless absolutely necessary
- **Test your changes** thoroughly before submitting

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

**Types:**

- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation changes
- `style` — Code style changes (formatting, missing semicolons, etc.)
- `refactor` — Code changes that neither fix a bug nor add a feature
- `perf` — Performance improvements
- `test` — Adding or modifying tests
- `chore` — Build process, dependencies, tooling changes

**Examples:**

```
feat(tickets): add bulk close command for multiple tickets
fix(modmail): handle null channel on thread deletion
docs(readme): update environment variable reference table
refactor(store): extract event filtering into dedicated module
```

## Pull Request Process

1. **Ensure your branch is up-to-date** with the main branch:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Test your changes** thoroughly. Verify:
   - The bot starts without errors
   - Your new feature works as expected
   - Existing features are not broken

3. **Create a pull request** on GitHub from your fork to the `main` branch.

4. **Fill out the PR template** with a clear description of your changes.

5. **Respond to any feedback** from reviewers. Be open to suggestions and willing to make changes.

6. **Once approved**, a maintainer will merge your PR.

### PR Guidelines

- Keep PRs focused on a single concern — avoid "kitchen sink" PRs
- If your PR addresses an issue, reference it in the description (e.g., "Closes #123")
- Include screenshots or GIFs for UI changes
- Document new environment variables or configuration options

## Issue Reporting

Before submitting an issue, please:

1. **Search existing issues** to avoid duplicates
2. **Check the README** for configuration guidance
3. **Use the issue templates** — they provide structure for complete bug reports

**Good bug reports include:**

- Bot version (from `/version` command) and commit hash
- Steps to reproduce the behavior
- Expected behavior vs actual behavior
- Screenshots or logs if applicable
- Environment details (hosting platform, Node.js version)

## Feature Requests

Feature requests are welcome! When suggesting a feature:

1. **Explain the problem** you're trying to solve
2. **Describe the solution** you'd like to see
3. **Consider alternatives** you've thought about
4. **Use the feature request template** from the repository

Not all features will be accepted. We prioritize features that align with the project's scope and are broadly useful.

## Security Issues

**Do not open public issues for security vulnerabilities.** Instead, please follow our [Security Policy](SECURITY.md) for responsible disclosure.

## Questions?

If you have questions about contributing, feel free to open a discussion or ask in the issues section. We're happy to help!

---

Thank you for contributing to Limey! 💚
