import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/bridge';
import { useProjectStore } from '../stores/project.store';
import { useAppStore } from '../stores/app.store';
import { useWikiStore } from '../stores/wiki.store';
import { MarkdownViewer } from '../components/wiki/MarkdownViewer';
import { FrontmatterBadge } from '../components/wiki/FrontmatterBadge';
import { WikiInspector } from '../components/wiki/WikiInspector';
import type { WikiBacklink, WikiFrontmatterPatch } from '../../shared/api.types';

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

function extractWikilinks(value: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

function stripWikiPrefix(relativePath: string): string {
  return relativePath.replace(/^wiki\//, '');
}

function pageTitle(relativePath: string): string {
  const fallback = relativePath.replace(/\.md$/i, '');
  return (fallback.split('/').pop() || fallback)
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
  const refreshStatus = useProjectStore((s) => s.refreshStatus);
  const addNotification = useAppStore((s) => s.addNotification);
  const pages = useWikiStore((s) => s.pages);
  const activePage = useWikiStore((s) => s.activePage);
  const setActivePage = useWikiStore((s) => s.setActivePage);
  const refreshPages = useWikiStore((s) => s.refreshPages);
  const reviewQueue = useWikiStore((s) => s.reviewQueue);
  const reviewQueueLoading = useWikiStore((s) => s.reviewLoading);
  const refreshReviewQueue = useWikiStore((s) => s.refreshReviewQueue);
  const [loadedPage, setLoadedPage] = useState<LoadedPage | null>(null);
  const [backlinks, setBacklinks] = useState<WikiBacklink[]>([]);
  const [backlinksLoading, setBacklinksLoading] = useState(false);
  const [creatingLink, setCreatingLink] = useState<string | null>(null);
  const [savingInspector, setSavingInspector] = useState(false);

  // Seite laden wenn activePage sich aendert
  useEffect(() => {
    if (!activeProject || !activePage) {
      setLoadedPage(null);
      setBacklinks([]);
      setBacklinksLoading(false);
      return;
    }
    api.wiki.readPage(activeProject, activePage)
      .then(setLoadedPage)
      .catch(() => {
        addNotification('error', 'Seite konnte nicht geladen werden.');
        setLoadedPage(null);
      });
  }, [activeProject, activePage]);

  useEffect(() => {
    refreshReviewQueue();
  }, [activeProject, refreshReviewQueue]);

  useEffect(() => {
    if (!activeProject || !activePage) return;
    let cancelled = false;
    setBacklinksLoading(true);
    setBacklinks([]);
    api.wiki.listBacklinks(activeProject, activePage)
      .then((items) => {
        if (!cancelled) setBacklinks(items);
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      })
      .finally(() => {
        if (!cancelled) setBacklinksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, activePage]);

  const handleWikilinkClick = useCallback(
    (target: string) => {
      const match = resolveWikilink(target, pages);
      if (match) {
        setActivePage(match);
      } else {
        addNotification('info', `Seite "${target}" nicht gefunden. Du kannst sie im Inspektor anlegen.`);
      }
    },
    [pages, setActivePage, addNotification],
  );

  const displayContent = loadedPage ? loadedPage.content.replace(/^---\n[\s\S]*?\n---\n?/, '') : '';
  const currentPagePath = loadedPage ? stripWikiPrefix(loadedPage.relativePath) : activePage || '';
  const currentReviewItem = useMemo(
    () => reviewQueue.find((item) => item.path === currentPagePath) || null,
    [reviewQueue, currentPagePath],
  );
  const nextReviewItem = useMemo(
    () => reviewQueue.find((item) => item.path !== currentPagePath) || null,
    [reviewQueue, currentPagePath],
  );
  const missingLinks = useMemo(() => {
    if (!displayContent) return [];
    return extractWikilinks(displayContent).filter((link) => !resolveWikilink(link, pages));
  }, [displayContent, pages]);

  const goToNextReview = useCallback(() => {
    if (!nextReviewItem) return;
    setActivePage(nextReviewItem.path);
  }, [nextReviewItem, setActivePage]);

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

  const handleFrontmatterSave = async (patch: WikiFrontmatterPatch) => {
    if (!activeProject || !loadedPage) return;
    setSavingInspector(true);
    try {
      const updated = await api.wiki.updateFrontmatter(
        activeProject,
        loadedPage.relativePath,
        patch,
      );
      setLoadedPage({
        relativePath: updated.relativePath,
        content: updated.content,
        frontmatter: updated.frontmatter,
      });
      await Promise.all([refreshStatus(), refreshReviewQueue()]);
      addNotification('success', 'Wiki-Metadaten gespeichert.');
    } catch (err) {
      addNotification(
        'error',
        `Metadaten konnten nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSavingInspector(false);
    }
  };

  const handleCreateMissingLink = async (title: string) => {
    if (!activeProject || !loadedPage) return;
    setCreatingLink(title);
    try {
      const created = await api.wiki.createPage(activeProject, {
        title,
        category: 'concepts',
        sourcePath: loadedPage.relativePath,
      });
      await Promise.all([refreshPages(), refreshStatus(), refreshReviewQueue()]);
      setActivePage(stripWikiPrefix(created.relativePath));
      addNotification('success', `Wiki-Seite "${title}" angelegt.`);
    } catch (err) {
      addNotification(
        'error',
        `Seite konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCreatingLink(null);
    }
  };

  return (
    <div className="wiki-workspace">
      <article className="wiki-reader">
        <div className="wiki-reader-header">
          <h1>{pageTitle(loadedPage.relativePath)}</h1>
          <FrontmatterBadge frontmatter={loadedPage.frontmatter} />
        </div>
        <MarkdownViewer
          content={displayContent}
          onWikilinkClick={handleWikilinkClick}
        />
      </article>
      <WikiInspector
        relativePath={loadedPage.relativePath}
        content={displayContent}
        frontmatter={loadedPage.frontmatter}
        backlinks={backlinks}
        backlinksLoading={backlinksLoading}
        missingLinks={missingLinks}
        creatingLink={creatingLink}
        reviewQueueCount={reviewQueue.length}
        reviewQueueLoading={reviewQueueLoading}
        currentReviewReasons={currentReviewItem?.reasons || []}
        nextReviewTitle={nextReviewItem?.title || ''}
        saving={savingInspector}
        onSave={handleFrontmatterSave}
        onNavigate={setActivePage}
        onCreateMissingLink={handleCreateMissingLink}
        onNextReview={goToNextReview}
      />
    </div>
  );
}
