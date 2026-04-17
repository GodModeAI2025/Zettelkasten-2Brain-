import { describe, it, expect } from 'vitest';
import { isMarpContent } from '../src/renderer/components/output/marpDetect';

describe('isMarpContent', () => {
  it('erkennt Marp-Frontmatter mit marp: true', () => {
    const content = `---
marp: true
theme: default
---

# Titel
`;
    expect(isMarpContent(content)).toBe(true);
  });

  it('ignoriert Frontmatter ohne marp-Flag', () => {
    const content = `---
title: Test
theme: default
---

# Titel
`;
    expect(isMarpContent(content)).toBe(false);
  });

  it('ignoriert marp: false', () => {
    const content = `---
marp: false
---

# Titel
`;
    expect(isMarpContent(content)).toBe(false);
  });

  it('ignoriert Inhalt ohne Frontmatter', () => {
    expect(isMarpContent('# Nur Markdown')).toBe(false);
  });

  it('ignoriert offenes Frontmatter ohne Schluss', () => {
    const content = `---
marp: true

# Kein Ende
`;
    expect(isMarpContent(content)).toBe(false);
  });

  it('ignoriert leeren String', () => {
    expect(isMarpContent('')).toBe(false);
  });

  it('akzeptiert Leerzeichen um marp-Direktive', () => {
    const content = `---
marp:   true
paginate: true
---

Slides
`;
    expect(isMarpContent(content)).toBe(true);
  });
});
