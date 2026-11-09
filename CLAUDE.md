# Importer Lab — rules for coding agents

Read `docs/SPEC.md` (rules) and `docs/INTEGRATION_BRIEF.md` (facts about the main app) before changing code.
Where they disagree the brief wins on facts and the spec wins on rules; open conflicts are in `docs/CONFLICTS.md`.

## The eight non-negotiables

A change to any of these needs agreement from Ross, Josh and Arn.

1. **Read-only.** The lab opens user files only for reading. It writes only inside its own data folder. A file-system guard enforces this, and a test fails if any write, rename or delete reaches a scanned folder.
2. **Same import code.** Today's classification, name cleaning, grouping, duplicate hashing and stem rules come from the main app's own modules, pinned to a known commit. Never copied and edited. If a module needs a change, the lab proposes a patch to the main repo.
3. **Same look.** Screens use the app's CSS variables, stylesheets, components and patterns (the producer-dashboard-design skill in `vendor/the-library/.claude/skills/` is the authority). No new colors, fonts or button sizes.
4. **Same environment.** Same Electron and Node versions as the main app, so file-system behaviour, cloud placeholders and macOS permissions match.
5. **Today's result is always shown.** Every scan also runs today's importer on the same files, so every number is a comparison.
6. **Precision before coverage.** A wrong merge is worse than a missed one. Nothing merges automatically unless it passes the agreed merge rule.
7. **Privacy.** Only names, dates, sizes, lengths and extracted clues may go to AI. No audio, no file paths, no account data.
8. **AI with a budget.** AI runs only on unclear leftovers, with a cost meter and a hard cap per run. Everything works with AI switched off.

## Never copy-and-edit a main-app file

Never copy a file from `vendor/the-library` and edit it. Wrap it in an adapter instead (`packages/import-engine/src/adapters/`).
If an adapter cannot reach what it needs (for example an unexported function), write the patch proposal in `docs/PATCHES.md` and record the stop-gap in `docs/DECISIONS.md`.

## Folder rules

| Folder | Rule |
| --- | --- |
| `packages/import-engine/` | The engine. No UI, no database, no Electron imports, no network (until M4's AI pass). Main-app modules are loaded only through `src/adapters/`. |
| `packages/contract/` | Contract types, semver. Currently 1.6.0. Any breaking change bumps the major version and needs Ross's sign-off. |
| `apps/lab/` | The Electron shell: screens, file-system guard, local SQLite store, worker thread. Absolute paths never leave the main process or the worker; the renderer gets `sourceRelativePath` only. |
| `vendor/the-library/` | Git submodule, pinned. **Never edit files inside it.** Moving the pin is a deliberate commit that records the reason in `docs/DECISIONS.md`. |
| `fixtures/synthetic/` | The generator only. Generated catalogs are written to temp folders or `fixtures/synthetic/out/` (git-ignored). |
| `fixtures/adversarial/` | Cases copied from the main repo's import tests (M3). |
| `labels/` | Marks per real catalog: names, ids and marks only. Never file contents or absolute paths. |
| `docs/` | `SPEC.md`, `INTEGRATION_BRIEF.md`, `CONFLICTS.md`, `DECISIONS.md`, `PATCHES.md`, `FINDINGS.md` (update a row's status and build when a fix lands). |
| `.github/`, `build/`, `scripts/ci/` | macOS build and release. Never name the repository owner (the repo moves between accounts). |

## Working rules

- Tests first for every clue reader and for the scoring.
- Plain, readable code; no clever abstractions.
- Update `CHANGELOG.md` and `docs/DECISIONS.md` with every milestone.
- Never commit real catalog data, keys (`.env` is git-ignored) or file contents.
- Copyright Producer Dashboard Corp. All rights reserved. Proprietary and confidential (`LICENSE`).
- Run `npm test` before committing. Tests run on Electron's own Node (24.18.0), the same runtime the lab ships.
- Build in milestones (M1–M4). After each: run the tests, run on the synthetic fixtures, show the result, stop for review.
