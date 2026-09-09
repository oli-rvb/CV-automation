# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Éditeur de CV — a single-page web app (French UI) that lets someone edit a base CV, paste a job posting, and get a reordered proposal (bullets ranked by relevance to the posting) that can be saved as a new named CV without ever touching the base CV. No build step, no npm dependencies. Vanilla JS throughout.

## Commands

There is no package manager, build step, linter, or test suite in this repo.

- **Run with the PDF backend (recommended)**: `node server.js` → open http://localhost:3333. Requires a local Chromium-family browser (Chrome/Edge/Brave/Arc); auto-detected per OS, or override with `CHROME_PATH`. Port defaults to 3333, override with `PORT`.
- **Run with no backend**: open `index.html` directly in a browser (`file://`). Works fully offline; PDF export falls back to the in-browser generator (`pdf.js`) instead of the Chrome-backed one.
- No test command exists — verify changes manually in the browser (see the `run` skill/agent for driving the app).

## Architecture

Five files, no framework, no modules/bundler — `index.html` loads `pdf.js` then `app.js` as plain `<script src>` tags, in that order, which matters:

- **`pdf.js`** loads first and sets shared config onto `window`: `CV_SIDE_BG_DEFAULT`, `CV_FONT_ROLES`, `CV_FONT_BOUNDS`. It's wrapped in an IIFE exposing only `generateCvPdf`, to avoid colliding with `app.js`'s own `renderPro`/`renderDesign`.
- **`app.js`** loads second and reads those `window.CV_*` globals as fallback-safe config. This is the entire app: state, rendering, editing, drag & drop, job-offer analysis, and PDF-trigger wiring. It's organized in commented sections (search for `/* ====` blocks): state/versions/templates/drag&drop → CV rendering → editing (inputs, buttons, modals) → named versions → job-offer analysis (keyword scoring) → toolbar/PDF wiring.
- **`server.js`** is a dependency-free Node HTTP server with three jobs: (1) statically serve the app, (2) `POST /pdf` — take the rendered CV's HTML, compose it with `styles.css`/`fonts.css`, and print it via headless Chrome (`--print-to-pdf`) so the PDF matches the on-screen render pixel-for-pixel, (3) `POST /fetch-job` — fetch a job posting URL server-side (the browser can't, due to CORS), with SSRF guards (rejects private/link-local IPs, follows redirects manually and re-validates each hop).
- **`pdf.js`**'s `generateCvPdf` is the no-backend PDF fallback: it writes a vector PDF by hand (Helvetica metrics, WinAnsi encoding, manual PDF byte assembly) — no library. Line-wrapping can differ slightly from the screen since font metrics aren't identical to the backend (Chrome-rendered) path.
- **`fonts.css`** embeds Open Sans as a data-URI `@font-face` so rendering (screen, print, both PDF paths) is identical everywhere, offline, no CDN.
- **`styles.css`** carries both screen and `@media print` rules, including the diff badges shown only on hover in the "Nouveau CV" tab (never printed/exported).

### Key invariants worth knowing before editing

- The base CV (`CV de base`) is never mutated by the job-analysis flow. A "proposal" is a display-only bullet reorder layered on top; saving it creates a new named CV.
- The "Design" template's sheet is pinned to exactly 297mm (not "at least") — overflow is truncated with a visible on-screen notice rather than silently spilling to a second page. The "Pro" template can span multiple pages.
- Data persists in `localStorage`, scoped per-origin — switching between `file://` and `http://localhost:3333` requires JSON export/import to carry data across.
- Any change to font-size roles, side-bar color defaults, or A4 page metrics touches three places that must stay in sync: `app.js` (screen rendering), `pdf.js` (fallback PDF), and `server.js`'s Chrome-print path (which reuses `styles.css`/`fonts.css` directly, so it stays in sync automatically).

## Backlog / workflow

This project's task backlog lives in Notion (not in this repo), driven via the `ntn` CLI. See project memory for the workflow (branch-per-story, one PR per user story, one commit per sub-task).
