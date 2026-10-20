# UI upgrade validation — 2026-10-21

## Result

All existing interfaces use the shared dark design system: project overview, Timing, task details and attachments, Lesson Learn, management, About PM, team, login and project/article editors. Product name: **Project Station**. Knowledge section name: **Lesson Learn**.

The changes remain local. No production deployment or production-data replacement was performed.

## Automated checks

- TypeScript: `tsc --noEmit` passed.
- Existing Node test suite: 5 passed, 0 failed. Coverage includes scheduling, dependencies, migration, transaction rollback, roles, attachments, conflicts, authentication and persistence.
- `git diff --check` passed.
- No backend/API, database schema, authentication or scheduling implementation changes; no new dependencies.

## Browser verification

| Area | Verification |
| --- | --- |
| All five hash-routed workspaces | Desktop and 390px mobile: shared dark background; 24px page titles; no document horizontal overflow |
| Management | Content actions visible; dark settings/member forms; unchanged settings submission succeeds; mobile management entry remains accessible |
| About PM and team | Shared navigation, dark panels, consistent spacing and readable text; mobile panels stack |
| Login | Guest management page; wrong-password message; successful login with the existing isolated-preview credentials |
| Project editor | Existing editor opens; required fields still block empty submission; dark input and focus states |
| Lesson Learn | Creation, editing, Markdown preview, reading and download verified during its phase; downloaded Markdown checked; mobile reading dialog has no horizontal overflow |
| Timing | Final desktop/mobile rows remain 44px; both headers remain 54px; task font remains 15px; all 19 APQP rows remain present |
| Task details | Final mobile drawer spans 390px without inner horizontal overflow; footer remains visible; create/update persistence verified during its phase in a separate preview project |
| Browser console | No captured error-level messages in the final preview |

Earlier phase checks also verified search/filtering, day/week/month views, expand/collapse, inline persistence, moving/resizing task bars, synchronized vertical scrolling and pinned task columns. Permission checks are covered by the existing test suite; the final manual login checks cover administrator and guest states.

## APQP preservation

Compared the live isolated APQP project with the pre-phase-3 snapshot: project data, revision, all 19 task rows, dependency rows and the single attachment metadata remain identical. The attachment file bytes also match the backup. The database snapshot and upload copies remain under ignored `data/preserved-apqp-phase3-*`; no credentials or database files were added to source control.

## Review artifacts

Screenshots are saved in the task artifact directory:

`C:/Users/curie/.codex/visualizations/2026/10/20/01a159d4-b0f1-7970-9483-3645c65fe656/`

- `final-projects-desktop.png`, `final-projects-mobile.png`
- `final-articles-desktop.png`, `final-articles-mobile.png`
- `final-about-desktop.png`, `final-about-mobile.png`
- `final-team-desktop.png`, `final-team-mobile.png`
- `final-admin-desktop.png`, `final-admin-overview.png`, `final-admin-mobile.png`
- `final-admin-guest.png`, `final-login.png`, `final-project-editor.png`
- `final-timing-desktop.png`, `final-timing-mobile.png`, `final-drawer-mobile.png`

Preview uses isolated demonstration content. Live application entry: `http://127.0.0.1:3011/`.
