# Changelog

## 0.4.0-dev.10 — 2026-11-08 (two fixes from the 22:44 check)

Replay of the producer's results files, 0.4.0-m4 → 0.4.1-m4 (names policy `lab-names-5`). The list of
changed groups with real names is in the git-ignored `private/` folder.

| | 2025 catalog | 2024 catalog |
| --- | --- | --- |
| Songs | 553 → 549 | 845 → 844 |
| Groups changed | 7 → 3 | 2 → 1 |
| Songs the producer marked right | none changed | none marked in this file |
| Answer key | 11 of 12 (unchanged: the twelfth passes through the producer's merge rule) | 3 of 3 |

- A closing segment that starts with a category phrase of two or more words, spaced or as one word
  ("- Musicbed Idea 1.1", "- Music Bed 2 Copy", "- Sound Design 2"), describes the file; it is not title.
  One-word categories at the end ("- Jam", "- Sample") stay title. A song in three entries is one.
- When cleaning a name would leave nothing ("Beat Idea - Revisit May 9 WIP 2"), the date stays the title,
  so the takes of one dated revisit are one song; a name beside the date ("… Sample V1") is still another
  song, and another day another song.

## 0.4.0 — 2026-11-08 (M4: the AI pass)

- **AI on unclear songs only**, off by default (Lab → Scan options). Sent per song: an opaque id, file
  names, types, extensions, sizes, dates, lengths, folder depth, the names of files beside it, the
  engine's clue texts and up to 8 candidate songs (by clue, rare shared word or folder). Never a path,
  audio or account data; every string has path separators and double quotes removed. A test fails if a
  path separator, a part of an absolute path or a long blob reaches the request.
- **Batches** stay under 100,000 tokens (30,000 targeted); songs that are candidates of each other
  (shared samples, timing, same words) stay in one batch.
- **Models from settings**: Claude Haiku 5.5 first; Claude Sonnet 5.5 re-answers a batch when Haiku is
  unsure on more than 25% of it. Official Anthropic SDK (`@anthropic-ai/sdk` 1.6.0), structured output.
- **Cost meter and hard cap**: every call is priced from the usage the service reports; a call that could
  pass the cap (worst case: every output token) is not made. The scan screen shows the cost so far;
  Metrics, Logs and the results file record every call (model, tokens, cost, time). No key in any of them.
- **Cached answers** per song in the data folder: scanning again costs nothing.
- **The gate**: "same song" merges only when it passes the merge rule (equal identity); otherwise it is the
  song's first suggestion, marked "AI suggestion" for review. An AI answer never makes a song sure.
- **Key**: `ANTHROPIC_API_KEY` in an untracked `.env` (development), or **Add key…** in the app (encrypted by
  the macOS keychain in the data folder). Never inside the app.
- Estimated on the producer's 2025 catalog (1,271 files, replay): 25 unclear songs, one batch, about
  $0.004 with Haiku (at most $0.007; $0.13 if every batch went to Sonnet).
- **Check songs…**: a short (10), standard (20) or deep (50) check, same weighting.
- **Your corrections** (Lab → Rules): every mark that changes the result, from every catalog, with Undo.

Contract 1.4.0 (optional `ai.largeModel`), engine 0.4.0-m4. Grouping without AI is unchanged.

## 0.3.0 — 2026-11-08 (M3: rules, marking, metrics, adversarial tests)

Measured by replaying the producer's two results files (2024 and 2025 catalogs) with folders, dates and
sizes, dev.7 engine → this build. Group-by-group lists with real names are in the git-ignored `private/`
folder.

| | 2025 catalog (1,291 files) | 2024 catalog (1,803 files) |
| --- | --- | --- |
| Today's importer | 592 songs | 1,068 songs |
| Engine dev.7 → 0.3.0 | 662 → 553 songs | 856 → 845 songs |
| Songs the producer marked right | 37; 33 unchanged, 4 gained files (nothing removed) | 27; 25 unchanged, 2 gained version files |
| The producer's answer key | 9 of 10 (the tenth passes once the producer's merge mark is a rule) | 3 of 3 |
| Stress set (1,000 songs) | 997, no automatic merge of different songs | |

Fixes from the producer's 46 checked songs (2025 catalog):
- A long shared prefix with "Stems" or a version number ("Kelp Banger 3.4.1 Shorter Stems -") is a stem
  export, not a client: 60 stems that were each a "song" are one song's stems again. A leading "STEM -"
  marks a stem. Stems of an export are never pack one-shots.
- A name after a date wins over the date (the producer's decision): the same name worked on over several
  days is one song; a date alone ("Friday April 21"), a session word ("- Live") or a note after the date
  still keeps songs apart. A date typo ("January 123") is still a date. A dated session joins a band's
  or client's song of the same name only as a suggestion.
- Version tails: "… 1 Reversed Riff Enhanced" after "…", "… SAMPLE 1" after "…" join as versions
  ("check", never "sure"); a tail that names another day does not.
- "<name> mix" teaches a collaborator ("(Theo Mix V4)").
- Numbered samples ("… - 1", "… - 4") in a folder of samples join its pack; prefixes in one folder that
  start with the same word are one pack.

M3:
- **Teach the importer**: up to 8 questions after a scan ("What is Quill? A band · A series · Course ·
  Sample pack · A collaborator · Just a word"), with the engine's guess preselected. Answers are rules
  applied first on the next scan; they replace the course-prefix prompt. Lab → Rules lists and forgets
  them.
- **Marks become rules** (on by default): Right and merge keep files together, split falls back to the
  app's exact names, "in the wrong song" takes the file out, the new Rename mark renames. Marks now carry
  file names; older marks are resolved from the scan they were made on.
- **Compare** labels "Moved files" next to Merged, Split from and Renamed. **Metrics** adds the check
  results per engine version and how today's importer did on the songs checked.
- **The main app's six import test files** run unchanged from the pinned submodule in `npm test` (36
  tests), plus the AMG-FN-001 negatives as engine tests (`npm run test:adversarial`).
- **Reading time**: per-reader timings (Ableton, Logic, project folders, audio headers) in Metrics and
  the results file. The 46 s first scan was reading 314 Ableton sets (about 0.15 s each: unzip,
  decode, search); hashing took 0.6 s. Reading four sets at once was slower, so reading stays
  one at a time; stored results make repeat scans fast.

Contract 1.3.0 (optional `userRules`), engine 0.3.0-m3, name policy `lab-names-4`.

## 0.2.0-dev.7 — 2026-11-08 (stems, packs and the weighted check)

Measured on the dev.6 results from a real catalog (replay with folders, dates and sizes; course
prefixes confirmed), dev.6 engine → dev.7 engine. The group-by-group list with real names is kept in
the git-ignored `private/` folder.

| Fix | Before → after |
| --- | --- |
| 1. Stems and versions join their song | a remade song shown as 10 entries (today's importer: 9) → 1 song with versions and stems; stem sets 14 → 7 (7 attach by title or date, 2 go to review, 5 have no song) |
| 2. One pack, one entry | sample-pack entries 22 → 9; a one-shot pack 8 → 1 with its contents; three multi-folder packs 3 → 1 each; a folder of drum one-shots counted as 5 songs → 1 pack; 5 neighbours of packs go to review; a jam named "… Patches" is a song |
| 3. Part words make a stem only when the rest of the song exists | loose stems 26 → 0: 1 joins its jam, 2 form one recording's stem set, 1 joins its pack, 22 are ideas of their own |
| 4. Course material keeps its kind | a course demo that pulled an 18-file song into a course-named group: song (18) + course item (1, in review, suggested against the song) |
| 5. Takes and plurals | 4 groups join as versions (one "Ideas"/"Idea" pair, three take pairs); a take join across folders is "check", never "sure" |
| 6. Weighted check | sessions of 50: 40% to check, 20% unclear, 25% sure with several files, 15% sure single-file; closest entries with "Same song"; Metrics shows the exact 95% lower bound (27 of 27 → at least 89%); target 100 marks |
| 7. Scan from scratch | Lab option and `--from-scratch`; fresh-scan timings come from the producer's next scan |

Songs 869 → 856. Of the 27 songs the producer marked right in dev.6, 25 are unchanged and 2 gained
version files with nothing removed. The three cases the producer confirmed (private answer key) pass.

Lab regressions found while building this and fixed before release:
- Takes 1–30 joining across folders merged "Sky Night 1" with "Sky Night 21" on the stress set as
  "sure"; now only single-digit takes join across folders, and never as "sure".
- "Combined" as a stage word turned "… - Combined Patterns - …" into a version label; it now only
  comes off the end of a title.
- The sibling-stem rule turned "… - MASTER" mixes into stems; a last part made only of stage words is
  the mix.
- The live song list ran the full grouping on every preview (3.8 s on 10,000 files); it now groups
  names only (1.7 s).

Also: name policy `lab-names-3`; word-by-word misspellings suggested across prefixes (never joined);
display names drop a contributor named inside a version ("… Theo Adds").

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
