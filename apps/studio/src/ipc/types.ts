/**
 * Result payloads of the engine projections (`src/studio/projections/*`, `src/studio/review.mjs`) and host
 * commands. The JSON Schema types results as plain objects, so these shapes are hand-written from the
 * projection tests (PJ-*, RV-*, EN-10, RP).
 */
export type BoardRoute = 'light' | 'standard' | 'full';
export type GateStatus = 'missing' | 'stale' | 'approved';
export type Attestation = 'none' | 'valid' | 'invalid';

export interface BoardCard {
  id: string;
  slug: string;
  title: string;
  route: BoardRoute | null;
  tags: string[];
  risk: string | null;
  owner: string | null;
  tasks: { done: number; total: number } | null;
  gates: { required: boolean; 1: GateStatus; 2: GateStatus };
  attestation: Attestation;
  lane: string;
  protected: boolean;
  updatedAt: string;
  suggestedAction?: { command: 'fit'; spec: string };
}

export interface BoardFilters {
  tags: string[];
  risk: string[];
  owner: string[];
}

export interface BoardPayload {
  route: BoardRoute;
  lanes: Array<{ id: string; cards: BoardCard[] }>;
  unrouted: BoardCard[];
  counts: { light: number; standard: number; full: number; unrouted: number };
}

export type EdgeType = 'value' | 'type_only' | 'synthetic';

export interface GraphNode {
  id: number;
  path: string;
  language: string;
  nodeType: string;
  dIn: number;
  dOut: number;
  contractLevel: number;
  isBarrel: boolean;
  externalCount: number;
  unresolvedCount: number;
}

export interface GraphEdge {
  s: number;
  t: number;
  type: EdgeType;
}

export interface GraphPayload {
  indexed: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  cyclesTruncated: boolean;
}

export interface HeatNode {
  id: number;
  path: string;
  distance: number;
  score: number;
  edgeClass: EdgeType;
  viaBarrel?: string;
}

export interface HeatPayload {
  level: string;
  nodes: HeatNode[];
}

export interface DiffHunk {
  id: string;
  header: string;
  text: string;
}

export type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** `null` when the diff is paged (RV-15): the file is fetched on demand with `diff.getFile`. */
  hunks: DiffHunk[] | null;
}

export interface DiffPayload {
  files: DiffFile[];
  paged: boolean;
}

export type BreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN' | 'DEAD_LETTER';

export interface FinopsTask {
  taskId: string;
  state: BreakerState;
  reason: string | null;
  consumedTokens: number;
  remainingBudget: number;
  rateHeadroom: number;
}

export interface FinopsPayload {
  stream: 'streaming' | 'idle';
  tokensPerSecond: number;
  session: { tokens: number };
  tasks: FinopsTask[];
  credentialSource: { kind: 'passthrough' | 'byok' | 'local'; provider: string; costPerToken?: number } | null;
  limits: { tokenBudget: number; maxTokensPerWindow: number; windowMs: number };
}

export interface Skill {
  name: string;
  description: string;
  origin: 'bundled' | 'project';
  path: string;
  enabled: boolean;
  weight: { tokens: number; estimated: true };
  problem: string | null;
}

export interface SkillsPayload {
  items: Skill[];
  activeTokens: number;
  budgetTokens: number;
  budgetShare: number;
}

export type GitMark = 'modified' | 'added' | 'untracked' | 'renamed';

export interface FileNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  git: GitMark | null;
  children?: FileNode[];
}

export interface SpecSummary {
  id: string;
  slug: string;
  title: string;
}

export interface SnapshotPayload {
  schemaVersion: number;
  root: string;
  branch: string;
  versions: { engine: string; node: string; protocol: number };
  activeSpec: (SpecSummary & { tasks: { done: number; total: number } }) | null;
  specs: SpecSummary[];
  routes: Record<string, BoardRoute | null>;
  gates: Record<string, unknown>;
  breakers: { state: BreakerState };
  cartography: { indexed: boolean; summary: Record<string, unknown> };
  memory: { walBytes: number; specsTreeOid: string };
}

export interface RecentProject {
  path: string;
  name: string;
  missing: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Host commands (Rust), next to the engine methods of `generated.ts`. */
export interface HostCommandParams {
  'project.open': { path: string };
  'recent.list': Record<string, never>;
  'engine.stderr': Record<string, never>;
  'pty.open': { cols?: number; rows?: number; shell?: string };
  'pty.write': { id: string; data: string };
  'pty.resize': { id: string; cols: number; rows: number };
  'pty.close': { id: string };
  'fs.rescan': Record<string, never>;
  'window.set_caption_layout': {
    windowWidth: number;
    windowHeight: number;
    captionHeight: number;
    resizeBorder: number;
    minimize: Rect & CaptionRect;
    maximize: Rect & CaptionRect;
    close: Rect & CaptionRect;
  };
}

/** Rust's `window::Rect` uses edges; the frontend sends both forms. */
export interface CaptionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Host → frontend events (Tauri names use `:`; the transport translates). */
export interface HostEventPayloads {
  'pty.output': { id: string; data: string };
  'pty.exit': { id: string; code: number | null };
  'watcher.error': { code: string };
  'engine.state': { code: number; message: string; data?: { code: string; detail: string; retryable: boolean } };
}
