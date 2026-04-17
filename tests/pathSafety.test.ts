import { describe, it, expect } from 'vitest';
import {
  sanitizeRelativePath,
  toScopedRelativePath,
  requireRootPrefix,
} from '../src/main/core/pathSafety';

describe('sanitizeRelativePath', () => {
  it('akzeptiert einfache Pfade', () => {
    expect(sanitizeRelativePath('wiki/test.md')).toBe('wiki/test.md');
  });

  it('normalisiert redundante Segmente', () => {
    expect(sanitizeRelativePath('./wiki/test.md')).toBe('wiki/test.md');
    expect(sanitizeRelativePath('wiki//test.md')).toBe('wiki/test.md');
  });

  it('ersetzt Backslashes', () => {
    expect(sanitizeRelativePath('wiki\\test.md')).toBe('wiki/test.md');
  });

  it('blockiert leere Pfade', () => {
    expect(() => sanitizeRelativePath('')).toThrow('Leerer Pfad');
    expect(() => sanitizeRelativePath('  ')).toThrow('Leerer Pfad');
  });

  it('blockiert absolute Pfade', () => {
    expect(() => sanitizeRelativePath('/etc/passwd')).toThrow('Absolute Pfade');
  });

  it('blockiert Pfad-Traversal', () => {
    expect(() => sanitizeRelativePath('../secret')).toThrow('ausserhalb');
    expect(() => sanitizeRelativePath('wiki/../../etc/passwd')).toThrow('ausserhalb');
  });
});

describe('toScopedRelativePath', () => {
  it('fuegt Scope-Prefix hinzu', () => {
    expect(toScopedRelativePath('wiki', 'concepts/test.md')).toBe(
      'wiki/concepts/test.md',
    );
  });

  it('blockiert Ausbruch aus dem Scope', () => {
    expect(() => toScopedRelativePath('wiki', '../raw/secret.md')).toThrow();
  });
});

describe('requireRootPrefix', () => {
  it('akzeptiert Pfade mit korrektem Prefix', () => {
    expect(requireRootPrefix('raw/test.md', 'raw')).toBe('raw/test.md');
  });

  it('blockiert Pfade ohne Prefix', () => {
    expect(() => requireRootPrefix('wiki/test.md', 'raw')).toThrow('ausserhalb');
  });
});
