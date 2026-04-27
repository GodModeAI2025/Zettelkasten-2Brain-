import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useOutputStore } from '../stores/output.store';
import { MarkdownViewer } from '../components/wiki/MarkdownViewer';
import { MarpViewer, isMarpContent } from '../components/output/MarpViewer';
import type { OutputInfo, SkillInfo } from '../../shared/api.types';

type ViewMode = 'list' | 'edit' | 'result' | 'skill-edit';

export function OutputPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const addNotification = useAppStore((s) => s.addNotification);
  const [outputs, setOutputs] = useState<OutputInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail-Ansicht
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const viewedJob = useOutputStore((s) => selectedOutput ? s.jobs[selectedOutput] : undefined);
  const allJobs = useOutputStore((s) => s.jobs);
  const startJob = useOutputStore((s) => s.startJob);
  const clearJob = useOutputStore((s) => s.clearJob);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editBody, setEditBody] = useState('');
  const [editSources, setEditSources] = useState('wiki/**/*.md');
  const [editFormat, setEditFormat] = useState('markdown');
  const [editModel, setEditModel] = useState('claude-sonnet-4-6');
  const [editSkills, setEditSkills] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [resultContent, setResultContent] = useState('');

  const generating = viewedJob?.phase === 'generating';

  // Erstellen
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  // Skill-Editor
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [skillBody, setSkillBody] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadOutputs = useCallback(async () => {
    if (!activeProject) return;
    try {
      const [list, skillList] = await Promise.all([
        api.output.list(activeProject),
        api.skill.list(activeProject),
      ]);
      setOutputs(list);
      setSkills(skillList);
    } catch {
      addNotification('error', 'Outputs konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [activeProject, addNotification]);

  useEffect(() => {
    loadOutputs();
  }, [loadOutputs]);

  const openOutput = async (name: string) => {
    if (!activeProject) return;
    setSelectedOutput(name);
    setViewMode('edit');
    try {
      const p = await api.output.readPrompt(activeProject, name);
      setEditBody(p.body);
      setEditSources(p.sources);
      setEditFormat(p.format);
      setEditModel(p.model);
      setEditSkills(p.skills || []);
    } catch {
      setEditBody('');
      setEditSkills([]);
    }
  };

  const handleSave = async () => {
    if (!activeProject || !selectedOutput) return;
    setSaving(true);
    try {
      await api.output.savePrompt(activeProject, selectedOutput, {
        sources: editSources,
        format: editFormat,
        model: editModel,
        skills: editSkills,
        body: editBody,
      });
      addNotification('success', 'Prompt gespeichert.');
      await loadOutputs();
    } catch (err) {
      addNotification('error', `Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!activeProject || !selectedOutput) return;
    try {
      await api.output.savePrompt(activeProject, selectedOutput, {
        sources: editSources,
        format: editFormat,
        model: editModel,
        skills: editSkills,
        body: editBody,
      });
      startJob(selectedOutput);
      await api.output.generate(activeProject, selectedOutput);
      // Generierung läuft jetzt im Hintergrund — Events kommen über output:progress
    } catch (err) {
      addNotification('error', `Generierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Wenn Generierung abgeschlossen → Ergebnis laden
  useEffect(() => {
    if (!activeProject || !selectedOutput) return;
    if (viewedJob?.phase === 'complete') {
      api.output.readResult(activeProject, selectedOutput)
        .then((content) => {
          setResultContent(content);
          setViewMode('result');
          loadOutputs();
          clearJob(selectedOutput);
        })
        .catch(() => undefined);
    }
  }, [viewedJob?.phase]);

  const handleViewResult = async () => {
    if (!activeProject || !selectedOutput) return;
    try {
      const content = await api.output.readResult(activeProject, selectedOutput);
      setResultContent(content);
      setViewMode('result');
    } catch {
      addNotification('info', 'Noch kein Ergebnis vorhanden. Bitte zuerst generieren.');
    }
  };

  const handleCreate = async () => {
    if (!activeProject || !newName.trim()) return;
    try {
      await api.output.create(activeProject, {
        name: newName.trim(),
        sources: 'wiki/**/*.md',
        format: 'markdown',
        model: 'claude-sonnet-4-6',
        prompt: 'Beschreibe hier, was dieser Output erzeugen soll.\n\nDu hast Zugriff auf alle Wiki-Seiten als Kontext.',
      });
      setShowCreate(false);
      setNewName('');
      await loadOutputs();
      openOutput(newName.trim());
    } catch (err) {
      addNotification('error', `Erstellen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async () => {
    if (!activeProject || !selectedOutput) return;
    try {
      await api.output.delete(activeProject, selectedOutput);
      addNotification('success', `"${selectedOutput}" gelöscht.`);
      setSelectedOutput(null);
      setViewMode('list');
      await loadOutputs();
    } catch (err) {
      addNotification('error', `Löschen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Skill-Aktionen
  const toggleSkill = (name: string) => {
    setEditSkills((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  };

  const openSkillEditor = async (name: string) => {
    if (!activeProject) return;
    try {
      const content = await api.skill.read(activeProject, name);
      setEditingSkill(name);
      setSkillBody(content);
      setViewMode('skill-edit');
    } catch {
      addNotification('error', `Skill "${name}" konnte nicht geladen werden.`);
    }
  };

  const saveSkill = async () => {
    if (!activeProject || !editingSkill) return;
    try {
      await api.skill.save(activeProject, editingSkill, skillBody);
      addNotification('success', `Skill "${editingSkill}" gespeichert.`);
      setViewMode(selectedOutput ? 'edit' : 'list');
      setEditingSkill(null);
      await loadOutputs();
    } catch (err) {
      addNotification('error', `Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const createSkill = async () => {
    if (!activeProject || !newSkillName.trim()) return;
    const name = newSkillName.trim();
    const template = `---\ndescription: ${name}\n---\n\nBeschreibe hier die Anweisungen für diesen Skill.\n`;
    try {
      await api.skill.save(activeProject, name, template);
      setShowCreateSkill(false);
      setNewSkillName('');
      await loadOutputs();
      openSkillEditor(name);
    } catch (err) {
      addNotification('error', `Skill erstellen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportSkills = async (fileList: FileList | null) => {
    if (!activeProject || !fileList || fileList.length === 0) return;
    const files: Array<{ name: string; data: ArrayBuffer }> = [];
    for (const file of fileList) {
      files.push({ name: file.name, data: await file.arrayBuffer() });
    }
    try {
      const results = await api.skill.import(activeProject, files);
      const success = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      if (success.length > 0) {
        addNotification('success', `${success.length} Skill(s) importiert: ${success.map((r) => r.name).join(', ')}`);
      }
      for (const f of failed) {
        addNotification('error', `Import "${f.name}" fehlgeschlagen: ${f.error}`);
      }
      await loadOutputs();
    } catch (err) {
      addNotification('error', `Import fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
    // File-Input zuruecksetzen
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const deleteSkill = async (name: string) => {
    if (!activeProject) return;
    try {
      await api.skill.delete(activeProject, name);
      addNotification('success', `Skill "${name}" gelöscht.`);
      setEditSkills((prev) => prev.filter((s) => s !== name));
      await loadOutputs();
    } catch (err) {
      addNotification('error', `Löschen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const installBuiltinSkills = async () => {
    if (!activeProject) return;
    try {
      const installed = await api.skill.installBuiltin(activeProject);
      if (installed.length > 0) {
        addNotification('success', `${installed.length} Built-in Skill(s) installiert: ${installed.join(', ')}`);
        await loadOutputs();
      } else {
        addNotification('info', 'Alle Built-in Skills sind bereits installiert.');
      }
    } catch (err) {
      addNotification('error', `Installation fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Outputs</h1>
          <p>Kein Projekt ausgewaehlt.</p>
        </div>
      </div>
    );
  }

  // Skill-Editor-Ansicht
  if (viewMode === 'skill-edit' && editingSkill) {
    return (
      <div>
        <div className="page-header">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setViewMode(selectedOutput ? 'edit' : 'list'); setEditingSkill(null); }}
            style={{ marginBottom: 8 }}
          >
            &larr; Zurück
          </button>
          <h1>Skill: {editingSkill}</h1>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <textarea
            className="skill-prompt-editor"
            value={skillBody}
            onChange={(e) => setSkillBody(e.target.value)}
            rows={16}
            placeholder="Skill-Inhalt (Markdown)..."
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={saveSkill}>
            Speichern
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-danger btn-sm" onClick={() => { deleteSkill(editingSkill); setViewMode(selectedOutput ? 'edit' : 'list'); setEditingSkill(null); }}>
            Skill löschen
          </button>
        </div>
      </div>
    );
  }

  // Detail-Ansicht: Prompt-Editor oder Ergebnis
  if (selectedOutput && (viewMode === 'edit' || viewMode === 'result')) {
    return (
      <div>
        <div className="page-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setSelectedOutput(null); setViewMode('list'); }}
                style={{ marginBottom: 8 }}
              >
                &larr; Alle Outputs
              </button>
              <h1>{selectedOutput}</h1>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {viewMode === 'result' && (
                <button className="btn btn-secondary" onClick={() => setViewMode('edit')}>
                  Prompt bearbeiten
                </button>
              )}
              {viewMode === 'edit' && outputs.find((o) => o.name === selectedOutput)?.lastGenerated && (
                <button className="btn btn-secondary" onClick={handleViewResult}>
                  Ergebnis anzeigen
                </button>
              )}
            </div>
          </div>
        </div>

        {viewMode === 'edit' && (
          <div className="skill-editor">
            {/* Skills */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3>Skills</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => importInputRef.current?.click()}
                  >
                    Importieren
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowCreateSkill(true)}
                  >
                    + Neuer Skill
                  </button>
                </div>
              </div>

              {showCreateSkill && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    placeholder="Skill-Name..."
                    onKeyDown={(e) => e.key === 'Enter' && createSkill()}
                    autoFocus
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={createSkill} disabled={!newSkillName.trim()}>
                    Erstellen
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setShowCreateSkill(false); setNewSkillName(''); }}>
                    Abbrechen
                  </button>
                </div>
              )}

              {skills.length === 0 && !showCreateSkill ? (
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                  Noch keine Skills vorhanden. Skills sind wiederverwendbare Prompt-Bausteine, die Outputs als Kontext mitgeben werden.
                </p>
              ) : (
                <div className="skill-chips">
                  {skills.map((skill) => {
                    const active = editSkills.includes(skill.name);
                    return (
                      <div key={skill.name} className={`skill-chip${active ? ' active' : ''}`}>
                        <button
                          className="skill-chip-toggle"
                          onClick={() => toggleSkill(skill.name)}
                          title={active ? 'Entfernen' : 'Hinzufuegen'}
                        >
                          <span className="skill-chip-check">{active ? '\u2713' : '+'}</span>
                          <span>{skill.name}</span>
                        </button>
                        <button
                          className="skill-chip-edit"
                          onClick={() => openSkillEditor(skill.name)}
                          title="Bearbeiten"
                        >
                          Bearbeiten
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Prompt</h3>
              <textarea
                className="skill-prompt-editor"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Beschreibe was dieser Output erzeugen soll..."
                rows={12}
              />
            </div>

            {/* Konfiguration */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 12 }}>Konfiguration</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Quellen (Glob)</label>
                  <input
                    type="text"
                    value={editSources}
                    onChange={(e) => setEditSources(e.target.value)}
                    placeholder="wiki/**/*.md"
                  />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Ausgabeformat</label>
                  <select value={editFormat} onChange={(e) => setEditFormat(e.target.value)}>
                    <option value="markdown">Markdown</option>
                    <option value="html">HTML</option>
                  </select>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Modell</label>
                  <select value={editModel} onChange={(e) => setEditModel(e.target.value)}>
                    <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                    <option value="claude-opus-4-6">Opus 4.6</option>
                    <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Aktionen */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={generating || !editBody.trim()}
              >
                {generating ? 'Generiere...' : 'Generieren'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Speichere...' : 'Nur speichern'}
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-danger btn-sm"
                onClick={handleDelete}
              >
                Output löschen
              </button>
            </div>
          </div>
        )}

        {/* Generierungs-Fortschritt */}
        {generating && viewedJob && (
          <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--system-blue, #007AFF)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>{'\u2699'}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Generierung läuft...</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{viewedJob.message}</div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'result' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3>Ergebnis</h3>
                {(() => {
                  const info = outputs.find((o) => o.name === selectedOutput);
                  return info?.lastGenerated ? (
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      Generiert am {new Date(info.lastGenerated).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} um {new Date(info.lastGenerated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                    </span>
                  ) : null;
                })()}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => window.print()}
                >
                  Drucken
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={handleGenerate}
                  disabled={generating}
                  title="Output komplett neu generieren"
                >
                  {generating ? 'Generiere...' : 'Redo'}
                </button>
              </div>
            </div>
            <div className="skill-result-content print-content">
              {isMarpContent(resultContent) ? (
                <MarpViewer content={resultContent} />
              ) : (
                <MarkdownViewer content={resultContent} />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Output-Liste
  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1>Outputs</h1>
            <p>Dokumente mit Skills aus dem Wiki generieren</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Neuer Output
          </button>
        </div>
      </div>

      {/* Neuen Output erstellen */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Neuen Output erstellen</h3>
          <div className="input-group">
            <label>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z.B. weekly-report, executive-summary, glossar..."
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Erstellen
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowCreate(false); setNewName(''); }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Skills-Übersicht */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3>Skills</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={installBuiltinSkills} title="Built-in Skills wie Marp-Praesentation installieren">
              Built-in installieren
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => importInputRef.current?.click()}>
              Importieren
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreateSkill(true)}>
              + Neuer Skill
            </button>
          </div>
        </div>
        {skills.length === 0 && !showCreateSkill && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            Noch keine Skills. Klicke auf &ldquo;Built-in installieren&rdquo; um z.B. den Marp-Praesentations-Skill hinzuzufuegen.
          </p>
        )}
          {showCreateSkill && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                placeholder="Skill-Name..."
                onKeyDown={(e) => e.key === 'Enter' && createSkill()}
                autoFocus
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" onClick={createSkill} disabled={!newSkillName.trim()}>Erstellen</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowCreateSkill(false); setNewSkillName(''); }}>Abbrechen</button>
            </div>
          )}
        {skills.length > 0 && (
          <div className="skill-chips">
            {skills.map((skill) => (
              <button
                key={skill.name}
                className="skill-chip-standalone"
                onClick={() => openSkillEditor(skill.name)}
                title={skill.description || skill.name}
              >
                <span>{skill.name}</span>
                {skill.description && <span className="skill-chip-desc">{skill.description}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Output-Liste */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Lade Outputs...</p>
        </div>
      ) : outputs.length === 0 && !showCreate ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Noch keine Outputs vorhanden.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            Ein Output ist ein Prompt + optionale Skills, der gegen dein Wiki ausgefuehrt wird und ein Dokument erzeugt.
          </p>
        </div>
      ) : (
        <div className="skill-list">
          {outputs.map((output) => {
            const job = allJobs[output.name];
            const isGenerating = job?.phase === 'generating';
            return (
            <button
              key={output.name}
              className="skill-card"
              onClick={() => openOutput(output.name)}
            >
              <div className="skill-card-header">
                <h3>
                  {isGenerating && <span style={{ marginRight: 6 }}>{'\u2699'}</span>}
                  {output.name}
                </h3>
                <span className="skill-card-model">{output.model.replace('claude-', '').replace(/-20\d{6}$/, '')}</span>
              </div>
              {output.skills.length > 0 && (
                <div className="skill-card-skills">
                  {output.skills.map((s) => (
                    <span key={s} className="skill-card-skill-tag">{s}</span>
                  ))}
                </div>
              )}
              {output.promptPreview && (
                <p className="skill-card-preview">{output.promptPreview}</p>
              )}
              <div className="skill-card-footer">
                <span className="skill-card-sources">{output.sourcesPattern}</span>
                {isGenerating ? (
                  <span className="skill-card-date" style={{ color: 'var(--system-blue, #007AFF)' }}>Generiert...</span>
                ) : output.lastGenerated ? (
                  <span className="skill-card-date">
                    {new Date(output.lastGenerated).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                ) : (
                  <span className="skill-card-date" style={{ fontStyle: 'italic' }}>Noch nicht generiert</span>
                )}
              </div>
            </button>
            );
          })}
        </div>
      )}

      {/* Hidden File-Input fuer Skill-Import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".md,.skill"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleImportSkills(e.target.files)}
      />
    </div>
  );
}
