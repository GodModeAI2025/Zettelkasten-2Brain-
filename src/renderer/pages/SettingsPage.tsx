import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/bridge';
import { useAppStore } from '../stores/app.store';
import { useProjectStore } from '../stores/project.store';

const LICENSES: Array<{ name: string; version: string; license: string; url: string }> = [
  { name: 'Electron', version: '41.2.0', license: 'MIT', url: 'https://github.com/electron/electron' },
  { name: 'React', version: '19.2.5', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'React Router', version: '7.14.1', license: 'MIT', url: 'https://github.com/remix-run/react-router' },
  { name: 'Zustand', version: '5.0.12', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'Anthropic SDK', version: '0.88.0', license: 'MIT', url: 'https://github.com/anthropics/anthropic-sdk-typescript' },
  { name: 'isomorphic-git', version: '1.37.5', license: 'MIT', url: 'https://github.com/nicolo-ribaudo/isomorphic-git' },
  { name: 'markdown-it', version: '14.1.1', license: 'MIT', url: 'https://github.com/markdown-it/markdown-it' },
  { name: 'react-force-graph-2d', version: '1.29.1', license: 'MIT', url: 'https://github.com/vasturiano/react-force-graph' },
  { name: 'pdf-parse', version: '2.4.5', license: 'MIT', url: 'https://github.com/nicolo-ribaudo/pdf-parse' },
  { name: 'mammoth', version: '1.12.0', license: 'BSD-2-Clause', url: 'https://github.com/mwilliamson/mammoth.js' },
  { name: 'node-html-markdown', version: '2.0.0', license: 'MIT', url: 'https://github.com/nicolo-ribaudo/node-html-markdown' },
  { name: 'glob', version: '13.0.6', license: 'ISC', url: 'https://github.com/isaacs/node-glob' },
  { name: 'Vite', version: '5.4.21', license: 'MIT', url: 'https://github.com/vitejs/vite' },
  { name: 'TypeScript', version: '5.6', license: 'Apache-2.0', url: 'https://github.com/microsoft/TypeScript' },
];

export function SettingsPage() {
  // --- API Key ---
  const [hasApiKey, setHasApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [savingApiKey, setSavingApiKey] = useState(false);

  // --- Git Token ---
  const [hasGitToken, setHasGitToken] = useState(false);
  const [newGitToken, setNewGitToken] = useState('');
  const [savingGitToken, setSavingGitToken] = useState(false);

  // --- Git Settings ---
  const [repoUrl, setRepoUrl] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [savingGit, setSavingGit] = useState(false);

  // --- UI Settings ---
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [language, setLanguage] = useState<'de' | 'en'>('de');
  const [savingUi, setSavingUi] = useState(false);

  // --- AI Settings ---
  const [model, setModel] = useState('claude-sonnet-4-6');

  // --- System Settings ---
  const [preventSleep, setPreventSleep] = useState(false);
  const [dataDirectory, setDataDirectory] = useState('');

  // --- Project creation ---
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDomain, setNewProjectDomain] = useState('');
  const [newProjectLanguage, setNewProjectLanguage] = useState('de');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingDemoProject, setCreatingDemoProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [syncStates, setSyncStates] = useState<Record<string, boolean>>({});

  const addNotification = useAppStore((s) => s.addNotification);
  const { projects, loadProjects, setActiveProject } = useProjectStore();
  const activeProject = useProjectStore((s) => s.activeProject);
  const refreshStatus = useProjectStore((s) => s.refreshStatus);

  const loadSettings = useCallback(async () => {
    try {
      const [hasKey, hasToken, settings] = await Promise.all([
        api.settings.hasApiKey(),
        api.settings.hasGitToken(),
        api.settings.get(),
      ]);
      setHasApiKey(hasKey);
      setHasGitToken(hasToken);
      setRepoUrl(settings.git?.repoUrl || '');
      setAuthorName(settings.git?.authorName || '');
      setAuthorEmail(settings.git?.authorEmail || '');
      setTheme(settings.ui?.theme || 'system');
      setLanguage(settings.ui?.language || 'de');
      setModel(settings.ai?.model || 'claude-sonnet-4-6');
      setPreventSleep(settings.system?.preventSleep || false);
      setDataDirectory(settings.system?.dataDirectory || '');
    } catch (err) {
      addNotification('error', 'Einstellungen konnten nicht geladen werden');
    }
  }, [addNotification]);

  const loadSyncStates = useCallback(async () => {
    const states: Record<string, boolean> = {};
    for (const p of projects) {
      try {
        const cfg = await api.project.getConfig(p.name);
        states[p.name] = (cfg as Record<string, unknown>).syncEnabled !== false;
      } catch {
        states[p.name] = true;
      }
    }
    setSyncStates(states);
  }, [projects]);

  useEffect(() => {
    loadSettings();
    loadProjects();
  }, [loadSettings, loadProjects]);

  useEffect(() => {
    if (projects.length > 0) loadSyncStates();
  }, [projects, loadSyncStates]);

  // --- Handlers ---

  const saveApiKey = async () => {
    if (!newApiKey.trim()) return;
    setSavingApiKey(true);
    try {
      const result = await api.settings.validateApiKey(newApiKey);
      if (!result.valid) {
        addNotification('error', result.error || 'API-Key ungültig');
        setSavingApiKey(false);
        return;
      }
      await api.settings.setApiKey(newApiKey);
      setHasApiKey(true);
      setNewApiKey('');
      addNotification('success', 'API-Key gespeichert');
    } catch (err) {
      addNotification('error', 'Fehler beim Speichern des API-Keys');
    } finally {
      setSavingApiKey(false);
    }
  };

  const saveGitToken = async () => {
    if (!newGitToken.trim()) return;
    setSavingGitToken(true);
    try {
      await api.settings.setGitToken(newGitToken);
      setHasGitToken(true);
      setNewGitToken('');
      addNotification('success', 'Git-Token aktualisiert');
    } catch (err) {
      addNotification('error', 'Fehler beim Speichern des Git-Tokens');
    } finally {
      setSavingGitToken(false);
    }
  };

  const saveGitSettings = async () => {
    setSavingGit(true);
    try {
      await api.settings.set({
        git: {
          repoUrl,
          authorName,
          authorEmail,
        },
      });
      addNotification('success', 'Git-Einstellungen gespeichert');
    } catch (err) {
      addNotification('error', 'Fehler beim Speichern der Git-Einstellungen');
    } finally {
      setSavingGit(false);
    }
  };

  const saveUiSettings = async () => {
    setSavingUi(true);
    try {
      await api.settings.set({ ui: { theme, language, sidebarCollapsed: false } });
      addNotification('success', 'Darstellungs-Einstellungen gespeichert');
    } catch (err) {
      addNotification('error', 'Fehler beim Speichern der Darstellung');
    } finally {
      setSavingUi(false);
    }
  };

  // Theme sofort anwenden wenn geaendert
  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    api.settings.set({ ui: { theme: newTheme, language, sidebarCollapsed: false } });
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      addNotification('error', 'Projektname darf nicht leer sein');
      return;
    }
    setCreatingProject(true);
    try {
      await api.project.create({
        name: newProjectName.trim(),
        domain: newProjectDomain.trim(),
        language: newProjectLanguage,
      });
      setNewProjectName('');
      setNewProjectDomain('');
      setNewProjectLanguage('de');
      setShowCreateProject(false);
      await loadProjects();
      addNotification('success', `Projekt "${newProjectName.trim()}" erstellt`);
    } catch (err) {
      addNotification('error', 'Fehler beim Erstellen des Projekts');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleCreateDemoProject = async () => {
    setCreatingDemoProject(true);
    try {
      const project = await api.project.createDemo();
      await loadProjects();
      await setActiveProject(project.name);
      addNotification('success', `Demo "${project.name}" erstellt`);
    } catch (err) {
      addNotification('error', 'Fehler beim Erstellen des Demo-Wissensraums');
    } finally {
      setCreatingDemoProject(false);
    }
  };

  const handleDeleteProject = async (name: string) => {
    setDeletingProject(name);
    try {
      await api.project.delete(name);
      setConfirmDelete(null);
      if (activeProject === name) {
        await setActiveProject(null);
      }
      await loadProjects();
      addNotification('success', `Projekt "${name}" gelöscht`);
    } catch (err) {
      addNotification('error', `Fehler beim Löschen von "${name}"`);
    } finally {
      setDeletingProject(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Einstellungen</h1>
        <p>API-Keys, Git-Konfiguration, Projekte und Darstellung</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
        {/* --- Anthropic API --- */}
        <div className="card">
          <h3>Anthropic API</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Status:{' '}
            {hasApiKey ? (
              <span className="badge badge-success">Konfiguriert</span>
            ) : (
              <span className="badge badge-error">Nicht gesetzt</span>
            )}
          </p>
          <div className="input-group">
            <label>Neuer API-Key</label>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={saveApiKey}
            disabled={savingApiKey || !newApiKey.trim()}
          >
            {savingApiKey ? 'Validiere...' : 'API-Key speichern'}
          </button>

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

          <div className="input-group">
            <label>Modell</label>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                api.settings.set({ ai: { model: e.target.value } });
              }}
            >
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (schnell, guenstig)</option>
              <option value="claude-opus-4-6">Claude Opus 4.6 (beste Qualitaet)</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (am schnellsten)</option>
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Gilt fuer Ingest, Query und Output-Generierung.
            </span>
          </div>
        </div>

        {/* --- Git Repository --- */}
        <div className="card">
          <h3>Git Repository</h3>
          <div className="input-group">
            <label>Repository URL</label>
            <input
              type="text"
              placeholder="https://github.com/user/repo.git"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>Author Name</label>
            <input
              type="text"
              placeholder="Max Mustermann"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>Author E-Mail</label>
            <input
              type="email"
              placeholder="max@example.com"
              value={authorEmail}
              onChange={(e) => setAuthorEmail(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={saveGitSettings}
              disabled={savingGit}
            >
              {savingGit ? 'Speichere...' : 'Git-Einstellungen speichern'}
            </button>
          </div>

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Token-Status:{' '}
            {hasGitToken ? (
              <span className="badge badge-success">Konfiguriert</span>
            ) : (
              <span className="badge badge-error">Nicht gesetzt</span>
            )}
          </p>
          <div className="input-group">
            <label>Git-Token aktualisieren</label>
            <input
              type="password"
              placeholder="ghp_..."
              value={newGitToken}
              onChange={(e) => setNewGitToken(e.target.value)}
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={saveGitToken}
            disabled={savingGitToken || !newGitToken.trim()}
          >
            {savingGitToken ? 'Speichere...' : 'Token aktualisieren'}
          </button>
        </div>

        {/* --- Projekte --- */}
        <div className="card">
          <h3>Projekte</h3>

          {projects.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Keine Projekte vorhanden.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {projects.map((p) => (
                <div
                  key={p.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'var(--bg-secondary, #f5f5f5)',
                  }}
                >
                  <div>
                    <strong>{p.name}</strong>
                    {p.domain && (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        {p.domain}
                      </span>
                    )}
                    {p.language && (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        ({p.language})
                      </span>
                    )}
                    {activeProject === p.name && (
                      <span
                        className="badge badge-success"
                        style={{ marginLeft: 8, fontSize: 11 }}
                      >
                        Aktiv
                      </span>
                    )}
                    {syncStates[p.name] === false && (
                      <span
                        className="badge"
                        style={{ marginLeft: 8, fontSize: 11, background: 'rgba(142,142,147,0.12)', color: 'var(--gray)' }}
                      >
                        Sync pausiert
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={async () => {
                        const next = !syncStates[p.name];
                        await api.project.setConfig(p.name, { syncEnabled: next });
                        setSyncStates((s) => ({ ...s, [p.name]: next }));
                        if (activeProject === p.name) refreshStatus();
                        addNotification('success', next ? `Sync für "${p.name}" aktiviert` : `Sync für "${p.name}" pausiert`);
                      }}
                      title={syncStates[p.name] !== false ? 'Sync pausieren' : 'Sync aktivieren'}
                    >
                      {syncStates[p.name] !== false ? '\u23F8 Pause' : '\u25B6 Sync an'}
                    </button>
                    {activeProject !== p.name && (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => setActiveProject(p.name)}
                      >
                        Aktivieren
                      </button>
                    )}
                    {confirmDelete === p.name ? (
                      <>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => setConfirmDelete(null)}
                          disabled={deletingProject === p.name}
                        >
                          Abbrechen
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{
                            fontSize: 12,
                            padding: '4px 10px',
                            background: 'var(--color-error, #e53e3e)',
                          }}
                          onClick={() => handleDeleteProject(p.name)}
                          disabled={deletingProject === p.name}
                        >
                          {deletingProject === p.name ? 'Lösche...' : 'Wirklich löschen'}
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        style={{
                          fontSize: 12,
                          padding: '4px 10px',
                          color: 'var(--color-error, #e53e3e)',
                        }}
                        onClick={() => setConfirmDelete(p.name)}
                      >
                        Löschen
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCreateProject ? (
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div className="input-group">
                <label>Projektname</label>
                <input
                  type="text"
                  placeholder="mein-projekt"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Domain / Themengebiet</label>
                <input
                  type="text"
                  placeholder="z.B. Software-Architektur"
                  value={newProjectDomain}
                  onChange={(e) => setNewProjectDomain(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Sprache</label>
                <select
                  value={newProjectLanguage}
                  onChange={(e) => setNewProjectLanguage(e.target.value)}
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateProject}
                  disabled={creatingProject || !newProjectName.trim()}
                >
                  {creatingProject ? 'Erstelle...' : 'Projekt erstellen'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowCreateProject(false);
                    setNewProjectName('');
                    setNewProjectDomain('');
                    setNewProjectLanguage('de');
                  }}
                  disabled={creatingProject}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-project-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateProject(true)}
                disabled={creatingDemoProject}
              >
                + Neues Projekt
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCreateDemoProject}
                disabled={creatingDemoProject}
              >
                {creatingDemoProject ? 'Erstelle...' : 'Demo-Wissensraum'}
              </button>
            </div>
          )}
        </div>

        {/* --- Darstellung --- */}
        <div className="card">
          <h3>Darstellung</h3>
          <div className="input-group">
            <label>Theme</label>
            <select
              value={theme}
              onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="system">System</option>
              <option value="light">Hell</option>
              <option value="dark">Dunkel</option>
            </select>
          </div>
          <div className="input-group">
            <label>Sprache</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'de' | 'en')}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
          <button
            className="btn btn-secondary"
            onClick={saveUiSettings}
            disabled={savingUi}
          >
            {savingUi ? 'Speichere...' : 'Speichern'}
          </button>
        </div>

        {/* --- System --- */}
        <div className="card">
          <h3>System</h3>

          <div className="input-group" style={{ marginBottom: 16 }}>
            <label>Arbeitsverzeichnis</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={dataDirectory}
                placeholder="Standard (App-interner Speicher)"
                readOnly
                style={{ flex: 1, cursor: 'default', opacity: dataDirectory ? 1 : 0.6 }}
              />
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const dir = await api.settings.selectDirectory();
                  if (dir) {
                    setDataDirectory(dir);
                    await api.settings.set({ system: { preventSleep, dataDirectory: dir } });
                    addNotification('success', `Arbeitsverzeichnis gesetzt: ${dir}`);
                    addNotification('info', 'Neustart empfohlen damit alle Projekte korrekt geladen werden.');
                  }
                }}
              >
                Durchsuchen...
              </button>
              {dataDirectory && (
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    setDataDirectory('');
                    await api.settings.set({ system: { preventSleep, dataDirectory: '' } });
                    addNotification('success', 'Arbeitsverzeichnis auf Standard zurueckgesetzt.');
                  }}
                  title="Auf Standard zuruecksetzen"
                >
                  Zuruecksetzen
                </button>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Hier werden Projekte, Wiki-Daten und Skills gespeichert. Aenderungen erfordern einen Neustart.
            </span>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={preventSleep}
              onChange={(e) => {
                setPreventSleep(e.target.checked);
                api.settings.set({ system: { preventSleep: e.target.checked, dataDirectory } });
              }}
              style={{ width: 18, height: 18 }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Ruhezustand verhindern</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Verhindert, dass der Rechner waehrend langer Ingests oder Generierungen in den Ruhezustand geht.
              </div>
            </div>
          </label>
        </div>

        {/* --- Lizenzen --- */}
        <div className="card">
          <h3>Open-Source-Lizenzen</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            2Brain verwendet folgende Open-Source-Bibliotheken:
          </p>
          <div className="license-list">
            {LICENSES.map((lib) => (
              <div key={lib.name} className="license-item">
                <div>
                  <span className="license-name">{lib.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                    v{lib.version}
                  </span>
                </div>
                <span className="license-type">{lib.license}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
