import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

// Wikilink-Plugin: [[target]] oder [[target|label]]
md.inline.ruler.push('wikilink', (state, silent) => {
  const src = state.src.slice(state.pos);
  const match = src.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!match) return false;
  if (silent) return true;

  const target = match[1].trim();
  const label = match[2]?.trim() || target;

  const token = state.push('wikilink', '', 0);
  token.meta = { target, label };
  state.pos += match[0].length;
  return true;
});

md.renderer.rules['wikilink'] = (tokens, idx) => {
  const { target, label } = tokens[idx].meta;
  const encoded = encodeURIComponent(target);
  return `<a class="wikilink" href="#" data-wiki-target="${encoded}">${md.utils.escapeHtml(label)}</a>`;
};

interface MarkdownViewerProps {
  content: string;
  onWikilinkClick?: (target: string) => void;
}

export function MarkdownViewer({ content, onWikilinkClick }: MarkdownViewerProps) {
  const html = useMemo(() => md.render(content), [content]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest('.wikilink') as HTMLAnchorElement | null;
    if (el) {
      e.preventDefault();
      const target = decodeURIComponent(el.dataset.wikiTarget || '');
      if (target && onWikilinkClick) onWikilinkClick(target);
    }
  };

  return (
    <div
      className="markdown-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
