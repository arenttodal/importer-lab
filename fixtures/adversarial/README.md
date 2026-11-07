# fixtures/adversarial/

Milestone M3: the six import test files named in `docs/INTEGRATION_BRIEF.md` §6.3, copied from the main
repo at the pinned commit (with their source commit recorded), plus the spec's four must-pass cases:

1. `Untitled 14.als` and `Untitled 37.als` stay separate.
2. `MG X JC - SKY FINAL.wav` joins Sky.
3. Stems follow their bounce when a collaborator prefix is removed.
4. The three-Sky case still holds.

Note: `tests/unit/adversarial-track-group-matching.test.mjs` in the main repo is about earnings, not
import, and is not part of this set.
