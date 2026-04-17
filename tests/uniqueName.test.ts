import { describe, it, expect } from 'vitest';
import { extname } from 'path';
import { randomBytes } from 'crypto';

// uniqueName ist eine lokale Funktion in files.ipc.ts — wir testen die Logik direkt
function uniqueName(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) return desired;
  const ext = extname(desired);
  const base = desired.slice(0, desired.length - ext.length);
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}${ext}`;
}

describe('uniqueName', () => {
  it('gibt den Originalnamen zurueck wenn kein Duplikat', () => {
    const existing = new Set(['a.md', 'b.md']);
    expect(uniqueName('c.md', existing)).toBe('c.md');
  });

  it('haengt Suffix an bei Duplikat', () => {
    const existing = new Set(['test.md']);
    const result = uniqueName('test.md', existing);
    expect(result).not.toBe('test.md');
    expect(result).toMatch(/^test-[a-f0-9]{6}\.md$/);
  });

  it('behaelt die Dateiendung bei', () => {
    const existing = new Set(['data.json']);
    const result = uniqueName('data.json', existing);
    expect(result).toMatch(/\.json$/);
  });

  it('funktioniert mit Dateien ohne Endung', () => {
    const existing = new Set(['Makefile']);
    const result = uniqueName('Makefile', existing);
    expect(result).toMatch(/^Makefile-[a-f0-9]{6}$/);
  });

  it('erzeugt unterschiedliche Suffixe', () => {
    const existing = new Set(['test.md']);
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      results.add(uniqueName('test.md', existing));
    }
    // Bei 10 Aufrufen sollten fast alle verschieden sein (6 Hex = 16M Moeglichkeiten)
    expect(results.size).toBeGreaterThan(5);
  });
});
