// @importer-lab/contract — types only, no build step.
// 1.0.0 was copied verbatim from docs/INTEGRATION_BRIEF.md §3.5 (the rewritten contract v1).
// 1.1.0 adds optional fields only (marked "1.1.0"): every 1.0.0 consumer keeps working.
// Runtime constants live in index.js. Check with: npm run typecheck
// contract v1.1.0 — semver; any breaking change bumps the major version

// CHANGED from spec: plural, matching tracks.file_type convention, plus 'videos' (IMP-FN-033)
export type FileType = "bounces" | "stems" | "projects" | "videos" | "unknown";

export interface ScanRequest {
  roots: string[];
  existingSongs?: ExistingSong[];
  options: {
    followSymlinks: false; // fixed in v1 — correct, see Traps (ESYMLINK_CONTENT)
    includeCloudPlaceholders: "skip" | "list"; // XX needs Adapter 9; app cannot tell placeholder from 0-byte
    ai: { enabled: boolean; maxCostUsd: number; model: string };
    mergeRule: "exact-identity-only" | "multi-clue";
    identityPolicyVersion: string; // ADDED — required to A/B the normalizer reconciliation
    groupEdits?: boolean; // 1.1.0 — short/long/track edits are versions of one song (default true)
    catalogRules?: { courseNamespaces?: string[] }; // 1.1.0 — prefixes that mark course material
  };
}

// CONFIRMED against public/components/header.js:4194 and the track_groups DDL
export interface ExistingSong {
  id: string; // uuid — track_groups.id, immutable, the ONLY legal match target
  songName: string; // track_groups.song_name, varchar(500) NOT NULL
  displayName: string; // track_groups.display_name, text NOT NULL DEFAULT '' (not optional)
  dropboxFolderPath?: string | null;
  hasBounce: boolean; // ADDED — needed for anchor/dependent classification
  hasStems: boolean;
  hasProject: boolean;
  // XX no field carries canonical identity; compute via
  //    canonicalSongIdentity(displayName || songName) — never with a different token policy
}

export interface ProposedCatalog {
  contractVersion: "1.0.0" | "1.1.0";
  engineVersion: string;
  policyVersion: string;
  songs: ProposedSong[];
  unassigned: ProposedFile[];
  duplicates: DuplicateSet[];
  baseline: BaselineResult; // today's importer, preserveSourceIdentity: true (the engine's target)
  baselineStripPrefixes?: BaselineResult; // 1.1.0 — today's importer, preserveSourceIdentity: false
  stats: ScanStats;
}

// 1.1.0 — what a proposed item is; only "song" counts as a song.
export type SongKind = "song" | "template" | "course" | "sample-pack" | "stem-set";

// 1.1.0 — files of one song that share a version label ("Final Master 1.1", "Pitched").
export interface VersionGroup {
  label: string;
  fileIds: string[];
}

// 1.1.0 — another song this one may be; proposed for review, never merged automatically.
export interface PossibleMatch {
  proposalId: string;
  songName: string;
  reason: string;
}

export interface ProposedSong {
  proposalId: string;
  songName: string; // -> track_groups.song_name, varchar(500) NOT NULL. CONFIRMED
  displayName: string; // ADDED -> track_groups.display_name, text NOT NULL DEFAULT ''
  canonicalIdentity: string; // ADDED — the merge key; MUST come from canonicalSongIdentity()
  existingSongId?: string; // -> publicGroup.targetTrackGroupId; immutable id only (IMP-FN-032-R5)
  band: "sure" | "unsure" | "unclear";
  confidence: number; // XX keep separate from publicFile.confidence — see note 2 below
  reasons: Reason[];
  files: ProposedFile[];
  stemSets: StemSet[];
  facts: { bpm?: number; key?: string; lengthSec?: number };
  // -> track_groups.bpm integer, .key text, .duration_seconds integer
  // XX bpm is INTEGER in the DB; a float tempo from .als must round
  decidedBy: "rules" | "ai";
  isAnchor: boolean; // ADDED — isAnchorGroup(): one or more bounce/project (IMP-FN-007-R14)
  kind?: SongKind; // 1.1.0
  namespace?: string | null; // 1.1.0 — client, collaborator or series prefix
  versions?: VersionGroup[]; // 1.1.0
  possibleMatches?: PossibleMatch[]; // 1.1.0
  precheck?: boolean; // 1.1.0 — an unsure song pre-checked for review (confidence >= 0.85)
}

export interface ProposedFile {
  fileId: string;
  path: string; // XX engine-local ONLY. IMP-FN-032-R3 forbids paths reaching the
  //    renderer at all, not just AI. UI must use sourceRelativePath.
  sourceRelativePath: string; // ADDED — what the UI and the wizard may see
  name: string;
  type: FileType; // CHANGED: plural; 'other' -> 'unknown'; 'videos' added
  ext: string;
  sizeBytes: number;
  durationMs?: number; // XX tracks.duration is INTEGER SECONDS, not ms
  createdAt?: string; // XX birthtime unreliable after cross-volume copies
  modifiedAt?: string; // -> tracks.file_modified_at
  sha256?: string;
  latest?: boolean; // cf. track_groups.default_bounce_track_id
  confidence: number; // XX the wizard treats 0.5 as a literal placeholder (IMP-FN-019-R19)
  reasons: Reason[];
  cloudPlaceholder?: boolean; // XX see Adapter 9
  needsReview: boolean; // ADDED -> publicFile.needsReview; starts unchecked (IMP-FN-032-R3)
  allowedTypes: FileType[]; // ADDED -> publicFile.allowedTypes
  sourceContainerId?: string | null; // 1.1.0 -> publicFile.sourceContainerId
  versionLabel?: string | null; // 1.1.0 — the words set aside from the title ("Final Master 1.1")
  stemPart?: string | null; // 1.1.0 — for a stem, the part ("Woodwinds")
}

export interface Reason {
  clue:
    | "canonical-name"
    | "folder"
    | "timing"
    | "project-contents"
    | "shared-samples"
    | "duplicate"
    | "stem-set"
    | "ai"
    | "user-rule";
  weight: number;
  text: string;
}

export interface StemSet {
  label: string;
  matchesFileId?: string;
  files: ProposedFile[];
}
export interface DuplicateSet {
  sha256: string;
  keepFileId: string;
  copies: string[];
}

export interface BaselineResult {
  groups: { songName: string; fileIds: string[] }[];
  // ADDED — hybridGroupFiles() returns these and the comparison screen needs them
  reviewItems: unknown[];
  tier3Candidates: { filename: string; identity: string; groupName: string }[];
  stats: {
    total: number;
    nsCount: number;
    mergeCount: number;
    groupCount: number;
    tier3Count: number;
  };
}

export interface ScanStats {
  files: number;
  songs: number;
  autoMatchedShare: number;
  durationMs: number;
  aiCostUsd: number;
  cappedAt?: number | null; // ADDED — the walkFolder baseline reports a file cap
  placeholdersSkipped: number; // ADDED
}

export declare const CONTRACT_VERSION: "1.1.0";
export declare const SONG_KINDS: readonly SongKind[];
export declare const FILE_TYPES: readonly FileType[];
export declare const BANDS: readonly ProposedSong["band"][];
export declare const CLUES: readonly Reason["clue"][];
