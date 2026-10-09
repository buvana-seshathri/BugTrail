# Contributing to BugTrail

Thanks for helping make debugging less painful! This guide gets you from clone to pull request.

## Setup

```sh
npm ci
npm run build      # builds dist/, load it via chrome://extensions → Load unpacked
npm run dev        # rebuilds on change; click ↻ on the extension card to reload
```

| Script             | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `npm test`         | Unit tests (Vitest), fast and needs no browser                       |
| `npm run test:e2e` | Builds, loads the extension in Chromium, records a broken login page |
| `npm run check`    | Typecheck + lint + format check + unit tests (what CI runs)          |
| `npm run icons`    | Re-renders `public/icons/*.png` from `assets/brand/*.svg`            |

The e2e test needs a Chromium binary: it uses `$CHROMIUM_PATH`, or a Playwright-managed one (`npx playwright-core install chromium`). Set `HEADED=1` to watch it.

## Where things live

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. In short:

- `src/core`: domain model and analysis (grouping, causal links, ranking, redaction, exports). **No browser or extension APIs**: ESLint blocks `chrome`, `window` and `document` here.
- `src/capture`: CDP → events mapper and the in-page probe.
- `src/background`: the service worker (debugger lifecycle, sessions, messaging).
- `src/ui`: React UI. Colours, fonts and radii come from `src/ui/theme.css` tokens only.

## Good first contributions

- **A noise rule** in `src/core/noise.ts`, with a test in `test/grouping.test.ts`.
- **Better wording** for a reason or summary in `src/core/analyze.ts`.
- **A ranking tweak**: change a weight and update `test/analyze.test.ts` to pin the behaviour you expect. Explain the real-world case in your PR.
- **Redaction** of a sensitive field we miss (`src/core/redact.ts`).

## Pull requests

- Keep PRs focused; one feature or fix each.
- Add or update tests. Changes to scoring, grouping or redaction **must** come with tests.
- Run `npm run check` (and `npm run test:e2e` if you touched capture, background or UI).
- For UI changes, include before/after screenshots in **both** light and dark themes.
- Never add a dependency to `src/core` without discussing it first.
- New permissions in `manifest.json` need a clear justification in the PR description. Staying permission-light is a feature.

## Design

The design system (tokens, logo and the Story/Workbench layouts) is described in [docs/DESIGN.md](docs/DESIGN.md). If your change needs a new colour, add a token for both themes rather than a raw value.

## Code of conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
