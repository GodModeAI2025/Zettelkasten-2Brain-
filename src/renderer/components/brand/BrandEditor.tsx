import { useEffect, useState } from 'react';
import { api } from '../../api/bridge';
import { useAppStore } from '../../stores/app.store';
import type { BrandDocName } from '../../../shared/api.types';

interface BrandEditorProps {
  projectName: string;
  name: BrandDocName;
  title: string;
  description: string;
}

export function BrandEditor({ projectName, name, title, description }: BrandEditorProps) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const addNotification = useAppStore((s) => s.addNotification);

  const dirty = content !== original;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.brand.read(projectName, name)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
      })
      .catch((err) => {
        if (cancelled) return;
        addNotification('error', `${title} konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, name, title, addNotification]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.brand.write(projectName, name, content);
      setOriginal(content);
      addNotification('success', `${title} gespeichert.`);
    } catch (err) {
      addNotification('error', `Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm(`${title} auf Standardvorlage zuruecksetzen? Aktueller Inhalt wird ueberschrieben.`)) return;
    setResetting(true);
    try {
      await api.brand.reset(projectName, name);
      const fresh = await api.brand.read(projectName, name);
      setContent(fresh);
      setOriginal(fresh);
      addNotification('success', `${title} auf Vorlage zurueckgesetzt.`);
    } catch (err) {
      addNotification('error', `Reset fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--text-secondary)' }}>Lade {title}...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>{description}</p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 420,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          lineHeight: 1.55,
          padding: 14,
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!dirty || saving || resetting}
        >
          {saving ? 'Speichere...' : 'Speichern'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleReset}
          disabled={saving || resetting}
          title="Inhalt durch Standardvorlage ersetzen"
        >
          {resetting ? 'Setze zurueck...' : 'Auf Vorlage zuruecksetzen'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
          {content.length.toLocaleString('de-DE')} Zeichen{dirty ? ' — ungespeichert' : ''}
        </span>
      </div>
    </div>
  );
}
