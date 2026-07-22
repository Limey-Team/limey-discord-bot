/**
 * Captcha Image Generator
 *
 * Generates PNG captcha images with distorted text, noise, and lines
 * using Jimp (pure JS, no native dependencies).
 *
 * Fonts are bundled with @jimp/plugin-print.
 */

const { Jimp, loadFont, rgbaToInt } = require('jimp');
const path = require('path');

// Font paths (bundled with @jimp/plugin-print)
const FONTS_DIR = path.join(
  path.dirname(require.resolve('@jimp/plugin-print/package.json')),
  'dist', 'fonts', 'open-sans'
);

// Font path format: <dir>/<font-name>/<font-name>.fnt (loadFont reads the .fnt file directly)
const FONT_BLACK_32 = path.join(FONTS_DIR, 'open-sans-32-black', 'open-sans-32-black.fnt');
const FONT_WHITE_32 = path.join(FONTS_DIR, 'open-sans-32-white', 'open-sans-32-white.fnt');

// Cached fonts (loaded once)
let fontBlack32 = null;
let fontWhite32 = null;

// Characters that are easy to distinguish (no 0/O, 1/l/I)
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAPTCHA_LENGTH = 6;
const IMG_WIDTH = 320;
const IMG_HEIGHT = 110;

/**
 * Load all fonts once at startup. Call this during bot init.
 */
async function initCaptcha() {
  const [f32b, f32w] = await Promise.all([
    loadFont(FONT_BLACK_32),
    loadFont(FONT_WHITE_32),
  ]);
  fontBlack32 = f32b;
  fontWhite32 = f32w;
}

/**
 * Generate a random captcha text string
 */
function generateCaptchaText() {
  let text = '';
  for (let i = 0; i < CAPTCHA_LENGTH; i++) {
    text += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  }
  return text;
}

/**
 * Generate a captcha PNG image with the given text
 * @param {string} text - The captcha text to render
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateCaptchaImage(text) {
  if (!fontBlack32 || !fontWhite32) {
    throw new Error('Captcha fonts not loaded. Call initCaptcha() first.');
  }

  // Random background color (light, pastel)
  const bgR = 200 + Math.floor(Math.random() * 56);
  const bgG = 200 + Math.floor(Math.random() * 56);
  const bgB = 200 + Math.floor(Math.random() * 56);
  const bgColor = rgbaToInt(bgR, bgG, bgB, 255);

  // Create the image
  const image = new Jimp({ width: IMG_WIDTH, height: IMG_HEIGHT, color: bgColor });

  // ── Draw random interference lines ──
  const lineCount = 4 + Math.floor(Math.random() * 3); // 4-6 lines
  for (let i = 0; i < lineCount; i++) {
    const color = rgbaToInt(
      Math.floor(Math.random() * 180),
      Math.floor(Math.random() * 180),
      Math.floor(Math.random() * 180),
      180 + Math.floor(Math.random() * 76)
    );
    const y = Math.floor(Math.random() * IMG_HEIGHT);
    // Draw a horizontal-ish line with some waviness
    for (let x = 0; x < IMG_WIDTH; x++) {
      const offset = Math.sin(x * 0.05 + i * 2) * 4;
      const py = Math.round(y + offset);
      if (py >= 0 && py < IMG_HEIGHT) {
        image.setPixelColor(color, x, py);
        if (py + 1 < IMG_HEIGHT) image.setPixelColor(color, x, py + 1);
      }
    }
  }

  // ── Draw diagonal lines ──
  for (let i = 0; i < 3; i++) {
    const color = rgbaToInt(
      100 + Math.floor(Math.random() * 100),
      100 + Math.floor(Math.random() * 100),
      100 + Math.floor(Math.random() * 100),
      120
    );
    const startX = Math.floor(Math.random() * IMG_WIDTH * 0.3);
    const startY = Math.floor(Math.random() * IMG_HEIGHT);
    for (let step = 0; step < IMG_WIDTH * 0.7; step++) {
      const x = startX + step;
      const y = startY + Math.floor(step * 0.3 * (Math.random() > 0.5 ? 1 : -1));
      if (x >= 0 && x < IMG_WIDTH && y >= 0 && y < IMG_HEIGHT) {
        image.setPixelColor(color, x, y);
      }
    }
  }

  // ── Render each character individually with slight offsets ──
  const charSpacing = 42;
  const totalWidth = CAPTCHA_LENGTH * charSpacing;
  const startX = (IMG_WIDTH - totalWidth) / 2 + 10;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const x = startX + i * charSpacing + Math.floor(Math.random() * 8) - 4;
    const y = 28 + Math.floor(Math.random() * 20) - 10; // random vertical offset

    // Alternate between black and white for visual variety
    const font = i % 3 === 1 ? fontWhite32 : fontBlack32;
    image.print({ font, x, y, text: char });
  }

  // ── Add random noise pixels ──
  const noiseCount = 150 + Math.floor(Math.random() * 100);
  for (let i = 0; i < noiseCount; i++) {
    const x = Math.floor(Math.random() * IMG_WIDTH);
    const y = Math.floor(Math.random() * IMG_HEIGHT);
    const noiseColor = rgbaToInt(
      Math.floor(Math.random() * 200),
      Math.floor(Math.random() * 200),
      Math.floor(Math.random() * 200),
      100 + Math.floor(Math.random() * 156)
    );
    image.setPixelColor(noiseColor, x, y);
  }

  // ── Add some small random circles/dots ──
  for (let i = 0; i < 20; i++) {
    const cx = Math.floor(Math.random() * IMG_WIDTH);
    const cy = Math.floor(Math.random() * IMG_HEIGHT);
    const radius = 1 + Math.floor(Math.random() * 3);
    const dotColor = rgbaToInt(
      Math.floor(Math.random() * 150),
      Math.floor(Math.random() * 150),
      Math.floor(Math.random() * 150),
      150
    );
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const px = cx + dx;
          const py = cy + dy;
          if (px >= 0 && px < IMG_WIDTH && py >= 0 && py < IMG_HEIGHT) {
            image.setPixelColor(dotColor, px, py);
          }
        }
      }
    }
  }

  // Export as PNG buffer
  return await image.getBuffer('image/png');
}

module.exports = { initCaptcha, generateCaptchaText, generateCaptchaImage, CAPTCHA_LENGTH };
