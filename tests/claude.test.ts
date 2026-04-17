import { describe, it, expect } from 'vitest';
import { parseClaudeJson } from '../src/main/core/claude';

describe('parseClaudeJson', () => {
  it('parst JSON aus Markdown-Codeblock', () => {
    const response = 'Hier ist das Ergebnis:\n```json\n{"key": "value"}\n```\nFertig.';
    const result = parseClaudeJson<{ key: string }>(response);
    expect(result).toEqual({ key: 'value' });
  });

  it('parst JSON aus verschachteltem Codeblock', () => {
    const response = '```json\n{"items": [1, 2, 3], "nested": {"a": true}}\n```';
    const result = parseClaudeJson<{ items: number[]; nested: { a: boolean } }>(response);
    expect(result?.items).toEqual([1, 2, 3]);
    expect(result?.nested.a).toBe(true);
  });

  it('findet JSON zwischen geschweiften Klammern', () => {
    const response = 'Antwort: {"key": 42} Ende.';
    const result = parseClaudeJson<{ key: number }>(response);
    expect(result).toEqual({ key: 42 });
  });

  it('parst reinen JSON-String', () => {
    const response = '{"pure": true}';
    const result = parseClaudeJson<{ pure: boolean }>(response);
    expect(result).toEqual({ pure: true });
  });

  it('gibt null bei ungueltigem JSON', () => {
    const result = parseClaudeJson('Das ist kein JSON.');
    expect(result).toBeNull();
  });

  it('parst JSON auch wenn Text davor steht', () => {
    const response = 'Hier ist das Ergebnis:\n```json\n{"inside": 2}\n```';
    const result = parseClaudeJson<{ inside: number }>(response);
    expect(result?.inside).toBe(2);
  });

  it('repariert abgeschnittenes JSON mit fehlenden Klammern', () => {
    const truncated = '{"takeaways": ["eins", "zwei"], "operations": [{"action": "create"';
    const result = parseClaudeJson<{ takeaways: string[] }>(truncated);
    expect(result?.takeaways).toEqual(['eins', 'zwei']);
  });

  it('repariert abgeschnittenes JSON in Codeblock ohne End-Marker', () => {
    const truncated = '```json\n{"key": "value", "items": [1, 2, 3';
    const result = parseClaudeJson<{ key: string; items: number[] }>(truncated);
    expect(result?.key).toBe('value');
    expect(result?.items).toEqual([1, 2, 3]);
  });

  it('repariert abgeschnittenen String', () => {
    const truncated = '{"name": "abgeschnitt';
    const result = parseClaudeJson<{ name: string }>(truncated);
    expect(result?.name).toBe('abgeschnitt');
  });

  it('entfernt Trailing Commas bei Reparatur', () => {
    const truncated = '{"items": ["a", "b",';
    const result = parseClaudeJson<{ items: string[] }>(truncated);
    expect(result?.items).toEqual(['a', 'b']);
  });

  it('repariert nach Trailing Comma in verschachteltem Objekt', () => {
    const truncated = '{"ops": [{"action": "create",';
    const result = parseClaudeJson<{ ops: Array<{ action: string }> }>(truncated);
    expect(result?.ops).toHaveLength(1);
    expect(result?.ops[0].action).toBe('create');
  });

  it('repariert typische Ingest-Antwort ohne schliessendes ```', () => {
    const truncated = '```json\n{"takeaways": ["Punkt 1", "Punkt 2"], "operations": [{"action": "create", "path": "wiki/concepts/test.md", "content": "# Test\\n\\nInhalt der abgeschnitten';
    const result = parseClaudeJson<{ takeaways: string[]; operations: Array<{ action: string; path: string }> }>(truncated);
    expect(result?.takeaways).toEqual(['Punkt 1', 'Punkt 2']);
    expect(result?.operations).toHaveLength(1);
    expect(result?.operations[0].path).toBe('wiki/concepts/test.md');
  });

  it('sanitized unescapte Newlines in JSON-Strings', () => {
    const raw = '{"content": "Zeile eins\nZeile zwei"}';
    const result = parseClaudeJson<{ content: string }>(raw);
    expect(result?.content).toBe('Zeile eins\nZeile zwei');
  });

  it('sanitized unescapte Tabs in JSON-Strings', () => {
    const raw = '{"content": "Spalte\tSpalte2"}';
    const result = parseClaudeJson<{ content: string }>(raw);
    expect(result?.content).toBe('Spalte\tSpalte2');
  });

  it('laesst korrekt escapte Steuerzeichen unveraendert', () => {
    const raw = '{"content": "Zeile\\nZwei\\tTab"}';
    const result = parseClaudeJson<{ content: string }>(raw);
    expect(result?.content).toBe('Zeile\nZwei\tTab');
  });

  it('fixt mehrere unescapte Newlines in verschiedenen Strings', () => {
    const raw = '{"a": "eins\nzwei", "b": "drei\nvier"}';
    const result = parseClaudeJson<{ a: string; b: string }>(raw);
    expect(result?.a).toBe('eins\nzwei');
    expect(result?.b).toBe('drei\nvier');
  });

  it('fixt unescapte Newlines auch in abgeschnittenem JSON', () => {
    const raw = '{"items": ["Text mit\nUmbruch", "Noch einer\nmit';
    const result = parseClaudeJson<{ items: string[] }>(raw);
    expect(result?.items?.[0]).toBe('Text mit\nUmbruch');
  });

  it('fixt unescapte ASCII-Anfuehrungszeichen in Strings (deutsche Zitate)', () => {
    // Claude schreibt oft \u201EJa" statt \u201EJa\u201C — das ASCII " terminiert den JSON-String vorzeitig
    const raw = '{"text": "Ingenieuren: \u201EJa" versuchen statt Nein"}';
    const result = parseClaudeJson<{ text: string }>(raw);
    expect(result?.text).toContain('Ja');
    expect(result?.text).toContain('versuchen');
  });

  it('fixt mehrere unescapte Anfuehrungszeichen im selben String', () => {
    const raw = '{"text": "Er sagte \u201EHallo" und sie antwortete \u201ETschuess" und ging."}';
    const result = parseClaudeJson<{ text: string }>(raw);
    expect(result?.text).toContain('Hallo');
    expect(result?.text).toContain('Tschuess');
    expect(result?.text).toContain('ging.');
  });

  it('fixt Kombination aus unescapten Quotes und Newlines', () => {
    const raw = '{"items": ["Text mit \u201EZitat" und\nUmbruch"]}';
    const result = parseClaudeJson<{ items: string[] }>(raw);
    expect(result?.items?.[0]).toContain('Zitat');
    expect(result?.items?.[0]).toContain('Umbruch');
  });

  it('fixt unescapte Quotes die zu "Expected double-quoted property name" fuehren', () => {
    // Reales Szenario: SDG-Referenzen mit deutschen Anfuehrungszeichen
    // Nach dem Fix des ersten " wechselt der Fehler zu "Expected double-quoted property name"
    const raw = '{"takeaways": ["SDG 14 \u201ELeben unter Wasser" und SDG 15 \u201ELeben an Land" sind relevant."], "ops": []}';
    const result = parseClaudeJson<{ takeaways: string[]; ops: unknown[] }>(raw);
    expect(result).not.toBeNull();
    expect(result?.takeaways[0]).toContain('Leben unter Wasser');
    expect(result?.takeaways[0]).toContain('Leben an Land');
    expect(result?.ops).toEqual([]);
  });

  it('fixt viele unescapte Quotes verteilt ueber mehrere Properties', () => {
    const raw = '{"a": "Text \u201Einner" Wert", "b": "Noch \u201Eein" Fall", "c": true}';
    const result = parseClaudeJson<{ a: string; b: string; c: boolean }>(raw);
    expect(result).not.toBeNull();
    expect(result?.a).toContain('inner');
    expect(result?.b).toContain('ein');
    expect(result?.c).toBe(true);
  });

  it('parst erstes JSON wenn Claude mit Selbstkorrektur ein zweites anhaengt', () => {
    // Reales Szenario aus dem Ingest-Log: Claude liefert ein vollstaendiges JSON,
    // sagt dann "Entschuldigung, ich starte neu" und haengt ein zweites JSON an.
    // Erwartung (Option A): das erste JSON wird zurueckgegeben.
    const response = [
      '```json',
      '{"takeaways": ["erste Analyse"], "operations": []}',
      '```',
      '',
      '---',
      '',
      'Entschuldigung – ich starte die Analyse neu und gehe anders vor.',
      '',
      '```json',
      '{"takeaways": ["zweite Analyse"], "operations": [{"action": "create", "path": "wiki/x.md"}]}',
      '```',
    ].join('\n');
    const result = parseClaudeJson<{ takeaways: string[]; operations: unknown[] }>(response);
    expect(result).not.toBeNull();
    expect(result?.takeaways).toEqual(['erste Analyse']);
    expect(result?.operations).toEqual([]);
  });
});
