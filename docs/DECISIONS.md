# Decisions log

Newest first. Each entry: what was decided, why, and what would change it. Conflicts between the spec
and the brief are in `docs/CONFLICTS.md`; this log records how the build resolved them.

## 2026-11-07 — M2: the engine groups songs

**D33. Merge rule and bands.** Default merge rule is `exact-identity-only`: a song is **sure** only when
every non-stem file has the same app canonical identity (or it is one clean file). Files joined by the
lab's name policy, folder or content clues form a proposal in band **unsure** ("Check these first");
empty, weekday-only or very short titles are **unclear**. Under `multi-clue` (Lab option) a policy merge
becomes sure at confidence ≥ 0.95 with two or more independent clue types. Scoring weights
(`policy/scoring-v1.json`) are hand-set (`fitted: false`) until M3 fits them on labelled catalogs.

**D34. One name policy, versioned (`policy/names-v1.json`, `lab-names-1`).** Built on the app's
`preClean` and canonical identity (loaded through adapters, never copied). The name is read as segments
split on " - ": category prefixes (the app's list plus idea/sample words), learned namespaces (the app's
`discoverNamespaces`, kept only when a title remains), collaboration prefixes ("A X B"), then label
segments (stage, render, edit, version, format and tech words, stem parts). The title loses trailing
stage/render/edit/version words, dates, takes and tempos, repeated words, contributors and "Project PD".
Every removal is recorded and shown as a plain reason. Applies the same way to bounces, stems and
projects (row 3).

**D35. Numbers and dates.** A bare number is a take (1–30) or tempo (60–200) and becomes a version label
only when the plain title is present or the numbered files share a folder; without folder information
(the names-only replay) nothing is split. A month alone is not a date. A title that is only a day
("Friday April 21") keeps its date and its series (row 26). Years always stay ("Live Set 2023" vs "2024").
Found by the 1,000-song stress set, where the first M2 draft found 628 songs instead of 1,000 (row 27).

**D36. Weak and generic titles.** Generic titles (the app's `isGenericTitle`) keep their number and
group only within one folder, never as sure (row 1). Weak titles (empty, weekday or number only, one or
two letters) group only identical names in one folder; an empty title stays a single file.

**D37. Contributors are learned only from explicit patterns** ("<name> adds", "for/feat/ft/w <name>") in
two or more files, never because removing a word matches another title (a first draft learned 61 words,
including "friday" and "structure").

**D38. Kinds.** A song's kind is the majority of its files: song, template, course, sample pack, or a
stem-only set. Course prefixes are per catalog (Lab options → Course prefixes); sample-pack families
need five or more numbered parts. Other kinds are hidden from the song count behind a button.

**D39. Clue readers run on local files only.** Cloud placeholders are never opened (so nothing
downloads); their names still group. Readers: Ableton (gzip XML: tempo, length, tracks, sample names),
Logic package contents, WAV/AIFF length, export batches, shared samples (a sample in more than
max(3, 5%) of projects counts as library and is ignored), timing (bounce saved within 30 minutes of a
project of the same length), duplicates (the app's `hashFileSha256`, same-size files of 1 KB or more).
Results are cached per file in the store.

**D40. Existing songs and auto-merge.** A snapshot of Library songs (JSON from the app, loaded in Lab
options) links a proposal to a Library song only on an exact canonical match; an empty or malformed
snapshot fails loudly. The auto-merge engine is loaded through an adapter that stubs its three
desktop-only requires (`adapters/auto-merge.js`) for `isGenericTitle` and its pure helpers.

**D41. Song detail uses styled rows, not the wizard's.** The import review wizard renders its file rows
only inside the full session flow (`library-import-wizard.js`), so it cannot be driven from the lab
without a session. Song detail shows the same information (type, version, stem part, latest, cloud) in
the app's row styles. *Revisit when:* the wizard exports a row renderer (to propose as a patch).

**D42. Export v2.** Adds per file: opaque folder id (salted hash, so folders can be compared without
names), size, modified time, length, version label and stem part; per song: kind, band, versions and
possible matches. No paths, no audio.

**D43. Contract 1.1.0** (additive, optional fields): song kind, namespace, versions, possible matches,
precheck; file version label, stem part, source container; request options `groupEdits` and
`catalogRules`; `baselineStripPrefixes`. Engine version `0.2.0-m2`.

## 2026-11-07 — Navigation and scan history (after the first real run)

**D29. Navigation.** One Back button in the header on every step (a stack of visited screens; the
one-off permission note is never returned to), plus Home and New scan on every screen after the
welcome. Leaving a running scan cancels it; starting a new scan while one runs replaces it (the old
one finishes cancelling first). File menu: New Scan (⌘N) and Open Previous Results… (⌘O).

**D30. Scan history.** Every finished scan is saved as `scans/<scanId>.json` in the data folder: the
renderer view (names, relative folders, counts — no absolute paths) and its catalog id. The home
screen lists them (date, folders, songs, files) with Open and Delete. Delete removes only the saved
results, after the app's destructive mirror confirmation (Keep + Delete); marks stay in `labels/`.

**D31. Live song list.** The scan screen shows the 20 newest song names and a "See all N" button.

**D32. M2 inputs from the first real run (one producer's catalog, 1,803 files → 1,068 songs today).**
The cases are recorded as anonymised rows in `docs/FINDINGS.md` and `fixtures/cases/findings-cases.json`
(variant suffixes, edits, uneven category prefixes, repeated words, contributor names, plural and suffix
variants, must-stay-separate series and years, templates and course material). Real names stay in the
git-ignored `private/` folder. "Project PD" is a backup-copy marker left by Producer Dashboard (the
earlier version of The Library) when files were moved: noise, never a rule or identity.



**D19. Review answers recorded.** D6 (the mirrored folder rule) stays until patch P1 lands, with its parity
test. D15 stays: the catalog is the grid's styled markup, no `tracksPage` stand-in. D13 is resolved by
vendoring Inter (OFL) from `@fontsource/inter` (`npm run vendor:fonts`); the app's `utilities.css`
still `@import`s Google Fonts, which the window blocks (no network), so Inter now comes from the lab.

**D20. Packaging from the repository root, no node_modules in the app.** The lab has no runtime
dependencies, so electron-builder copies only `apps/lab`, the two packages, `vendor/the-library/electron`
(JS) and `vendor/the-library/public`. Workspace imports became relative paths so nothing needs
`node_modules` at run time. `asar` is off because the scan runs in a worker thread that loads the engine
from plain files. The packaged app was run end to end (Linux build, no lab environment variables).

**D21. Unsigned builds get an ad-hoc signature.** electron-builder 26.17 cannot ad-hoc sign, and a
completely unsigned arm64 app downloaded from the internet is reported as "damaged" with no way to
open it. `scripts/after-pack.js` runs `codesign --sign -` on the merged universal app, so testers get
the normal "Open Anyway" path. Developer ID signing and notarisation are wired in the workflow behind
the repository variable `MAC_SIGNING=on` and five secrets; they are never read while it is off.

**D22. One credential slot for the private submodule, two kinds.** Only the pinned commit is fetched (`--depth 1`, about 140 MB instead of more than 1 GB of history; full clone as fallback), and git never prompts for a password, so a bad credential fails the step instead of hanging it. `scripts/ci/checkout-submodule.sh`
uses `THE_LIBRARY_DEPLOY_KEY` (SSH, read-only) when present, otherwise `THE_LIBRARY_TOKEN` (HTTPS),
rewriting the submodule URL only for that one command. Switching to a deploy key = adding one secret.
Nothing names the repository owner; the release step uses the workflow's own repository context.

**D23. Releases.** Branch pushes replace one pre-release, `lab-latest`, so testers always have one place
to download from; `v*` tags make permanent releases. Branch builds are versioned `0.1.0-dev.<run>`.

**D24. The producer flow is the default; team tools are opt-in.** Welcome → folders → permission note
→ scanning → catalog → song → marks → send results. Compare, scan options, metrics and logs live in a
Lab screen and a native Lab menu, shown only after Settings → Show Lab tools.

**D25. Folders.** Suggested: ~/Music (ticked by default), ~/Desktop, ~/Documents, and real folders in
/Volumes (the startup disk's symlink is skipped). Added and dropped folders are remembered in
`settings.json` in the data folder. Dropped folders are resolved in the preload with
`webUtils.getPathForFile` and sent straight to the main process; the page never holds a path. A folder
inside another ticked folder is not scanned twice.

**D26. Permission note.** Shown once, before the first scan that includes Desktop, Documents, Downloads,
iCloud Drive (~/Library/Mobile Documents) or /Volumes. Folders the user does not allow are counted as
unreadable; the catalog then offers a button that opens System Settings → Files and Folders.

**D27. "Check these first" until M2.** A song is unsure when today's importer flagged it as ambiguous, its two modes (keep or strip name prefixes) disagree about which files belong to it, or
its bounces, projects and videos do not all clean to the same name (the app's `canonicalSongIdentity`).
Stems are left out of that comparison because today's grouper reads stems with a pattern it does not
export. A guessed file type is shown on the file, not as doubt about the song. Known gap: "Untitled 14"
and "Untitled 37" share the name "untitled", so they are not flagged; the generic-title check needs the
auto-merge adapter (M2), which must stub modules (unzipper, fs-extra) that are not in the packaged app.

**D28. Marks and results.** Marks are saved as `labels/<catalogId>.json` in the data folder; the catalog id
is a hash of the chosen folders. Unknown fields (such as paths) are dropped when a mark is saved.
"Send results" writes `exports/Importer Lab results <date time>.json` in the data folder (the only place
the lab may write) and reveals it in Finder. It holds song and file names, types, counts, marks,
timings and versions; tests fail if a path or folder path appears. The repository's `labels/` folder is
where the team keeps the results testers send (M3).

## 2026-11-07 — Setup and M1

**D1. Submodule pinned to f5af21c7** (the brief's commit, origin/main 2026-11-02), not the newer local
checkout (7370e16). Every module path in the brief was re-verified at the pin. `PINNED_COMMIT` in
`packages/import-engine/src/adapters/vendor.js` is checked by a test against the submodule's HEAD.
*Revisit when:* the name-cleaner reconciliation (brief 2.3) lands in the main repo.

**D2. Electron 41.10.7 exactly; Node 24.18.0.** The app's `^41.10.7` resolves to 41.10.7 in its lockfile.
Measured: Electron 41.10.7 bundles Node 24.18.0, Chromium 146.0.7680.216, SQLite 3.53.1 (the brief
assumed Node 22.x). Tests run with `ELECTRON_RUN_AS_NODE=1 electron --test`, so they execute on the
exact runtime the lab ships; `.nvmrc` and `engines` say 24.18.0 for anything else.

**D3. node:sqlite for the evidence store; no native module.** Measured working inside Electron 41.10.7,
both as Node and in the real Electron main process (worker thread). Ross can confirm on his Mac with
`npm run electron:versions`.

**D4. The engine package has no database.** The SQLite store lives in `apps/lab/src/store.js`; the engine
takes a `previous(item)` lookup and returns `records` to save. Keeps "the engine is a package with no
screens and no database" true while still meeting SPEC step 1.

**D5. The crawler is the lab's; what counts as an item is the app's.** No depth or file cap (spec rule).
Per folder it calls the app's exported `isSkippableName`, `extensionOf` and
`findProjectFolderForPath(folder, { maxAncestors: 1 })`, which applies walkFolder's own project-folder
rule (DAW bundles and genuine project wrappers stay one item). A test asserts the crawler yields exactly
what the real `walkFolder` yields wherever walkFolder can reach, and that it also finds a file 12 folders
deep that walkFolder misses.

**D6. One mirrored rule, with a parity test and a patch.** `sourceCategoryForFolder` (Bounces/Stems/Projects
folder names → source category, IMP-FN-023) is not exported at the pin. It is mirrored in
`adapters/walker.js` (a 3-entry map), proven identical by the walkFolder parity test, and patch P1 in
`docs/PATCHES.md` exports it. This is the only mirrored rule. *Needs review:* is this acceptable under
non-negotiable 2 until P1 lands?

**D7. Baseline = `hybridGroupFiles` run directly, both modes.** The brief's proven recipe (2.4). Entry
shape copied from the review wizard's call site. `catalog.baseline` is `preserveSourceIdentity: true`
(the engine's target); the `false` run travels next to the catalog as `baselineStripNamespaces` because
contract 1.0.0 has one baseline field (proposed for 1.1.0, not added). The grouper's `console.log` is
captured (Adapter 2). No AI is involved: the wizard's later JEV merge and Tier 3 AI are not part of the
baseline (CONFLICTS K9).

**D8. Session adapter (Adapter 3) moved to M2.** M1 does not need the wizard. Adapter 1
(client-diagnostics stub) is not needed at all so far: neither the classifier nor the grouper loads it.

**D9. Placeholder detector built in M1** (the crawler needs it). `size > 0 && blocks === 0` makes a
candidate; on macOS `/usr/bin/stat -f %Sf` confirms (`dataless` = placeholder, `compressed` = a local
compressed file). Off macOS, or if `stat` fails, a candidate stays a placeholder so it is never read.
A 0-byte file is empty, not a placeholder. Results are cached in the store.

**D10. A scan reads metadata only.** Directory listings and `lstat`. A test spies on every fs read/open
API during a full scan and requires zero calls. Hashing and .als parsing (M2) will read contents of
non-placeholder files only.

**D11. Store reuse.** Lookup by (device, inode) when size and modified time match, else by path
(inode churn). The engine reuses stored derived data only when size and modified time are unchanged.
Name-based results (classification) are always recomputed: they depend on the path, which can change
under the same inode.

**D12. Absolute paths stay in the main process and the worker.** The renderer gets `sourceRelativePath`
(starting at the chosen folder's name) and opaque ids; roots are shown by folder name. A test fails if
the scanned location appears anywhere in the renderer view.

**D13. The window cannot reach the network.** All http(s)/ws(s) requests from the renderer are cancelled
in the main process; a Content-Security-Policy limits the page to the lab's own files. Consequence: the
app's Google Fonts link is not loaded, so Inter is used only if it is installed locally (otherwise the
app's own fallback stack, -apple-system). *Revisit when:* someone wants pixel-identical type; Inter could
be vendored.

**D14. Styles come from the app unchanged.** The renderer is served over a `lab://` protocol: `/lab/*`
is the lab's renderer, every other path is the submodule's `public/`, so the app's stylesheets and their
root-relative URLs load as they do in the app. Tailwind is vendored with the app's own production
recipe (`npm run vendor:tailwind`). `lab.css` is layout only and uses only the app's variables.

**D15. Catalog grid: the app's markup and stylesheets, not `TracksVanillaTable`.** The grid class needs
`window.tracksPage` (103 references) and about 40 app globals. M1 renders `#tracksGrid` with the grid's
own classes (`datatable-row`, `song-name-cell`, `track-name-content`, `song-name-line`) under
`vanilla-table-theme.css`. *Needs review:* if "the same grid" must mean the same class, M2 needs a
`tracksPage` stub — a large adapter.

**D16. Contract package = `index.d.ts` + a small CommonJS file.** The types are the brief's §3.5 verbatim
(checked with `npm run typecheck`); `index.js` holds the runtime constants, and a test keeps both in step.
Engine files carry three fields beyond the contract (`sourceContainerId`, `isFolder`, `classifierReason`);
`sourceContainerId` maps to the wizard's publicFile, the other two are lab-internal. Proposed for 1.1.0.

**D17. `allowedTypes` is empty and `needsReview` uses the wizard's rule** (`confidence < 0.8` or unknown,
library-import-session.cjs:1767) until M2 brings the wizard's file rows through the session adapter.

**D18. Synthetic catalogs are generated, not committed.** Sparse placeholder stand-ins would become real
files in git. The generator is deterministic and writes `<name>.truth.json` (ground truth for M3 metrics)
beside the catalog, outside the scanned folder.
