import { useState } from 'react';
import { useProjectStore } from '../../stores/project.store';
import { useAppStore } from '../../stores/app.store';
import { useTakeawayStore } from '../../stores/takeaway.store';

interface IngestSummary {
  sourceFile?: string;
  takeaways: string[];
  summary: {
    created: string[];
    updated: string[];
    contradictions: string[];
    superseded: Array<{ old: string; new: string }>;
  };
}

interface TakeawayListProps {
  results: IngestSummary[];
}

interface TakeawayItem {
  key: string;
  text: string;
  sourceFile?: string;
}

export function TakeawayList({ results }: TakeawayListProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const addNotification = useAppStore((s) => s.addNotification);
  const conversations = useTakeawayStore((s) => s.conversations);
  const openKey = useTakeawayStore((s) => s.openKey);
  const setOpenKey = useTakeawayStore((s) => s.setOpenKey);
  const addMessage = useTakeawayStore((s) => s.addMessage);
  const clearConversation = useTakeawayStore((s) => s.clearConversation);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  if (results.length === 0) return null;

  const allTakeaways: TakeawayItem[] = results.flatMap((r, ri) =>
    (r.takeaways || []).map((t, ti) => ({
      key: `${ri}-${ti}-${r.sourceFile ?? ''}`,
      text: t,
      sourceFile: r.sourceFile,
    })),
  );
  const allCreated = results.flatMap((r) => r.summary?.created || []);
  const allUpdated = results.flatMap((r) => r.summary?.updated || []);
  const allContradictions = results.flatMap((r) => r.summary?.contradictions || []);

  const toggle = (key: string) => {
    setOpenKey(openKey === key ? null : key);
  };

  const sendMessage = async (item: TakeawayItem) => {
    if (!activeProject) return;
    const question = (draft[item.key] || '').trim();
    if (!question) return;
    const history = conversations[item.key] || [];
    setBusy((b) => ({ ...b, [item.key]: true }));
    addMessage(item.key, { role: 'user', content: question });
    setDraft((d) => ({ ...d, [item.key]: '' }));
    try {
      const answer = await window.api.takeaway.discuss({
        projectName: activeProject,
        takeaway: item.text,
        sourceFile: item.sourceFile,
        history,
        question,
      });
      addMessage(item.key, { role: 'assistant', content: answer });
    } catch (err) {
      addNotification(
        'error',
        `Diskussion fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy((b) => ({ ...b, [item.key]: false }));
    }
  };

  const synthesize = async (item: TakeawayItem) => {
    if (!activeProject) return;
    const history = conversations[item.key] || [];
    if (history.length === 0) {
      addNotification('info', 'Noch keine Diskussion zum Synthetisieren.');
      return;
    }
    setBusy((b) => ({ ...b, [item.key]: true }));
    try {
      const res = await window.api.takeaway.synthesize({
        projectName: activeProject,
        takeaway: item.text,
        sourceFile: item.sourceFile,
        history,
      });
      addNotification('success', `Synthese erstellt: ${res.title} (${res.path})`);
      clearConversation(item.key);
      setOpenKey(null);
    } catch (err) {
      addNotification(
        'error',
        `Synthese fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy((b) => ({ ...b, [item.key]: false }));
    }
  };

  return (
    <div className="takeaway-section">
      {allTakeaways.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Kernaussagen</h3>
          <ul className="takeaway-list">
            {allTakeaways.map((item) => {
              const history = conversations[item.key] || [];
              const isOpen = openKey === item.key;
              const isBusy = !!busy[item.key];
              return (
                <li key={item.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>{item.text}</div>
                    <button
                      className="btn btn-small"
                      onClick={() => toggle(item.key)}
                      disabled={isBusy}
                    >
                      {isOpen ? 'Schliessen' : history.length > 0 ? `Weiter (${history.length})` : 'Diskutieren'}
                    </button>
                  </div>
                  {isOpen && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 12,
                        background: 'var(--bg-subtle, #f6f6f6)',
                        borderRadius: 6,
                      }}
                    >
                      {history.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          {history.map((m, mi) => (
                            <div
                              key={mi}
                              style={{
                                marginBottom: 6,
                                padding: 8,
                                background: m.role === 'user' ? 'var(--bg-user, #e8f0fe)' : 'var(--bg-assistant, #fff)',
                                borderRadius: 4,
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              <strong>{m.role === 'user' ? 'Du' : 'Assistent'}:</strong>
                              <div>{m.content}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={draft[item.key] || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [item.key]: e.target.value }))}
                        placeholder="Impuls, Frage oder Gegenposition..."
                        rows={3}
                        style={{ width: '100%', marginBottom: 8 }}
                        disabled={isBusy}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-primary btn-small"
                          onClick={() => sendMessage(item)}
                          disabled={isBusy || !(draft[item.key] || '').trim()}
                        >
                          {isBusy ? 'Laedt...' : 'Senden'}
                        </button>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => synthesize(item)}
                          disabled={isBusy || history.length === 0}
                        >
                          Als Synthese speichern
                        </button>
                        {history.length > 0 && (
                          <button
                            className="btn btn-ghost btn-small"
                            onClick={() => clearConversation(item.key)}
                            disabled={isBusy}
                          >
                            Zuruecksetzen
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="ingest-stats">
        {allCreated.length > 0 && (
          <div className="stat-card">
            <div className="stat-number">{allCreated.length}</div>
            <div className="stat-label">Erstellt</div>
            <div className="stat-detail">{allCreated.join(', ')}</div>
          </div>
        )}
        {allUpdated.length > 0 && (
          <div className="stat-card">
            <div className="stat-number">{allUpdated.length}</div>
            <div className="stat-label">Aktualisiert</div>
            <div className="stat-detail">{allUpdated.join(', ')}</div>
          </div>
        )}
        {allContradictions.length > 0 && (
          <div className="stat-card stat-card-warn">
            <div className="stat-number">{allContradictions.length}</div>
            <div className="stat-label">Widersprueche</div>
            <div className="stat-detail">{allContradictions.join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
