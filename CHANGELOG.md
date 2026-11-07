# Changelog

## 0.1.0 — 2026-11-07 (packaging and the producer flow)

### Packaging
- GitHub Actions workflow builds a universal macOS `.dmg` and `.zip` on every push to the working branch
  (pre-release `lab-latest`) and on `v*` tags; tests run first, on Electron's Node.
- Private submodule fetched with `THE_LIBRARY_TOKEN` or, when present, `THE_LIBRARY_DEPLOY_KEY`.
- Unsigned builds get an ad-hoc signature; Developer ID signing and notarisation prepared behind
  `MAC_SIGNING=on`. No dependency on the repository owner's name.
- The app needs no environment variables or commands. `LICENSE` added (proprietary).

### User flow
- New default screens: welcome, choose folders (suggestions, drives, drag-and-drop, Add folder),
  macOS permission note, live scanning (counts and songs as they are recognised), catalog with songs to
  check first, song detail with plain reasons, two-click "This is wrong" marks, "Send results to the team".
- Lab tools (compare with today's importer, scan options, metrics, logs) behind Settings → Show Lab tools.
- Inter vendored (OFL) so the lab matches the app offline.
- Engine: classification during the crawl, live type counts and song names, the app's canonical identity
  per file.

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
