import { useState } from 'react';

interface CreateProjectDialogProps {
  onSubmit: (data: { name: string; domain: string; language: string }) => void;
  onCancel: () => void;
  creating: boolean;
}

export function CreateProjectDialog({ onSubmit, onCancel, creating }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState('de');

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), domain: domain.trim(), language });
  };

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3>Neues Projekt</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Alle Projekte werden im selben Git-Repository gespeichert.
        </p>

        <div className="input-group">
          <label>Projektname</label>
          <input
            type="text"
            placeholder="z.B. energiewende, diplomarbeit, produktstrategie..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </div>

        <div className="input-group">
          <label>Themengebiet / Domain</label>
          <input
            type="text"
            placeholder="z.B. Erneuerbare Energien, Software-Architektur..."
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        <div className="input-group">
          <label>Sprache</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="confirm-dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={creating}>
            Abbrechen
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={creating || !name.trim()}
          >
            {creating ? 'Erstelle...' : 'Projekt erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
