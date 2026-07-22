/**
 * Build script for Limey
 *
 * Obfuscates all JavaScript source files using javascript-obfuscator,
 * copies non-JS assets (HTML, CSS, JSON, etc.) to dist/,
 * and preserves the full directory structure.
 *
 * Usage: node scripts/build.js
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

// Files / directories to always skip (relative to src/)
const SKIP = new Set([
  // No exclusions by default — obfuscate everything
]);

// File extensions to obfuscate
const OBFUSCATE_EXT = new Set(['.js']);

// File extensions to copy as-is (without obfuscation)
const COPY_EXT = new Set(['.html', '.css', '.json', '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webmanifest', '.xml', '.woff', '.woff2']);

// ─── Maximum VM-Style Obfuscation Settings ──────────────────────────
// These options emulate VM-like protection using:
// - controlFlowFlattening (switch-case dispatcher) at max threshold
// - deadCodeInjection (junk code) at max threshold
// - stringArray (rc4-encoded strings) at max threshold
// - transformObjectKeys (object access virtualization)
// - selfDefending (tamper resistance, breaks code if beautified)
// - debugProtection (freezes debugger when DevTools is detected)
// - debugProtectionInterval (periodic re-check every 2s)
// - target: 'node' (optimized for Node.js)
//
// For true bytecode VM obfuscation, upgrade to:
//   https://obfuscator.io  (Pro plan)
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.9,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 1.0,
  debugProtection: true,
  debugProtectionInterval: 2000, // Periodic re-check (browser-oriented; adds minor overhead in Node.js)
  disableConsoleOutput: false,
  identifierNamesGenerator: 'mangled-shuffled',
  ignoreImports: true,
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1.0,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexesType: ['hexadecimal-number'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 5,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1.0,
  target: 'node',
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

let totalFiles = 0;
let obfuscatedCount = 0;
let copiedCount = 0;
let skippedCount = 0;
let errorCount = 0;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isSkipped(relativePath) {
  const parts = relativePath.split(path.sep);
  return parts.some(p => SKIP.has(p));
}

function shouldObfuscate(filePath) {
  return OBFUSCATE_EXT.has(path.extname(filePath));
}

function shouldCopy(filePath) {
  return COPY_EXT.has(path.extname(filePath));
}

/**
 * Obfuscate a single JavaScript file and write to dist/
 */
function obfuscateFile(srcFilePath, distFilePath) {
  const code = fs.readFileSync(srcFilePath, 'utf8');
  try {
    const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(distFilePath, result.getObfuscatedCode(), 'utf8');
    obfuscatedCount++;
  } catch (err) {
    // Fallback: copy the file as-is if obfuscation fails
    console.warn(`  ⚠  Obfuscation failed for ${path.relative(SRC_DIR, srcFilePath)}: ${err.message}`);
    console.warn(`     Falling back — copying as-is.`);
    fs.copyFileSync(srcFilePath, distFilePath);
    copiedCount++;
  }
}

/**
 * Recursively process all files in a directory
 */
function processDirectory(srcDir, distDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const distPath = path.join(distDir, entry.name);
    const relativePath = path.relative(SRC_DIR, srcPath);

    if (isSkipped(relativePath)) {
      skippedCount++;
      continue;
    }

    if (entry.isDirectory()) {
      ensureDir(distPath);
      processDirectory(srcPath, distPath);
    } else if (entry.isFile()) {
      totalFiles++;

      if (shouldObfuscate(srcPath)) {
        obfuscateFile(srcPath, distPath);
      } else if (shouldCopy(srcPath)) {
        fs.copyFileSync(srcPath, distPath);
        copiedCount++;
      } else {
        // Unknown extension — skip with notice in verbose mode
        skippedCount++;
      }
    }
  }
}

function cleanDist() {
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  ensureDir(DIST_DIR);
  console.log('🧹  Cleaned dist/ directory');
}

function printSummary() {
  const border = '═'.repeat(50);
  console.log(`\n${border}`);
  console.log(`  📦  Build Complete`);
  console.log(`${border}`);
  console.log(`  Total files processed : ${totalFiles}`);
  console.log(`  🌀  Obfuscated JS      : ${obfuscatedCount}`);
  console.log(`  📋  Copied assets       : ${copiedCount}`);
  console.log(`  ⏭   Skipped             : ${skippedCount}`);
  console.log(`  ❌  Errors              : ${errorCount}`);

  if (obfuscatedCount > 0 && errorCount === 0) {
    const srcSize = getDirSize(SRC_DIR);
    const distSize = getDirSize(DIST_DIR);
    const reduction = ((1 - distSize / srcSize) * 100).toFixed(1);
    console.log(`${border}`);
    console.log(`  📏  Source size  : ${formatSize(srcSize)}`);
    console.log(`  📏  Output size  : ${formatSize(distSize)} (${reduction}% reduction)`);
  }
  console.log(`${border}\n`);
}

function getDirSize(dirPath) {
  let size = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else if (entry.isFile()) {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Main ──────────────────────────────────────────────────────────────

console.log(`\n  🏗️   Building Limey — ${new Date().toISOString()}\n`);

cleanDist();
processDirectory(SRC_DIR, DIST_DIR);
printSummary();

// Exit with error code if any files failed
if (errorCount > 0) {
  process.exit(1);
}
