interface FileCardProps {
  filename: string;
  ingested: boolean;
  onDelete: (filename: string) => void;
  onForget?: (filename: string) => void;
  onView: (filename: string) => void;
  deleting: boolean;
  forgetting?: boolean;
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    pdf: '\uD83D\uDCC4',
    txt: '\uD83D\uDCC3',
    md: '\uD83D\uDCDD',
    html: '\uD83C\uDF10',
    csv: '\uD83D\uDCCA',
    json: '{ }',
  };
  return icons[ext] || '\uD83D\uDCC1';
}

export function FileCard({ filename, ingested, onDelete, onForget, onView, deleting, forgetting }: FileCardProps) {
  return (
    <div className="file-card">
      <div className="file-card-icon">{getFileIcon(filename)}</div>
      <div className="file-card-info">
        <span className="file-card-name" title={filename}>{filename}</span>
        <span className={`file-card-status ${ingested ? 'ingested' : 'new'}`}>
          {ingested ? 'Verarbeitet' : 'Neu'}
        </span>
      </div>
      <div className="file-card-actions">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => onView(filename)}
          title="Anzeigen"
        >
          Anzeigen
        </button>
        {ingested && onForget && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onForget(filename)}
            disabled={forgetting}
            title="Ingest-Markierung zurücksetzen — Datei wird beim nächsten Ingest erneut angeboten"
          >
            {forgetting ? '...' : 'Vergessen'}
          </button>
        )}
        <button
          className="btn btn-danger btn-sm"
          onClick={() => onDelete(filename)}
          disabled={deleting}
          title="Datei und zugehörige Wiki-Einträge löschen"
        >
          {deleting ? '...' : 'Löschen'}
        </button>
      </div>
    </div>
  );
}
