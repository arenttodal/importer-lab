# Importer Lab

A separate, **read-only** Electron app that runs the next-generation import engine on real drives and
shows the result as songs, next to today's importer, using The Library's own import code and look.
Spec: `docs/SPEC.md`. Facts about the main app: `docs/INTEGRATION_BRIEF.md`. Rules for agents: `CLAUDE.md`.

Status: **M1** — crawl, classify, today's importer as the baseline, screens 1–3. Clues, scoring and
bands arrive in M2; compare, marking and metrics in M3; the AI pass in M4.

## Requirements

- macOS, git, and npm (any recent Node; the lab itself runs on Electron 41.10.7's own Node 24.18.0).
- Read access to `rosscrispin/the-library` on GitHub (the submodule).

## Run on a Mac

```bash
git clone https://github.com/arenttodal/importer-lab.git
cd importer-lab
git checkout claude/dazzling-sagan-44w0ed
git submodule update --init
npm install
npm run electron:versions   # expect electron 41.10.7, node 24.18.0, "node:sqlite ok"
npm test
npm run lab
```

In the window: **Add folders…**, pick a folder or drive, **Scan**, then **View catalog**.
To preselect folders: `IMPORTER_LAB_ROOTS="$HOME/Music:/Volumes/Archive" npm run lab`.

Headless, same worker and guard: `npm run scan -- "$HOME/Music" --groups`.

macOS asks for permission the first time the lab reads Desktop, Documents, Downloads or an external
drive; it appears as **Electron** in System Settings → Privacy & Security → Files and Folders (or Full
Disk Access). The lab only reads.

## What it writes

Only its data folder: `~/Library/Application Support/Importer Lab/lab-data/` (override with
`IMPORTER_LAB_DATA`). The headless `npm run scan` uses `./lab-data/` (git-ignored). Every other write,
rename or delete is blocked by the file-system guard and fails loudly.

## Commands

| Command | What it does |
| --- | --- |
| `npm run lab` | Start the lab |
| `npm test` | All tests, on Electron's own Node |
| `npm run scan -- <folder>... [--groups] [--skip-placeholders]` | Headless scan |
| `npm run fixtures` | Write the synthetic catalog to `fixtures/synthetic/out/` (git-ignored) |
| `npm run typecheck` | Check the contract types |
| `npm run vendor:tailwind` | Rebuild the offline Tailwind copy (after moving the submodule pin) |
| `npm run electron:versions` | Print Electron/Node/Chromium/SQLite versions and check node:sqlite |

## Layout

```
packages/contract/       contract 1.0.0 (types + runtime constants)
packages/import-engine/  the engine: crawler, placeholder detector, adapters around the app's modules
apps/lab/                Electron shell: guard, SQLite store, scan worker, screens
vendor/the-library/      main app, git submodule pinned to f5af21c7 — never edited
fixtures/synthetic/      catalog generator (output is never committed)
fixtures/adversarial/    cases from the main repo's import tests (M3)
labels/                  marks per real catalog (M3)
docs/                    spec, brief, conflicts, decisions, patches
```
