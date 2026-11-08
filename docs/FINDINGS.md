# Findings log

Mirrors the team's "Importer v2 Findings Log": every place today's importer fails, with evidence, so the
case for Importer v2 rests on measured results. Same numbers and columns as that log, plus the build
that changed the status.

- **Evidence here is anonymised**: same patterns, invented names (`fixtures/cases/findings-cases.json`).
  Real names from a producer's catalog stay in the team's log and in the git-ignored `private/` folder.
- **Status values:** Open · Fixed in lab · Verified on real catalog · Patch proposed to app · Decision needed.
  "Verified on real catalog" is set only after a producer confirms it on their own Mac with the build named.
- **Before → after** counts songs for the anonymised case: today's grouping (the app's code at `f5af21c7`)
  → the lab engine. `npm test` runs every case on every build (`findings-cases.test.js`), and
  `node scripts/findings-report.js` prints the table.
- **Adding a finding:** next number, the source (a test, or whose catalog and the date), the exact names as
  evidence (anonymised here), Status Open. When a fix lands, update Status and Build.

## Headline

| Measure | Today's importer | Importer v2 (lab, 0.2.0-dev.6) |
| --- | --- | --- |
| One producer's catalog, scanned on their Mac, 8 Nov 2026 (1,803 files, 1,785 grouped, 1,270 in the cloud) | 1,068 songs | 868 songs: 772 sure, 81 to check, 15 unclear |
| Not counted as songs (course prefixes found by the lab and confirmed) | — | 54 course items, 23 sample packs, 22 templates, 14 stem sets, 26 loose stems in one review entry |
| Scan time, same catalog | 1.0 s (first run, 0.1.0-dev.2) | 1.4 s on a repeat scan with stored results (0 files opened; today's importer itself 0.17 s of it, both modes) |
| Random check of 30 songs by the producer | — | 27 answered, 27 right (3 skipped); 12 of the 27 hold more than one file, 4 were in "Check these first". With 0 wrong in 27 the error rate is below about 11% (95%, rule of three); a larger sample is needed for the 99.5% target |
| Synthetic stress set (1,000 songs, 10,000 files, 1,000 folders) | 980 songs, 24 of them merging different songs | 997 songs; no automatic merge of different songs |
| False merges of different songs | rows 1, 26, 27 | 0 found: none automatic on the anonymised cases and the stress set, none marked on the real catalog |

## The log

| # | Source | What fails | Evidence (anonymised) | Cause in today's importer | Impact for producers | Fix in the lab | Before → after | Status | Build |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Code audit, measured | **False merge:** every "Untitled N" project becomes one song | `Untitled 14.als` + `Untitled 37.als`; `New Project 2/5.als` | Canonical identity strips the number; no generic-title check in import | Unrelated ideas merged | Generic titles keep their number and only group within one folder, never as sure | 2 → 4 (correct) | Fixed in lab | 0.2.0-dev.4 |
| 2 | Code audit, measured | **False split:** a final mix becomes its own song | `MG X JC - SKY FINAL.wav` apart from `SKY.wav`, `SKY v2.wav`, `SKY V2.als` | "Final" not removed by canonical identity | Finished version sits apart from its project | Stage words set aside under the versioned name policy (`lab-names-2`); collaboration prefix read as a namespace | 2 → 1 | Fixed in lab | 0.2.0-dev.4 |
| 3 | Code audit, measured | Stems separated from their bounce | `Beat Idea - Aug Song.wav` + `… Drums.wav`, `… Bass.wav` | Prefix removed for bounces, kept for stems | Stems missing when a client asks | One naming policy for every file type; stems attach by title | 1 → 1 (today's split does not reproduce on names alone; engine keeps one song) | Fixed in lab | 0.2.0-dev.4 |
| 4 | Code audit, measured | Two name cleaners disagree | 12 of 32 test names cleaned differently | `normalizeFilename()` and `canonicalSongIdentity()` remove different words | Results depend on the import path | The lab uses one policy; reconciliation belongs in the app (`docs/PATCHES.md` P4) | — | Patch proposed to app | 0.2.0-dev.4 |
| 5 | Code audit, measured | Technical specs kept in names | `Dune.wav`, `Dune 320kbps.mp3`, `Dune 24bit 48kHz.wav` | Only bpm removed | MP3 and WAV exports split | kbps, bit, kHz, sample rates removed | 3 → 1 | Fixed in lab | 0.2.0-dev.4 |
| 6 | Code audit, measured | "Radio edit" leaves a fragment | `Dune Radio Edit.mp3` → "dune radio" | Suffix pass removes "edit" only | Radio edits split | Phrase removed whole | 2 → 1 | Fixed in lab | 0.2.0-dev.4 |
| 7 | Code audit | Project files never opened | No project parsing in the code | Filename match only | Renamed projects never link | Ableton `.als` read (tempo, length, tracks, samples); Logic packages read as folders (contents only). Shared samples and timing become clues | synthetic: tempo 122 read, shared samples linked | Fixed in lab | 0.2.0-dev.4 |
| 8 | Code audit | Drives aren't searched | Picker stops at 6–10 levels | No drive crawler, depth cap | Old drives never imported | Full crawl, no depth limit, the app's folder rules | — | Fixed in lab | 0.1.0 (M1) |
| 9 | Code audit | Cloud placeholders detected by size only | 0-byte file and undownloaded file look the same | Size check only | Real projects deferred | `size > 0 && blocks == 0`, confirmed by the macOS `dataless` flag; placeholders never opened | — | Patch proposed to app | 0.1.0 (M1) |
| 10 | Code audit | Duplicates found only when filenames match | Same bounce under two names | Name check before the hash | Copies appear as separate files | Content hash (the app's `hashFileSha256`) on same-size local audio, after a quick check of the first and last 64 KB | synthetic: 3 duplicate sets found | Fixed in lab | 0.2.0-dev.6 |
| 11 | Code audit | AI cost isn't logged | Only an estimate exists | No per-call record | Spend can't be capped | Cost meter and cap per run | — | Open (M4) | — |
| 12 | Producer catalog | Variant words split one song | `CORALINE PIANO IDEA 1.3`, `… IDEA 2`, `… IDEA #2`, `… 1.4 W IMAGE`, `… 1.4 WO IMAGE`, `… IDEAS` | Numbers and descriptive tails kept | One cue shown five times | Version numbers and descriptive tails become version labels; plural variant proposed in review | 7 → 4 (real family: 5 → 2) | Fixed in lab | 0.2.0-dev.4 |
| 13 | Producer catalog | Edits of one piece split | `ATLAS - Intro v2`, `… Long 1.3`, `… Short 1.1`, `… Track 1`, `… Piece Project` | Edit words kept | Edits scattered | Short/long/track/piece edits are versions of one song, behind the setting "Short, long and cut-down edits are versions of one song" (on). Course prefixes from Lab options set the kind | 6 → 1 course item (real: 5 → 1, course) | Fixed in lab | 0.2.0-dev.4 |
| 14 | Producer catalog | "Project PD" suffix kept | `Beat Idea - Velvet Moss Project PD` vs `… 1 Suno.wav`; `KESTREL RUN Project PD` | Backup marker not removed | Project and bounce split | "Project PD" treated as noise | 4 → 2 (real: 3 → 1, 3 → 1) | Fixed in lab | 0.2.0-dev.4 |
| 15 | Producer catalog | Category prefixes used inconsistently | `Blooper Idea - Paper Moths`, `… Moths2`, `Idea - Paper Moths Project` | Prefix learning varies with the batch | One idea split | One prefix policy (the app's list plus the catalog's own category words) | 3 → 1 | Fixed in lab | 0.2.0-dev.4 |
| 16 | Producer catalog | Repeated words | `Lumen - Lumen Engine Demos 2` vs `Lumen - Engine Demos` | Repeats not collapsed | Duplicate entries | Repeated words and a repeated prefix collapsed | 4 → 3 (the demos join) | Fixed in lab | 0.2.0-dev.4 |
| 17 | Producer catalog | Contributor names split songs | `HARBOR - CELLO ADDS` vs `HARBOR - THEO CELLO ADDS 1`; `QUILL - Take It Over - Theo Adds` | Contributor names kept in titles | Collaborations scattered | Contributors learned from the catalog's own explicit patterns ("<name> adds", "feat", "w") in two or more files | 6 → 3 | Fixed in lab | 0.2.0-dev.4 |
| 18 | Producer catalog | Small spelling variants split | `Pinwheel` / `Pinwheels`; `Seawall Walk` / `… Monday` | Exact match only | Near-duplicates fill the catalog | Proposed as "Might be the same song as" in song detail, never merged | 4 → 4 with 2 proposals | Fixed in lab | 0.2.0-dev.4 |
| 19 | Producer catalog | Templates, course material and sample packs counted as songs | `TEMPLATE - 2024 ORCHESTRA`, `Tutorial - …`, `Engine 1 - …`, `Ev - Nyckelharpa - Drones - 1…7` | No kind beyond bounce/project/stem | Inflated song count | Own kinds (template, course, sample pack), hidden from the song count behind a button. Course prefixes are found in the catalog and offered for one-click confirmation (manual setting kept as an override); one-shots in a pack folder are a sample pack | 13 → 1 song (+ kinds); real: 7 of 7 course prefixes found | Fixed in lab | 0.2.0-dev.6 |
| 20 | Code audit | File type spelling not enforced | `tracks.file_type` has no rule | Convention only | Hidden data errors | The contract enforces plural types | — | Fixed in lab | 0.1.0 (M1) |
| 21 | Producer catalog | **Stems become separate songs** | `Sync - Glasshouse - Final - Whooshes`, `… Transitions`, `… Textures`, `… String Shorts`, `… LOWS`, `… Choirs` | Stem words suit beats only | Every orchestral stem is a song | Wider stem vocabulary; words after "Stems"; export batches (same folder and format, length within 50 ms, saved within minutes) make stems of the mix; a single stem joins a song in its folder, otherwise it is listed once under "Loose stems" for review | 16 → 3; real: 32 one-stem entries → 0 | Fixed in lab | 0.2.0-dev.6 |
| 22 | Producer catalog | Process and render words split songs | `Morning 5 - Tuesday 31 Oct` / `… Pitched`; `… Nov 9 Beat` / `… Instr Only` / `… Bass Only`; `… Viola` / `… Viola Wet` | Render words kept | Alternate renders scattered | Render words become version labels; "bass only" style parts become stems | 9 → 3 | Fixed in lab | 0.2.0-dev.4 |
| 23 | Producer catalog | Mix and master stages split one song | `Corvid - The Lantern .1.1`, `v2`, `Export 1.1`, `Final Master`, `Final Touches - Done`, `Master V1 - …`, `Post Revisit 1.2` | Stage words kept | History spread over a dozen entries | Stage words become version labels within one song | 13 → 2 | Fixed in lab | 0.2.0-dev.4 |
| 24 | Producer catalog | Tempo and take numbers split songs | `Riff Idea - Marble 121 og`, `… 121 3rdup`; `Tin Snow Christmas 165`, `… Christmas2`; `Ember Gate 2 - 128 Loop` | Bare numbers kept | Takes appear as songs | Takes (1–30) and tempos (60–200) become version labels when the plain title or the same folder is there; other numbers stay in the title. Check against the project's tempo not built yet | 10 → 4 | Fixed in lab | 0.2.0-dev.4 |
| 25 | Producer catalog | File-format word left in the name | `KESTREL RUN.wav 101 BPM 2.wav` | Format words inside names kept | Three entries for one song | Format words removed | 3 → 1 | Fixed in lab | 0.2.0-dev.4 |
| 26 | Producer catalog (replay, 7 Nov 2026) | **False merge:** different dated sessions of a series become one song | `Morning 5 - Friday April 21`, `… April 28`, `… June 16`, `… Aug 4` | Canonical identity strips the date, leaving only "Morning 5 Friday" | Weeks of separate sessions shown as one song (real: 42 files in 6 songs) | A day-named title keeps its date and its series | 1 → 4 (real: 6 → 21) | Fixed in lab | 0.2.0-dev.4 |
| 27 | Lab stress set (synthetic, 7 Nov 2026) | **False merge:** different numbered songs in different folders become one song | `Drive Glass 53` (folder A) + `Drive Glass 73` (folder B) | Canonical identity strips two-digit numbers it reads as tempo | Distinct songs merged | Bare numbers join only when the plain title exists, the files share a folder, or one file's numbers contain the other's | today 24 merges → engine 0 automatic | Fixed in lab | 0.2.0-dev.6 |

The lab's own regressions and fixes (for example the first M2 numbers rule and the noisy "might be the
same song" suggestions) are recorded in `CHANGELOG.md`, not here: this log is about today's importer.

## Guardrails (tested on every build)

All pass in 0.2.0-dev.6 (`group.test.js`, `names.test.js`, `findings-cases.test.js`):

- "Sky", "Red Sky 116bpm" and "Ide Kareal Sky" are three songs; "Sky Structure" is not "Sky".
- Each "Morning 5 <day>" is its own song; the same day in two series stays two songs.
- "… Live Set - Ascent 2023" and "… 2024" are separate.
- Generic titles never merge on the name alone.
- Similar names alone never merge; they are proposed in review only.
- Numbered titles in different folders never merge without the plain title or a shared number (row 27).
- Different dates in a series, and titles that differ only by number, are never suggested as matches.

## Decisions needed

| Decision | Proposal | Rows | Lab today |
| --- | --- | --- | --- |
| Are short, long and cut-down edits versions of one song? | Yes | 13 | Yes, behind a setting (on) |
| May strong evidence from several clues merge automatically? | Only at ≥ 0.95 with 2+ independent clue types, after 99.5% accuracy on real catalogs | 1, 12, 15 | Off by default (exact identity only); multi-clue is a Lab option |
| How should templates and course material appear? | Own kinds, hidden from the song count | 19 | As proposed; course prefixes are found automatically and confirmed in one click (Lab options keep a manual override) |
| Should near-identical spellings ever merge automatically? | No, review only | 18 | As proposed |
