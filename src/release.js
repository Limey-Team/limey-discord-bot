/**
 * Release — auto-creates GitHub Releases when the bot version changes.
 *
 * Tracks the last released version in a file. On startup, compares with
 * the version in package.json. If a new version is detected, reads the
 * corresponding section from CHANGELOG.md and creates a GitHub Release
 * via the GitHub API.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const gitSync = require('./git-sync');

const LAST_VERSION_FILE = path.join(__dirname, '..', 'database', 'last-version.txt');
const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_REPO = gitSync.getGithubRepo();

/**
 * Get the current version from package.json.
 */
function getCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Get the release name from the changelog for a given version.
 * Parses "## [version] — Name" from CHANGELOG.md.
 */
function getChangelogSection(version) {
  try {
    if (!fs.existsSync(CHANGELOG_PATH)) return null;
    const content = fs.readFileSync(CHANGELOG_PATH, 'utf8');

    // Match the version section: ## [version] — Name ... until next ## or end
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `## \\[${escapedVersion}\\] — ([^\\n]+)\\n\\n([\\s\\S]*?)(?=\\n## |$)`
    );
    const match = content.match(regex);
    if (!match) return null;

    return {
      name: match[1].trim(),
      body: match[2].trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Get the commit hash for a given git tag (if it exists).
 */
function getTagCommit(tag) {
  try {
    return execSync(`git rev-parse "${tag}" 2>/dev/null`, {
      encoding: 'utf8', timeout: 5000, cwd: path.join(__dirname, '..'),
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Create a GitHub Release via the GitHub API.
 */
async function createGitHubRelease(version, releaseName, body) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return { success: false, error: 'GITHUB_TOKEN or GITHUB_REPO not configured' };
  }

  const tag = `v${version}`;

  // Check if the tag/release already exists
  const existingTag = getTagCommit(tag);
  if (existingTag) {
    return { success: false, error: `Tag ${tag} already exists — release already created` };
  }

  // Get the latest commit hash for the target
  // If it's a local commit that hasn't been pushed yet, fall back to the branch name
  let targetCommit = GITHUB_BRANCH;
  try {
    const hash = execSync('git rev-parse HEAD', {
      encoding: 'utf8', timeout: 5000, cwd: path.join(__dirname, '..'),
    }).trim();
    // Verify the commit is reachable on the remote
    const remoteCheck = execSync(`git branch -r --contains ${hash} 2>/dev/null || true`, {
      encoding: 'utf8', timeout: 5000, cwd: path.join(__dirname, '..'),
    }).trim();
    if (remoteCheck) {
      targetCommit = hash;
    }
  } catch {
    // Fallback to branch name already set
  }

  const releaseData = {
    tag_name: tag,
    target_commitish: targetCommit,
    name: `${tag} — ${releaseName}`,
    body: body,
    draft: false,
    prerelease: false,
  };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'limey-bot',
        },
        body: JSON.stringify(releaseData),
      }
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = errorBody.message
        || (errorBody.errors?.[0]?.message)
        || await response.text().catch(() => 'Unknown error');
      const scopeHint = response.status === 401 || response.status === 403
        ? ' — check that GITHUB_TOKEN has repo/public_repo scope'
        : '';
      return { success: false, error: `GitHub API returned ${response.status}: ${(errorMsg || 'Unknown error').substring(0, 500)}${scopeHint}` };
    }

    const result = await response.json();
    return {
      success: true,
      releaseUrl: result.html_url,
      tag: tag,
      id: result.id,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Read the last released version from disk.
 */
function readLastVersion() {
  try {
    if (fs.existsSync(LAST_VERSION_FILE)) {
      return fs.readFileSync(LAST_VERSION_FILE, 'utf8').trim();
    }
  } catch {}
  return null;
}

/**
 * Write the current version to disk.
 */
function writeLastVersion(version) {
  try {
    const dir = path.dirname(LAST_VERSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_VERSION_FILE, version, 'utf8');
  } catch (err) {
    console.error('[Release] Failed to write last version:', err.message);
  }
}

/**
 * Initialize the release check.
 * Called from the manager process on startup.
 */
async function init() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('[Release] ℹ️ GITHUB_TOKEN or GITHUB_REPO not configured — skipping auto-release');
    return;
  }

  const currentVersion = getCurrentVersion();
  if (!currentVersion) {
    console.log('[Release] ℹ️ Could not read version from package.json');
    return;
  }

  const lastVersion = readLastVersion();

  // First run — just record the version
  if (!lastVersion) {
    writeLastVersion(currentVersion);
    console.log(`[Release] ℹ️ First run — recorded version v${currentVersion}`);
    return;
  }

  // Same version — nothing to release
  if (lastVersion === currentVersion) {
    console.log(`[Release] ℹ️ Version unchanged (v${currentVersion}) — no release needed`);
    return;
  }

  // New version detected! Create a GitHub Release
  console.log(`[Release] 🏷️ New version detected: v${lastVersion} → v${currentVersion}`);

  // Get the changelog section for the new version
  const section = getChangelogSection(currentVersion);
  if (!section) {
    console.log(`[Release] ⚠️ Could not find changelog section for v${currentVersion} — creating release without notes`);
  }

  const releaseName = section ? section.name : `Release v${currentVersion}`;
  const releaseBody = section ? section.body : `Version ${currentVersion} of Limey. See the changelog for details.`;

  const result = await createGitHubRelease(currentVersion, releaseName, releaseBody);

  if (result.success) {
    console.log(`[Release] ✅ GitHub Release created: ${result.releaseUrl}`);
  } else {
    console.log(`[Release] ⚠️ Could not create release: ${result.error}`);
  }

  // Record the new version regardless (don't re-attempt on next restart)
  writeLastVersion(currentVersion);
}

module.exports = { init, getCurrentVersion, getChangelogSection };
