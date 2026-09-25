# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Éditeur de CV — a single-page web app (French UI) with three tabs. **Bibliothèque** is the content reservoir: every experience, education entry, project, contact, link, skill and interest, with unlimited bullets per block. **Mes CV** is the printable document (whatever CV is currently loaded/displayed — `state`), where each block carries a display limit (`maxVisible`) deciding how many bullets actually print, plus the list of saved named CVs. **Nouveau CV** starts a new CV (from the Bibliothèque, from an existing saved CV, or from the CV currently displayed — see `openCreateChoiceModal`/`buildCvFromLibrary`) and, once created, lets a pasted job posting propose a reordered CV (bullets ranked by relevance) that can be saved as a new named CV. There is only ever one "current" CV (`state`) shared by both tabs — **Nouveau CV** simply hides it behind an empty state (`state.createDraft`, see `showCvInCreateTab`) until the user creates or reveals one; **Mes CV** always shows it. No build step, no npm dependencies. Vanilla JS throughout.

## Commands

There is no package manager, build step, linter, or test suite in this repo.

- **Run with the PDF backend (recommended)**: `node server.js` → open http://localhost:3333. Requires a local Chromium-family browser (Chrome/Edge/Brave/Arc); auto-detected per OS, or override with `CHROME_PATH`. Port defaults to 3333, override with `PORT`.
- **Run with no backend**: open `index.html` directly in a browser (`file://`). Works fully offline; PDF export falls back to the in-browser generator (`pdf.js`) instead of the Chrome-backed one.
- No test command exists — verify changes manually in the browser (see the `run` skill/agent for driving the app).

## Architecture

Five files, no framework, no modules/bundler — `index.html` loads `pdf.js` then `app.js` as plain `<script src>` tags, in that order, which matters:

- **`pdf.js`** loads first and sets shared config onto `window`: `CV_SIDE_BG_DEFAULT`, `CV_FONT_ROLES`, `CV_FONT_BOUNDS`. It's wrapped in an IIFE exposing only `generateCvPdf`, to avoid colliding with `app.js`'s own `renderPro`/`renderDesign`.
- **`app.js`** loads second and reads those `window.CV_*` globals as fallback-safe config. This is the entire app: state, rendering, editing, drag & drop, job-offer analysis, and PDF-trigger wiring. It's organized in commented sections (search for `/* ====` blocks): state/versions/templates/drag&drop → CV rendering → editing (inputs, buttons, modals) → named versions → job-offer analysis (keyword scoring) → toolbar/PDF wiring.
  Rendering and editing are **scope-parameterized**: `installEditing(rootEl, scope)` and the shared block renderers serve both the CV (`scope.isCv === true`) and the Bibliothèque from one implementation. CV-only concerns — proposal order, diff/match badges, `maxVisible`, photo, `profile` — sit behind `scope.isCv`. Add a feature to one editor and decide deliberately whether the other gets it.
- **`server.js`** is a dependency-free Node HTTP server with three jobs: (1) statically serve the app, (2) `POST /pdf` — take the rendered CV's HTML, compose it with `styles.css`/`fonts.css`, and print it via headless Chrome (`--print-to-pdf`) so the PDF matches the on-screen render pixel-for-pixel, (3) `POST /fetch-job` — fetch a job posting URL server-side (the browser can't, due to CORS), with SSRF guards (rejects private/link-local IPs, follows redirects manually and re-validates each hop).
- **`pdf.js`**'s `generateCvPdf` is the no-backend PDF fallback: it writes a vector PDF by hand (embedded Open Sans TrueType instances 400/600/700 as base64 in `pdf.js`, real hmtx advance widths, manual PDF byte assembly) — no library. Its layout mirrors the CSS box model (margins collapse, .exp padding, break-inside/orphans, per-template density in `DENSITY`), so it matches the Chrome PDF to ~1 pt; remaining limits: no kerning, non-Latin glyphs fall back to a base letter or `?`. When changing spacing in `styles.css`, update `DENSITY`/`pdf.js` too. The WOFF2 in `fonts.css` can't be reused at runtime, so the font data is duplicated there; regeneration recipe is in the `pdf.js` comment.
- **`fonts.css`** embeds Open Sans as a data-URI `@font-face` so rendering (screen, print, both PDF paths) is identical everywhere, offline, no CDN.
- **`styles.css`** carries both screen and `@media print` rules, including the diff badges shown only on hover in the "Nouveau CV" tab (never printed/exported).

### Key invariants worth knowing before editing

- The currently displayed CV is never mutated by the job-analysis flow itself. A "proposal" (`state.proposal`) is a display-only surcharge layered on top of it: a bullet reorder (`orders`) plus, per block, Bibliothèque bullets suggested at the end of the list (`added`, scored the same way as the reorder). Saving it (`saveProposalVersion`) creates a new named CV **and loads it** as the displayed CV (like « Charger », including the unsaved-changes confirm, which ignores `jobText`), because « Télécharger PDF » exports whatever is displayed. The proposal covers experiences, education **and** projects.
- **Nouveau CV**'s empty state: `state.createDraft` (persisted) gates whether the CV sheet or the empty state shows in that tab (`showCvInCreateTab()` = `createDraft || !!proposal`, so an old save carrying a `proposal` still shows the CV). Any flow that replaces or reveals the displayed CV from that tab (create-from-library/version/current, AI fill, JSON import) sets it; `replaceDisplayedCv()` centralizes the "unsaved changes?" confirm shared with « Charger ». Creating from the Bibliothèque (`buildCvFromLibrary`) reuses each library block's `id` as the new CV block's id (so `matchLibraryOwner` finds it by id later) and tags every imported bullet with `libraryOrigin`, exactly like a materialized suggestion — so a subsequent « Analyser l'offre » never re-suggests what was just imported; `maxVisible` per block is inherited from the matching block in the previously displayed CV, else `null`.
- The Bibliothèque (`state.library`) and the CV are **independent stores**. `normalizeState` seeds the library from the CV once, keyed on the *presence* of the `library` key (not its validity) so a momentarily malformed state never re-seeds over the user's work. Manual edits in either direction never affect the other, and JSON export/import on each store stays separate — but clicking **« Analyser l'offre »** opens a one-way, opt-in bridge: each CV block is matched to its Bibliothèque equivalent (`matchLibraryOwner`) and its top-scoring unused bullets are suggested. A suggestion stays display-only (`state.proposal.added`, rendered only in "Nouveau CV") until the user actually edits or drags it — that single interaction materializes it into a real, permanent `owner.bullets` entry tagged with `libraryOrigin` (see `materializePendingBullet`); merely analyzing, or ignoring the proposal, never touches the base CV.
- `maxVisible` is display-only: bullets past the cut stay in the data. Screen, print and both PDF paths must show the same thing — the cut is applied in `visibleBullets()`, in `@media print`, and in the `generateCvPdf` call site, which must stay in sync.
- Editing affordances are absolutely positioned overlays that are `display:none` at rest and never take flow space, so the sheet on screen is pixel-identical to the PDF. They fade with `transition: display … allow-discrete`, which means `getComputedStyle().display` lags — wait for `getAnimations().length === 0` before asserting on print visibility.
- The "Design" template's sheet is pinned to exactly 297mm (not "at least") — overflow is truncated with a visible on-screen notice rather than silently spilling to a second page. The "Pro" template can span multiple pages.
- Data persists in `localStorage`, scoped per-origin — switching between `file://` and `http://localhost:3333` requires JSON export/import to carry data across.
- Any change to font-size roles, side-bar color defaults, or A4 page metrics touches three places that must stay in sync: `app.js` (screen rendering), `pdf.js` (fallback PDF), and `server.js`'s Chrome-print path (which reuses `styles.css`/`fonts.css` directly, so it stays in sync automatically).
- Section titles ("Expériences professionnelles", "Formation", …) are editable and stored per-CV in `sectionTitles`, normalized key-by-key (`normalizeSectionTitles`) so a save from before this field existed just falls back to the defaults. CV-only, like `maxVisible` — the Bibliothèque never reads or writes it. Touches `app.js` (`sectionTitle()`), `pdf.js` (`secTitle()`), and the explicit field lists in `snapshotCV()`/`applyCV()` (named versions), which must stay in sync.
- Drag & drop has two granularities sharing the same `installEditing` handlers: bullets (`.drag-handle` inside `li.bullet`, reorders `owner.bullets`) and whole blocks — experience/education/project (`.block-drag-handle` inside `.exp-head`, reorders `state.experiences`/`.education`/`.projects`). They're kept apart via separate drag-state variables (`dragEl` vs `dragBlockEl`); touch both carefully if you change this code.

## Backlog / workflow

This project's task backlog lives in Notion (not in this repo), driven via the `ntn` CLI. See project memory for the workflow (branch-per-story, one PR per user story, one commit per sub-task).

## Dev workflow

- Commit after each change validated by a test; push, PR and merge only when asked.
- The user's app runs on port 3333 (`node server.js`). Agents test on the dedicated `cv-editor-3411` server (`.claude/launch.json`, port 3411) and never stop the user's own server.
- When a change is a new/changed feature the user should try themselves, leave that test server running after verifying it (don't stop it) and give them the URL — don't make them ask for it.
- The Chrome extension (`extension/`) is loaded unpacked from the main repo checkout, not from a worktree. After changing `extension/`, remind the user to click ↻ in `chrome://extensions`.
