# fixtures/adversarial/

Milestone M3's adversarial set (docs/INTEGRATION_BRIEF.md §6.3).

**The main app's six import test files run unchanged from the pinned submodule** — they are not
copied here. Copying would mean editing their relative imports, and the lab never copies-and-edits a
main-app file (CLAUDE.md). `npm test` runs them with Electron's own Node, from
`vendor/the-library/tests/unit/`:

- `import-canonical-identity.test.js` (the three-Sky regression)
- `import-assignment-gate-contract.test.js`
- `hybrid-grouper.test.js`
- `track-name-identity-parity.test.js`
- `external-folder-import.test.js`
- `ai-grouping-authoritative-scope.test.js` (for M4)

`npm run test:adversarial` runs just these plus the engine's adversarial tests.

**The engine's own adversarial tests** are in `packages/import-engine/test/adversarial.test.js` (the
AMG-FN-001 negatives: repeated silence, samples reused across songs, copied project templates,
different songs with the same title, intentionally separate versions), next to the four must-pass
cases (`group.test.js`) and the findings cases (`fixtures/cases/`).

Note: `tests/unit/adversarial-track-group-matching.test.mjs` in the main repo is about earnings, not
import, and is not part of this set.
