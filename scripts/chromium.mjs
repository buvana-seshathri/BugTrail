import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Finds a Chromium binary for scripts and e2e tests: $CHROMIUM_PATH, then a
 * Playwright-managed browser under $PLAYWRIGHT_BROWSERS_PATH (or the default cache).
 */
export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME ?? '', '.cache', 'ms-playwright'),
    join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse()) {
      for (const rel of [
        'chrome-linux/chrome',
        'chrome-linux64/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-win/chrome.exe',
      ]) {
        const p = join(root, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error('Chromium not found. Set CHROMIUM_PATH or run `npx playwright install chromium`.');
}
