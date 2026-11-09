# Importer Lab

Copyright Producer Dashboard Corp. All rights reserved. Proprietary and confidential.

A separate, **read-only** Mac app that looks through your music folders and drives and shows what it
finds as songs, using The Library's own import code and look. It never changes, moves, uploads or
downloads anything. Spec: `docs/SPEC.md`. Facts about the main app: `docs/INTEGRATION_BRIEF.md`.
Rules for coding agents: `CLAUDE.md`.

Status: **M4.** The new engine groups songs from clues, scores and bands (M2), learns from your marks
and answers (M3), and can ask AI about the songs it cannot place, with a cost cap (M4, off by default).

## Install (no Terminal)

1. Open this repository on GitHub → **Releases** → **Importer Lab … (latest test build)** (tag `lab-latest`).
2. Under **Assets**, click the file ending in **`-universal.dmg`**. It works on Apple silicon and Intel Macs.
3. Open the downloaded `.dmg` and drag **Importer Lab** onto **Applications**.
4. Open **Applications** and double-click **Importer Lab**. The build is not signed yet, so macOS stops it once:
   - **macOS 15 Sequoia or later:** click **Done** in the warning. Open **System Settings → Privacy & Security**,
     scroll to **Security**, find "Importer Lab was blocked…", click **Open Anyway**, enter your password,
     then click **Open Anyway** again.
   - **macOS 14 or earlier:** Control-click **Importer Lab** in Applications, choose **Open**, then **Open**.
5. From then on it opens normally. To update, download the newest `.dmg` and replace the app.

## Using it

1. **Welcome** → **Find my songs**.
2. **Where does your music live?** Tick Music, Desktop, Documents or any drive, drop folders onto the
   window, or click **Add folder…**. Then **Look for songs**.
3. The first time a protected place is read (Desktop, Documents, Downloads, iCloud Drive or a drive),
   the app explains the macOS permission prompt; click **Allow** when macOS asks.
4. Counts and song names appear while it reads. **Cancel** stops at any time.
5. **Your catalog** lists the songs, with the ones to check first at the top. Templates, course
   material, sample packs and stem-only sets are not counted as songs; a button shows them. Click a
   song for its files, the reasons they are together, its versions, stem sets, project facts (tempo,
   length) and songs it might be the same as.
6. **This is wrong** on a song or a file saves a mark in two clicks. **Check songs…** asks for a short
   (10), standard (20) or deep (50) check, then shows a random sample, weighted toward songs to check and songs with several files, one song at a time with
   **Right**, **Wrong**, **Should be split**, **Should be merged…** and **Skip**, plus the closest
   similar entries with a **Same song** button. The answers go in the results file, and Metrics shows
   the confidence they give. If the catalog looks like it holds course material, the app names the
   prefixes and asks once; **Yes** scans again with them set aside. Entries beside a sample pack that
   may or may not belong to it are marked **Review**. **Teach the importer** asks a few questions
   after a scan ("What is Quill? A band, a series, a course, a sample pack, a collaborator, or just a
   word?"); answers and marks (including **Rename**) become rules applied first on the next scan, listed
   under Lab → **Rules**. **Your corrections** there lists every mark that changes the result, with
   **Undo** for one made by mistake. **Not a song…** (in a check, or under "This is wrong") marks a stem
   of another song, a sample, or something else; such files are listed under **Not songs** or in a
   sample pack, never counted as songs, with **It's a song** to put one back. When a small folder holds
   files that look like samples, the app asks once and you tick the samples.
7. **Send results to the team** saves one file (names, counts, marks and timings — no paths, no audio)
   and shows it in Finder, ready to attach to a message.

Getting around: **Back** (top left) on every step, **Home** and **New scan** (top right), and the
**File** menu: **New Scan** (⌘N) and **Open Previous Results…** (⌘O). The home screen lists previous
scans with **Open** and **Delete** (deleting removes only the saved results, never music files).

Team tools (compare with today's importer, scan options, metrics, logs) are hidden: turn on
**Settings → Show Lab tools** (the gear, or ⌘,) and a **Lab** button and menu appear. Scan options:
merge rule (exact identity only, or multi-clue), cloud placeholders (list or leave out), edits as
versions, **Course prefixes** (comma-separated words that mark course material in this catalog), and
**Songs already in your Library** (load a snapshot JSON exported from the app; an empty or malformed
file is refused). Options apply from the next scan. `npm run test:adversarial` runs the main app's six import test files unchanged from the submodule
plus the engine's adversarial cases. **Scan from scratch** reads every file again,
ignoring what earlier scans stored, to time a first scan.

**AI pass** (Lab → Scan options, off by default): asks a model about the songs the engine marks unclear,
nothing else. Only names, dates, sizes, lengths, folder depth, the names of files beside them and the
engine's clues are sent: never a path, audio or account data. An answer never makes a song sure: "same
song as …" becomes the first suggestion on that song (it merges only when the names have the same
identity, the merge rule), and a sure "a song of its own" moves it from unclear to "check". A cost cap
per scan (default $0.50) stops before any call that could pass it, the scan screen shows the cost so
far, and Metrics and Logs show every call (model, tokens, dollars). Answers are kept in the data folder,
so scanning again costs nothing. When only you can settle something, the AI asks you ("Is X the same song as
Y?", "What is Ev?") in the **Teach the importer** window, up to six per scan; your answers become rules.
Models: Claude Haiku 5.5 first, Claude Sonnet 5.5 for a batch where
Haiku is unsure on more than a quarter (both changeable). The key: **Add key…** in the same section
(kept encrypted by the macOS keychain in the lab's folder), or `ANTHROPIC_API_KEY` in an untracked
`.env` file when running from source (see `.env.example`). The key never ships inside the app.

How songs are grouped, and every failure of today's importer the lab fixes, is in `docs/FINDINGS.md`.

## What it writes

Only its own folder: `~/Library/Application Support/Importer Lab/lab-data/` — settings, the scan store
(`evidence.sqlite`), marks (`labels/`), rules (`rules.json`), kept AI answers (`ai-cache.json`), the
encrypted AI key (`ai-key.bin`, only if added) and exported results (`exports/`). Every other write,
rename or delete is blocked by the file-system guard. The window cannot reach the network; the only
network call is the optional AI pass, from the scan worker, to Anthropic's API.

## Builds

`.github/workflows/build-mac.yml` builds a universal `.dmg` and `.zip` with electron-builder on every
push to the working branch (replacing the pre-release `lab-latest`) and on every `v*` tag (a release of
that name). Nothing in the repository names its owner, so moving it to another GitHub account or
organization needs no code change. After a move, check under **Settings → Secrets and variables →
Actions** that the secrets below are still there.

### Access to the main app (private submodule)

The workflow needs read access to `rosscrispin/the-library`. Set **one** of these repository secrets
(**Settings → Secrets and variables → Actions → New repository secret**). If both exist, the deploy key is used.

**Option A — personal access token (current): `THE_LIBRARY_TOKEN`**
A classic token from an account that can read `rosscrispin/the-library`, with the `repo` scope
(GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Tokens (classic)**).
Classic tokens cannot be limited to reading one repository, so prefer option B for the long term.

**Option B — read-only deploy key: `THE_LIBRARY_DEPLOY_KEY`**
1. On any Mac, make a key pair (one command in Terminal; nothing is uploaded):
   `ssh-keygen -t ed25519 -N "" -C "importer-lab CI (read-only)" -f importer-lab-deploy-key`
   This creates `importer-lab-deploy-key` (private) and `importer-lab-deploy-key.pub` (public).
2. **Ross**, on github.com: `rosscrispin/the-library` → **Settings → Deploy keys → Add deploy key**.
   Title: `Importer Lab CI (read-only)`. Key: paste the whole contents of `importer-lab-deploy-key.pub`.
   Leave **Allow write access** unticked. Click **Add key**.
3. **An admin of this repository**, on github.com: this repository → **Settings → Secrets and variables →
   Actions → New repository secret**. Name: `THE_LIBRARY_DEPLOY_KEY`. Secret: paste the whole contents of
   `importer-lab-deploy-key` (from `-----BEGIN OPENSSH PRIVATE KEY-----` to the `END` line). Click **Add secret**.
4. Delete the local key files, then delete the `THE_LIBRARY_TOKEN` secret. The next push uses the key.

Only the public half ever goes to Ross; the private half goes only into this repository's secret.

### Signing and notarisation (off until the secrets exist)

Builds are unsigned (with an ad-hoc signature, so Apple silicon Macs can open them after **Open Anyway**).
To ship signed and notarised builds, add these repository secrets, then the repository **variable**
`MAC_SIGNING` = `on` (**Settings → Secrets and variables → Actions → Variables**):

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | The "Developer ID Application" certificate exported from Keychain Access as a `.p12`, base64-encoded |
| `MAC_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_ID` | The Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (account.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | The 10-character Team ID (developer.apple.com → Membership) |

With `MAC_SIGNING` = `on` the workflow signs with hardened runtime (`build/entitlements.mac.plist`)
and notarises; without it, it never reads those secrets.

## Development

```bash
git clone <this repository's URL>
cd importer-lab
git submodule update --init
npm install
npm test
npm run lab
```

| Command | What it does |
| --- | --- |
| `npm run lab` | Start the lab from source |
| `npm test` | All tests, on Electron's own Node (24.18.0) |
| `npm run scan -- <folder>... [--groups] [--skip-placeholders] [--ai[=<cap>]]` | Headless scan, same worker and guard; `--ai` uses the key from `.env` |
| `npm run fixtures` | Write the synthetic catalog to `fixtures/synthetic/out/` (git-ignored) |
| `npm run dist:mac` | Build the macOS `.dmg` and `.zip` locally (on a Mac) |
| `npm run dist:dir` | Build an unpacked app for the current platform (packaging smoke test) |
| `npm run typecheck` | Check the contract types |
| `npm run vendor:tailwind` / `npm run vendor:fonts` | Rebuild the offline Tailwind copy / Inter font files |
| `npm run electron:versions` | Print Electron/Node/Chromium/SQLite versions and check node:sqlite |

## Layout

```
packages/contract/       contract 1.0.0 (types + runtime constants)
packages/import-engine/  the engine: crawler, placeholder detector, adapters around the app's modules
apps/lab/                Electron shell: guard, SQLite store, scan worker, screens
vendor/the-library/      main app, git submodule pinned to f5af21c7 — never edited
fixtures/synthetic/      catalog generator (output is never committed)
fixtures/adversarial/    cases from the main repo's import tests (M3)
labels/                  marks per real catalog, from exported results (M3)
build/                   macOS entitlements (used only when signing is on)
docs/                    spec, brief, conflicts, decisions, patches
```

## License

Copyright Producer Dashboard Corp. All rights reserved. Proprietary and confidential. See `LICENSE`.
The vendored Inter typeface is under the SIL Open Font License 1.1.
