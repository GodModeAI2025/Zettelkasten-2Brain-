import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useWikiStore } from '../stores/wiki.store';
import { MarkdownViewer } from '../components/wiki/MarkdownViewer';
import { FrontmatterBadge } from '../components/wiki/FrontmatterBadge';
import type { WikiPage, WikiReviewItem, WikiReviewReason } from '../../shared/api.types';

type ReviewFilter = 'all' | WikiReviewReason;

const STATUS_OPTIONS = ['', 'seed', 'confirmed', 'stale'];
const CONFIDENCE_OPTIONS = ['', 'high', 'medium', 'low', 'uncertain'];

const FILTERS: Array<{ id: ReviewFilter; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'unreviewed', label: 'Unreviewed' },
  { id: 'seed', label: 'Seed' },
  { id: 'stale', label: 'Stale' },
  { id: 'low-confidence', label: 'Low confidence' },
  { id: 'uncertain', label: 'Uncertain' },
];

const REASON_LABELS: Record<WikiReviewReason, string> = {
  unreviewed: 'unreviewed',
  seed: 'seed',
  stale: 'stale',
  'low-confidence': 'low confidence',
  uncertain: 'uncertain',
};

function countReason(items: WikiReviewItem[], reason: WikiReviewReason): number {
  return items.filter((item) => item.reasons.includes(reason)).length;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function isReviewFilter(value: string | null): value is ReviewFilter {
  return value === 'all' || FILTERS.some((filter) => filter.id === value);
}

function normalizeReviewPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^wiki\//, '');
}

export function ReviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeProject = useProjectStore((s) => s.activeProject);
  const refreshStatus = useProjectStore((s) => s.refreshStatus);
  const addNotification = useAppStore((s) => s.addNotification);
  const reviewQueue = useWikiStore((s) => s.reviewQueue);
  const reviewLoading = useWikiStore((s) => s.reviewLoading);
  const refreshReviewQueue = useWikiStore((s) => s.refreshReviewQueue);
  const setActivePage = useWikiStore((s) => s.setActivePage);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [confidenceDraft, setConfidenceDraft] = useState('');
  const [reviewedDraft, setReviewedDraft] = useState(false);
  const [scopedOutputName, setScopedOutputName] = useState<string | null>(null);
  const [scopedPaths, setScopedPaths] = useState<Set<string> | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  useEffect(() => {
    refreshReviewQueue();
  }, [activeProject, refreshReviewQueue]);

  useEffect(() => {
    const nextFilter = searchParams.get('filter');
    if (isReviewFilter(nextFilter)) setFilter(nextFilter);
    const nextQuery = searchParams.get('q');
    if (nextQuery !== null) setQuery(nextQuery);
  }, [searchParams]);

  useEffect(() => {
    const outputName = searchParams.get('output');
    if (!activeProject || !outputName) {
      setScopedOutputName(null);
      setScopedPaths(null);
      setScopeLoading(false);
      return;
    }

    let cancelled = false;
    setScopeLoading(true);
    setScopedOutputName(outputName);
    api.output.list(activeProject)
      .then((list) => {
        if (cancelled) return;
        const output = list.find((item) => item.name === outputName);
        const paths = output?.sourceReadiness.skippedUnreviewed.map(normalizeReviewPath) || [];
        setScopedPaths(new Set(paths));
      })
      .catch(() => {
        if (cancelled) return;
        setScopedPaths(new Set());
        addNotification('error', 'Output-Quellen konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setScopeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject, searchParams, addNotification]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reviewQueue.filter((item) => {
      if (scopedPaths && !scopedPaths.has(normalizeReviewPath(item.path))) return false;
      if (filter !== 'all' && !item.reasons.includes(filter)) return false;
      if (!needle) return true;
      return `${item.title} ${item.path} ${item.status} ${item.confidence}`.toLowerCase().includes(needle);
    });
  }, [reviewQueue, filter, query, scopedPaths]);
  const scopedOpenCount = useMemo(() => {
    if (!scopedPaths) return 0;
    return reviewQueue.filter((item) => scopedPaths.has(normalizeReviewPath(item.path))).length;
  }, [reviewQueue, scopedPaths]);
  const scopedDoneCount = scopedPaths ? Math.max(scopedPaths.size - scopedOpenCount, 0) : 0;
  const scopedPercent = scopedPaths && scopedPaths.size > 0
    ? Math.round((scopedDoneCount / scopedPaths.size) * 100)
    : 100;
  const emptyReviewText = scopedOutputName && scopedPaths && scopedPaths.size > 0 && scopedOpenCount === 0
    ? 'Alle Output-Quellen sind geprueft.'
    : 'Keine passenden Review-Seiten.';

  const selectedItem = useMemo(
    () => reviewQueue.find((item) => item.path === selectedPath) || null,
    [reviewQueue, selectedPath],
  );
  const selectedIndex = useMemo(
    () => filteredItems.findIndex((item) => item.path === selectedPath),
    [filteredItems, selectedPath],
  );
  const nextItem = selectedIndex >= 0 ? filteredItems[selectedIndex + 1] || null : null;
  const previousItem = selectedIndex > 0 ? filteredItems[selectedIndex - 1] : null;
  const selectedPosition = selectedIndex >= 0 ? selectedIndex + 1 : 0;

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !filteredItems.some((item) => item.path === selectedPath)) {
      setSelectedPath(filteredItems[0].path);
    }
  }, [filteredItems, selectedPath]);

  useEffect(() => {
    if (!activeProject || !selectedPath) {
      setSelectedPage(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    api.wiki.readPage(activeProject, selectedPath)
      .then((page) => {
        if (cancelled) return;
        setSelectedPage(page);
        setStatusDraft(typeof page.frontmatter.status === 'string' ? page.frontmatter.status : '');
        setConfidenceDraft(typeof page.frontmatter.confidence === 'string' ? page.frontmatter.confidence : '');
        setReviewedDraft(page.frontmatter.reviewed === true);
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedPage(null);
        addNotification('error', 'Review-Seite konnte nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject, selectedPath, addNotification]);

  const goToWiki = () => {
    if (!selectedPath) return;
    setActivePage(selectedPath);
    navigate('/wiki');
  };

  const nextPathAfter = (currentPath: string): string | null => {
    const currentIndex = filteredItems.findIndex((item) => item.path === currentPath);
    const nextItem = filteredItems[currentIndex + 1] || filteredItems[currentIndex - 1] || null;
    return nextItem?.path || null;
  };

  const moveSelection = (direction: 1 | -1) => {
    if (filteredItems.length === 0) return;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : direction === 1 ? -1 : filteredItems.length;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), filteredItems.length - 1);
    setSelectedPath(filteredItems[nextIndex].path);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault();
        moveSelection(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredItems, selectedIndex]);

  const skipCurrent = () => {
    if (!selectedPath) return;
    setSelectedPath(nextPathAfter(selectedPath));
  };

  const clearOutputScope = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('output');
    setSearchParams(nextParams);
  };

  const saveReview = async (opts?: { confirm?: boolean; reviewed?: boolean; advance?: boolean }) => {
    if (!activeProject || !selectedPage || !selectedPath) return;
    setSaving(true);
    const nextPath = opts?.advance ? nextPathAfter(selectedPath) : selectedPath;
    const nextStatus = opts?.confirm ? 'confirmed' : statusDraft;
    const nextConfidence = opts?.confirm
      ? confidenceDraft === 'high' ? 'high' : 'medium'
      : confidenceDraft;
    const nextReviewed = opts?.confirm ? true : opts?.reviewed ?? reviewedDraft;

    try {
      await api.wiki.updateFrontmatter(activeProject, selectedPage.relativePath, {
        status: optionalString(nextStatus),
        confidence: optionalString(nextConfidence),
        reviewed: nextReviewed,
      });
      addNotification('success', opts?.confirm ? 'Review bestaetigt.' : 'Review gespeichert.');
      await Promise.all([refreshStatus(), refreshReviewQueue()]);
      setSelectedPath(nextPath);
    } catch (err) {
      addNotification(
        'error',
        `Review konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Review</h1>
          <p>Kein Projekt ausgewaehlt.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header review-header">
        <div>
          <h1>Review</h1>
          <p>Pruefe Seiten, bevor sie in Antworten und Outputs einfliessen.</p>
        </div>
        <button className="btn btn-secondary" onClick={refreshReviewQueue} disabled={reviewLoading}>
          {reviewLoading ? 'Lade...' : 'Aktualisieren'}
        </button>
      </div>

      <div className="review-summary-grid">
        <div className="review-summary-card">
          <span>Offen</span>
          <strong>{reviewQueue.length}</strong>
        </div>
        <div className="review-summary-card">
          <span>Unreviewed</span>
          <strong>{countReason(reviewQueue, 'unreviewed')}</strong>
        </div>
        <div className="review-summary-card">
          <span>Seed</span>
          <strong>{countReason(reviewQueue, 'seed')}</strong>
        </div>
        <div className="review-summary-card">
          <span>Stale</span>
          <strong>{countReason(reviewQueue, 'stale')}</strong>
        </div>
      </div>

      <div className="review-toolbar">
        <div className="review-filter-row">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? 'active' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Seiten suchen..."
          aria-label="Review-Seiten suchen"
        />
      </div>

      {scopedOutputName && (
        <div className="review-scope-banner">
          <div>
            <strong>{scopedOutputName}</strong>
            <span>
              {scopeLoading
                ? 'Lade Output-Quellen...'
                : scopedPaths && scopedPaths.size > 0
                  ? `${scopedOpenCount} von ${scopedPaths.size} Quellen noch offen · ${scopedDoneCount} erledigt`
                  : 'Dieser Output hat keine unreviewed Quellen.'}
            </span>
            {scopedPaths && scopedPaths.size > 0 && (
              <div className="review-scope-progress" aria-label={`${scopedPercent} Prozent erledigt`}>
                <span style={{ width: `${scopedPercent}%` }} />
              </div>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={clearOutputScope}>
            Alle Reviews
          </button>
        </div>
      )}

      <div className="review-workspace">
        <div className="review-list">
          {reviewLoading && reviewQueue.length === 0 ? (
            <div className="review-empty">Lade Review-Warteschlange...</div>
          ) : filteredItems.length === 0 ? (
            <div className="review-empty">{emptyReviewText}</div>
          ) : (
            filteredItems.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`review-item${item.path === selectedPath ? ' active' : ''}`}
                onClick={() => setSelectedPath(item.path)}
              >
                <div className="review-item-main">
                  <strong>{item.title}</strong>
                  <span>{item.path}</span>
                </div>
                <div className="review-item-meta">
                  {item.status && <code>{item.status}</code>}
                  {item.confidence && <code>{item.confidence}</code>}
                  {item.updated && <small>{item.updated}</small>}
                </div>
                <div className="review-reason-row">
                  {item.reasons.map((reason) => (
                    <em key={reason}>{REASON_LABELS[reason]}</em>
                  ))}
                </div>
              </button>
            ))
          )}
        </div>

        <aside className="review-detail">
          {!selectedPath ? (
            <div className="review-empty">Waehle eine Review-Seite aus.</div>
          ) : detailLoading ? (
            <div className="review-empty">Lade Seite...</div>
          ) : !selectedPage ? (
            <div className="review-empty">Seite konnte nicht geladen werden.</div>
          ) : (
            <>
              <div className="review-detail-header">
                <div>
                  <span>Aktuelle Seite</span>
                  <h2>{selectedItem?.title || selectedPath}</h2>
                  <p>{selectedPath}</p>
                </div>
                <FrontmatterBadge frontmatter={selectedPage.frontmatter} />
              </div>

              {selectedItem && (
                <div className="review-detail-reasons">
                  {selectedItem.reasons.map((reason) => (
                    <em key={reason}>{REASON_LABELS[reason]}</em>
                  ))}
                </div>
              )}

              <div className="review-progress-panel">
                <div>
                  <span>Fortschritt</span>
                  <strong>{selectedPosition} von {filteredItems.length}</strong>
                </div>
                <div>
                  <span>Naechste Seite</span>
                  <strong>{nextItem?.title || 'Keine weitere Seite'}</strong>
                </div>
                <div className="review-progress-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => moveSelection(-1)}
                    disabled={!previousItem || saving}
                  >
                    Zurueck
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => moveSelection(1)}
                    disabled={!nextItem || saving}
                  >
                    Weiter
                  </button>
                </div>
              </div>

              <div className="review-field-grid">
                <label className="wiki-field">
                  <span>Status</span>
                  <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option || 'empty'} value={option}>
                        {option || 'Nicht gesetzt'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wiki-field">
                  <span>Confidence</span>
                  <select value={confidenceDraft} onChange={(event) => setConfidenceDraft(event.target.value)}>
                    {CONFIDENCE_OPTIONS.map((option) => (
                      <option key={option || 'empty'} value={option}>
                        {option || 'Nicht gesetzt'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wiki-check review-check">
                  <input
                    type="checkbox"
                    checked={reviewedDraft}
                    onChange={(event) => setReviewedDraft(event.target.checked)}
                  />
                  <span>Geprueft</span>
                </label>
              </div>

              <div className="review-action-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => saveReview({ reviewed: true, advance: true })}
                  disabled={saving}
                >
                  {saving ? 'Speichere...' : 'Geprueft speichern & weiter'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => saveReview({ confirm: true, advance: true })}
                  disabled={saving}
                >
                  Als bestaetigt abschliessen
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => saveReview()}
                  disabled={saving}
                >
                  Nur speichern
                </button>
                <button type="button" className="btn btn-secondary" onClick={skipCurrent} disabled={saving}>
                  Ueberspringen
                </button>
                <button type="button" className="btn btn-secondary" onClick={goToWiki}>
                  Im Wiki oeffnen
                </button>
              </div>

              <div className="review-preview">
                <MarkdownViewer content={stripFrontmatter(selectedPage.content)} />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
