// End-to-end smoke test: loads the built extension into Chromium, records an
// investigation against a broken login page and checks what the side panel shows.
// Screenshots land in e2e/artifacts/. Run with `npm run test:e2e`.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { findChromium } from '../scripts/chromium.mjs';
import { startFixtureServer } from './fixture-server.mjs';

const DIST = resolve('dist');
const OUT = resolve('e2e/artifacts');
await mkdir(OUT, { recursive: true });

const server = await startFixtureServer();
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'bugtrail-e2e-'));

const context = await chromium.launchPersistentContext(profile, {
  executablePath: findChromium(),
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

const step = (name) => console.log(`• ${name}`);
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  step(`extension loaded (${extensionId})`);

  const app = context.pages()[0] ?? (await context.newPage());
  await app.goto(`${base}/login`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 900 });
  // Find the app's tab id from an extension page (the panel's own tab is the other one).
  await panel.goto(`chrome-extension://${extensionId}/src/pages/sidepanel.html`);
  const tabId = await panel.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.id !== self?.id)?.id;
  });
  assert.ok(tabId, 'found the app tab');
  await panel.goto(`chrome-extension://${extensionId}/src/pages/sidepanel.html?tabId=${tabId}`);
  await panel.getByPlaceholder('e.g. Login is broken').fill('Login is broken');
  await panel.getByRole('button', { name: 'Start investigation' }).click();
  await panel
    .getByText(/Recording/)
    .first()
    .waitFor();
  step('investigation started');

  await app.bringToFront();
  await app.goto(`${base}/login`);
  await app.waitForTimeout(1800); // let the slow /api/flags call finish
  await app.locator('#email').fill('dana@acme.dev');
  await app.locator('#password').fill('hunter2');
  await app.getByRole('button', { name: 'Sign in' }).click();
  await app.waitForTimeout(1500);
  step('reproduced the bug in the page');

  await panel.bringToFront();
  await panel.locator('.chapter-title', { hasText: 'Clicked “Sign in”' }).waitFor({ timeout: 5000 });
  const summary = await panel.locator('.summary-text').innerText();
  console.log(`  summary: ${summary}`);
  assert.match(summary, /After you clicked “Sign in”, POST \/api\/v2\/auth\/login returned 500/);
  assert.match(summary, /TypeError: Cannot read properties of undefined \(reading 'token'\)/);

  const chapters = await panel.locator('.chapter-title').allInnerTexts();
  console.log(`  chapters: ${chapters.map((c) => c.split('\n')[0]).join(' | ')}`);
  assert.ok(chapters.some((c) => c.startsWith('Opened /login')));
  assert.ok(chapters.some((c) => c.startsWith('Typed in “Email”')));
  assert.ok(chapters.some((c) => c.startsWith('Clicked “Sign in”')));

  const topIssue = await panel.locator('.top-issue-title').first().innerText();
  assert.equal(topIssue, 'POST /api/v2/auth/login → 500');
  assert.ok(await panel.locator('.row.is-effect').count(), 'the TypeError is drawn under the request that caused it');
  assert.ok(await panel.getByText('GET /api/flags').count(), 'the slow request is listed');
  step('side panel shows the causal story');

  await panel.locator('.row-head', { hasText: 'POST /api/v2/auth/login' }).click();
  await panel.getByText('Why it scores').waitFor();
  const detail = await panel.locator('.detail').first().innerText();
  assert.match(detail, /session store unavailable/, 'response body captured');

  for (const scheme of ['dark', 'light']) {
    await panel.emulateMedia({ colorScheme: scheme });
    await panel.setViewportSize({ width: 420, height: 900 });
    await panel.screenshot({ path: join(OUT, `sidepanel-${scheme}.png`) });
    await panel.setViewportSize({ width: 1280, height: 820 });
    await panel.screenshot({ path: join(OUT, `wide-${scheme}.png`) });
  }
  await panel.getByRole('button', { name: 'Stop' }).click();
  await panel.getByText(/Stopped/).waitFor();
  step('stopped; screenshots saved to e2e/artifacts');

  for (const scheme of ['dark', 'light']) {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 340, height: 320 });
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.goto(`chrome-extension://${extensionId}/src/pages/popup.html`);
    await popup.getByText('Start investigation').waitFor();
    await popup.screenshot({ path: join(OUT, `popup-${scheme}.png`) });
    await popup.close();
  }
  console.log('\nE2E PASSED');
} catch (err) {
  console.error('\nE2E FAILED');
  console.error(err);
  process.exitCode = 1;
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
