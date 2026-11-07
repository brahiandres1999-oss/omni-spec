/**
 * Payload builders and DOM stubs for the Omni Studio frontend tests.
 *
 * Shapes mirror the engine projections exercised by `test/studio-projections.test.mjs` (board, graph,
 * finops, skills, files) and `test/studio-review.test.mjs` (diff/review), plus `project.snapshot` (EN-10).
 * Fields the engine tests do not pin are marked "assumed" and listed in the RED-phase report.
 */
import { vi } from 'vitest';
import type { FakeTransport, InvokeArgs, RpcErrorPayload } from './fake-transport';

// ---------------------------------------------------------------------------------------------------------
// UI copy pinned by the plan / blueprint (exact strings)
// ---------------------------------------------------------------------------------------------------------

/** Blueprint §4.7.3 — Protected state for Gate 2 (FS Protected, VD-07, E2E-09). */
export const GATE2_TEXT =
  'Compuerta 2 Bloqueada: Se requiere la atestación criptográfica HMAC de las pruebas unitarias y la verificación de 0 regresiones antes de autorizar el commit';

/** SH-09 — dock without an active terminal. */
export const DOCK_PROTECTED_TEXT = 'Abre una terminal con tu agente (claude, gemini, agy…) para enviar instrucciones';

/** Blueprint §4.7.3 — Error state retry CTA. */
export const RETRY_LABEL = 'Reintentar Operación';

/** Empty-state CTAs per view: label → dispatched StudioAction. Board CTAs are the blueprint's; the rest are assumed. */
export const EMPTY_CTAS = {
  board: [
    { label: 'Crear Hotfix Micro (--light)', action: { type: 'spec.hotfix' } },
    { label: 'Iniciar Nueva Especificación', action: { type: 'spec.new' } },
    { label: 'Escanear Proyecto Brownfield', action: { type: 'project.scan' } },
  ],
  cartography: [{ label: 'Escanear Proyecto Brownfield', action: { type: 'project.scan' } }],
  diff: [{ label: 'Volver al Tablero', action: { type: 'stage.open', tab: 'kanban' } }],
  finops: [{ label: 'Abrir Terminal', action: { type: 'inspector.open', tab: 'terminal' } }],
  skills: [{ label: 'Reescanear Skills', action: { type: 'skills.rescan' } }],
} as const;

// ---------------------------------------------------------------------------------------------------------
// Errors (EN-12: error.data = { code, detail, retryable })
// ---------------------------------------------------------------------------------------------------------

export function rpcError(code: string, detail: string, retryable = false): RpcErrorPayload {
  return { code: -32000, message: detail, data: { code, detail, retryable } };
}

export const gateLocked = (reason: string): RpcErrorPayload => rpcError('GATE_LOCKED', reason, false);

// ---------------------------------------------------------------------------------------------------------
// Board (PJ-BRD)
// ---------------------------------------------------------------------------------------------------------

export type BoardRoute = 'light' | 'standard' | 'full';
export type GateStatus = 'missing' | 'stale' | 'approved';

export const BOARD_LANES: Readonly<Record<BoardRoute, readonly string[]>> = {
  light: ['backlog', 'running', 'verified'],
  standard: ['specification', 'tasks', 'implementation', 'verification'],
  full: ['specification', 'gate-1', 'tasks', 'implementation', 'gate-2', 'closed'],
};

/** Visible lane titles (PJ-BRD-01..03). */
export const LANE_TITLES: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  running: 'En ejecución',
  verified: 'Verificado',
  specification: 'Especificación',
  tasks: 'Tareas',
  implementation: 'Implementación',
  verification: 'Verificación',
  'gate-1': 'Revisión Blast Radius (Compuerta 1)',
  'gate-2': 'Verificación HMAC y Diff (Compuerta 2)',
  closed: 'Cerrado',
};

export interface CardPayload {
  id: string;
  slug: string;
  title: string;
  route: BoardRoute | null;
  tags: string[];
  risk: string | null;
  owner: string | null;
  tasks: { done: number; total: number } | null;
  gates: { required: boolean; 1: GateStatus; 2: GateStatus };
  /** assumed values besides 'invalid' (PJ-BRD-06): 'none' | 'valid' | 'invalid' */
  attestation: 'none' | 'valid' | 'invalid';
  lane: string;
  protected: boolean;
  updatedAt: string;
}

export interface BoardPayload {
  route: BoardRoute;
  lanes: Array<{ id: string; cards: CardPayload[] }>;
  unrouted: Array<CardPayload & { suggestedAction: { command: 'fit'; spec: string } }>;
  counts: { light: number; standard: number; full: number; unrouted: number };
}

export function card(overrides: Partial<CardPayload> = {}): CardPayload {
  const id = overrides.id ?? '001';
  return {
    id,
    slug: `${id}-change`,
    title: 'Change',
    route: 'standard',
    tags: [],
    risk: null,
    owner: null,
    tasks: null,
    gates: { required: false, 1: 'missing', 2: 'missing' },
    attestation: 'none',
    lane: 'specification',
    protected: false,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

export function board(route: BoardRoute, cards: CardPayload[] = []): BoardPayload {
  const lanes = BOARD_LANES[route].map(id => ({ id, cards: [] as CardPayload[] }));
  for (const entry of cards) {
    const lane = lanes.find(candidate => candidate.id === entry.lane);
    if (!lane) throw new Error(`fixture: lane "${entry.lane}" does not exist on route "${route}"`);
    lane.cards.push(entry);
  }
  const counts = { light: 0, standard: 0, full: 0, unrouted: 0 };
  counts[route] = cards.length;
  return { route, lanes, unrouted: [], counts };
}

/** Default standard board: 001 and 002 in specification (001 newest), 003 in tasks. */
export function defaultCards(): CardPayload[] {
  return [
    card({
      id: '001',
      slug: '001-memory',
      title: 'Memory',
      lane: 'specification',
      tags: ['ui'],
      risk: 'high',
      owner: 'ana',
      updatedAt: '2026-11-03T00:00:00.000Z',
    }),
    card({
      id: '002',
      slug: '002-guardian',
      title: 'Guardian',
      lane: 'specification',
      tags: ['ui', 'db'],
      risk: 'low',
      owner: 'ana',
      updatedAt: '2026-11-02T00:00:00.000Z',
    }),
    card({
      id: '003',
      slug: '003-carto',
      title: 'Carto',
      lane: 'tasks',
      tags: ['db'],
      risk: 'high',
      owner: 'luis',
      tasks: { done: 0, total: 3 },
    }),
  ];
}

export function defaultBoard(route: BoardRoute = 'standard'): BoardPayload {
  if (route === 'standard') return board('standard', defaultCards());
  if (route === 'light')
    return board('light', [card({ id: '010', slug: '010-hotfix', title: 'Hotfix', route: 'light', lane: 'backlog' })]);
  return board('full', [
    card({
      id: '004',
      slug: '004-payments',
      title: 'Payments',
      route: 'full',
      lane: 'gate-1',
      gates: { required: true, 1: 'missing', 2: 'missing' },
      tasks: { done: 0, total: 4 },
    }),
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// Graph (PJ-GRF)
// ---------------------------------------------------------------------------------------------------------

export type EdgeType = 'value' | 'type_only' | 'synthetic';

export interface GraphNodePayload {
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

export interface GraphPayload {
  indexed: boolean;
  nodes: GraphNodePayload[];
  edges: Array<{ s: number; t: number; type: EdgeType }>;
  cycles: string[][];
  cyclesTruncated: boolean;
}

export interface HeatPayload {
  level: string;
  nodes: Array<{ id: number; path: string; distance: number; score: number; edgeClass: EdgeType; viaBarrel?: string }>;
}

export function graphNode(overrides: Partial<GraphNodePayload> & { id: number; path: string }): GraphNodePayload {
  return {
    language: 'typescript',
    nodeType: 'leaf',
    dIn: 0,
    dOut: 0,
    contractLevel: 0,
    isBarrel: false,
    externalCount: 0,
    unresolvedCount: 0,
    ...overrides,
  };
}

/** The PJ-GRF fixture project: core ← a (value), core ← b (type_only), index barrel, app. */
export function graph(): GraphPayload {
  return {
    indexed: true,
    nodes: [
      graphNode({ id: 0, path: 'src/a.ts', dIn: 1, dOut: 1 }),
      graphNode({ id: 1, path: 'src/app.ts', dOut: 1, externalCount: 1, unresolvedCount: 1 }),
      graphNode({ id: 2, path: 'src/b.ts', dIn: 1, dOut: 1 }),
      graphNode({ id: 3, path: 'src/core.ts', dIn: 2, contractLevel: 1 }),
      graphNode({ id: 4, path: 'src/index.ts', dIn: 1, dOut: 2, isBarrel: true }),
    ],
    edges: [
      { s: 0, t: 3, type: 'value' },
      { s: 2, t: 3, type: 'type_only' },
      { s: 4, t: 0, type: 'value' },
      { s: 4, t: 2, type: 'value' },
      { s: 1, t: 4, type: 'synthetic' },
    ],
    cycles: [],
    cyclesTruncated: false,
  };
}

export const emptyGraph = (): GraphPayload => ({
  indexed: false,
  nodes: [],
  edges: [],
  cycles: [],
  cyclesTruncated: false,
});

export function heat(): HeatPayload {
  return {
    level: 'medium',
    nodes: [
      { id: 1, path: 'src/app.ts', distance: 3, score: 20, edgeClass: 'value', viaBarrel: 'src/index.ts' },
      { id: 0, path: 'src/a.ts', distance: 1, score: 70, edgeClass: 'value' },
      { id: 4, path: 'src/index.ts', distance: 2, score: 45, edgeClass: 'value' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------
// Diff / review (RV)
// ---------------------------------------------------------------------------------------------------------

export interface DiffHunkPayload {
  /** sha256 hex (RV-05) */
  id: string;
  header: string;
  /** Hunk body lines (' ', '-', '+' prefixed), WITHOUT the @@ header line (assumed). */
  text: string;
}

export interface DiffFilePayload {
  path: string;
  oldPath: string | null;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunkPayload[] | null;
}

export interface DiffPayload {
  files: DiffFilePayload[];
  paged: boolean;
}

/** Deterministic 64-hex id for a label (stands in for sha256 in fixtures). */
export function hunkId(label: string): string {
  let hash = 0x811c9dc5;
  let out = '';
  for (let round = 0; out.length < 64; round++) {
    for (const char of `${label}#${round}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += hash.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

/** One hunk replacing line `at` of a numbered file, with 3 lines of context (RV threeHunks). */
function changeHunk(at: number, replacement: string, idLabel: string): DiffHunkPayload {
  const start = at - 3;
  const body: string[] = [];
  for (let line = start; line < at; line++) body.push(` line ${line}`);
  body.push(`-line ${at}`, `+${replacement}`);
  for (let line = at + 1; line <= at + 3; line++) body.push(` line ${line}`);
  return { id: hunkId(idLabel), header: `@@ -${start},7 +${start},7 @@`, text: body.join('\n') };
}

/** RV threeHunks(): a 60-line file edited at lines 5, 30 and 55. `variant` changes hunk 2 only. */
export function threeHunkFile(path = 'src/app.txt', variant: 'base' | 'edited-second' = 'base'): DiffFilePayload {
  const second =
    variant === 'base'
      ? changeHunk(30, 'changed 30', `${path}:2`)
      : changeHunk(30, 'changed thirty', `${path}:2:edited`);
  return {
    path,
    oldPath: null,
    status: 'modified',
    additions: 3,
    deletions: 3,
    binary: false,
    hunks: [changeHunk(5, 'changed 5', `${path}:1`), second, changeHunk(55, 'changed 55', `${path}:3`)],
  };
}

export function binaryFile(path = 'assets/logo.bin'): DiffFilePayload {
  return { path, oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: true, hunks: [] };
}

/** One added file of `lines` lines (RV-15 / VD-01). */
export function bigFile(lines = 10_000, path = 'src/big.txt'): DiffFilePayload {
  const body = Array.from({ length: lines }, (_, index) => `+edited ${index + 1}`).join('\n');
  return {
    path,
    oldPath: null,
    status: 'added',
    additions: lines,
    deletions: 0,
    binary: false,
    hunks: [{ id: hunkId(`${path}:big`), header: `@@ -0,0 +1,${lines} @@`, text: body }],
  };
}

export const diff = (files: DiffFilePayload[] = [threeHunkFile()]): DiffPayload => ({ files, paged: false });

// ---------------------------------------------------------------------------------------------------------
// FinOps (PJ-FIN)
// ---------------------------------------------------------------------------------------------------------

export type BreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN' | 'DEAD_LETTER';

export interface FinopsTaskPayload {
  taskId: string;
  state: BreakerState;
  reason: string | null;
  /** assumed (breaker snapshot consumedTokens) */
  consumedTokens: number;
  remainingBudget: number;
  rateHeadroom: number;
}

export interface FinopsPayload {
  stream: 'streaming' | 'idle';
  tokensPerSecond: number;
  session: { tokens: number };
  tasks: FinopsTaskPayload[];
  credentialSource: { kind: 'passthrough' | 'byok' | 'local'; provider: string; costPerToken?: number } | null;
  /** assumed additive field: BREAKER_DEFAULTS echoed so the UI never hard-codes them */
  limits: { tokenBudget: number; maxTokensPerWindow: number; windowMs: number };
}

export const BREAKER_LIMITS = { tokenBudget: 80_000, maxTokensPerWindow: 25_000, windowMs: 60_000 } as const;

export function finopsTask(overrides: Partial<FinopsTaskPayload> & { taskId: string }): FinopsTaskPayload {
  return {
    state: 'CLOSED',
    reason: null,
    consumedTokens: 20_000,
    remainingBudget: BREAKER_LIMITS.tokenBudget - 20_000,
    rateHeadroom: BREAKER_LIMITS.maxTokensPerWindow - 20_000,
    ...overrides,
  };
}

export function finops(overrides: Partial<FinopsPayload> = {}): FinopsPayload {
  return {
    stream: 'streaming',
    tokensPerSecond: 142,
    session: { tokens: 21_000 },
    tasks: [finopsTask({ taskId: 'T-1' })],
    credentialSource: { kind: 'passthrough', provider: 'claude' },
    limits: { ...BREAKER_LIMITS },
    ...overrides,
  };
}

/** No credential source and no activity: the FinOps Empty state (assumed; VF-06 idle keeps a source). */
export const emptyFinops = (): FinopsPayload =>
  finops({ stream: 'idle', tokensPerSecond: 0, session: { tokens: 0 }, tasks: [], credentialSource: null });

// ---------------------------------------------------------------------------------------------------------
// Skills (PJ-SKL)
// ---------------------------------------------------------------------------------------------------------

export interface SkillPayload {
  name: string;
  description: string;
  origin: 'bundled' | 'project';
  path: string;
  enabled: boolean;
  weight: { tokens: number; estimated: true };
  problem: string | null;
}

export interface SkillsPayload {
  items: SkillPayload[];
  activeTokens: number;
  budgetTokens: number;
  budgetShare: number;
}

export function skill(overrides: Partial<SkillPayload> & { name: string }): SkillPayload {
  return {
    description: `${overrides.name} description`,
    origin: 'bundled',
    path: `skills/${overrides.name}/SKILL.md`,
    enabled: true,
    weight: { tokens: 1_000, estimated: true },
    problem: null,
    ...overrides,
  };
}

export function skills(items: SkillPayload[] = defaultSkills(), budgetTokens = 200_000): SkillsPayload {
  const activeTokens = items.filter(item => item.enabled).reduce((sum, item) => sum + item.weight.tokens, 0);
  return { items, activeTokens, budgetTokens, budgetShare: activeTokens / budgetTokens };
}

/** Server order (alphabetical). Active = 25.000 + 12.500 = 37.500 of 200.000 (18,75 %). */
export function defaultSkills(): SkillPayload[] {
  return [
    skill({
      name: 'broken',
      origin: 'project',
      path: '.claude/skills/broken/SKILL.md',
      enabled: false,
      weight: { tokens: 5, estimated: true },
      problem: 'FRONTMATTER_MISSING',
    }),
    skill({
      name: 'house-style',
      origin: 'project',
      path: '.claude/skills/house-style/SKILL.md',
      enabled: false,
      weight: { tokens: 40_000, estimated: true },
    }),
    skill({ name: 'omni-audit', weight: { tokens: 12_500, estimated: true } }),
    skill({ name: 'omni-specify', weight: { tokens: 25_000, estimated: true } }),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Files (PJ-FIL), snapshot (EN-10), recent projects (RP)
// ---------------------------------------------------------------------------------------------------------

export interface FileNodePayload {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  git: 'modified' | 'added' | 'untracked' | 'renamed' | null;
  children?: FileNodePayload[];
}

export function fileTree(extraFiles = 0): FileNodePayload {
  const filler = Array.from({ length: extraFiles }, (_, index) => {
    const name = `zz-file-${String(index).padStart(4, '0')}.ts`;
    return { name, path: name, kind: 'file' as const, git: null };
  });
  return {
    name: '',
    path: '',
    kind: 'dir',
    git: null,
    children: [
      {
        name: 'src',
        path: 'src',
        kind: 'dir',
        git: null,
        children: [{ name: 'app.txt', path: 'src/app.txt', kind: 'file', git: 'modified' }],
      },
      { name: 'CHANGELOG.md', path: 'CHANGELOG.md', kind: 'file', git: 'modified' },
      { name: 'README.md', path: 'README.md', kind: 'file', git: null },
      ...filler,
    ],
  };
}

export interface SnapshotPayload {
  schemaVersion: 1;
  root: string;
  branch: string;
  versions: { engine: string; node: string; protocol: number };
  /** assumed: tasks counter of the active spec for the Overview tab (SH-11) */
  activeSpec: { id: string; slug: string; title: string; tasks: { done: number; total: number } } | null;
  specs: Array<{ id: string; slug: string; title: string }>;
  routes: Record<string, BoardRoute | null>;
  gates: Record<string, unknown>;
  /** assumed: worst breaker state across tasks */
  breakers: { state: BreakerState };
  cartography: { indexed: boolean; summary: Record<string, unknown> };
  memory: { walBytes: number; specsTreeOid: string };
}

export const TREE_OID = 'abcdef1234567890abcdef1234567890abcdef12';

export function snapshot(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    schemaVersion: 1,
    root: 'C:/dev/omni-spec',
    branch: 'feat/nextgen-phase4-omni-studio',
    versions: { engine: '0.8.1', node: '24.22.1', protocol: 1 },
    activeSpec: { id: '001', slug: '001-memory', title: 'Memory', tasks: { done: 4, total: 7 } },
    specs: [
      { id: '001', slug: '001-memory', title: 'Memory' },
      { id: '002', slug: '002-guardian', title: 'Guardian' },
      { id: '003', slug: '003-carto', title: 'Carto' },
    ],
    routes: { '001-memory': 'standard', '002-guardian': 'standard', '003-carto': 'standard' },
    gates: {},
    breakers: { state: 'CLOSED' },
    cartography: { indexed: true, summary: {} },
    memory: { walBytes: 0, specsTreeOid: TREE_OID },
    ...overrides,
  };
}

export interface RecentProjectPayload {
  path: string;
  name: string;
  missing: boolean;
}

export const recentProjects = (): RecentProjectPayload[] => [
  { path: 'C:/dev/omni-spec', name: 'omni-spec', missing: false },
  { path: 'C:/dev/omnipage', name: 'omnipage', missing: false },
];

// ---------------------------------------------------------------------------------------------------------
// Default script: every read the shell may issue answers with a ready payload
// ---------------------------------------------------------------------------------------------------------

export function scriptStudio(fake: FakeTransport): FakeTransport {
  const route = (args: InvokeArgs): BoardRoute => {
    const value = args.route;
    return value === 'light' || value === 'full' ? value : 'standard';
  };
  return fake
    .respond('project.snapshot', snapshot())
    .respond('recent.list', recentProjects())
    .respond('project.open', (args: InvokeArgs) => snapshot({ root: String(args.path) }))
    .respond('board.get', (args: InvokeArgs) => defaultBoard(route(args)))
    .respond('cartography.graph', graph())
    .respond('blastRadius.heat', heat())
    .respond('diff.get', diff([threeHunkFile(), threeHunkFile('CHANGELOG.md')]))
    .respond('diff.getFile', (args: InvokeArgs) => threeHunkFile(String(args.path)))
    .respond('review.decideHunk', (args: InvokeArgs) => ({ hunkId: args.hunkId, decision: args.decision }))
    .respond('review.stageApproved', { staged: 0 })
    .respond('review.addRemark', { id: 1 })
    .respond('gate.approve', (args: InvokeArgs) => ({ gate: args.gate, status: 'approved' }))
    .respond('finops.snapshot', finops())
    .respond('skills.list', skills())
    .respond('skills.toggle', (args: InvokeArgs) => ({ name: args.name, enabled: args.enabled }))
    .respond('files.tree', fileTree())
    .respond('fs.rescan', null)
    .respond('agent.sessions', { sessions: [] })
    .respond('conversations.list', (args: InvokeArgs) => ({
      projects: ((args.roots as string[] | undefined) ?? []).map(root => ({ root, conversations: [] })),
    }))
    .respond('project.pick', null)
    .respond('recent.remove', { entries: [] })
    .respond('pty.open', { id: 'pty-1' })
    .respond('pty.write', null)
    .respond('pty.resize', null)
    .respond('pty.close', null)
    .respond('window.set_caption_layout', null);
}

// ---------------------------------------------------------------------------------------------------------
// DOM stubs (happy-dom has no layout, no Worker and no 2D canvas)
// ---------------------------------------------------------------------------------------------------------

type LayoutKey = 'offsetHeight' | 'offsetWidth' | 'clientHeight' | 'clientWidth' | 'getBoundingClientRect';

/**
 * Gives elements a deterministic size so virtualizers render a bounded window:
 * `[data-scroll-region]` elements are `regionHeight` tall, every other element `rowHeight` tall.
 */
export function installLayoutStub({ regionHeight = 800, rowHeight = 20, width = 1200 } = {}): () => void {
  const proto = HTMLElement.prototype;
  const keys: LayoutKey[] = ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth', 'getBoundingClientRect'];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(proto, key)] as const));
  const heightOf = (element: HTMLElement) => (element.hasAttribute('data-scroll-region') ? regionHeight : rowHeight);
  const size = (key: 'offsetHeight' | 'clientHeight' | 'offsetWidth' | 'clientWidth') => ({
    configurable: true,
    get(this: HTMLElement) {
      return key.endsWith('Width') ? width : heightOf(this);
    },
  });
  Object.defineProperty(proto, 'offsetHeight', size('offsetHeight'));
  Object.defineProperty(proto, 'clientHeight', size('clientHeight'));
  Object.defineProperty(proto, 'offsetWidth', size('offsetWidth'));
  Object.defineProperty(proto, 'clientWidth', size('clientWidth'));
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const height = heightOf(this);
      return { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };
    },
  });
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else Reflect.deleteProperty(proto, key);
    }
  };
}

export interface Point {
  x: number;
  y: number;
}

export interface RecordedOp {
  op: string;
  args: unknown[];
  /** Points of the call mapped through the current transform (screen space). */
  points: Point[];
  fillStyle: unknown;
  strokeStyle: unknown;
  lineDash: number[];
}

export interface RecordedStroke {
  segments: Array<{ from: Point; to: Point }>;
  lineDash: number[];
  strokeStyle: unknown;
}

export interface RecordingContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly ops: RecordedOp[];
  readonly strokes: RecordedStroke[];
  count(op: string): number;
  reset(): void;
}

type Matrix = [number, number, number, number, number, number];

/** A CanvasRenderingContext2D double that records calls, the active line dash and stroked segments. */
export function createRecordingContext(width = 1200, height = 800): RecordingContext {
  const ops: RecordedOp[] = [];
  const strokes: RecordedStroke[] = [];
  interface State {
    fillStyle: unknown;
    strokeStyle: unknown;
    lineDash: number[];
    matrix: Matrix;
    props: Record<string, unknown>;
  }
  let state: State = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineDash: [],
    matrix: [1, 0, 0, 1, 0, 0],
    props: {},
  };
  const stack: State[] = [];
  let segments: Array<{ from: Point; to: Point }> = [];
  let cursor: Point | null = null;
  let subpathStart: Point | null = null;

  const map = (x: number, y: number): Point => {
    const [a, b, c, d, e, f] = state.matrix;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  };
  const multiply = (n: Matrix) => {
    const [a, b, c, d, e, f] = state.matrix;
    const [a2, b2, c2, d2, e2, f2] = n;
    state.matrix = [
      a * a2 + c * b2,
      b * a2 + d * b2,
      a * c2 + c * d2,
      b * c2 + d * d2,
      a * e2 + c * f2 + e,
      b * e2 + d * f2 + f,
    ];
  };
  const record = (op: string, args: unknown[], points: Point[] = []) =>
    ops.push({
      op,
      args,
      points,
      fillStyle: state.fillStyle,
      strokeStyle: state.strokeStyle,
      lineDash: [...state.lineDash],
    });
  const num = (value: unknown) => (typeof value === 'number' ? value : Number(value));

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    save: () => {
      stack.push({ ...state, lineDash: [...state.lineDash], props: { ...state.props } });
      record('save', []);
    },
    restore: () => {
      const previous = stack.pop();
      if (previous) state = previous;
      record('restore', []);
    },
    setTransform: (...args) => {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = args.map(num);
      state.matrix = [a, b, c, d, e, f];
      record('setTransform', args);
    },
    resetTransform: () => {
      state.matrix = [1, 0, 0, 1, 0, 0];
      record('resetTransform', []);
    },
    transform: (...args) => {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = args.map(num);
      multiply([a, b, c, d, e, f]);
      record('transform', args);
    },
    translate: (...args) => {
      multiply([1, 0, 0, 1, num(args[0]), num(args[1])]);
      record('translate', args);
    },
    scale: (...args) => {
      multiply([num(args[0]), 0, 0, num(args[1] ?? args[0]), 0, 0]);
      record('scale', args);
    },
    beginPath: () => {
      segments = [];
      cursor = null;
      subpathStart = null;
      record('beginPath', []);
    },
    moveTo: (...args) => {
      cursor = map(num(args[0]), num(args[1]));
      subpathStart = cursor;
      record('moveTo', args, [cursor]);
    },
    lineTo: (...args) => {
      const to = map(num(args[0]), num(args[1]));
      if (cursor) segments.push({ from: cursor, to });
      cursor = to;
      record('lineTo', args, [to]);
    },
    closePath: () => {
      if (cursor && subpathStart) segments.push({ from: cursor, to: subpathStart });
      cursor = subpathStart;
      record('closePath', []);
    },
    arc: (...args) => {
      const center = map(num(args[0]), num(args[1]));
      cursor = center;
      record('arc', args, [center]);
    },
    rect: (...args) => record('rect', args, [map(num(args[0]), num(args[1]))]),
    fillRect: (...args) => record('fillRect', args, [map(num(args[0]), num(args[1]))]),
    strokeRect: (...args) => record('strokeRect', args, [map(num(args[0]), num(args[1]))]),
    clearRect: (...args) => record('clearRect', args),
    fillText: (...args) => record('fillText', args, [map(num(args[1]), num(args[2]))]),
    stroke: (...args) => {
      strokes.push({ segments: [...segments], lineDash: [...state.lineDash], strokeStyle: state.strokeStyle });
      record('stroke', args);
    },
    fill: (...args) => record('fill', args),
    setLineDash: (...args) => {
      const dash = args[0];
      state.lineDash = Array.isArray(dash) ? dash.map(num) : [];
      record('setLineDash', args);
    },
    getLineDash: () => [...state.lineDash],
    measureText: (...args) => ({ width: String(args[0]).length * 6 }),
  };

  const canvas = { width, height };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_target, key) {
      if (key === 'canvas') return canvas;
      if (key === 'fillStyle') return state.fillStyle;
      if (key === 'strokeStyle') return state.strokeStyle;
      if (typeof key !== 'string') return undefined;
      const method = methods[key];
      if (method) return method;
      if (key in state.props) return state.props[key];
      // Unknown drawing API (ellipse, roundRect, quadraticCurveTo…): recorded generically.
      return (...args: unknown[]) => record(key, args);
    },
    set(_target, key, value) {
      if (key === 'fillStyle') state.fillStyle = value;
      else if (key === 'strokeStyle') state.strokeStyle = value;
      else if (typeof key === 'string') state.props[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    ops,
    strokes,
    count: op => ops.filter(entry => entry.op === op).length,
    reset: () => {
      ops.length = 0;
      strokes.length = 0;
    },
  };
}

/** `canvas.getContext('2d')` returns a recording context (happy-dom returns null). Restored by restoreMocks. */
export function stubCanvas(): RecordingContext {
  const recording = createRecordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => recording.ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  return recording;
}

export interface FakeWorkerRecord {
  url: string;
  options: unknown;
  messages: unknown[];
  terminated: boolean;
}

/** Installs an inert global `Worker` (happy-dom has none) that records construction and posted messages. */
export function stubWorker(): FakeWorkerRecord[] {
  const instances: FakeWorkerRecord[] = [];
  class FakeWorker extends EventTarget {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private readonly record: FakeWorkerRecord;
    constructor(url: string | URL, options?: unknown) {
      super();
      this.record = { url: String(url), options, messages: [], terminated: false };
      instances.push(this.record);
    }
    postMessage(message: unknown): void {
      this.record.messages.push(message);
    }
    terminate(): void {
      this.record.terminated = true;
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return instances;
}
