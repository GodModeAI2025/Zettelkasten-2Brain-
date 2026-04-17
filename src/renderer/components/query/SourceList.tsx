interface SourceListProps {
  sources: string[];
}

export function SourceList({ sources }: SourceListProps) {
  if (sources.length === 0) return null;

  return (
    <div className="source-list">
      <span className="source-label">Quellen:</span>
      {sources.map((source, i) => (
        <span key={i} className="source-tag">{source}</span>
      ))}
    </div>
  );
}
