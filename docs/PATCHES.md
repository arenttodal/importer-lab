# Patches proposed to the main repo

The lab never edits `vendor/the-library`. When it needs something the app does not offer, the change is
proposed here for Ross to review, then lands in the main repo, then the pin moves.

## P1 — Export walkFolder's per-folder rules (IMP-FN-023)

**File:** `electron/external-folder-import.js`
**Why:** the lab crawls with no depth limit (SPEC step 1) but must treat folders exactly as `walkFolder`
does. `isGenuineProjectWrapper` is reachable through `findProjectFolderForPath(dir, { maxAncestors: 1 })`,
but `sourceCategoryForFolder` (Bounces/Stems/Projects → source category) is not reachable at all, so the
lab mirrors it (DECISIONS D6).
**Change:** add `sourceCategoryForFolder` and `isGenuineProjectWrapper` to `module.exports`. No behaviour
change. Spec touch: IMP_SPEC.md review marker; `@version` bump.
**Lab follow-up:** delete the mirror in `packages/import-engine/src/adapters/walker.js`; keep the parity test.

## P2 — Cloud placeholder detection (offered back, per SPEC)

**Files:** `electron/local-file-scanner.js` (`inspectProjectContentReadiness`)
**Why:** today's check is `size === 0`, which cannot tell an empty file from an undownloaded one
(brief 2.6). The lab's detector (`packages/import-engine/src/placeholder.js`): `size > 0 && blocks === 0`
is a candidate; on macOS `stat -f %Sf` confirms `dataless`.
**Status:** to propose once it has run on a real catalog with many placeholders (SPEC test catalog list).

## P3 — One list of category prefixes

**Files:** `electron/local-lcp-grouper.js` (`CATEGORY_PREFIXES`, IMP-FN-017, line 661) and the import name cleaners.
**Why:** the list lives in one module and import paths apply it unevenly (FINDINGS row 15). The lab keeps
one list in `policy/names-v1.json` (the app's words plus idea/sample words seen on a real catalog).
**Proposal:** export the list from one module and use it in every cleaner.
**Status:** to propose after M3 accuracy on labelled catalogs.

## P4 — Name policy for the app (FINDINGS rows 2, 4–6, 12–17, 22–27)

**Files:** `canonicalSongIdentity()`, `normalizeFilename()`.
**Why:** the two cleaners disagree (row 4), keep stage, render, format and tech words (rows 2, 5, 6, 22,
23, 25), and strip dates and two-digit numbers that identify different songs (rows 26, 27).
**Proposal:** one cleaner built from `lab-names-1` once M3 shows the accuracy target on real catalogs: the
recorded removals become version labels, generic and day-named titles keep their number or date, and
bare numbers join a song only with the plain title or within one folder.
**Status:** draft; the lab's policy file and tests are the reference.

## P5 — Log the cost of every AI call (FINDINGS row 11)

`POST /api/import/ai-review` (IMP-FN-016) keeps only an estimate (R16). Proposal: after each OpenRouter call,
write one record per call (user id, model, prompt and completion tokens from the response's `usage`, cost,
duration) and refuse a call once a per-user monthly cap would be passed. The lab's meter
(`packages/import-engine/src/ai/pricing.js`, `pass.js`) shows the shape: price from reported usage, worst
case checked before the call.

## Already scheduled by the spec (not lab patches)

- Generic titles ("Untitled N", "New Project N", "Track N") merge into one song — port `GENERIC_TITLES`
  into import (SPEC "Fix in the main app now", Ross).
- "Radio edit" leaves the fragment "radio".
- Reconcile `normalizeFilename()` and `canonicalSongIdentity()` (brief 2.3); the lab pins to that commit.
