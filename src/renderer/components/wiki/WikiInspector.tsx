import { useEffect, useMemo, useState } from 'react';
import type { WikiBacklink, WikiFrontmatterPatch, WikiReviewReason } from '../../../shared/api.types';

interface WikiInspectorProps {
  relativePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  backlinks: WikiBacklink[];
  backlinksLoading: boolean;
  missingLinks: string[];
  creatingLink: string | null;
  reviewQueueCount: number;
  reviewQueueLoading: boolean;
  currentReviewReasons: WikiReviewReason[];
  nextReviewTitle: string;
  saving: boolean;
  onSave: (patch: WikiFrontmatterPatch) => Promise<void>;
  onNavigate: (path: string) => void;
  onCreateMissingLink: (title: string) => Promise<void>;
  onNextReview: () => void;
}

const STATUS_OPTIONS = ['', 'seed', 'confirmed', 'stale'];
const CONFIDENCE_OPTIONS = ['', 'high', 'medium', 'low', 'uncertain'];
const REVIEW_REASON_LABELS: Record<WikiReviewReason, string> = {
  unreviewed: 'unreviewed',
  seed: 'seed',
  stale: 'stale',
  'low-confidence': 'low confidence',
  uncertain: 'uncertain',
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function listText(value: unknown, separator = '\n'): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(separator);
  }
  if (typeof value === 'string') return value.trim();
  return '';
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function extractWikilinks(value: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

function collectFrontmatterRelations(frontmatter: Record<string, unknown>): Array<{ key: string; links: string[] }> {
  return Object.entries(frontmatter)
    .map(([key, value]) => {
      const raw = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
      return { key, links: extractWikilinks(raw) };
    })
    .filter((entry) => entry.links.length > 0);
}

export function WikiInspector({
  relativePath,
  content,
  frontmatter,
  backlinks,
  backlinksLoading,
  missingLinks,
  creatingLink,
  reviewQueueCount,
  reviewQueueLoading,
  currentReviewReasons,
  nextReviewTitle,
  saving,
  onSave,
  onNavigate,
  onCreateMissingLink,
  onNextReview,
}: WikiInspectorProps) {
  const [status, setStatus] = useState('');
  const [confidence, setConfidence] = useState('');
  const [type, setType] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [tagsText, setTagsText] = useState('');
  const [sourcesText, setSourcesText] = useState('');
  const [supersededBy, setSupersededBy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [reviewedTouched, setReviewedTouched] = useState(false);

  useEffect(() => {
    setStatus(stringValue(frontmatter.status));
    setConfidence(stringValue(frontmatter.confidence));
    setType(stringValue(frontmatter.type));
    setReviewed(booleanValue(frontmatter.reviewed));
    setTagsText(listText(frontmatter.tags, ', '));
    setSourcesText(listText(frontmatter.sources));
    setSupersededBy(stringValue(frontmatter.superseded_by));
    setDirty(false);
    setReviewedTouched(false);
  }, [frontmatter, relativePath]);

  const frontmatterRelations = useMemo(() => collectFrontmatterRelations(frontmatter), [frontmatter]);
  const bodyLinks = useMemo(() => extractWikilinks(content), [content]);
  const createdText = frontmatter.created == null ? '' : String(frontmatter.created);
  const updatedText = frontmatter.updated == null ? '' : String(frontmatter.updated);

  const markDirty = () => setDirty(true);

  const save = async () => {
    const patch: WikiFrontmatterPatch = {
      status: optionalString(status),
      confidence: optionalString(confidence),
      type: optionalString(type),
      reviewed,
      tags: splitList(tagsText),
      sources: splitList(sourcesText),
      superseded_by: optionalString(supersededBy),
    };
    if (frontmatter.reviewed !== undefined || reviewedTouched) {
      patch.reviewed = reviewed;
    }
    await onSave(patch);
    setDirty(false);
    setReviewedTouched(false);
  };

  return (
    <aside className="wiki-inspector" aria-label="Wiki-Metadaten">
      <div className="wiki-inspector-header">
        <div>
          <h2>Inspektor</h2>
          <p>{relativePath}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? 'Speichere...' : 'Speichern'}
        </button>
      </div>

      <section className="wiki-review-box">
        <div>
          <span>Review</span>
          <strong>{reviewQueueLoading ? 'Lade...' : `${reviewQueueCount} offen`}</strong>
        </div>
        {currentReviewReasons.length > 0 ? (
          <div className="wiki-review-reasons">
            {currentReviewReasons.map((reason) => (
              <em key={reason}>{REVIEW_REASON_LABELS[reason]}</em>
            ))}
          </div>
        ) : (
          <p>Keine offenen Marker auf dieser Seite.</p>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onNextReview}
          disabled={!nextReviewTitle || reviewQueueLoading}
          title={nextReviewTitle ? `Weiter zu ${nextReviewTitle}` : 'Keine weitere Review-Seite'}
        >
          {nextReviewTitle ? 'Naechster Review' : 'Keine weitere Seite'}
        </button>
      </section>

      <section className="wiki-inspector-section">
        <h3>Status</h3>
        <label className="wiki-field">
          <span>Status</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); markDirty(); }}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option || 'empty'} value={option}>
                {option || 'Nicht gesetzt'}
              </option>
            ))}
          </select>
        </label>
        <label className="wiki-field">
          <span>Confidence</span>
          <select value={confidence} onChange={(e) => { setConfidence(e.target.value); markDirty(); }}>
            {CONFIDENCE_OPTIONS.map((option) => (
              <option key={option || 'empty'} value={option}>
                {option || 'Nicht gesetzt'}
              </option>
            ))}
          </select>
        </label>
        <label className="wiki-check">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => {
              setReviewed(e.target.checked);
              setReviewedTouched(true);
              markDirty();
            }}
          />
          <span>Geprueft</span>
        </label>
      </section>

      <section className="wiki-inspector-section">
        <h3>Einordnung</h3>
        <label className="wiki-field">
          <span>Typ</span>
          <input value={type} onChange={(e) => { setType(e.target.value); markDirty(); }} />
        </label>
        <label className="wiki-field">
          <span>Tags</span>
          <input
            value={tagsText}
            onChange={(e) => { setTagsText(e.target.value); markDirty(); }}
            placeholder="ai, product, method"
          />
        </label>
      </section>

      <section className="wiki-inspector-section">
        <h3>Quellen</h3>
        <label className="wiki-field">
          <span>sources</span>
          <textarea
            value={sourcesText}
            onChange={(e) => { setSourcesText(e.target.value); markDirty(); }}
            rows={4}
            placeholder="Eine Quelle pro Zeile"
          />
        </label>
      </section>

      <section className="wiki-inspector-section">
        <h3>Beziehungen</h3>
        <label className="wiki-field">
          <span>superseded_by</span>
          <input
            value={supersededBy}
            onChange={(e) => { setSupersededBy(e.target.value); markDirty(); }}
            placeholder="[[neuere-seite]]"
          />
        </label>
        {frontmatterRelations.length > 0 ? (
          <div className="wiki-relation-list">
            {frontmatterRelations.map((entry) => (
              <div key={entry.key} className="wiki-relation-group">
                <span>{entry.key}</span>
                <div>
                  {entry.links.map((link) => (
                    <code key={link}>{link}</code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="wiki-inspector-muted">Keine Frontmatter-Wikilinks.</p>
        )}
      </section>

      <section className="wiki-inspector-section">
        <h3>Textlinks</h3>
        {bodyLinks.length > 0 ? (
          <div className="wiki-link-cloud">
            {bodyLinks.slice(0, 24).map((link) => (
              <span key={link}>{link}</span>
            ))}
            {bodyLinks.length > 24 && <span>+{bodyLinks.length - 24}</span>}
          </div>
        ) : (
          <p className="wiki-inspector-muted">Keine Wikilinks im Text.</p>
        )}
      </section>

      <section className="wiki-inspector-section">
        <h3>Fehlende Links</h3>
        {missingLinks.length > 0 ? (
          <div className="wiki-missing-list">
            {missingLinks.map((link) => (
              <button
                key={link}
                type="button"
                className="wiki-missing-item"
                onClick={() => onCreateMissingLink(link)}
                disabled={creatingLink === link}
              >
                <span>{link}</span>
                <small>{creatingLink === link ? 'Lege an...' : 'Als Konzept anlegen'}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="wiki-inspector-muted">Alle Textlinks zeigen auf vorhandene Seiten.</p>
        )}
      </section>

      <section className="wiki-inspector-section">
        <h3>Ruecklinks</h3>
        {backlinksLoading ? (
          <p className="wiki-inspector-muted">Suche Verweise...</p>
        ) : backlinks.length > 0 ? (
          <div className="wiki-backlink-list">
            {backlinks.map((backlink) => (
              <button
                key={backlink.path}
                type="button"
                className="wiki-backlink-item"
                onClick={() => onNavigate(backlink.path)}
              >
                <span>{backlink.title}</span>
                <small>
                  {backlink.count} {backlink.count === 1 ? 'Verweis' : 'Verweise'}
                  {backlink.matches.length > 0 && ` - ${backlink.matches.slice(0, 2).join(', ')}`}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="wiki-inspector-muted">Keine Ruecklinks gefunden.</p>
        )}
      </section>

      <section className="wiki-inspector-section">
        <h3>System</h3>
        <dl className="wiki-meta-list">
          {createdText && (
            <>
              <dt>created</dt>
              <dd>{createdText}</dd>
            </>
          )}
          {updatedText && (
            <>
              <dt>updated</dt>
              <dd>{updatedText}</dd>
            </>
          )}
        </dl>
      </section>
    </aside>
  );
}
