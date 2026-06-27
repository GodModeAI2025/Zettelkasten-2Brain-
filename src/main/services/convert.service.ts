import { readFile } from 'fs/promises';
import path from 'path';

export interface ConvertResult {
  markdown: string;
  originalName: string;
  converted: boolean;
  error?: string;
}

/**
 * Liest die kanonische Quell-URL aus HTML (`<link rel="canonical">` oder
 * `og:url`) — Provenienz fuer das spaetere `resource:`-Frontmatter (M-3/OKF).
 */
export function extractCanonicalUrl(html: string): string | undefined {
  const canonical = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i);
  if (canonical) {
    const href = canonical[0].match(/\bhref=["']([^"']+)["']/i);
    if (href) return href[1].trim();
  }
  const og = html.match(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/i);
  if (og) {
    const content = og[0].match(/\bcontent=["']([^"']+)["']/i);
    if (content) return content[1].trim();
  }
  return undefined;
}

export const ConvertService = {
  async toMarkdown(filePath: string): Promise<ConvertResult> {
    const ext = path.extname(filePath).toLowerCase();
    const originalName = path.basename(filePath);

    // Bereits Markdown
    if (ext === '.md' || ext === '.markdown') {
      const content = await readFile(filePath, 'utf-8');
      return { markdown: content, originalName, converted: false };
    }

    // Plain Text
    if (ext === '.txt' || ext === '.csv' || ext === '.log' || ext === '.json') {
      const content = await readFile(filePath, 'utf-8');
      const wrapped = ext === '.json' || ext === '.csv' || ext === '.log'
        ? `# ${originalName}\n\n\`\`\`${ext.slice(1)}\n${content}\n\`\`\``
        : content;
      return { markdown: wrapped, originalName, converted: true };
    }

    // DOCX — mammoth liefert HTML, das wir dann in Markdown wandeln
    if (ext === '.docx') {
      try {
        const mammoth = await import('mammoth');
        const { NodeHtmlMarkdown } = await import('node-html-markdown');
        const buffer = await readFile(filePath);
        const htmlResult = await mammoth.convertToHtml({ buffer });
        const markdown = NodeHtmlMarkdown.translate(htmlResult.value);
        return { markdown, originalName, converted: true };
      } catch (err) {
        return { markdown: '', originalName, converted: false, error: `DOCX-Konvertierung fehlgeschlagen: ${err}` };
      }
    }

    // PDF — pdf-parse v2 nutzt Klassen-API
    if (ext === '.pdf') {
      try {
        const { PDFParse } = await import('pdf-parse');
        const buffer = await readFile(filePath);
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await parser.getText();
        await parser.destroy();
        return { markdown: `# ${originalName}\n\n${result.text}`, originalName, converted: true };
      } catch (err) {
        return { markdown: '', originalName, converted: false, error: `PDF-Konvertierung fehlgeschlagen: ${err}` };
      }
    }

    // HTML
    if (ext === '.html' || ext === '.htm') {
      try {
        const { NodeHtmlMarkdown } = await import('node-html-markdown');
        const content = await readFile(filePath, 'utf-8');
        const url = extractCanonicalUrl(content);
        const body = NodeHtmlMarkdown.translate(content);
        // Quell-URL als Frontmatter voranstellen — die KI uebernimmt sie als resource:.
        const markdown = url ? `---\nsource_url: ${url}\n---\n\n${body}` : body;
        return { markdown, originalName, converted: true };
      } catch (err) {
        return { markdown: '', originalName, converted: false, error: `HTML-Konvertierung fehlgeschlagen: ${err}` };
      }
    }

    // Nicht unterstuetzt
    return {
      markdown: '',
      originalName,
      converted: false,
      error: `Dateityp "${ext}" wird nicht unterstuetzt. Unterstuetzte Formate: .md, .txt, .docx, .pdf, .html, .json, .csv`,
    };
  },

  isSupported(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.md', '.markdown', '.txt', '.docx', '.pdf', '.html', '.htm', '.json', '.csv', '.log',
      '.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
  },

  isImage(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
  },

  imageMediaType(filename: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return map[ext] || 'image/jpeg';
  },
};
