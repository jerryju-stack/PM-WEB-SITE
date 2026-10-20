# Project Station UI design system

The product name remains **Project Station**. The knowledge section is **Lesson Learn** (`#articles`).

## Theme and scope

`workspace-ui` on the body provides shared tokens, navigation, panels, forms and dialogs across every route. Page classes (`project-workspace`, `lesson-workspace`, `timing-workspace`) scope page-specific layouts. Reuse tokens rather than introducing independent page palettes.

| Token | Value | Purpose |
| --- | --- | --- |
| `--ds-bg` | `#141518` | Page background |
| `--ds-sidebar` | `#18191D` | Navigation background |
| `--ds-surface` | `#1D1E23` | Panels, cards, dialogs |
| `--ds-hover` | `#25262C` | Hover state |
| `--ds-selected` | `#2B2942` | Selection |
| `--ds-border` | `#303138` | Component boundaries |
| `--ds-divider` | `#27282E` | Subtle separators |
| `--ds-text` | `#ECEDEF` | Titles and essential content |
| `--ds-secondary` | `#B6B8C2` | Body content and metadata |
| `--ds-muted` | `#9699A6` | Supporting labels |
| `--ds-accent` | `#8580F5` | Links, focus and progress |
| `--ds-primary` | `#6862D9` | Primary actions |
| `--ds-success` | `#80C4A2` | Completion |

Status colors supplement text: purple for active work, green for completion, neutral for planned work, amber for paused work, red (`#EB929C`) for overdue work and destructive actions.

## Typography and spacing

Use the existing system font stack; no external font dependency. Page titles: 24/32px, section titles: 18/26px, project and article titles: 17/26px, task names: 15/24px, body/controls: 14px, dates and metadata: 13px. Markdown reading paragraphs: 15px with 1.85 line height. Use tabular numerals for aligned metrics and dates. Essential content must not use 9–11px text.

Spacing scale: 4, 8, 12, 16, 24, 32px. Default card radius: 8px; controls: 6px; dialogs: 12px. Controls are typically 36–40px high. Cards use borders instead of strong shadows; drawers and dialogs use restrained black shadows.

Statistics pair labels and values and do not pad counts with zeroes. Large numerals must not outweigh their meaning.

## Layout and interaction

- Shared sidebar: 232px; intermediate width: 208px. Header: 56px.
- Content uses a bounded readable width; Timing uses the available width.
- Project cards reduce from three columns to two, then one as space decreases.
- Admin settings stack below 1100px. Mobile navigation keeps the management entry available.
- Tables retain horizontal scrolling instead of shrinking text to fit every column.
- Timing table and timeline rows **must remain 44px high**, with matching 54px headers. The existing dependency geometry uses these dimensions.
- Task drawer: 520px on desktop, full width on mobile; content scrolls while its header and save footer remain visible.
- Preserve hover, active, selected, keyboard focus, disabled, read-only, saving, error and empty states. Visible focus uses the accent color. Respect reduced-motion preferences.
- Markdown imports, previews and reading dialogs reuse the same component styles wherever they are opened.

## Implementation boundary

Styling and presentation changes live in `src/styles.css`, `src/timing.css`, `src/app.ts`, `src/timing.ts` and the HTML theme-color declaration. API contracts, database schema, authentication, permissions and scheduling rules remain unchanged. No UI framework or new dependency is required.

The APQP preview project is retained with its existing tasks, dependencies and attachment. Preview content is isolated from production data. Deploying source must not replace production databases or upload directories with preview data.
