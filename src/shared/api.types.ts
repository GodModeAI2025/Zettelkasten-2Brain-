/** Typdefinitionen fuer die Bridge-API zwischen Preload und Renderer */

export interface AppSettings {
  git: {
    repoUrl: string;
    authorName: string;
    authorEmail: string;
  };
  ui: {
    theme: 'light' | 'dark' | 'system';
    language: 'de' | 'en';
    sidebarCollapsed: boolean;
  };
  ai: {
    model: string;
  };
  system: {
    preventSleep: boolean;
    dataDirectory: string;
  };
  schedule: {
    enabled: boolean;
    intervalMinutes: number;
  };
  activeProjectName: string | null;
}

export interface ProjectInfo {
  name: string;
  domain: string;
  language: string;
}

export interface ProjectStatus {
  totalPages: number;
  sources: number;
  entities: number;
  concepts: number;
  synthesis: number;
  syntheses: number;
  sops: number;
  decisions: number;
  confirmed: number;
  seed: number;
  stale: number;
  unreviewed: number;
  rawTotal: number;
  rawNew: number;
  lastIngest: string;
  lastLint: string;
  syncEnabled: boolean;
}

export type GitChangeState = 'modified' | 'added' | 'deleted' | 'staged' | 'unchanged';

export interface GitChange {
  path: string;
  project: string;
  area: string;
  state: GitChangeState;
  staged: boolean;
}

export interface GitCommitInfo {
  oid: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
}

export interface WikiPage {
  path: string;
  relativePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface WikiFrontmatterPatch {
  status?: string | null;
  confidence?: string | null;
  type?: string | null;
  tags?: string[];
  sources?: string[];
  superseded_by?: string | null;
  reviewed?: boolean;
}

export interface WikiBacklink {
  path: string;
  title: string;
  count: number;
  matches: string[];
}

export type WikiReviewReason = 'unreviewed' | 'seed' | 'stale' | 'low-confidence' | 'uncertain';

export interface WikiReviewItem {
  path: string;
  title: string;
  status: string;
  confidence: string;
  reviewed: boolean;
  created: string;
  updated: string;
  reasons: WikiReviewReason[];
  priority: number;
}

export type WikiPageCategory = 'sources' | 'entities' | 'concepts' | 'syntheses' | 'sops' | 'decisions';

export interface WikiCreatePageInput {
  title: string;
  category?: WikiPageCategory | string;
  path?: string;
  sourcePath?: string;
}

export interface LintResult {
  brokenLinks: Array<{ file: string; target: string }>;
  orphans: string[];
  indexMissing: string[];
  stalePages: Array<{ file: string; status: string; age: number }>;
  supersededNotStale: string[];
  seedWithMultipleSources: string[];
  missingTemporalFields: string[];
  unreviewedPages: string[];
  uncertainPages: string[];
  errors: number;
  warnings: number;
}

export interface LintSuggestions {
  questions: Array<{ question: string; relatedPages: string[]; reason: string }>;
  gaps: Array<{ topic: string; reason: string; mentionedIn: string[] }>;
  sourceSuggestions: Array<{ type: string; reason: string }>;
  synthesisCandidates: Array<{ title: string; pages: string[]; reason: string }>;
}

export interface OutputSourceReadiness {
  sourceCount: number;
  includedCount: number;
  skippedUnreviewedCount: number;
  skippedUnreviewed: string[];
}

export interface OutputInfo {
  name: string;
  lastGenerated: string | null;
  format: string;
  promptPreview: string;
  sourcesPattern: string;
  model: string;
  skills: string[];
  sourceReadiness: OutputSourceReadiness;
}

export interface OutputPrompt {
  sources: string;
  format: string;
  model: string;
  skills: string[];
  body: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  preview: string;
}

export type BrandDocName = 'voice' | 'style' | 'positioning';

export interface BrandDoc {
  name: BrandDocName;
  exists: boolean;
  updated: string;
  size: number;
}

export interface QueryResult {
  answer: string;
  sources_used: string[];
  confidence: string;
  save_as_synthesis: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  confidence?: string;
  sources?: string[];
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created: string;
  updated: string;
  messages: ChatMessage[];
}

export interface RawFileInfo {
  name: string;
  ingested: boolean;
}

export interface PendingStub {
  slug: string;
  title: string;
  category: string;
  path: string;
  referencedBy: string[];
}

export interface UploadResult {
  filename: string;
  converted: boolean;
  convertedName?: string;
  error?: string;
}

export interface UploadProgress {
  filename: string;
  step: 'reading' | 'converting' | 'saving' | 'done' | 'error' | 'committing';
  message: string;
  fileIndex: number;
  totalFiles: number;
}

export interface GraphNode {
  id: string;
  label: string;
  group: 'sources' | 'entities' | 'concepts' | 'synthesis' | 'other';
  tags: string[];
  degree: number;
  hasContent: boolean;
  community: number;
  pagerank: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  reciprocal: boolean;
  tagSimilarity: number;
  contentSimilarity: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ScheduleStatus {
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  lastRunAt: string | null;
  lastRunSummary: string | null;
}

export interface BridgeApi {
  settings: {
    get: () => Promise<AppSettings>;
    set: (patch: Partial<AppSettings>) => Promise<void>;
    hasApiKey: () => Promise<boolean>;
    hasGitToken: () => Promise<boolean>;
    setApiKey: (key: string) => Promise<void>;
    setGitToken: (token: string) => Promise<void>;
    validateApiKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
    selectDirectory: () => Promise<string | null>;
  };
  schedule: {
    getStatus: () => Promise<ScheduleStatus>;
    runNow: () => Promise<void>;
  };
  git: {
    clone: (url: string, token: string) => Promise<{ success: boolean; error?: string }>;
    pull: () => Promise<{ updated: boolean; error?: string }>;
    push: () => Promise<{ success: boolean; error?: string }>;
    sync: () => Promise<{ pulled: boolean; pushed: boolean; error?: string }>;
    forcePush: () => Promise<{ success: boolean; error?: string }>;
    forcePull: () => Promise<{ success: boolean; error?: string }>;
    atRiskFiles: () => Promise<{ files: Array<{ project: string; path: string; full: string }> }>;
    status: () => Promise<{ clean: boolean; ahead: number; behind: number }>;
    listChanges: () => Promise<GitChange[]>;
    listRecentCommits: (limit?: number) => Promise<GitCommitInfo[]>;
  };
  project: {
    list: () => Promise<ProjectInfo[]>;
    create: (opts: Record<string, unknown>) => Promise<ProjectInfo>;
    createDemo: () => Promise<ProjectInfo>;
    delete: (name: string) => Promise<void>;
    getConfig: (name: string) => Promise<Record<string, unknown>>;
    setConfig: (name: string, cfg: Record<string, unknown>) => Promise<void>;
    getStatus: (name: string) => Promise<ProjectStatus>;
    suggestTaxonomy: (
      name: string,
      field: 'entityTypes' | 'conceptTypes' | 'tags',
    ) => Promise<{ suggestions: string[]; reasoning: string }>;
  };
  files: {
    upload: (proj: string, files: Array<{ name: string; data: ArrayBuffer }>) => Promise<UploadResult[]>;
    listRaw: (proj: string) => Promise<string[]>;
    listRawWithStatus: (proj: string) => Promise<RawFileInfo[]>;
    readRaw: (proj: string, file: string) => Promise<string>;
    readRawBase64: (proj: string, file: string) => Promise<string>;
    deleteRaw: (proj: string, file: string) => Promise<void>;
  };
  wiki: {
    listPages: (proj: string, subdir?: string) => Promise<string[]>;
    readPage: (proj: string, path: string) => Promise<WikiPage>;
    createPage: (proj: string, input: WikiCreatePageInput) => Promise<WikiPage>;
    setReviewed: (proj: string, path: string, reviewed: boolean) => Promise<WikiPage>;
    updateFrontmatter: (proj: string, path: string, patch: WikiFrontmatterPatch) => Promise<WikiPage>;
    listBacklinks: (proj: string, path: string) => Promise<WikiBacklink[]>;
    listReviewQueue: (proj: string) => Promise<WikiReviewItem[]>;
    getWikilinkMap: (proj: string) => Promise<Record<string, string[]>>;
    getGraphData: (proj: string) => Promise<GraphData>;
    listPendingStubs: (proj: string) => Promise<PendingStub[]>;
    deletePendingStub: (proj: string, slug: string) => Promise<void>;
  };
  ingest: {
    run: (proj: string, files?: string[]) => Promise<unknown[]>;
    cancel: (proj: string) => Promise<{ cancelled: boolean }>;
  };
  query: {
    ask: (proj: string, question: string) => Promise<QueryResult>;
    listSessions: (proj: string) => Promise<Array<{ id: string; title: string; created: string; updated: string; messageCount: number }>>;
    loadSession: (proj: string, sessionId: string) => Promise<ChatSession>;
    saveSession: (proj: string, session: ChatSession) => Promise<void>;
    deleteSession: (proj: string, sessionId: string) => Promise<void>;
  };
  lint: {
    run: (proj: string) => Promise<LintResult>;
    fix: (proj: string) => Promise<{ fixed: number; actions: Array<{ page: string; action: string }>; skipped: Array<{ page: string; reason: string }> }>;
    suggest: (proj: string) => Promise<LintSuggestions>;
  };
  forget: {
    preview: (proj: string, file: string) => Promise<{ affectedPages: string[] }>;
    execute: (proj: string, file: string) => Promise<Record<string, unknown>>;
    reset: (proj: string, file: string) => Promise<void>;
  };
  output: {
    list: (proj: string) => Promise<OutputInfo[]>;
    create: (proj: string, opts: Record<string, unknown>) => Promise<OutputInfo>;
    generate: (proj: string, name: string) => Promise<{ started: boolean }>;
    readResult: (proj: string, name: string) => Promise<string>;
    readPrompt: (proj: string, name: string) => Promise<OutputPrompt>;
    savePrompt: (proj: string, name: string, opts: Record<string, unknown>) => Promise<void>;
    delete: (proj: string, name: string) => Promise<void>;
  };
  skill: {
    list: (proj: string) => Promise<SkillInfo[]>;
    read: (proj: string, name: string) => Promise<string>;
    save: (proj: string, name: string, content: string) => Promise<void>;
    delete: (proj: string, name: string) => Promise<void>;
    import: (proj: string, files: Array<{ name: string; data: ArrayBuffer }>) => Promise<Array<{ name: string; success: boolean; error?: string }>>;
    listBuiltin: () => Promise<Array<{ name: string; description: string }>>;
    installBuiltin: (proj: string) => Promise<string[]>;
  };
  takeaway: {
    discuss: (input: {
      projectName: string;
      takeaway: string;
      sourceFile?: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      question: string;
    }) => Promise<string>;
    synthesize: (input: {
      projectName: string;
      takeaway: string;
      sourceFile?: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => Promise<{ path: string; title: string }>;
  };
  brand: {
    list: (proj: string) => Promise<BrandDoc[]>;
    read: (proj: string, name: BrandDocName) => Promise<string>;
    write: (proj: string, name: BrandDocName, content: string) => Promise<void>;
    reset: (proj: string, name: BrandDocName) => Promise<void>;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}
