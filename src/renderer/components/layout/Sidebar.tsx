import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useProjectStore } from '../../stores/project.store';
import { useIngestStore } from '../../stores/ingest.store';
import { useWikiStore } from '../../stores/wiki.store';
import { useAppStore } from '../../stores/app.store';
import { CreateProjectDialog } from '../shared/CreateProjectDialog';
import { api } from '../../api/bridge';

const NAV_SECTION_DATA = [
  { to: '/raw', icon: '\u2191', label: 'Rohdaten' },
];

const NAV_SECTION_VIS = [
  // Wiki wird separat gerendert (mit SubNav)
  { to: '/graph', icon: '\u25C9', label: 'Graph' },
];

const NAV_SECTION_MGMT = [
  { to: '/ingest', icon: '\u26A1', label: 'Ingest' },
  { to: '/lint', icon: '\u2713', label: 'Gesundheitscheck' },
  { to: '/query', icon: '?', label: 'Query' },
];

const NAV_SECTION_IDENTITY = [
  { to: '/brand', icon: '\u25C6', label: 'Brand' },
];

const NAV_SECTION_OUTPUT = [
  { to: '/output', icon: '\u25A4', label: 'Outputs' },
];

function groupByDirectory(pages: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const parts = page.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const existing = groups.get(dir) || [];
    existing.push(page);
    groups.set(dir, existing);
  }
  return groups;
}

const SYSTEM_PAGES = new Set(['index', 'log']);

function isSystemPage(pagePath: string): boolean {
  const name = pagePath.replace(/\.md$/i, '').split('/').pop()?.toLowerCase() || '';
  return SYSTEM_PAGES.has(name);
}

function pageDisplayName(pagePath: string): string {
  const name = pagePath.replace(/\.md$/i, '').split('/').pop() || pagePath;
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function WikiSubNav() {
  const pages = useWikiStore((s) => s.pages);
  const activePage = useWikiStore((s) => s.activePage);
  const setActivePage = useWikiStore((s) => s.setActivePage);
  const searchQuery = useWikiStore((s) => s.searchQuery);
  const setSearchQuery = useWikiStore((s) => s.setSearchQuery);
  const loading = useWikiStore((s) => s.loading);
  const visiblePages = pages.filter((p) => !isSystemPage(p));

  // Standardmässig alle Ordner zugeklappt
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (collapsedDirs === null && visiblePages.length > 0) {
      const grouped = groupByDirectory(visiblePages);
      const allDirs = [...grouped.keys()].filter((d) => d !== '');
      setCollapsedDirs(new Set(allDirs));
    }
  }, [visiblePages.length, collapsedDirs]);
  const filtered = searchQuery
    ? visiblePages.filter((p) => p.toLowerCase().includes(searchQuery.toLowerCase()))
    : visiblePages;

  const grouped = groupByDirectory(filtered);
  const sortedDirs = [...grouped.keys()].sort();

  const toggleDir = (dir: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const isDirCollapsed = (dir: string) => collapsedDirs?.has(dir) ?? false;

  return (
    <div className="wiki-subnav">
      <input
        type="text"
        placeholder="Suchen..."
        className="wiki-subnav-search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      {loading ? (
        <div className="wiki-subnav-info">Lade...</div>
      ) : filtered.length === 0 ? (
        <div className="wiki-subnav-info">Keine Seiten</div>
      ) : (
        <div className="wiki-subnav-tree">
          {sortedDirs.map((dir) => {
            const dirPages = grouped.get(dir)!;
            const isCollapsed = isDirCollapsed(dir);

            if (!dir) {
              // Root-Seiten (ohne Verzeichnis)
              return dirPages.map((page) => (
                <button
                  key={page}
                  className={`wiki-subnav-page${activePage === page ? ' active' : ''}`}
                  onClick={() => setActivePage(page)}
                  title={page}
                >
                  {pageDisplayName(page)}
                </button>
              ));
            }

            return (
              <div key={dir} className="wiki-subnav-group">
                <button
                  className="wiki-subnav-dir"
                  onClick={() => toggleDir(dir)}
                >
                  <span className="wiki-subnav-dir-arrow">{isCollapsed ? '\u25B8' : '\u25BE'}</span>
                  <span>{dir}/</span>
                  <span className="wiki-subnav-dir-count">{dirPages.length}</span>
                </button>
                {!isCollapsed && dirPages.map((page) => (
                  <button
                    key={page}
                    className={`wiki-subnav-page wiki-subnav-page-nested${activePage === page ? ' active' : ''}`}
                    onClick={() => setActivePage(page)}
                    title={page}
                  >
                    {pageDisplayName(page)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const activeStatus = useProjectStore((s) => s.activeStatus);
  const loadProjects = useProjectStore((s) => s.loadProjects);

  const wikiPages = useWikiStore((s) => s.pages);
  const setWikiPages = useWikiStore((s) => s.setPages);
  const setWikiLoading = useWikiStore((s) => s.setLoading);
  const wikiPageCount = wikiPages.filter((p) => !isSystemPage(p)).length;

  const addNotification = useAppStore((s) => s.addNotification);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isWikiRoute = location.pathname.startsWith('/wiki');
  const [wikiSubNavOpen, setWikiSubNavOpen] = useState(true);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!activeProject) return;
    setWikiLoading(true);
    api.wiki.listPages(activeProject)
      .then((pages) => setWikiPages(pages))
      .catch(() => setWikiPages([]))
      .finally(() => setWikiLoading(false));
  }, [activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    if (switcherOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [switcherOpen]);

  const rawTotal = activeStatus?.rawTotal ?? 0;
  const rawNew = activeStatus?.rawNew ?? 0;
  const graphNodeCount = activeStatus
    ? (activeStatus.sources ?? 0) + (activeStatus.entities ?? 0) + (activeStatus.concepts ?? 0) + (activeStatus.synthesis ?? 0) + (activeStatus.sops ?? 0) + (activeStatus.decisions ?? 0)
    : 0;
  const ingestPhase = useIngestStore((s) => s.phase);
  const ingestRunning = ingestPhase === 'running' || ingestPhase === 'committing';

  function handleProjectSelect(name: string) {
    setActiveProject(name);
    setSwitcherOpen(false);
  }

  async function handleCreateProject(data: { name: string; domain: string; language: string }) {
    setCreatingProject(true);
    try {
      await api.project.create({ name: data.name, domain: data.domain, language: data.language });
      setShowCreateDialog(false);
      await loadProjects();
      setActiveProject(data.name);
      addNotification('success', `Projekt "${data.name}" erstellt.`);
      navigate('/dashboard');
    } catch (err) {
      addNotification('error', `Projekt erstellen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreatingProject(false);
    }
  }

  function renderNavItem(item: { to: string; icon: string; label: string }) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) => isActive ? 'active' : ''}
      >
        <span className="nav-icon">{item.icon}</span>
        <span className="nav-label">{item.label}</span>
        {item.to === '/raw' && rawTotal > 0 && (
          <span className="nav-count">{rawTotal}</span>
        )}
        {item.to === '/graph' && graphNodeCount > 0 && (
          <span className="nav-count">{graphNodeCount}</span>
        )}
        {item.to === '/ingest' && ingestRunning && (
          <span className="nav-activity-dot" />
        )}
        {item.to === '/ingest' && !ingestRunning && rawNew > 0 && (
          <span className="nav-badge">{rawNew}</span>
        )}
      </NavLink>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>2Brain</h2>
        <div className="project-switcher" ref={switcherRef}>
          <button
            className="project-switcher-trigger"
            onClick={() => setSwitcherOpen(!switcherOpen)}
          >
            <span className="project-switcher-name">
              {activeProject ?? 'Projekt waehlen...'}
            </span>
            <span className="project-switcher-arrow">{switcherOpen ? '\u25B4' : '\u25BE'}</span>
          </button>
          {switcherOpen && (
            <div className="project-switcher-dropdown">
              {projects.map((p) => (
                <button
                  key={p.name}
                  className={`project-switcher-option${p.name === activeProject ? ' active' : ''}`}
                  onClick={() => handleProjectSelect(p.name)}
                >
                  {p.name}
                </button>
              ))}
              {projects.length === 0 && (
                <div className="project-switcher-empty">Keine Projekte</div>
              )}
              <button
                className="project-switcher-option project-switcher-create"
                onClick={() => { setSwitcherOpen(false); setShowCreateDialog(true); }}
              >
                + Neues Projekt
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        {/* Dashboard */}
        <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>
          <span className="nav-icon">{'\u25EB'}</span>
          <span className="nav-label">Dashboard</span>
        </NavLink>

        {/* Rohdaten */}
        <div className="sidebar-section-label">Rohdaten</div>
        {NAV_SECTION_DATA.map(renderNavItem)}

        {/* Visualisierung */}
        <div className="sidebar-section-label">Visualisierung</div>
        <NavLink
          to="/wiki"
          className={({ isActive }) => isActive ? 'active' : ''}
          onClick={(e) => {
            if (isWikiRoute) {
              e.preventDefault();
              setWikiSubNavOpen((prev) => !prev);
            } else {
              setWikiSubNavOpen(true);
            }
          }}
        >
          <span className="nav-icon">{'\u2630'}</span>
          <span className="nav-label">Wiki</span>
          {wikiPageCount > 0 && (
            <span className="nav-count">{wikiPageCount}</span>
          )}
        </NavLink>
        {isWikiRoute && wikiSubNavOpen && <WikiSubNav />}
        {NAV_SECTION_VIS.map(renderNavItem)}

        {/* Datenmanagement */}
        <div className="sidebar-section-label">Datenmanagement</div>
        {NAV_SECTION_MGMT.map(renderNavItem)}

        {/* Identitaet */}
        <div className="sidebar-section-label">Identitaet</div>
        {NAV_SECTION_IDENTITY.map(renderNavItem)}

        {/* Output */}
        <div className="sidebar-section-label">Output</div>
        {NAV_SECTION_OUTPUT.map(renderNavItem)}

        {/* Einstellungen */}
        <div className="sidebar-separator" />
        <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
          <span className="nav-icon">{'\u2699'}</span>
          <span className="nav-label">Einstellungen</span>
        </NavLink>
      </nav>

      {showCreateDialog && (
        <CreateProjectDialog
          onSubmit={handleCreateProject}
          onCancel={() => setShowCreateDialog(false)}
          creating={creatingProject}
        />
      )}
    </aside>
  );
}
