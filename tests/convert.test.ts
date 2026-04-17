import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConvertService } from '../src/main/services/convert.service';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConvertService.isSupported', () => {
  it('akzeptiert unterstuetzte Formate', () => {
    const supported = ['.md', '.markdown', '.txt', '.docx', '.pdf', '.html', '.htm', '.json', '.csv', '.log',
      '.jpg', '.jpeg', '.png', '.gif', '.webp'];
    for (const ext of supported) {
      expect(ConvertService.isSupported(`test${ext}`)).toBe(true);
    }
  });

  it('lehnt unbekannte Formate ab', () => {
    expect(ConvertService.isSupported('test.xyz')).toBe(false);
    expect(ConvertService.isSupported('test.exe')).toBe(false);
    expect(ConvertService.isSupported('test.bmp')).toBe(false);
  });

  it('erkennt Bildformate korrekt', () => {
    expect(ConvertService.isImage('foto.jpg')).toBe(true);
    expect(ConvertService.isImage('foto.jpeg')).toBe(true);
    expect(ConvertService.isImage('screenshot.png')).toBe(true);
    expect(ConvertService.isImage('animation.gif')).toBe(true);
    expect(ConvertService.isImage('bild.webp')).toBe(true);
    expect(ConvertService.isImage('dokument.pdf')).toBe(false);
    expect(ConvertService.isImage('text.md')).toBe(false);
  });

  it('gibt korrekten Media-Type fuer Bilder', () => {
    expect(ConvertService.imageMediaType('foto.jpg')).toBe('image/jpeg');
    expect(ConvertService.imageMediaType('foto.jpeg')).toBe('image/jpeg');
    expect(ConvertService.imageMediaType('bild.png')).toBe('image/png');
    expect(ConvertService.imageMediaType('anim.gif')).toBe('image/gif');
    expect(ConvertService.imageMediaType('modern.webp')).toBe('image/webp');
  });
});

describe('ConvertService.toMarkdown', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convert-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('liest Markdown-Dateien unveraendert', async () => {
    const path = join(tmpDir, 'test.md');
    await writeFile(path, '# Hallo Welt');
    const result = await ConvertService.toMarkdown(path);
    expect(result.converted).toBe(false);
    expect(result.markdown).toBe('# Hallo Welt');
  });

  it('konvertiert TXT zu Markdown', async () => {
    const path = join(tmpDir, 'test.txt');
    await writeFile(path, 'Einfacher Text');
    const result = await ConvertService.toMarkdown(path);
    expect(result.converted).toBe(true);
    expect(result.markdown).toBe('Einfacher Text');
  });

  it('wrppt JSON in Codeblock', async () => {
    const path = join(tmpDir, 'data.json');
    await writeFile(path, '{"key": "value"}');
    const result = await ConvertService.toMarkdown(path);
    expect(result.converted).toBe(true);
    expect(result.markdown).toContain('```json');
    expect(result.markdown).toContain('"key": "value"');
  });

  it('wrppt CSV in Codeblock', async () => {
    const path = join(tmpDir, 'data.csv');
    await writeFile(path, 'a,b,c\n1,2,3');
    const result = await ConvertService.toMarkdown(path);
    expect(result.converted).toBe(true);
    expect(result.markdown).toContain('```csv');
  });

  it('konvertiert HTML zu Markdown', async () => {
    const path = join(tmpDir, 'page.html');
    await writeFile(path, '<h1>Titel</h1><p>Absatz</p>');
    const result = await ConvertService.toMarkdown(path);
    expect(result.converted).toBe(true);
    expect(result.markdown).toContain('Titel');
    expect(result.markdown).toContain('Absatz');
  });

  it('gibt Fehler fuer unbekanntes Format', async () => {
    const path = join(tmpDir, 'test.xyz');
    await writeFile(path, 'data');
    const result = await ConvertService.toMarkdown(path);
    expect(result.converted).toBe(false);
    expect(result.error).toContain('nicht unterstuetzt');
  });
});
