import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useWikiStore } from '../stores/wiki.store';
import { MarkdownViewer } from '../components/wiki/MarkdownViewer';
import { FrontmatterBadge } from '../components/wiki/FrontmatterBadge';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) =>
      c === 'ä' ? 'ae' : c === 'ö' ? 'oe' : c === 'ü' ? 'ue' : 'ss'
    )
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function alphaOnly(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveWikilink(target: string, pages: string[]): string | null {
  const normalized = target.toLowerCase().replace(/\.md$/i, '');
  const slugged = slugify(target);
  const withoutParens = target.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const sluggedNoParens = slugify(withoutParens);
  const targetAlpha = alphaOnly(target);

  for (const p of pages) {
    const pNorm = p.replace(/\.md$/i, '').toLowerCase();
    const pName = p.replace(/\.md$/i, '').split('/').pop()?.toLowerCase() || '';
    const pSlug = slugify(pName);
    const pAlpha = alphaOnly(pName);

    if (pNorm === normalized || pName === normalized) return p;
    if (pNorm.endsWith('/' + normalized)) return p;
    if (pSlug === slugged || pSlug === sluggedNoParens) return p;
    if (pName.replace(/-/g, ' ') === normalized) return p;
    // Alpha-only Vergleich (ignoriert alle Sonderzeichen und Trennzeichen)
    if (pAlpha === targetAlpha) return p;
    if (pAlpha === alphaOnly(withoutParens)) return p;
  }
  return null;
}

function pageTitle(relativePath: string): string {
  return relativePath
    .replace(/\.md$/i, '')
    .split('/').pop()!
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface LoadedPage {
  relativePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

export function WikiPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const addNotification = useAppStore((s) => s.addNotification);
  const pages = useWikiStore((s) => s.pages);
  const activePage = useWikiStore((s) => s.activePage);
  const setActivePage = useWikiStore((s) => s.setActivePage);
  const [loadedPage, setLoadedPage] = useState<LoadedPage | null>(null);

  // Seite laden wenn activePage sich aendert
  useEffect(() => {
    if (!activeProject || !activePage) {
      setLoadedPage(null);
      return;
    }
    api.wiki.readPage(activeProject, activePage)
      .then(setLoadedPage)
      .catch(() => {
        addNotification('error', 'Seite konnte nicht geladen werden.');
        setLoadedPage(null);
      });
  }, [activeProject, activePage]);

  const handleWikilinkClick = useCallback(
    (target: string) => {
      const match = resolveWikilink(target, pages);
      if (match) {
        setActivePage(match);
      } else {
        addNotification('info', `Seite "${target}" nicht gefunden.`);
      }
    },
    [pages, setActivePage, addNotification],
  );

  if (!activeProject) {
    return (
      <div className="wiki-empty-page">
        <p>Kein Projekt ausgewaehlt.</p>
      </div>
    );
  }

  if (!loadedPage) {
    return (
      <div className="wiki-empty-page">
        <h2>Wiki</h2>
        <p>Waehle eine Seite in der Sidebar.</p>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
          {pages.length} Seiten verfuegbar
        </p>
      </div>
    );
  }

  // Frontmatter aus dem Content entfernen fuer die Anzeige
  const displayContent = loadedPage.content.replace(/^---\n[\s\S]*?\n---\n?/, '');

  const reviewed = loadedPage.frontmatter.reviewed as boolean | undefined;
  const canToggleReview = reviewed !== undefined;

  const handleToggleReview = async () => {
    if (!activeProject || !loadedPage) return;
    try {
      const updated = await api.wiki.setReviewed(
        activeProject,
        loadedPage.relativePath,
        !(reviewed === true),
      );
      setLoadedPage({
        relativePath: updated.relativePath,
        content: updated.content,
        frontmatter: updated.frontmatter,
      });
      addNotification(
        'success',
        !(reviewed === true) ? 'Als reviewed markiert.' : 'Review-Status zurueckgesetzt.',
      );
    } catch {
      addNotification('error', 'Review-Status konnte nicht aktualisiert werden.');
    }
  };

  return (
    <div className="wiki-reader">
      <div className="wiki-reader-header">
        <h1>{pageTitle(loadedPage.relativePath)}</h1>
        <FrontmatterBadge frontmatter={loadedPage.frontmatter} />
        {canToggleReview && (
          <button
            type="button"
            className={`btn btn-sm ${reviewed === true ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleToggleReview}
            style={{ marginLeft: 'auto' }}
          >
            {reviewed === true ? 'Review zuruecksetzen' : 'Als reviewed markieren'}
          </button>
        )}
      </div>
      <MarkdownViewer
        content={displayContent}
        onWikilinkClick={handleWikilinkClick}
      />
    </div>
  );
}
