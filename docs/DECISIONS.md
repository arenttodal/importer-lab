# Decisions log

Newest first. Each entry: what was decided, why, and what would change it. Conflicts between the spec
and the brief are in `docs/CONFLICTS.md`; this log records how the build resolved them.

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
