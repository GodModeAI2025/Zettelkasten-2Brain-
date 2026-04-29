interface PageListProps {
  pages: string[];
  activePage: string | null;
  onSelect: (page: string) => void;
}

function pageDisplayName(pagePath: string): string {
  return pagePath.replace(/\.md$/i, '').split('/').pop() || pagePath;
}

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

export function PageList({ pages, activePage, onSelect }: PageListProps) {
  const grouped = groupByDirectory(pages);
  const sortedDirs = [...grouped.keys()].sort();

  return (
    <div className="page-list">
      {sortedDirs.map((dir) => (
        <div key={dir || '__root__'} className="page-list-group">
          {dir && <div className="page-list-dir">{dir}/</div>}
          {(grouped.get(dir) || []).map((page) => (
            <button
              key={page}
              className={`page-list-item ${activePage === page ? 'active' : ''}`}
              onClick={() => onSelect(page)}
              title={page}
            >
              {pageDisplayName(page)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
