# Importer Lab Spec

7 Nov 2026 · Arent Todal

> Source: the "Importer Lab Spec" document, exported to Markdown for this repository.
> Tables were flattened in the paste and are reconstructed here; wording is unchanged.
> The two prompts at the end of the original document are kept in "Prompts" for reference.

## Summary and scope

The Importer Lab is a separate, read-only Electron app that runs the next-generation import engine on real drives. It shows the result as songs, using the same code and the same interface elements as The Library, and moves into the main app once it's proven.

### What it proves

- That years of scattered bounces, projects and stems can become a correct catalog with almost no manual work.
- That the new engine beats today's importer on the same folders, measured, not assumed.
- That AI on the leftovers is worth its cost, with a meter on every run.

### What it never does

- Write to The Library's database (dev and prod share one), the user's Library folders or any user file.
- Move, rename, delete or download files.
- Send audio or file paths to an AI model.
- Ship to users. The lab is for the team and invited testers.

How it gets into the app: the engine is a package with no screens and no database. The lab is a thin Electron shell around it. When the engine meets the targets in section 8, the main app imports the same package, first in shadow mode, then for real.

### Changes from the integration brief (7 November)

The codebase brief makes the lab simpler than planned. Every import module runs in plain Node, and the review wizard already accepts a replacement grouping engine through one injection point. It also measured three bugs in today's importer. Where this spec and the brief disagree, the brief wins on facts.

| Area | Change to this spec |
| --- | --- |
| Integration point | The engine plugs into `createLibraryImportSessionManager` as `hybridGroupFiles`. The lab stubs `executeApproved`, `finalizeApproved`, `trashItem` and `routeItemsToInboxes` (it moves files) to no-ops. The same injection puts the engine into the main app later. |
| File types | Plural only: bounces, stems, projects, videos, unknown. |
| Paths | Absolute paths stay in the main process. Screens use `sourceRelativePath` and `sourceContainerId` only (IMP-FN-032-R3). |
| Song keys | The wizard keys groups by display name; the engine uses stable ids. A translator converts both ways. |
| Confidence | The wizard's 0.5 is a placeholder, not a score. Engine scores go in a separate field. |
| Matching evidence | Shared samples and audio checks are shown as clues, never as proof that two files sound the same. |
| Baseline | Today's grouper runs in both modes (`preserveSourceIdentity` true and false). The engine targets true: keep collaborator prefixes. |
| Existing songs | Loaded from a snapshot file. The lab fails loudly if the list is empty when it shouldn't be. |
| Environment | Electron ^41.10.7, npm, CommonJS. node:sqlite works on Node 22 but is experimental: confirm it inside Electron 41 before building on it. |
| Styling | Tailwind loads from a CDN; vendor a built copy so the lab works offline. |
| Player | The waveform player needs a preload shim of six electronAPI methods. It plays local files with no server. |
| Cloud placeholders | Today's check is file size only. The lab builds a real detector, then offers it back to the app. |
| AI cost | Nothing logs AI cost today. The lab logs every call. |
| Tests | The "adversarial" file this spec named is about earnings, not import. Use the six import test files listed in the brief. |

### Must-pass cases (all fail in today's importer, measured by the brief)

1. `Untitled 14.als` and `Untitled 37.als` stay separate. Today every "Untitled" project merges into one song.
2. `MG X JC - SKY FINAL.wav` joins Sky. Today it becomes a separate "Sky Final".
3. Stems follow their bounce when a collaborator prefix is removed. Today they're left in a separate group.
4. The three-Sky case still holds.

### Fix in the main app now, independent of the lab (Ross)

- Generic titles merge: every "Untitled N", "New Project N" and "Track N" collapses into one song. Port `GENERIC_TITLES` from the auto-merge engine into import so these go to review instead. This likely affects real libraries today.
- "Radio edit" leaves the fragment "radio".
- Run the DAW count query from section 7 of the brief.

### Answers to the brief's open questions (recommendations, for Ross to confirm)

| Question | Recommendation |
| --- | --- |
| Is the "Untitled" merge known or a bug? | A bug; fix now |
| Strip technical specs (320kbps, 24bit, 48kHz) from names? | Yes |
| Revisit IMP-FN-019-R24 (final, clean, rough, released, radio edit)? | Yes, through a versioned name policy the lab can compare old against new |
| May the lab read real track sidecars? | Yes, read-only, on our own catalogs |
| Which file_type spelling? | Plural |
| Which preserveSourceIdentity mode? | Engine: true. Baseline: both |
| Add AI cost logging? | Yes, in the lab and the app |
| Does node:sqlite work in Electron 41? | Ross checks on his Mac before phase 1 |

## 1. Non-negotiables

Eight rules hold for every line of lab code. A change to any of them needs agreement from Ross, Josh and Arn.

1. **Read-only.** The lab opens user files only for reading. It writes only inside its own data folder. A file-system guard enforces this, and a test fails if any write, rename or delete reaches a scanned folder.
2. **Same import code.** Today's classification, name cleaning, grouping, duplicate hashing and stem rules come from the main app's own modules, pinned to a known commit. Never copied and edited. If a module needs a change, the lab proposes a patch to the main repo.
3. **Same look.** Screens use the app's CSS variables, stylesheets, components and patterns (the producer-dashboard-design skill is the authority). No new colors, fonts or button sizes.
4. **Same environment.** Same Electron and Node versions as the main app, so file-system behaviour, cloud placeholders and macOS permissions match.
5. **Today's result is always shown.** Every scan also runs today's importer on the same files, so every number is a comparison.
6. **Precision before coverage.** A wrong merge is worse than a missed one. Nothing merges automatically unless it passes the merge rule agreed in section 9.
7. **Privacy.** Only names, dates, sizes, lengths and extracted clues may go to AI. No audio, no file paths, no account data.
8. **AI with a budget.** AI runs only on unclear leftovers, with a cost meter and a hard cap per run. Everything works with AI switched off.

## 2. Repository, ownership and structure

The lab lives in a private repository owned by a Producer Dashboard Corp. GitHub organization, not a personal account. All work in it is company IP from the first commit.

```
importer-lab/
  packages/
    import-engine/        # the engine: no UI, no database, no Electron imports
      src/                # crawler, clue readers, scoring, AI pass, contract types
      test/               # unit tests + fixture runs
    contract/             # shared TypeScript types (section 5), versioned
  apps/
    lab/                  # Electron shell: screens, file-system guard, local store
  vendor/
    the-library/          # main app repo as a git submodule, pinned to a commit, read-only
  fixtures/
    synthetic/            # generated messy catalogs (fake .als files etc.)
    adversarial/          # cases copied from the main repo's tests
  labels/                 # human right/wrong marks per real catalog (no file contents)
  docs/
    SPEC.md               # this spec
    INTEGRATION_BRIEF.md  # output of prompt 1
  CLAUDE.md               # lab rules for coding agents (non-negotiables above)
```

- **The main app as a submodule.** The lab imports today's import modules and stylesheets from `vendor/the-library`, pinned to a commit. Updating the pin is a deliberate step, recorded with the reason.
- **No deployments except one:** a small Cloudflare Worker for AI calls when testers outside the team run the lab. During development, a local key in an untracked `.env` file is fine. The key never ships inside the app.
- **Builds:** unsigned development builds for the team. Signed builds only if outside testers need them.

## 3. What we reuse from the app

The lab calls the app's own import modules and renders with the app's own interface. Paths below come from the codebase audit of 7 November; prompt 1 confirms each one and its dependencies before any build starts.

### Import code (used as today's baseline and as building blocks)

| Module | What it does today | Lab use |
| --- | --- | --- |
| `electron/local-file-scanner.js` | Scans Library folders; content readiness and cloud placeholder checks | Reuse readiness checks; the lab adds its own drive crawler |
| `electron/external-folder-import.js` (`walkFolder`) | Imports picked folders; treats a DAW project folder as one item | Baseline for picked folders; keep the project-folder rule |
| `electron/catchall-classifier.js`, `electron/inbox-router.js` | Classifies files as bounce, stem, project (IMP-FN-021) | Reuse as-is for classification |
| `electron/local-lcp-grouper.js` (`normalizeFilename`) | Name cleaning, version 1 (IMP-FN-001) | Baseline only, until the two cleaners are reconciled |
| `canonicalSongIdentity()` (location to confirm) | The only name allowed to merge songs (IMP-FN-007-R14) | Reuse as the strongest name clue and the merge gate |
| `electron/hybrid-grouper.js` (`hybridGroupFiles`) | Today's 3-tier grouping (IMP-FN-019) | Runs on every scan as the comparison baseline |
| `electron/import-content-identity.js` | SHA-256 of file contents | Reuse for exact duplicates |
| `electron/auto-merge-engine.js` | Reads WAV and AIFF audio, detects silence and placeholders | Reuse for audio checks; no new audio code in v1 |
| `electron/library-import-session.cjs` | The import review wizard (IMP-FN-032) | Its data shapes define the engine's output (section 5) |
| `POST /api/import/ai-review` (IMP-FN-016) | Today's AI step for ambiguous files | Reuse its prompt and schema as the starting point |

### Interface elements

| From the app | Lab use |
| --- | --- |
| `public/tracks-page.css` (design tokens: colors, type, sizing) | Loaded unchanged; every lab style uses its CSS variables |
| `public/vanilla-table-theme.css` and the tracks grid patterns from `tracks.html` | The catalog screen looks like the main tracks view |
| `public/components/` and `.std-*` classes | Buttons, chips, badges, inputs, panels |
| `window.createStandardModal` | Every dialog |
| `public/waveform-player.js` | Playing bounces and stems in song detail |
| The import review wizard's file rows (bounce, project, stem types, confidence, weak-match labels) | Song detail and marking screens |
| producer-dashboard-design skill | The style authority for any new element |

How we pull them in: import from the pinned submodule where a module has no Electron or database dependency. Where it does, wrap it with a thin adapter in the lab, and list the adapter in the integration brief. Never copy a file and edit it.

## 4. The contract

The engine takes a scan request and returns a proposed catalog. Its output must map one-to-one onto the import review wizard's data and the `track_groups` and `tracks` tables, so the app can use it without translation. This is the page to agree with Ross first.

Draft v1 below. Prompt 1 replaces every TO CONFIRM with the app's real field names and types. (The rewritten contract is in `docs/INTEGRATION_BRIEF.md` §3.5 and is implemented in `packages/contract`.)

```ts
// contract v1.0.0 — semver; any breaking change bumps the major version

export interface ScanRequest {
  roots: string[];                 // folders or drives chosen by the user
  existingSongs?: ExistingSong[];  // songs already in the user's Library, read-only
  options: {
    followSymlinks: false;         // fixed in v1
    includeCloudPlaceholders: 'skip' | 'list';  // never downloads
    ai: { enabled: boolean; maxCostUsd: number; model: string };
    mergeRule: 'exact-identity-only' | 'multi-clue';  // decision in section 9
  };
}

export interface ExistingSong { id: string; songName: string; displayName?: string }  // TO CONFIRM

export interface ProposedCatalog {
  contractVersion: '1.0.0';
  engineVersion: string;
  policyVersion: string;           // scoring weights and thresholds file
  songs: ProposedSong[];
  unassigned: ProposedFile[];      // files that fit no song with enough confidence
  duplicates: DuplicateSet[];
  baseline: BaselineResult;        // today's importer on the same files
  stats: ScanStats;
}

export interface ProposedSong {
  proposalId: string;              // stable across re-runs of the same files
  songName: string;                // maps to track_groups.song_name (TO CONFIRM)
  existingSongId?: string;         // when it matches a song already in the Library
  band: 'sure' | 'unsure' | 'unclear';
  confidence: number;              // 0 to 1
  reasons: Reason[];               // why these files belong together
  files: ProposedFile[];
  stemSets: StemSet[];             // same rules as IMP-FN-032-R3
  facts: { bpm?: number; key?: string; lengthSec?: number };  // from project contents
  decidedBy: 'rules' | 'ai';
}

export interface ProposedFile {
  fileId: string;                  // hash of device + path; the path stays local
  path: string;                    // local only, never sent to AI
  name: string;
  type: 'bounces' | 'stems' | 'projects' | 'videos' | 'unknown';  // tracks.file_type convention, plural
  ext: string;
  sizeBytes: number;
  durationMs?: number;
  createdAt?: string; modifiedAt?: string;
  sha256?: string;
  latest?: boolean;                // newest bounce of the song
  confidence: number;
  reasons: Reason[];
  cloudPlaceholder?: boolean;
}

export interface Reason {
  clue: 'canonical-name' | 'folder' | 'timing' | 'project-contents' | 'shared-samples' | 'duplicate' | 'stem-set' | 'ai' | 'user-rule';
  weight: number;
  text: string;                    // one line a person can read
}

export interface StemSet { label: string; matchesFileId?: string; files: ProposedFile[] }
export interface DuplicateSet { sha256: string; keepFileId: string; copies: string[] }  // nothing is deleted
export interface BaselineResult { groups: { songName: string; fileIds: string[] }[] }
export interface ScanStats { files: number; songs: number; autoMatchedShare: number; durationMs: number; aiCostUsd: number }
```

What the contract deliberately leaves out: user ids, database ids for new rows, storage paths inside the Library, and symlink handling. The app adds those when it commits an approved proposal, as it does today.

## 5. Engine pipeline

Eight steps, each independently testable. Steps 1 to 6 run on the user's computer with no network.

1. **Crawl.** Stream every file under the chosen roots in worker threads, with no depth limit. Store (device, inode, size, modified) per file in a local SQLite store (Node's built-in node:sqlite if the Node version allows). Skip unchanged files on re-scans. If inodes churn (the Dropbox File Provider issue), fall back to (path, size, modified). Never read a cloud placeholder's contents.
2. **Classify.** Use the app's own classifier: bounce, project, stem or other. DAW project folders stay one item, as in `walkFolder`.
3. **Baseline.** Run today's `hybridGroupFiles` on the same files and keep the result for comparison.
4. **Read clues.**
   - Project contents: Ableton `.als` (gunzip + streaming XML): tempo, track names, sample references, arrangement length. Logic `.logicx` read as a folder: Media, Alternatives, Bounces and file dates. Others: name and dates only in v1.
   - Shared samples: an index of sample to projects. Projects sharing several samples are versions of one song. Samples used in more than 5% of projects count as library sounds and are ignored.
   - Timing: a bounce created shortly after a project save, with a length close to the arrangement length.
   - Names and folders: canonical identity (strongest), same folder, sibling folder, same drive.
   - Duplicates: SHA-256, reusing the app's module. One copy is marked as the one to keep; nothing is deleted.
   - Stem sets: the IMP-FN-032-R3 rules.
   - User rules: corrections saved from earlier marking, applied first.
5. **Score.** Combine clue weights per candidate match. Weights and thresholds live in a versioned policy file, fitted on marked catalogs, never hand-tuned in code.
6. **Band.**

   | Band | Rule (draft, pending the merge decision) | Shown as |
   | --- | --- | --- |
   | Sure | Exact canonical identity, or a validated existing association, or (if the multi-clue rule is agreed) score ≥ 0.95 from 2+ independent clues with no rival within 0.15 | Pre-approved |
   | Unsure | 0.60 to 0.95, any tie, or a high score from one clue type only | Review, pre-checked above 0.85 |
   | Unclear | Below 0.60, no clues, or a 3-way or wider ambiguity | Review, unchecked; eligible for AI |
   | Never automatic | Empty identity, unsafe folder name, conflicting associations | Review, flagged |

7. **AI pass (optional).** Only unclear items. Payload: an opaque id, name, type, extension, size, dates, length, folder depth, sibling names and clues. No paths, no audio. Chunks stay under 100,000 tokens, and items that share samples stay in the same chunk. A small model by default, a larger one only when the small one is unsure on more than 25% of a chunk. A live cost meter stops at the cap. Results are cached, so a re-run costs nothing. Every AI group still passes the merge rule before it can be sure.
8. **Output.** The proposed catalog in the contract format, plus the baseline and stats.

Performance targets: a 10,000-file catalog usable within 10 minutes; peak memory under 500 MB; the interface never freezes during a scan.

## 6. Lab app screens

Seven screens. The catalog and song detail screens must be recognisable as The Library: same grid, same file rows, same player.

| Screen | What it shows | Built from |
| --- | --- | --- |
| 1. Choose folders | Drives and folders to scan, AI on or off, cost cap, merge rule | Standard inputs and buttons |
| 2. Scan | Live progress: files found, projects read, songs proposed, AI cost so far; cancel at any time | Standard progress patterns |
| 3. Catalog | Proposed songs as the tracks grid: name, band, confidence, counts ("3 bounces · 1 project · 14 stems"), BPM, key, length. Filter by band; sort by confidence | Tracks grid and table theme |
| 4. Song detail | Every file in the song as in the import review wizard: type, latest, weak match, confidence, folder and date, plus the reasons as plain lines. Play bounces and stems | Import review file rows, waveform player |
| 5. Compare | Today's importer vs the new engine, per song: same, merged, split, moved file | Grid with change labels |
| 6. Marking | Right or wrong per song and per file; split, merge and rename; every mark can become a reusable rule. Saved to a labels file with no file contents | Review checkboxes and standard modals |
| 7. Metrics | Auto-matched share, accuracy against marks, false merges, run time, AI cost; versus the baseline and the previous engine version | Simple tables; charts later |

Out of scope for the lab interface: stages, tags, comments, sharing, collaborators, earnings. Those belong to the main app.

## 7. Safety, test catalogs and metrics

### Safety

- A file-system guard wraps every write API. Writes are allowed only inside the lab's data folder. A test scans a fixture folder and fails on any change to it.
- No network calls except the optional AI pass, and the AI payload is checked by a test that fails if it contains a path separator or audio data.
- Cloud placeholders are listed, never opened, so a scan never triggers downloads.
- Labels and reports contain names, ids and marks only. Real catalogs' file contents never enter the repository.

### Test catalogs

| Catalog | Why |
| --- | --- |
| Synthetic generator (fake .als files, renamed versions, copies across folders, stems mixed with bounces) | Repeatable, safe to commit |
| The main repo's six import test files (per the brief), including the three-Sky case, plus the must-pass cases | Must keep passing; guards the merge rule |
| Arn's catalog (about 12,000 files, Ableton) | First real test |
| Josh's catalog (collaboration-heavy) | Collaborator naming |
| A Logic user's catalog | Second DAW |
| A catalog with the same bounces on 3 drives | Duplicates |
| A catalog with many cloud placeholders | Safety and speed |

## 8. Targets before the engine moves into the app

| Metric | Target |
| --- | --- |
| Files matched with no human input | 85% or more |
| Accuracy of automatic matches | 99.5% or more |
| False merges per 10,000 files | 0 |
| Time to a usable 10,000-file catalog | 10 minutes or less |
| Corrections needed on a second run, vs the first | 30% or fewer |
| AI cost per 10,000-file catalog | Under $0.50 |
| Beats today's importer | On every real test catalog |

## 9. Path into the main app, and decisions to agree

The engine enters the app in three steps, each reversible.

1. **Shadow mode.** The app runs the engine on real imports and logs its proposals next to today's result. Today's importer still decides. No user sees a difference.
2. **Behind a setting.** Testers switch the new engine on. Its proposals feed the import review wizard.
3. **Default.** Once shadow results meet the targets on real users' imports, the engine becomes the default and today's grouping stays as a fallback for one release.

Moving code into the main repo follows its rules: spec entries first (a new IMP section with spec codes), `@spec` tags and `@version` headers, mapped specs touched, `lessons_learned.md` for surprises, engineering graph checks, and the deploy steps in CLAUDE.md.

### Decisions to agree with Ross before the build starts

| Decision | Proposal |
| --- | --- |
| Contract v1 (section 5) | Agree field names after prompt 1; Ross signs off |
| Merge rule | Exact identity only in the app for now; the lab tests the multi-clue rule and switches only after 99.5% accuracy on real catalogs |
| Naming policy | Keep collaborator prefixes; propose merges in review (as the review wizard does) |
| The two name cleaners | Reconcile in the main app first, about 2 days; the lab pins to that commit |
| Evidence store | Device-local SQLite; no new database tables |
| AI model and budget | Ross names the model; cap per run in the lab, and per user in the app |
| Electron and Node versions | Same as the main app, pinned |
| Repository | Producer Dashboard Corp. GitHub organization; the main app moves there too |
| Who reviews | Ross reviews the contract, adapters and any patch to the main repo |
| DAW priority | Ableton, then Logic; confirm with prompt 1's count of project file types |

## Prompts

### Prompt 1: investigate the main codebase

Run in Claude Code inside the main the-library repo. It reads only, and produces the integration brief that prompt 2 builds on. Its output is `docs/INTEGRATION_BRIEF.md`.

### Prompt 2: build the lab

Run in Claude Code inside the new, empty importer-lab repository, after prompt 1:

> Build the Importer Lab described in docs/SPEC.md, using docs/INTEGRATION_BRIEF.md for every fact about the main app. Where the two disagree, the brief wins on facts and the spec wins on rules; list each conflict before you start.
>
> SETUP
> 1. Create the structure in the spec (packages/import-engine, packages/contract, apps/lab, vendor, fixtures, labels, docs).
> 2. Add the main repo as a git submodule at vendor/the-library, pinned to the commit named in the brief. Never edit files inside it.
> 3. Write CLAUDE.md for this repo containing the spec's eight non-negotiables, the folder rules, and: never copy-and-edit a main-app file, wrap it in an adapter instead.
> 4. Match the main app's Electron and Node versions exactly. Use node:sqlite if available, otherwise explain the alternative before adding any native module.
> 5. Put the contract types from the brief's rewritten contract v1 in packages/contract, versioned 1.0.0.
>
> BUILD IN MILESTONES. After each, run the tests, run on the synthetic fixtures, show the result, and stop for review.
>
> M1 Crawl, classify, baseline, catalog
> - Synthetic catalog generator: fake .als files (gzipped XML with tempo, tracks, sample references, arrangement length), renamed versions, copies across folders, stems mixed with bounces, cloud placeholder stand-ins.
> - File-system guard plus a test that fails on any write, rename or delete in a scanned folder.
> - Streaming crawler with the incremental store; classification and baseline grouping through adapters around the app's own modules.
> - Lab screens 1 to 3 (choose folders, scan, catalog) using the app's stylesheets, grid and components, showing the baseline result.
>
> M2 Clues, scoring, bands, song detail
> - Ableton reader, Logic-as-folder reader, timing, folder, canonical name, duplicates, stem sets, shared samples.
> - Scoring from a versioned policy file; bands as in the spec, with the merge rule as a setting defaulting to exact-identity-only.
> - Screen 4 (song detail) with the app's file rows, reasons in plain lines, and the waveform player for local files.
>
> M3 Compare, marking, metrics, rules
> - Screens 5 to 7. Marks saved to labels/<catalog>.json with no file contents. Corrections can be saved as user rules and applied first on the next run.
> - Metrics computed against marks and against the baseline.
> - Copy the six import test files listed in the brief into fixtures/adversarial and make them pass, including the three-Sky case, plus the spec's four must-pass cases.
>
> M4 AI pass
> - Unclear items only; payload per the spec (no paths, no audio) with a test that fails if a path or audio data appears.
> - Chunking under 100,000 tokens keeping shared-sample items together; model from config; local key from an untracked .env file; live cost meter; hard cap; cached results.
>
> RULES THROUGHOUT
> - Tests first for every clue reader and for the scoring.
> - Plain, readable code; no clever abstractions.
> - Keep a CHANGELOG.md and a decisions log in docs/DECISIONS.md.
> - Never commit real catalog data, keys or file contents.
