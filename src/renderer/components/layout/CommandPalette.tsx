import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../stores/project.store';
import { useWikiStore } from '../../stores/wiki.store';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  section: string;
  title: string;
  subtitle: string;
  keywords: string[];
  run: () => void;
}

const MAX_RESULTS = 18;
const SYSTEM_PAGES = new Set(['index', 'log']);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[äöüß]/g, (c) =>
    c === 'ä' ? 'ae' : c === 'ö' ? 'oe' : c === 'ü' ? 'ue' : 'ss'
  );
}

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

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const activeProject = useProjectStore((s) => s.activeProject);
  const pages = useWikiStore((s) => s.pages);
  const setActivePage = useWikiStore((s) => s.setActivePage);
  const refreshPages = useWikiStore((s) => s.refreshPages);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (activeProject && pages.length === 0) {
      refreshPages().catch(() => undefined);
    }
  }, [open, activeProject, pages.length, refreshPages]);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const actionCommands = useMemo<CommandItem[]>(() => [
    {
      id: 'dashboard',
      section: 'Navigation',
      title: 'Dashboard',
      subtitle: 'Projektstatus und naechste Schritte',
      keywords: ['home', 'status', 'overview'],
      run: () => go('/dashboard'),
    },
    {
      id: 'raw',
      section: 'Navigation',
      title: 'Rohdaten',
      subtitle: 'Dateien hochladen und verwalten',
      keywords: ['upload', 'datei', 'import'],
      run: () => go('/raw'),
    },
    {
      id: 'wiki',
      section: 'Navigation',
      title: 'Wiki',
      subtitle: 'Seiten lesen und Metadaten pflegen',
      keywords: ['seiten', 'notizen', 'lesen'],
      run: () => go('/wiki'),
    },
    {
      id: 'query',
      section: 'Navigation',
      title: 'Query',
      subtitle: 'Fragen an das Wiki stellen',
      keywords: ['chat', 'frage', 'ki'],
      run: () => go('/query'),
    },
    {
      id: 'ingest',
      section: 'Aktionen',
      title: 'Ingest',
      subtitle: 'Neue Quellen in Wiki-Seiten verwandeln',
      keywords: ['verarbeiten', 'claude', 'analyse'],
      run: () => go('/ingest'),
    },
    {
      id: 'lint',
      section: 'Aktionen',
      title: 'Gesundheitscheck',
      subtitle: 'Links, Luecken und Metadaten pruefen',
      keywords: ['lint', 'pruefung', 'reparatur'],
      run: () => go('/lint'),
    },
    {
      id: 'review',
      section: 'Aktionen',
      title: 'Review',
      subtitle: 'Offene Wiki-Seiten pruefen',
      keywords: ['review', 'unreviewed', 'seed', 'stale', 'pruefen'],
      run: () => go('/review'),
    },
    {
      id: 'graph',
      section: 'Ansichten',
      title: 'Graph',
      subtitle: 'Wissensnetz visualisieren',
      keywords: ['netz', 'visualisierung', 'knoten'],
      run: () => go('/graph'),
    },
    {
      id: 'output',
      section: 'Aktionen',
      title: 'Outputs',
      subtitle: 'Dokumente und Praesentationen generieren',
      keywords: ['skill', 'marp', 'praesentation', 'dokument'],
      run: () => go('/output'),
    },
    {
      id: 'changes',
      section: 'System',
      title: 'Aenderungen',
      subtitle: 'Git-Status, lokale Dateien und letzte Commits',
      keywords: ['git', 'sync', 'commit', 'version'],
      run: () => go('/changes'),
    },
    {
      id: 'brand',
      section: 'Navigation',
      title: 'Brand',
      subtitle: 'Stimme, Stil und Positionierung pflegen',
      keywords: ['voice', 'style', 'identitaet'],
      run: () => go('/brand'),
    },
    {
      id: 'settings',
      section: 'System',
      title: 'Einstellungen',
      subtitle: 'API, Git, Projekte und Darstellung',
      keywords: ['settings', 'git', 'api', 'projekt'],
      run: () => go('/settings'),
    },
  ], [navigate, onClose]);

  const wikiCommands = useMemo<CommandItem[]>(() => {
    if (!activeProject) return [];
    return pages
      .filter((page) => !isSystemPage(page))
      .map((page) => ({
        id: `wiki:${page}`,
        section: 'Wiki-Seiten',
        title: pageDisplayName(page),
        subtitle: page,
        keywords: ['wiki', 'seite', page],
        run: () => {
          setActivePage(page);
          navigate('/wiki');
          onClose();
        },
      }));
  }, [activeProject, pages, setActivePage, navigate, onClose]);

  const visibleCommands = useMemo(() => {
    const all = [...actionCommands, ...wikiCommands];
    const needle = normalize(query.trim());
    if (!needle) return all.slice(0, MAX_RESULTS);
    return all
      .filter((cmd) => {
        const haystack = normalize([
          cmd.title,
          cmd.subtitle,
          cmd.section,
          ...cmd.keywords,
        ].join(' '));
        return haystack.includes(needle);
      })
      .slice(0, MAX_RESULTS);
  }, [actionCommands, wikiCommands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (selectedIndex >= visibleCommands.length) {
      setSelectedIndex(Math.max(0, visibleCommands.length - 1));
    }
  }, [selectedIndex, visibleCommands.length]);

  if (!open) return null;

  const selected = visibleCommands[selectedIndex];

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleCommands.length === 0) return;
      setSelectedIndex((idx) => Math.min(idx + 1, visibleCommands.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleCommands.length === 0) return;
      setSelectedIndex((idx) => Math.max(idx - 1, 0));
      return;
    }
    if (e.key === 'Enter' && selected) {
      e.preventDefault();
      selected.run();
    }
  }

  return (
    <div className="command-palette-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="command-palette-input-row">
          <span className="command-palette-symbol">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Aktion oder Wiki-Seite suchen..."
          />
        </div>

        <div className="command-palette-list" role="listbox">
          {visibleCommands.length === 0 ? (
            <div className="command-palette-empty">Keine Treffer.</div>
          ) : (
            visibleCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                className={`command-palette-item${index === selectedIndex ? ' active' : ''}`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={cmd.run}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <span className="command-palette-item-main">
                  <span className="command-palette-item-title">{cmd.title}</span>
                  <span className="command-palette-item-subtitle">{cmd.subtitle}</span>
                </span>
                <span className="command-palette-section">{cmd.section}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
