import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../src/main/core/keywords';

describe('extractKeywords', () => {
  it('sortiert nach Haeufigkeit, nicht nach Reihenfolge im Text', () => {
    const text = 'Transformer lernen. Der Transformer ist wichtig. Python ist eine Sprache. Der Transformer rechnet.';
    const kws = extractKeywords(text, 5);
    expect(kws[0]).toBe('transformer');
  });

  it('filtert Stoppwoerter', () => {
    const text = 'Das ist ein Test mit vielen haeufigen Woertern aber nur einem echten Begriff: Tensorflow.';
    const kws = extractKeywords(text);
    expect(kws).toContain('tensorflow');
    expect(kws).not.toContain('haben');
    expect(kws).not.toContain('einem');
  });

  it('filtert zu kurze Woerter', () => {
    const text = 'ab cd efgh ijkl mnopq';
    const kws = extractKeywords(text);
    expect(kws).not.toContain('ab');
    expect(kws).not.toContain('cd');
    expect(kws).toContain('efgh');
  });

  it('respektiert das Limit', () => {
    const words = Array.from({ length: 50 }, (_, i) => `wort${i}`).join(' ');
    const kws = extractKeywords(words, 10);
    expect(kws).toHaveLength(10);
  });

  it('ignoriert reine Zahlen-Tokens', () => {
    const kws = extractKeywords('2024 war das Jahr von GPT4 und 12345 anderen Modellen');
    expect(kws).not.toContain('2024');
    expect(kws).not.toContain('12345');
    expect(kws).toContain('gpt4');
  });

  it('behandelt Umlaute und ss korrekt', () => {
    const kws = extractKeywords('Künstliche Intelligenz löst große Probleme mit Strassenschildern');
    expect(kws).toContain('künstliche');
    expect(kws).toContain('strassenschildern');
  });
});
