import { useState } from 'react';
import { useProjectStore } from '../stores/project.store';
import { BrandEditor } from '../components/brand/BrandEditor';
import type { BrandDocName } from '../../shared/api.types';

interface TabDef {
  name: BrandDocName;
  label: string;
  description: string;
}

const TABS: TabDef[] = [
  {
    name: 'voice',
    label: 'Voice',
    description: 'Tonalitaet, Haltung und Perspektive. Praegt, wie die KI formuliert — nicht was sie sagt.',
  },
  {
    name: 'style',
    label: 'Style',
    description: 'Formale Regeln: Satzlaenge, Typografie, Aufzaehlungen, Anrede, Zitationen.',
  },
  {
    name: 'positioning',
    label: 'Positioning',
    description: 'Wer du bist, fuer wen du schreibst, was dich abgrenzt. Gibt jeder Ausgabe Richtung.',
  },
];

export function BrandPage() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [activeTab, setActiveTab] = useState<BrandDocName>('voice');

  if (!activeProject) {
    return (
      <div>
        <div className="page-header">
          <h1>Brand-Foundation</h1>
          <p>Kein Projekt ausgewaehlt.</p>
        </div>
      </div>
    );
  }

  const current = TABS.find((t) => t.name === activeTab) ?? TABS[0];

  return (
    <div>
      <div className="page-header">
        <h1>Brand-Foundation</h1>
        <p>
          Statische Identitaet des Projekts. Wird in jede KI-Antwort (Ingest, Query, Takeaway, Lint, Output) mit eingespielt —
          sorgt fuer konsistente Stimme ueber alle Ausgaben hinweg.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border-color)',
          marginBottom: 20,
        }}
      >
        {TABS.map((tab) => {
          const active = tab.name === activeTab;
          return (
            <button
              key={tab.name}
              onClick={() => setActiveTab(tab.name)}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent-color, #007AFF)' : '2px solid transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 500,
                fontSize: 14,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <BrandEditor
        key={`${activeProject}:${current.name}`}
        projectName={activeProject}
        name={current.name}
        title={current.label}
        description={current.description}
      />
    </div>
  );
}
