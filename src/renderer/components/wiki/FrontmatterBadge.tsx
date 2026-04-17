interface FrontmatterBadgeProps {
  frontmatter: Record<string, unknown>;
}

function statusClass(status: string): string {
  switch (status) {
    case 'confirmed': return 'badge-success';
    case 'seed': return 'badge-warning';
    case 'stale': return 'badge-error';
    default: return 'badge-info';
  }
}

function confidenceClass(conf: string): string {
  switch (conf) {
    case 'high': return 'badge-success';
    case 'medium': return 'badge-warning';
    case 'low': return 'badge-error';
    case 'uncertain': return 'badge-error';
    default: return 'badge-info';
  }
}

export function FrontmatterBadge({ frontmatter }: FrontmatterBadgeProps) {
  const status = frontmatter.status as string | undefined;
  const confidence = frontmatter.confidence as string | undefined;
  const type = frontmatter.type as string | undefined;
  const created = frontmatter.created as string | undefined;
  const reviewed = frontmatter.reviewed as boolean | undefined;

  return (
    <div className="frontmatter-badges">
      {type && (
        <span className="badge badge-info">{type}</span>
      )}
      {status && (
        <span className={`badge ${statusClass(status)}`}>{status}</span>
      )}
      {confidence && (
        <span className={`badge ${confidenceClass(confidence)}`} title={`Confidence: ${confidence}`}>
          conf: {confidence}
        </span>
      )}
      {reviewed === false && (
        <span className="badge badge-warning" title="Diese Seite wurde noch nicht von dir geprueft">
          unreviewed
        </span>
      )}
      {reviewed === true && (
        <span className="badge badge-success" title="Von dir bestaetigt">
          reviewed
        </span>
      )}
      {created && (
        <span className="badge badge-neutral">
          {created}
        </span>
      )}
    </div>
  );
}
