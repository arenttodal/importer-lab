# Changelog

## 0.2.0-dev.6 — 2026-11-07 (fixes after the first real M2 scan)

Build dev.5 stopped in CI (the workspace still asked for contract 1.1.0); dev.6 is the same code with
that fixed.

Measured on the dev.4 results from a real catalog (replay with folders, dates and sizes; no project
contents), dev.4 engine → dev.6 engine:

| Fix | Before → after |
| --- | --- |
| 1. Numbered files join when one's numbers contain the other's | 1 of the 5 songs the dev.4 numbers rule split rejoins (a project "… 80 Project" and its bounce "… 80 1"); the other 4 differ in number and folder ("1" vs "3") and stay apart |
| 2. No suggestions between different dates of a series, or titles that differ only by number | name-based suggestions 480 on 221 songs → 103 on 78 |
| 3. Sample links need two shared rare samples (each in at most 3 projects), told apart by name and stored size; at most 3 suggestions per song, strongest first | the sample-based part only shows in a real scan (was 1,122 suggestions on 339 songs in total) |
| 4. Time for every step in Metrics and the results file; a quick 64 KB edge check before hashing same-size files in full | timings: new; stored clue results from older builds are read once more (format 2) |
| 5. Display names: the producer's own fullest title with only the noise removed; never shared | 9 shared display names → 0; one-word names 73 → 13 (all real one-word titles) |
| 6. One-shots in a pack-like folder are a sample pack, never a song or an export batch's mix | 6 one-shot groups that were songs ("Claps", "Kick" …) → sample packs; songs 922 → 916 |
| 7. A lone stem joins a song in its folder; otherwise one "Loose stems" review entry | one-stem entries 32 → 0 (2 joined a song, 4 kept their template or pack kind, 26 loose); stem sets 46 → 14 |
| 8. Course prefixes found automatically, confirmed in one click | 0 → 8 found (all 7 of the producer's own list, plus one voice-over prefix); confirming them gives 869 songs and 54 course items |
| 9. "Check 30 songs": a random sample with Right / Wrong / Split / Merge | new; answers are marks flagged `check`, summed up in the results file |

Lab regressions found by that scan and fixed here (not in `docs/FINDINGS.md`, which covers today's
importer only):
- The M2 numbers rule split a project from its bounce when their numbers differed only by a take
  ("80" vs "80 1").
- "Might be the same song as" was noise: 1,122 suggestions on 339 songs, including different dates of a
  series and projects linked by the producer's own reused samples or by same-named recordings.
- Display names came from the comparison identity ("Nov 27", "Glasshouse", "Intro"), and two clients'
  songs could share one name.
- An export batch could pick a one-shot ("Claps") as its mix, making a sample pack into a song.
- Single stems with no song became entries of their own.

Also: contract 1.2.0 (optional `looseStems`, suggestion `weight`), engine 0.2.1-m2, name policy
`lab-names-2`, results file `check` summary and per-step `timings`.

## 0.2.0 — 2026-11-07 (M2: the engine groups songs)

What changed, in plain words:
- Songs are now grouped by the new engine, not today's importer. Mix, master, stage and render words
  ("final", "wip", "pitched", "instr only"…), file formats and audio specs, take and tempo numbers,
  repeated words, category prefixes, contributor names and the "Project PD" backup marker no longer
  split a song: they become version labels you can see in the song.
- Orchestral and trailer stems (whooshes, textures, choirs, string shorts, lows…) and parts exported
  together with a mix attach to their song as a stem set instead of becoming songs.
- "Untitled N" projects, different dated sessions of a series ("Morning 5 - Friday April 21" vs
  "April 28") and different numbered songs in different folders are no longer merged.
- Templates, course material and sample-pack parts are their own kinds, left out of the song count.
- Each song shows how sure the engine is: sure, check, or unclear. Merges based only on the new name
  rules are never automatic; they wait under "Check these first".
- Song detail: versions, stem sets, tempo and length from Ableton projects, and "Might be the same song
  as" for near-identical names (never merged automatically).
- The app reads Ableton projects, Logic package contents, WAV/AIFF lengths, export batches, shared
  samples, save times and identical audio — only for files on the Mac; cloud placeholders are never
  opened.
- Lab tools: today-vs-engine comparison, edits-as-versions switch, course prefixes, a snapshot of songs
  already in the Library, and metrics including marks.
- "Send results to the team" (format 2) adds opaque folder ids, sizes, dates, lengths, version labels
  and stem parts — still no paths and no audio.
- `docs/FINDINGS.md` tracks every finding row with its status and build. Contract 1.1.0.

## 0.1.1 — 2026-11-07 (navigation)

- Back on every step, Home and New scan in the header after the welcome screen.
- File menu: New Scan (⌘N) and Open Previous Results… (⌘O).
- Previous scans on the home screen (date, folders, songs, files) with Open and Delete.
- Scan screen shows the 20 newest songs with "See all".
- Starting a new scan while one runs replaces it cleanly.

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
