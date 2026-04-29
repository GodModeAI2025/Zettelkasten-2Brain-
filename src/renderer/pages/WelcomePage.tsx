import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/bridge';
import { useAppStore } from '../stores/app.store';
import { useGitStore } from '../stores/git.store';
import { useProjectStore } from '../stores/project.store';

type Step = 'api-key' | 'git' | 'project';

export function WelcomePage() {
  const [step, setStep] = useState<Step>('api-key');
  const [apiKey, setApiKey] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [projectName, setProjectName] = useState('');
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState('de');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const addNotification = useAppStore((s) => s.addNotification);
  const setCloned = useGitStore((s) => s.setCloned);
  const { loadProjects, setActiveProject } = useProjectStore();

  const handleApiKey = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.settings.validateApiKey(apiKey);
      if (!result.valid) {
        setError(result.error || 'API-Key ungültig. Bitte prüfen.');
        setLoading(false);
        return;
      }
      await api.settings.setApiKey(apiKey);
      addNotification('success', 'API-Key gespeichert');
      setStep('git');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const handleGitClone = async () => {
    setLoading(true);
    setError('');
    try {
      await api.settings.setGitToken(gitToken);
      await api.settings.set({ git: { repoUrl, authorName: '', authorEmail: '' } });
      const result = await api.git.clone(repoUrl, gitToken);
      if (!result.success) {
        setError(result.error || 'Clone fehlgeschlagen');
        setLoading(false);
        return;
      }
      setCloned(true);
      addNotification('success', 'Repository geklont');

      const projects = await api.project.list();
      if (projects.length > 0) {
        await loadProjects();
        await setActiveProject(projects[0].name);
        navigate('/dashboard');
      } else {
        setStep('project');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const handleCreateProject = async () => {
    setLoading(true);
    setError('');
    try {
      await api.project.create({ name: projectName, domain, language, tags: [] });
      await loadProjects();
      await setActiveProject(projectName);
      addNotification('success', `Projekt "${projectName}" erstellt`);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const handleCreateDemoProject = async () => {
    setLoading(true);
    setError('');
    try {
      const project = await api.project.createDemo();
      await loadProjects();
      await setActiveProject(project.name);
      addNotification('success', `Demo "${project.name}" erstellt`);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const stepIndex = step === 'api-key' ? 0 : step === 'git' ? 1 : 2;

  return (
    <div className="welcome-container">
      <div className="welcome-card">
        <h1>2Brain</h1>
        <p className="subtitle">KI-gestütztes Wissensmanagementsystem</p>

        <div className="step-indicator">
          {['api-key', 'git', 'project'].map((s, i) => (
            <div
              key={s}
              className={`step-dot ${i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}`}
            />
          ))}
        </div>

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {step === 'api-key' && (
          <>
            <div className="input-group">
              <label>Anthropic API-Key</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={handleApiKey} disabled={loading || !apiKey}>
              {loading ? 'Validiere...' : 'Weiter'}
            </button>
          </>
        )}

        {step === 'git' && (
          <>
            <div className="input-group">
              <label>Git Repository URL</label>
              <input
                type="text"
                placeholder="https://github.com/user/my-brain.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Personal Access Token</label>
              <input
                type="password"
                placeholder="ghp_..."
                value={gitToken}
                onChange={(e) => setGitToken(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={handleGitClone} disabled={loading || !repoUrl || !gitToken}>
              {loading ? 'Klone Repository...' : 'Repository klonen'}
            </button>
          </>
        )}

        {step === 'project' && (
          <>
            <div className="input-group">
              <label>Projektname</label>
              <input
                type="text"
                placeholder="mein-wiki"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Themenfeld</label>
              <input
                type="text"
                placeholder="z.B. KI-Forschung, Marktanalyse"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Sprache</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="welcome-actions">
              <button className="btn btn-primary" onClick={handleCreateProject} disabled={loading || !projectName}>
                {loading ? 'Erstelle...' : 'Projekt erstellen'}
              </button>
              <button className="btn btn-secondary" onClick={handleCreateDemoProject} disabled={loading}>
                {loading ? 'Erstelle...' : 'Demo-Wissensraum'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
