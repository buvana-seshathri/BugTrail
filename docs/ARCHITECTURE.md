# Architecture

BugTrail has four layers. Data flows one way, from the page to the UI:

```
 inspected tab                    background worker                 extension pages
┌──────────────┐  CDP events   ┌──────────────────────┐  TabState  ┌────────────────────┐
│ page + probe │ ────────────▶ │ CdpEventMapper       │ ─────────▶ │ analyze()          │
│ (probe.js)   │  (debugger)   │  → Session (events)  │   (port)   │  → Story view, etc │
└──────────────┘               └──────────────────────┘            └────────────────────┘
```

| Layer             | Folder           | Knows about Chrome?    | Tested by                    |
| ----------------- | ---------------- | ---------------------- | ---------------------------- |
| Domain & analysis | `src/core`       | **No** (lint-enforced) | unit tests (`test/`)         |
| Capture           | `src/capture`    | No (fed raw CDP)       | unit tests with recorded CDP |
| Background        | `src/background` | Yes                    | e2e (`e2e/smoke.mjs`)        |
| UI                | `src/ui`         | Yes (ports, storage)   | e2e + screenshots            |

## Capture

Recording starts when the user clicks **Start investigation**. The background worker:

1. attaches `chrome.debugger` to the tab (Chrome shows its debugging bar while attached);
2. enables the `Network`, `Page`, `Log` and `Runtime` domains;
3. adds a CDP binding (`__bugtrail`) and injects **`probe.js`** into the page (now and on every navigation) with `Page.addScriptToEvaluateOnNewDocument`.

The probe (`src/capture/probe.ts`) listens for clicks, typing, submits and Enter/Escape, describes the element (`form#signin › button[type=submit]`, label “Sign in”), and reports through the binding. It never reads field values. Using CDP for this instead of a content script means BugTrail needs **no host permissions**.

`CdpEventMapper` (`src/capture/cdpMapper.ts`) turns raw CDP events into `TrailEvent`s (`src/core/types.ts`):

- `Network.*` → `RequestEvent` (timing, status, initiator stack, request body; response body fetched only for failed requests);
- `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded` → `ConsoleEvent`;
- `Runtime.bindingCalled` (probe), main-frame document requests and same-document navigations → `ActionEvent`.

The mapper is pure, so it can be tested by replaying CDP messages (`test/cdpMapper.test.ts`).

## Background worker

`src/background/index.ts` keeps one `Session` per tab (`sessions.ts`), upserts events by id, caps them at 5,000, persists to `chrome.storage.session` (so a restarted service worker can show what was recorded), and pushes the full `TabState` to subscribed pages over a port, throttled to ~150 ms. The protocol lives in `src/shared/messages.ts`.

## Analysis

`analyze(investigation)` (`src/core/analyze.ts`) is a pure function. Everything the UI shows comes from it:

1. **Classify** each event: a failed request, slow request, error or warning becomes an issue candidate. Everything else is "passed" or "quiet".
2. **Group** candidates by fingerprint (`fingerprint.ts`): method + id-normalised path + outcome for requests; level + normalised message + top stack frame for console messages.
3. **Trigger**: the most recent user action within 2 s before an issue's first occurrence.
4. **Causal links**: an error is linked to a failed request that finished within 2 s before it, preferring one whose initiator stack shares a script with the error's stack.
5. **Score** (0–100) from reasons. Each reason is kept and shown in the UI:

   | Signal                                   | Points             |
   | ---------------------------------------- | ------------------ |
   | 5xx from your own API / third party      | +40 / +20          |
   | Network failure, CORS                    | +35 (1st-party)    |
   | 401/403 · other 4xx                      | +20 · +25          |
   | Uncaught exception / unhandled rejection | +40                |
   | `console.error` / browser error          | +25                |
   | Slow request                             | +15 … +30 by ratio |
   | Within 2 s of a click/type/submit        | +25                |
   | During page load                         | +10                |
   | Caused other errors                      | +20                |
   | Follows a failed request                 | +10                |
   | Own code (+) / third-party origin (−)    | +10 / −10          |
   | Repeated _n_ times                       | up to +10          |
   | Matches a noise rule                     | −40                |

   Finally, an effect is capped just below its cause, so fixing the cause comes first.

6. **Story**: one chapter per action (consecutive typing in one field is merged). Each chapter lists its issues, effects indented under their causes, plus counts of passed requests and quiet messages.
7. **Summary**: one or two sentences about the root cause.

Thresholds live in `DEFAULT_OPTIONS`; slow detection uses `max(1 s, 4 × median)` capped at 3 s once there are at least five successful requests, and 1 s before that.

## UI

React 19, no UI framework. `src/ui/theme.css` holds the design tokens for both themes; components use only `var(--bt-*)`. Entries:

- `sidepanel.tsx`: follows the active tab of its window (`?tabId=` pins it, for tests);
- `panel.tsx`: the DevTools tab, bound to `chrome.devtools.inspectedWindow.tabId`;
- `popup.tsx`: status and quick start;
- `devtools.ts`: registers the DevTools tab.

The same `App` serves the side panel and DevTools; the layout switches at 820 px.

## Build

Two Vite builds: `vite.config.ts` (pages + background as an ES-module service worker) and `vite.probe.config.ts` (the probe as one IIFE). `public/manifest.json` and icons are copied as-is. Icons are rendered from `assets/brand/*.svg` with `npm run icons`.
