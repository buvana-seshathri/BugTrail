# Design

## Brand

- **Mark**: a simple bug with an S-shaped “trail” seam (`assets/brand/mark.svg`, 16 px cut `mark-16.svg`). One colour, no gradients.
- **Brand red**: `#EF4F43` on light, `#FF6B5E` on dark. Used for the mark and the “Trail” half of the wordmark only. It is not used for UI state.
- **Wordmark**: Bricolage Grotesque 700, “Bug” in the text colour, “Trail” in brand red.

## Typography

| Role               | Face                      |
| ------------------ | ------------------------- |
| Headings, wordmark | Bricolage Grotesque 700   |
| Interface          | IBM Plex Sans 400/500/600 |
| URLs, codes, data  | JetBrains Mono 400/600    |

Fonts are bundled (`@fontsource`); the extension makes no network requests for them.

## Colour tokens

All defined in `src/ui/theme.css` for both themes. The theme follows the system unless the user picks one.

| Token          | Light     | Dark      | Use                               |
| -------------- | --------- | --------- | --------------------------------- |
| `--bt-bg`      | `#F5F6F8` | `#0E1116` | Page background                   |
| `--bt-surface` | `#FFFFFF` | `#151A21` | Cards, rows, bars                 |
| `--bt-raised`  | `#EEF0F3` | `#1C222B` | Secondary buttons, hovered rows   |
| `--bt-border`  | `#DADFE6` | `#29313C` | Dividers                          |
| `--bt-fg`      | `#12161C` | `#E6EAF0` | Text                              |
| `--bt-muted`   | `#5A6472` | `#97A1AF` | Secondary text                    |
| `--bt-accent`  | `#0B8577` | `#34C7B5` | Primary actions, selection, links |
| `--bt-err`     | `#C9291E` | `#FF6B5E` | Failures, errors                  |
| `--bt-warn`    | `#9A5B00` | `#F5B544` | Warnings, 4xx                     |
| `--bt-slow`    | `#3557D6` | `#8EA8FF` | Slow requests                     |
| `--bt-ok`      | `#1E7F46` | `#5BD68F` | Success                           |

Each signal colour has a matching `-bg` tint for badges. Signal colours also differ in lightness, so they can be told apart without relying on hue.

## Layouts

- **B — Story timeline** (v0.1): chapters per user action; effects indented under causes; a summary column (sticky on wide screens, on top in the side panel).
- **A — Workbench** (planned): a VS Code-style three-pane layout (filters, ranked list with a timeline strip, detail inspector) for developers.

Screenshots of the implemented UI in both themes are in [`docs/images`](images). Regenerate them with `npm run test:e2e`, which writes to `e2e/artifacts/`.
