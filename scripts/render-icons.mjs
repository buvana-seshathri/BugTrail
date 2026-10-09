// Renders the toolbar/store icons in public/icons from the SVG sources in assets/brand.
// Run with `npm run icons` after changing the mark.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';

const SIZES = [
  { size: 16, src: 'assets/brand/mark-16.svg' },
  { size: 32, src: 'assets/brand/mark.svg' },
  { size: 48, src: 'assets/brand/mark.svg' },
  { size: 128, src: 'assets/brand/mark.svg' },
];

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { size, src } of SIZES) {
  const svg = await readFile(src, 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
  console.log(`public/icons/icon-${size}.png`);
}
await browser.close();
