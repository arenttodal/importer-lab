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

## Already scheduled by the spec (not lab patches)

- Generic titles ("Untitled N", "New Project N", "Track N") merge into one song — port `GENERIC_TITLES`
  into import (SPEC "Fix in the main app now", Ross).
- "Radio edit" leaves the fragment "radio".
- Reconcile `normalizeFilename()` and `canonicalSongIdentity()` (brief 2.3); the lab pins to that commit.
