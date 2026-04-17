import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useWikiStore } from '../stores/wiki.store';
import { useAppStore } from '../stores/app.store';
import { useQueryStore } from '../stores/query.store';
import type { LintSuggestions } from '../../shared/api.types';

interface LintResult {
  brokenLinks: Array<{ file: string; target: string }>;
  orphans: string[];
  indexMissing: string[];
  stalePages: Array<{ file: string; status: string; age: number }>;
  supersededNotStale: string[];
  seedWithMultipleSources: string[];
  missingTemporalFields: string[];
  errors: number;
  warnings: number;
}

interface FixReport {
  fixed: number;
  actions: Array<{ page: string; action: string }>;
  skipped: Array<{ page: string; reason: string }>;
}

type FixStepStatus = 'pending' | 'active' | 'done' | 'error';

interface FixStep {
  key: string;
  label: string;
  status: FixStepStatus;
  detail?: string;
}

const INITIAL_STEPS: FixStep[] = [
  { key: 'init', label: 'Wiki-Seiten laden', status: 'pending' },
  { key: 'frontmatter', label: 'Frontmatter reparieren', status: 'pending' },
  { key: 'context', label: 'Fehlende Seiten analysieren', status: 'pending' },
  { key: 'ai', label: 'KI-Seitengenierung', status: 'pending' },
  { key: 'indexes', label: 'Indexes aktualisieren', status: 'pending' },
];

function stepIcon(status: FixStepStatus): string {
  switch (status) {
    case 'done': return '\u2713';
    case 'active': return '\u2699';
    case 'error': return '\u2717';
    default: return '\u2022';
  }
}

export function LintPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const refreshStatus = useProjectStore((s) => s.refreshStatus);
  const refreshPages = useWikiStore((s) => s.refreshPages);
  const addNotification = useAppStore((s) => s.addNotification);
  const setPendingQuestion = useQueryStore((s) => s.setPendingQuestion);
  const navigate = useNavigate();
  const [result, setResult] = useState<LintResult | null>(null);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixReport, setFixReport] = useState<FixReport | null>(null);
  const [fixSteps, setFixSteps] = useState<FixStep[]>(INITIAL_STEPS);
  const [fixLog, setFixLog] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<LintSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = api.on('lint:progress', (...args: unknown[]) => {
      const data = args[0] as { step: string; message: string };
      if (!data) return;
      const { step, message } = data;

      // Step-Status aktualisieren
      setFixSteps((prev) => prev.map((s) => {
        if (s.key === step) {
          return { ...s, status: 'active', detail: message };
        }
        // Vorherige Steps als erledigt markieren
        const stepOrder = INITIAL_STEPS.findIndex((is) => is.key === step);
        const thisOrder = INITIAL_STEPS.findIndex((is) => is.key === s.key);
        if (thisOrder < stepOrder && s.status !== 'error') {
          return { ...s, status: 'done' };
        }
        return s;
      }));

      // Bei 'done' oder 'error': Step abschliessen
      if (step === 'done') {
        setFixSteps((prev) => prev.map((s) =>
          s.status === 'active' ? { ...s, status: 'done' } : s
        ));
      }
      if (step === 'error') {
        setFixSteps((prev) => prev.map((s) =>
          s.status === 'active' ? { ...s, status: 'error', detail: message } : s
        ));
      }

      // Detail-Log
      setFixLog((prev) => [...prev, message]);
    });
    return unsub;
  }, []);

  // Auto-Scroll im Log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [fixLog]);

  const runLint = async () => {
    if (!activeProject) return;
    setRunning(true);
    try {
      const res = await api.lint.run(activeProject);
      setResult(res);
    } catch (err) {
      addNotification(
        'error',
        `Lint fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRunning(false);
    }
  };

  const runSuggestions = async () => {
    if (!activeProject) return;
    setSuggesting(true);
    try {
      const res = await api.lint.suggest(activeProject);
      setSuggestions(res);
      const total = res.questions.length + res.gaps.length + res.sourceSuggestions.length + res.synthesisCandidates.length;
      if (total === 0) {
        addNotification('info', 'Keine Vorschlaege erzeugt — ggf. zu wenige Wiki-Seiten.');
      }
    } catch (err) {
      addNotification(
        'error',
        `Vorschlaege fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSuggesting(false);
    }
  };

  const askInChat = (question: string) => {
    setPendingQuestion(question);
    navigate('/query');
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Gesundheitscheck</h1>
          <p>Kein Projekt ausgewählt.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Gesundheitscheck</h1>
        <p>Wiki-Integrität prüfen</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={runLint} disabled={running || fixing}>
          {running ? 'Pruefe...' : 'Pruefung starten'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={runSuggestions}
          disabled={suggesting || running || fixing}
          title="KI-basierte Lernvorschlaege: Luecken, Fragen, Synthese-Ideen"
        >
          {suggesting ? 'Analysiere...' : 'Lernvorschlaege generieren'}
        </button>
        {result && (result.errors > 0 || result.warnings > 0) && (
          <button
            className="btn btn-secondary"
            disabled={fixing || running}
            onClick={async () => {
              if (!activeProject) return;
              setFixing(true);
              setFixReport(null);
              setFixSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending' as FixStepStatus, detail: undefined })));
              setFixLog([]);
              try {
                const res = await api.lint.fix(activeProject);
                setFixReport(res);
                if (res.fixed > 0) {
                  addNotification('success', `${res.fixed} Reparatur(en) durchgeführt.`);
                  // Stores aktualisieren damit Sidebar/Dashboard/Wiki die neuen Seiten sehen
                  await Promise.all([refreshStatus(), refreshPages()]);
                } else {
                  addNotification('info', 'Keine automatisch reparierbaren Probleme gefunden.');
                }
                await runLint();
              } catch (err) {
                addNotification('error', `Reparatur fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setFixing(false);
              }
            }}
          >
            {fixing ? 'Repariere...' : 'Automatisch reparieren'}
          </button>
        )}
      </div>

      {(fixing || (fixReport && fixLog.length > 0)) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>
            {fixing ? 'Reparatur läuft...' : 'Reparatur-Verlauf'}
          </h3>

          {/* Schritt-Anzeige */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {fixSteps.map((step) => (
              <div
                key={step.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  opacity: step.status === 'pending' ? 0.4 : 1,
                }}
              >
                <span style={{
                  width: 20,
                  textAlign: 'center',
                  fontWeight: 600,
                  fontSize: 14,
                  color: step.status === 'done' ? 'var(--system-green, #34C759)'
                    : step.status === 'error' ? 'var(--system-red, #FF3B30)'
                    : step.status === 'active' ? 'var(--system-blue, #007AFF)'
                    : 'var(--text-tertiary)',
                }}>
                  {stepIcon(step.status)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: step.status === 'active' ? 600 : 400,
                    color: step.status === 'active' ? 'var(--text-primary)' : undefined,
                  }}>
                    {step.label}
                  </div>
                  {step.detail && step.status === 'active' && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {step.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Detail-Log */}
          {fixLog.length > 0 && (
            <details style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none', marginBottom: 4 }}>
                Detail-Log ({fixLog.length} Einträge)
              </summary>
              <div style={{ maxHeight: 150, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.6 }}>
                {fixLog.map((msg, i) => (
                  <div key={i}>{msg}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            </details>
          )}
        </div>
      )}

      {fixReport && (
        <div className="lint-fix-report card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>
            Reparaturbericht: {fixReport.fixed} Aktion(en)
          </h3>
          {fixReport.actions.length > 0 && (
            <div className="lint-fix-actions">
              {fixReport.actions.map((a, i) => (
                <div key={i} className="lint-fix-action">
                  <span className="lint-fix-icon">{'\u2713'}</span>
                  <span className="lint-fix-page">{a.page}</span>
                  <span className="lint-fix-desc">{a.action}</span>
                </div>
              ))}
            </div>
          )}
          {fixReport.skipped.length > 0 && (
            <div className="lint-fix-skipped" style={{ marginTop: 8 }}>
              <h4 style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Übersprungen:</h4>
              {fixReport.skipped.map((s, i) => (
                <div key={i} className="lint-fix-action">
                  <span className="lint-fix-icon" style={{ color: 'var(--system-orange)' }}>{'\u26A0'}</span>
                  <span className="lint-fix-page">{s.page}</span>
                  <span className="lint-fix-desc">{s.reason}</span>
                </div>
              ))}
            </div>
          )}
          {fixReport.fixed === 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Alle verbleibenden Probleme erfordern manuelle Bearbeitung.
            </p>
          )}
        </div>
      )}

      {suggestions && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Lernvorschlaege</h3>

          {suggestions.questions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                Fragen an dein Wiki ({suggestions.questions.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {suggestions.questions.map((q, i) => (
                  <div key={i} style={{
                    padding: 12,
                    background: 'var(--bg-secondary, #F2F2F7)',
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{q.question}</div>
                    {q.reason && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{q.reason}</div>
                    )}
                    {q.relatedPages.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary, #8E8E93)', fontFamily: 'var(--font-mono, monospace)' }}>
                        {q.relatedPages.join(' · ')}
                      </div>
                    )}
                    <button
                      className="btn btn-primary"
                      style={{ alignSelf: 'flex-start', fontSize: 12, padding: '4px 10px' }}
                      onClick={() => askInChat(q.question)}
                    >
                      Im Chat fragen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.gaps.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                Wissensluecken ({suggestions.gaps.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {suggestions.gaps.map((g, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    <strong>{g.topic}</strong>
                    <span style={{ color: 'var(--text-secondary)' }}> — {g.reason}</span>
                    {g.mentionedIn.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary, #8E8E93)', fontFamily: 'var(--font-mono, monospace)', marginTop: 2 }}>
                        erwaehnt in: {g.mentionedIn.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.synthesisCandidates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                Synthese-Kandidaten ({suggestions.synthesisCandidates.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {suggestions.synthesisCandidates.map((s, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    <strong>{s.title}</strong>
                    <span style={{ color: 'var(--text-secondary)' }}> — {s.reason}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary, #8E8E93)', fontFamily: 'var(--font-mono, monospace)', marginTop: 2 }}>
                      {s.pages.join(' + ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.sourceSuggestions.length > 0 && (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                Quellen-Ideen ({suggestions.sourceSuggestions.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.sourceSuggestions.map((s, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    <strong>{s.type}</strong>
                    <span style={{ color: 'var(--text-secondary)' }}> — {s.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {suggestions.questions.length === 0
            && suggestions.gaps.length === 0
            && suggestions.synthesisCandidates.length === 0
            && suggestions.sourceSuggestions.length === 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Keine Vorschlaege — das Wiki ist zu klein oder die KI konnte nichts Konkretes ableiten.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="lint-results">
          <div className="lint-summary">
            <div className={`lint-summary-card ${result.errors > 0 ? 'lint-has-errors' : 'lint-clean'}`}>
              <span className="lint-count">{result.errors}</span>
              <span className="lint-count-label">Fehler</span>
            </div>
            <div className={`lint-summary-card ${result.warnings > 0 ? 'lint-has-warnings' : 'lint-clean'}`}>
              <span className="lint-count">{result.warnings}</span>
              <span className="lint-count-label">Warnungen</span>
            </div>
          </div>

          {result.brokenLinks.length > 0 && (
            <LintSection title="Kaputte Links" type="error" count={result.brokenLinks.length}>
              {result.brokenLinks.map((link, i) => (
                <div key={i} className="lint-item">
                  <span className="lint-item-file">{link.file}</span>
                  <span className="lint-item-arrow">&rarr;</span>
                  <span className="lint-item-target">{link.target}</span>
                </div>
              ))}
            </LintSection>
          )}

          {result.supersededNotStale.length > 0 && (
            <LintSection title="Ersetzt aber nicht stale" type="error" count={result.supersededNotStale.length}>
              {result.supersededNotStale.map((page, i) => (
                <div key={i} className="lint-item">{page}</div>
              ))}
            </LintSection>
          )}

          {result.seedWithMultipleSources.length > 0 && (
            <LintSection title="Seed mit mehreren Quellen" type="error" count={result.seedWithMultipleSources.length}>
              {result.seedWithMultipleSources.map((page, i) => (
                <div key={i} className="lint-item">{page}</div>
              ))}
            </LintSection>
          )}

          {result.orphans.length > 0 && (
            <LintSection title="Verwaiste Seiten" type="warning" count={result.orphans.length}>
              {result.orphans.map((page, i) => (
                <div key={i} className="lint-item">{page}</div>
              ))}
            </LintSection>
          )}

          {result.indexMissing.length > 0 && (
            <LintSection title="Nicht im Index" type="warning" count={result.indexMissing.length}>
              {result.indexMissing.map((page, i) => (
                <div key={i} className="lint-item">{page}</div>
              ))}
            </LintSection>
          )}

          {result.stalePages.length > 0 && (
            <LintSection title="Veraltete Seiten" type="warning" count={result.stalePages.length}>
              {result.stalePages.map((page, i) => (
                <div key={i} className="lint-item">
                  <span>{page.file}</span>
                  <span className="lint-item-meta">{page.age} Tage alt</span>
                </div>
              ))}
            </LintSection>
          )}

          {result.missingTemporalFields.length > 0 && (
            <LintSection title="Fehlende Temporal-Felder" type="info" count={result.missingTemporalFields.length}>
              {result.missingTemporalFields.map((page, i) => (
                <div key={i} className="lint-item">{page}</div>
              ))}
            </LintSection>
          )}

          {result.errors === 0 && result.warnings === 0 && (
            <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
              <p style={{ fontSize: 15, fontWeight: 500 }}>Alles in Ordnung! Keine Probleme gefunden.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LintSection({ title, type, count, children }: {
  title: string;
  type: 'error' | 'warning' | 'info';
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className={`lint-section lint-section-${type}`}>
      <div className="lint-section-header">
        <h3>{title}</h3>
        <span className={`badge badge-${type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'}`}>
          {count}
        </span>
      </div>
      <div className="lint-section-body">
        {children}
      </div>
    </div>
  );
}
