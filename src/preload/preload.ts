import { contextBridge, ipcRenderer } from 'electron';

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    hasApiKey: () => ipcRenderer.invoke('settings:has-api-key'),
    hasGitToken: () => ipcRenderer.invoke('settings:has-git-token'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:set-api-key', key),
    setGitToken: (token: string) => ipcRenderer.invoke('settings:set-git-token', token),
    validateApiKey: (key: string) => ipcRenderer.invoke('settings:validate-api-key', key),
    selectDirectory: () => ipcRenderer.invoke('settings:select-directory'),
  },
  schedule: {
    getStatus: () => ipcRenderer.invoke('schedule:get-status'),
    runNow: () => ipcRenderer.invoke('schedule:run-now'),
  },
  git: {
    clone: (url: string, token: string) => ipcRenderer.invoke('git:clone', url, token),
    pull: () => ipcRenderer.invoke('git:pull'),
    push: () => ipcRenderer.invoke('git:push'),
    sync: () => ipcRenderer.invoke('git:sync'),
    forcePush: () => ipcRenderer.invoke('git:force-push'),
    forcePull: () => ipcRenderer.invoke('git:force-pull'),
    atRiskFiles: () => ipcRenderer.invoke('git:at-risk-files'),
    status: () => ipcRenderer.invoke('git:status'),
    listChanges: () => ipcRenderer.invoke('git:list-changes'),
    listRecentCommits: (limit?: number) => ipcRenderer.invoke('git:list-recent-commits', limit),
  },
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (opts: Record<string, unknown>) => ipcRenderer.invoke('project:create', opts),
    createDemo: () => ipcRenderer.invoke('project:create-demo'),
    delete: (name: string) => ipcRenderer.invoke('project:delete', name),
    getConfig: (name: string) => ipcRenderer.invoke('project:get-config', name),
    setConfig: (name: string, cfg: Record<string, unknown>) => ipcRenderer.invoke('project:set-config', name, cfg),
    getStatus: (name: string) => ipcRenderer.invoke('project:get-status', name),
    suggestTaxonomy: (name: string, field: 'entityTypes' | 'conceptTypes' | 'tags') =>
      ipcRenderer.invoke('project:suggest-taxonomy', name, field),
  },
  files: {
    upload: (proj: string, files: Array<{ name: string; data: ArrayBuffer }>) => ipcRenderer.invoke('files:upload', proj, files),
    listRaw: (proj: string) => ipcRenderer.invoke('files:list-raw', proj),
    listRawWithStatus: (proj: string) => ipcRenderer.invoke('files:list-raw-with-status', proj),
    readRaw: (proj: string, file: string) => ipcRenderer.invoke('files:read-raw', proj, file),
    readRawBase64: (proj: string, file: string) => ipcRenderer.invoke('files:read-raw-base64', proj, file),
    deleteRaw: (proj: string, file: string) => ipcRenderer.invoke('files:delete-raw', proj, file),
  },
  wiki: {
    listPages: (proj: string, subdir?: string) => ipcRenderer.invoke('wiki:list-pages', proj, subdir),
    readPage: (proj: string, path: string) => ipcRenderer.invoke('wiki:read-page', proj, path),
    createPage: (proj: string, input: Record<string, unknown>) => ipcRenderer.invoke('wiki:create-page', proj, input),
    setReviewed: (proj: string, path: string, reviewed: boolean) => ipcRenderer.invoke('wiki:set-reviewed', proj, path, reviewed),
    updateFrontmatter: (proj: string, path: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('wiki:update-frontmatter', proj, path, patch),
    listBacklinks: (proj: string, path: string) => ipcRenderer.invoke('wiki:list-backlinks', proj, path),
    listReviewQueue: (proj: string) => ipcRenderer.invoke('wiki:list-review-queue', proj),
    getWikilinkMap: (proj: string) => ipcRenderer.invoke('wiki:get-wikilink-map', proj),
    getGraphData: (proj: string) => ipcRenderer.invoke('wiki:get-graph-data', proj),
    listPendingStubs: (proj: string) => ipcRenderer.invoke('wiki:list-pending-stubs', proj),
    deletePendingStub: (proj: string, slug: string) => ipcRenderer.invoke('wiki:delete-pending-stub', proj, slug),
  },
  ingest: {
    run: (proj: string, files?: string[]) => ipcRenderer.invoke('ingest:run', proj, files),
    cancel: (proj: string) => ipcRenderer.invoke('ingest:cancel', proj),
  },
  query: {
    ask: (proj: string, question: string) => ipcRenderer.invoke('query:ask', proj, question),
    listSessions: (proj: string) => ipcRenderer.invoke('query:list-sessions', proj),
    loadSession: (proj: string, sessionId: string) => ipcRenderer.invoke('query:load-session', proj, sessionId),
    saveSession: (proj: string, session: Record<string, unknown>) => ipcRenderer.invoke('query:save-session', proj, session),
    deleteSession: (proj: string, sessionId: string) => ipcRenderer.invoke('query:delete-session', proj, sessionId),
  },
  lint: {
    run: (proj: string) => ipcRenderer.invoke('lint:run', proj),
    fix: (proj: string) => ipcRenderer.invoke('lint:fix', proj),
    suggest: (proj: string) => ipcRenderer.invoke('lint:suggest', proj),
  },
  forget: {
    preview: (proj: string, file: string) => ipcRenderer.invoke('forget:preview', proj, file),
    execute: (proj: string, file: string) => ipcRenderer.invoke('forget:execute', proj, file),
    reset: (proj: string, file: string) => ipcRenderer.invoke('forget:reset', proj, file),
  },
  takeaway: {
    discuss: (input: {
      projectName: string;
      takeaway: string;
      sourceFile?: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      question: string;
    }) => ipcRenderer.invoke('takeaway:discuss', input),
    synthesize: (input: {
      projectName: string;
      takeaway: string;
      sourceFile?: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => ipcRenderer.invoke('takeaway:synthesize', input),
  },
  output: {
    list: (proj: string) => ipcRenderer.invoke('output:list', proj),
    create: (proj: string, opts: Record<string, unknown>) => ipcRenderer.invoke('output:create', proj, opts),
    generate: (proj: string, name: string) => ipcRenderer.invoke('output:generate', proj, name),
    readResult: (proj: string, name: string) => ipcRenderer.invoke('output:read-result', proj, name),
    readPrompt: (proj: string, name: string) => ipcRenderer.invoke('output:read-prompt', proj, name),
    savePrompt: (proj: string, name: string, opts: Record<string, unknown>) => ipcRenderer.invoke('output:save-prompt', proj, name, opts),
    delete: (proj: string, name: string) => ipcRenderer.invoke('output:delete', proj, name),
  },

  skill: {
    list: (proj: string) => ipcRenderer.invoke('skill:list', proj),
    read: (proj: string, name: string) => ipcRenderer.invoke('skill:read', proj, name),
    save: (proj: string, name: string, content: string) => ipcRenderer.invoke('skill:save', proj, name, content),
    delete: (proj: string, name: string) => ipcRenderer.invoke('skill:delete', proj, name),
    import: (proj: string, files: Array<{ name: string; data: ArrayBuffer }>) => ipcRenderer.invoke('skill:import', proj, files),
    listBuiltin: () => ipcRenderer.invoke('skill:list-builtin'),
    installBuiltin: (proj: string) => ipcRenderer.invoke('skill:install-builtin', proj),
  },

  brand: {
    list: (proj: string) => ipcRenderer.invoke('brand:list', proj),
    read: (proj: string, name: string) => ipcRenderer.invoke('brand:read', proj, name),
    write: (proj: string, name: string, content: string) => ipcRenderer.invoke('brand:write', proj, name, content),
    reset: (proj: string, name: string) => ipcRenderer.invoke('brand:reset', proj, name),
  },

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const allowed = new Set(['ingest:progress', 'query:stream-chunk', 'query:stream-end', 'git:sync-status', 'files:upload-progress', 'lint:progress', 'output:progress', 'schedule:status']);
    if (!allowed.has(channel)) return () => undefined;
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
};

contextBridge.exposeInMainWorld('api', api);
