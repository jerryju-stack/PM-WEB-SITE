# Project Station UI design system

The product name remains **Project Station**. The knowledge section is **Lesson Learn** (`#articles`).

## Theme and scope

`workspace-ui` on the body provides shared navigation, panels, forms and dialogs. Page classes scope layouts. Define shared colors on `html` and set `data-theme` to the effective `light` or `dark` theme. The browser preference is `system`, `light` or `dark`. It takes effect before first paint, and the shared appearance control applies changes in place.

| Token | Dark | Light | Purpose |
| --- | --- | --- | --- |
| `--ds-bg` | `#141518` | `#F5F6F8` | Page background |
| `--ds-sidebar` | `#18191D` | `#FFFFFF` | Navigation background |
| `--ds-surface` | `#1D1E23` | `#FFFFFF` | Panels, cards, dialogs |
| `--ds-hover` | `#25262C` | `#EEF0F5` | Hover state |
| `--ds-selected` | `#2B2942` | `#EBE6FB` | Selection |
| `--ds-border` | `#303138` | `#DCE0E8` | Component boundaries |
| `--ds-divider` | `#27282E` | `#DCE0E8` | Subtle separators |
| `--ds-text` | `#ECEDEF` | `#191C2B` | Titles and essential content |
| `--ds-secondary` | `#B6B8C2` | `#484A59` | Body content |
| `--ds-muted` | `#9699A6` | `#555C70` | Supporting labels |
| `--ds-accent` | `#8580F5` | `#5743A1` | Links, focus and progress |
| `--ds-primary` | `#6862D9` | `#5743A1` | Primary actions |
| `--ds-success` | `#80C4A2` | `#14796C` | Completion and positive cash flow |

Pair color with text or shape. Use purple for active work, green for completion, neutral for planned work, amber for paused work and red for overdue work and destructive actions. Use `--ds-control-border` for inputs, `--ds-table-head` for table headers, and `--ds-overlay` for modal backdrops.

## Typography and spacing

Use the existing system font stack. Light workspaces use 32/40px page titles and 26/34px on mobile. Finance uses 18/26px section headings, 15/24px body and controls, 14/22px table body and 13/20px supporting labels. Its key figures use 26/34px on desktop and scale down to fit two cards across on mobile. Use tabular numerals and right-align numeric cells. Outside finance, dark workspaces use 24/32px page titles. Project and article titles use 17/26px and Timing task names use 15/24px. Markdown reading paragraphs use 15px with 1.85 line height.

The finance dashboard groups current metrics in one panel with internal dividers. Each metric displays the name, figure, currency and reporting scope in that order. The annual sales table uses two rows per product, one for volume and another for unit price. Keep product names visible while scrolling across years on narrow screens.

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

The same-origin `src/theme-bootstrap.js` loads before the stylesheets in `src/index.html`. The shared appearance control is rendered in the site and Timing headers. The finance sample uses `src/finance.css` and the production finance renderers. The cash-flow canvas observes the effective theme so its colors update while the current view stays mounted. See the [implementation plan](site-theme-rollout-plan.md) for page-by-page rollout.

The APQP preview project is retained with its existing tasks, dependencies and attachment. Preview content is isolated from production data. Deploying source must not replace production databases or upload directories with preview data.

## Finance sample review

The baseline is commit `a1cced2`. Local baseline captures are under `.deploy/site-theme-review/` and use the isolated CASE-001 review dataset. Compare the project finance dashboard and its `/commercial` route with the same version selected at 1440×960 and 390×844. On mobile, the screenshots extend down to the main table to show its layout.

Run `scripts/verify-finance-workbench-browser.mjs` against the isolated review server with `FINANCE_REVIEW_THEME` set to `light` and then `dark`. Each pass checks 26 route and workflow combinations, including mobile widths, the equipment register, display currencies and the cash-only version.

## Light workspaces and Timing

Light login and editor fields use the white surface, the shared input border and a purple focus indicator. Timing date and select controls inherit the effective color scheme from the page. Keep enabled fields white and give read-only controls a pale neutral fill.

Use the same light table header for Timing's task columns and timeline. A pale purple row identifies a summary, and the stronger selection tint identifies the current task. Use purple for scheduled work, green for completed work and red for overdue work. Keep the corresponding task bars, milestone diamonds, dependency arrows and legend visible against the white timeline. Apply light-specific changes only when the root theme is light.
