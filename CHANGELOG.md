# Changelog

## 0.1.0-m1 — 2026-11-07

Setup and milestone M1 (crawl, classify, baseline, catalog).

### Setup
- Repository structure from the spec: `packages/import-engine`, `packages/contract`, `apps/lab`,
  `vendor/the-library`, `fixtures/{synthetic,adversarial}`, `labels`, `docs`.
- Main app added as a git submodule at `vendor/the-library`, pinned to `f5af21c7`.
- `CLAUDE.md` with the eight non-negotiables, folder rules and the no-copy-and-edit rule.
- Electron 41.10.7 exactly; Node 24.18.0 (Electron's own); `node:sqlite` confirmed inside Electron.
- `packages/contract` 1.0.0: the brief's rewritten contract as `index.d.ts`, plus runtime constants.
- `docs/SPEC.md`, `docs/INTEGRATION_BRIEF.md`, `docs/CONFLICTS.md`, `docs/DECISIONS.md`, `docs/PATCHES.md`.

### M1
- Synthetic catalog generator (`fixtures/synthetic/generate.js`): gzipped-XML .als files with tempo,
  tracks, sample references and clip ends; a .logicx bundle; small real WAVs; renamed versions; copies
  across folders; stems mixed with bounces; a folder deeper than walkFolder's cap; sparse-file cloud
  placeholder stand-ins; a dotfile and a symlink; ground truth in `<name>.truth.json`.
- File-system guard (`apps/lab/src/fs-guard.js`) installed first in the main process and the scan worker;
  tests for 26 write/rename/delete APIs and a full two-pass scan that must leave the folder unchanged.
- Streaming crawler with no depth limit, reusing walkFolder's per-folder rules; parity test against the
  real `walkFolder`.
- Cloud placeholder detector (blocks + macOS `stat -f %Sf`).
- Incremental SQLite store (device+inode, then path fallback) in the lab data folder.
- Classification through the app's `catchall-classifier.js`; baseline through the app's
  `hybridGroupFiles`, both `preserveSourceIdentity` modes.
- Lab screens 1–3 (choose folders, scan, catalog) with the app's stylesheets, `.std-*` components and
  `#tracksGrid` markup; vendored Tailwind built with the app's own recipe; no network from the window.
- `npm run scan` headless CLI using the same worker, guard and store.
