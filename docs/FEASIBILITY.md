# BugTrail — Feasibility & Go/No-Go Analysis

_Date: 2026-10-08_

**Idea in one line:** a browser tool that turns "something is broken" into a focused
investigation (the failing request, the error it caused, the user action that started it)
and a report that lets someone else reproduce it.

---

## 1. TL;DR

| Question               | Answer                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technically feasible?  | **Yes.** All of it can be built as a Chrome MV3 extension with public APIs. Nothing needs a browser fork.                                                                                                                                                                                                                                |
| Does it already exist? | **Partly.** Chrome DevTools already has most of the _filters_. Jam.dev and similar tools already make _bug reports_ (principle 2). Requestly and similar tools already _mock responses_ (principle 3). **No tool combines live correlation, impact ranking and "a report that reproduces itself"**, and that combination is the opening. |
| Useful?                | High for QA and API testers and for frontend devs on teams with a QA handoff. Lower for senior devs who already know DevTools well.                                                                                                                                                                                                      |
| ROI                    | **As a commercial product: medium-risk.** The market is crowded, so getting users (distribution) is the hard part, not building it. **As a portfolio piece, open-source tool or internal team tool: high.**                                                                                                                              |
| Effort                 | MVP: **~8–10 weeks for one dev** (~5–6 weeks for two). Shareable hosted reports and polish add another **~6–8 weeks**.                                                                                                                                                                                                                   |
| Should we do it?       | **Yes, with a narrow wedge.** Don't build "better DevTools". Build _"Investigate → Report → Reproduce"_ and test it with real testers before widening it.                                                                                                                                                                                |
| Form factor            | **Chrome extension** (DevTools panel and side panel), plus a **self-contained HTML report file** (later a small web viewer). Not a standalone web app, not a desktop proxy.                                                                                                                                                              |

---

## 2. What Chrome DevTools already does (answering the pain-point questions)

Many of the pain points are partly solved in DevTools already, but the solutions are **hard to find, scattered across panels, or not connected to each other**. That gap is where we compete.

| Pain point / idea                                 | Already in Chrome?                                                                                                                                                             | Gap that remains                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Filter by status code                             | **Yes.** Network filter box supports `status-code:500`, negation `-status-code:200`, `method:POST`, `domain:`, `larger-than:`, `is:running`, `has-response-header:` and regex. | You can only find it if you already know the syntax. There's no one-click "only failures" view, no "4xx / 5xx / failed / slow" chips, and no automatic "slow" threshold relative to the page's own baseline. |
| Separate warnings from errors                     | **Yes.** Level filter (Errors/Warnings/Info/Verbose) plus the console sidebar, which groups messages by level and source.                                                      | Errors aren't ranked by severity. Third-party and extension noise isn't separated from your own code. Nothing explains _why_ one error matters more than another.                                            |
| Suppress repetitive noise                         | **Partly.** "Group similar messages" collapses identical, consecutive messages.                                                                                                | It doesn't collapse near-duplicates (same stack, different values). There's no persistent "mute this pattern" and no known-noise list (favicon 404, React dev warnings, analytics blocked by ad-blockers).   |
| Rank issues by impact                             | **Partly.** The Issues panel categorises CORS, cookie, mixed-content and deprecation problems. "Understand this error" (Gemini) explains a single message.                     | Nothing ranks the session's problems against each other or ties them to what the user did.                                                                                                                   |
| Chronological timeline (action → request → error) | **Partly.** The Performance panel has a timeline. The Recorder records user flows. Request _initiator_ stacks exist.                                                           | Console and Network are never shown on one causal timeline. Playwright's Trace Viewer does exactly this, but only for automated test runs and not in a manual browsing session.                              |
| See all panels at once                            | **Partly.** The console drawer (Esc) can sit under Network.                                                                                                                    | It's limited to two panels and nothing is linked. Clicking an error doesn't highlight its request.                                                                                                           |
| Surface failed and slow requests, shareable       | **Partly.** HAR export.                                                                                                                                                        | A HAR contains _everything_, including tokens and cookies. It's huge and unreadable for the person receiving it.                                                                                             |
| Simulate failures / delays / bad responses        | **Partly.** Local Overrides (response body and headers), request blocking, network throttling.                                                                                 | Setup takes many clicks for each request. Mocks aren't saved with a bug and can't be shared, so the receiving dev can't re-apply them.                                                                       |

**Conclusion:** the value isn't in any single feature. It's in **correlation, prioritisation and portability**. DevTools is built for experts who explore. BugTrail should be built for people who **triage and hand off**.

---

## 3. Competitive landscape

| Category                       | Products                                                                                             | Overlap with our principles                                                                                                          | Weakness we exploit                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-click bug reports          | **Jam.dev** (closest competitor), Bird Eats Bug, Marker.io, BugHerd, Usersnap, Zipy                  | **Principle 2** is strongly covered: screen recording, console and network logs, device info, AI summaries, Jira/Linear integration. | They capture _after_ the bug and dump everything. They don't rank, isolate the causal chain, or reproduce.                                          |
| Session replay / observability | Sentry (Session Replay + breadcrumbs), LogRocket, PostHog, OpenReplay, Highlight                     | **Principle 4 (timeline)** is covered _in production_.                                                                               | They need an SDK installed in the app, are priced per org, and are aimed at devs looking at production. They don't help a tester exploring staging. |
| Request interception / mocking | **Requestly** (now part of BrowserStack), ModHeader, Tweak, Charles, Proxyman, HTTP Toolkit, Mockoon | **Principle 3** is covered.                                                                                                          | The mocks are disconnected from the bug. Nobody bundles "the exact failing responses" into a report that replays them.                              |
| Time-travel debugging          | Replay.io                                                                                            | Deep reproduction                                                                                                                    | Heavy, aimed at developers, needs a custom browser or runtime.                                                                                      |
| Test tooling                   | Playwright Trace Viewer, Cypress, Chrome Recorder                                                    | Timeline and repro                                                                                                                   | Automated tests only. Not for manual QA sessions.                                                                                                   |
| AI agents                      | Chrome DevTools MCP, AI features inside DevTools                                                     | Could make "investigate" automatic                                                                                                   | Both a threat and an opportunity (see §7).                                                                                                          |

**Positioning:** _Jam tells you what happened. BugTrail tells you **what caused it** and lets the developer **make it happen again**._

The **"self-reproducing bug report"** is our main differentiator. The report carries the failing and slow responses as mock rules. A developer with the extension clicks **Reproduce** and their local or staging app gets the same 500 / timeout / malformed JSON, even if the backend has since recovered or the bug was intermittent.

---

## 4. Feasibility of each idea

| Idea                                       | Feasibility                                                | How                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status-code / failure / slow filters       | Easy                                                       | Chips: `Failed`, `4xx`, `5xx`, `Network error`, `CORS`, `Slow (> p90 of this session or > N ms)`, `1st-party only`.                                                                                                                                                                     |
| Separate and dedupe console                | Easy                                                       | Normalise messages: strip numbers, IDs and URLs, then hash with the top stack frame and group. Keep a built-in known-noise list plus per-project "mute pattern".                                                                                                                        |
| Impact ranking that explains itself        | **Medium, feasible with heuristics. No ML needed for v1.** | A score made of weighted signals, each one shown as a readable reason (see below). An LLM can add a written summary later as an optional extra.                                                                                                                                         |
| Causal timeline (action → request → error) | Medium                                                     | Record user actions with a content script (click, input, submit, navigation, labelled by the element's text/ARIA). Link them to requests by timing and the CDP `initiator` stack. Link requests to errors by timing, matching stack frames, or the URL appearing in the error text.     |
| "Investigate this failure"                 | Medium                                                     | Start from any error or request. Walk the links back to the triggering action and forward to downstream errors. Show that sub-graph in one view.                                                                                                                                        |
| "Login is broken" workflow investigation   | Medium                                                     | v1: the user clicks **Start investigation**, names it ("Login is broken"), does the flow, then clicks **Stop**. Everything in that window is scoped and ranked. Matching a named workflow to past traffic by keywords or an LLM comes later.                                            |
| Unified multi-pane view                    | Easy–Medium                                                | One DevTools panel with resizable splits (timeline / requests / console / detail), in the style of VS Code view containers.                                                                                                                                                             |
| One-click report                           | Medium                                                     | Repro steps from recorded actions, the selected element (selector, screenshot crop, computed state), top-ranked issues, request/response details, environment info. **Secrets are redacted by default** (Authorization, Cookie, Set-Cookie, tokens in bodies, configurable field list). |
| Simulate failures / delays / bad responses | Medium                                                     | CDP `Fetch.enable` + `Fetch.requestPaused` → `fulfillRequest` / `failRequest`, with a delay before continuing. Rules: URL pattern + method → status / body / headers / latency / error type.                                                                                            |
| Self-reproducing report                    | Medium (it's the rules above, exported)                    | Export captured responses as mock rules inside the report, and import them with one click.                                                                                                                                                                                              |

### Ranking sketch (explainable by design)

```
score = Σ weight × signal
  + 40  uncaught exception / unhandled rejection
  + 30  5xx, network error, CORS failure on a 1st-party request
  + 25  happened within 2s after a user action (user-visible)
  + 20  causally linked to another failure (request → error chain)
  + 15  4xx other than an expected 401/404 probe
  + 10  1st-party script/origin (vs 3rd-party / extension)
  +  5  × log(occurrences)
  − 30  matches a known-noise pattern (analytics blocked, favicon, dev-only warnings)
  − 20  warning-level only, no linked failure
```

The UI shows the reasons as plain sentences: _"Ranked #1: uncaught `TypeError` in your code, 140 ms after clicking **Sign in**, right after `POST /api/login` returned **500**."_ That explanation is the feature, not just the number.

### Key technical choices and risks

| Topic                       | Decision / risk                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture mechanism           | **`chrome.debugger` (CDP)** gives full request/response bodies, initiators, console with stacks, and Fetch interception for mocking. **Cost:** Chrome shows a "BugTrail is debugging this browser" bar while attached. **Mitigation:** attach only during an active investigation, or offer a lighter mode that patches `fetch`/XHR/`console` in the page itself (no bar, misses some resource loads and service-worker requests). |
| `chrome.devtools.network`   | Only available while DevTools is open, and only gives HAR entries. Useful as a fallback inside the DevTools panel.                                                                                                                                                                                                                                                                                                                 |
| MV3 service worker lifetime | The extension's background script is shut down when idle, so session state can be lost. Keep it in the DevTools panel / side panel or in `chrome.storage.session` + IndexedDB.                                                                                                                                                                                                                                                     |
| Privacy                     | Reports can contain PII and tokens. Redaction is a requirement for v1. Default to **local-only**, so nothing leaves the machine unless the user shares it. This is also a selling point for enterprises.                                                                                                                                                                                                                           |
| Chrome Web Store review     | Permissions like `debugger` and `<all_urls>` get extra scrutiny and scare users at install. Ask for host permissions per site when needed (optional permissions) instead of all sites up front.                                                                                                                                                                                                                                    |
| Cross-browser               | Edge and Brave work with the same build. Firefox has no `chrome.debugger`, so it would only get the lighter page-patching mode.                                                                                                                                                                                                                                                                                                    |

---

## 5. Effort & resources

Estimates assume one competent TypeScript/frontend developer. Two developers cut the elapsed time by about 40%, not 50%.

| Phase                      | Scope                                                                                                                                                                                                                          | Effort    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **0. Validation**          | Interview 8–10 QA testers and devs. Clickable prototype. Check: "would you install this / would you pay for it?"                                                                                                               | 1–2 weeks |
| **1. MVP (local-only)**    | MV3 extension + DevTools panel. CDP capture. Failure/slow chips. Console grouping and noise muting. Start/Stop investigation. Unified timeline. Heuristic ranking with reasons. Self-contained **HTML report** with redaction. | 6–8 weeks |
| **2. Reproduce**           | Mock rule editor (status, body, delay, network error). Export captured responses as rules. Import rules from a report.                                                                                                         | 2–3 weeks |
| **3. Share & integrate**   | Hosted report viewer (link sharing, expiry, auth). Jira/Linear/GitHub issue export. Playwright test export from recorded steps.                                                                                                | 4–6 weeks |
| **4. AI layer (optional)** | LLM summary of the investigation, "likely root cause", natural-language workflow matching. Opt-in, with redacted data only.                                                                                                    | 2–3 weeks |

**Money cost is low:** Chrome Web Store $5 one-off. Hosting for phase 3 is ~$0–50/month to start. LLM API costs are per use and can be passed on to paid tiers. The real cost is **developer time (~3–5 person-months to a credible v1)** plus continuous work on distribution.

**Stack:** TypeScript, Vite + CRXJS (or WXT) for the extension build, React or Preact for the panel, IndexedDB for session storage. Phase 3: a small backend (Cloudflare Workers + R2, or Supabase).

---

## 6. ROI

**Value to a user (estimate):**

- Bug triage back-and-forth ("can't reproduce", "send me the console", "which request?") typically costs **15–45 min per bug** across the tester and the dev.
- A QA engineer filing 5–10 bugs a week saves roughly **1–4 hours a week**. For a 10-person QA/dev team that is ~**$2–8k/month** of time, against tools in this category priced at roughly **$10–40 per user per month**. The value per seat is easy to justify.

**As a business:**

- ✅ Proven demand: bug-report and mocking tools have real paying customers, and one of them was acquired.
- ⚠️ Crowded, and Jam is well funded and moving toward AI debugging. Google keeps adding AI to DevTools. Copying features won't work.
- ⚠️ The extension is easy to build and hard to get noticed. Plan for distribution: open-source core, a well-written launch, content for QA communities, and being findable in the Chrome Web Store.
- Realistic outcome: a **useful niche tool or open-source project with a paid team tier** (hosted reports, integrations). Venture-scale only if the "reproduce" angle clearly beats existing tools.

**As a portfolio or learning project:** very high ROI. It covers CDP, MV3, data correlation, UX for dense data and privacy engineering, and it's a demo-able product.

---

## 7. Recommendation

**Take the project, scoped tightly, with a kill switch.**

1. **Wedge:** _Investigate → Report → Reproduce._ Don't rebuild the Network or Console panels in general. Show only what is relevant to the current investigation, and send people to DevTools for the rest.
2. **Primary user:** manual QA / API tester handing bugs to developers. They feel the pain most and are the least served by DevTools.
3. **Form factor:** **Chrome extension** (DevTools panel for power use, side panel for testers who never open DevTools) + **portable HTML report**. A standalone web app can't observe other sites' traffic. A desktop proxy (Charles-style) means certificate setup and a heavy install, so it isn't worth it for v1.
4. **Hedge against AI:** expose investigations through a small API or **MCP server** so AI coding agents can read "the ranked, correlated failure + repro mocks". Then AI agents add to the product's value instead of replacing it.
5. **Kill / continue criteria after the MVP (~3 months):**
   - ≥ 30 weekly active users from outreach, **and**
   - ≥ 40% of shared reports opened by a second person, **and**
   - at least 3 users saying the reproduce feature saved them time.
     If none of these are met, keep it as an open-source / portfolio project and stop investing.

### Suggested MVP cut (what to build first)

- [ ] DevTools panel with **Failed / 4xx / 5xx / Slow / 1st-party** chips
- [ ] Console grouping of near-duplicates + "mute this pattern"
- [ ] Start/Stop **Investigation** with a name
- [ ] Unified timeline: user action → requests → console errors
- [ ] Explainable impact ranking (heuristic)
- [ ] One-click **HTML report** with redaction
- [ ] Mock rules (status / body / delay / fail) + **"Reproduce from report"**
