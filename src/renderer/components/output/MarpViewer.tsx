import { useEffect, useMemo, useRef, useState } from 'react';
import { Marp } from '@marp-team/marp-core';

export { isMarpContent } from './marpDetect';

interface MarpViewerProps {
  content: string;
}

function buildSrcDoc(html: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .marpit { max-width: 100%; }
  .marpit > svg { display: block; max-width: 100%; height: auto; }
  ${css}
</style>
</head>
<body>${html}
<script>
  (function() {
    var slides = document.querySelectorAll('.marpit > svg');
    var current = 0;
    function show(idx) {
      current = Math.max(0, Math.min(slides.length - 1, idx));
      slides.forEach(function(s, i) { s.style.display = i === current ? 'block' : 'none'; });
      window.parent.postMessage({ type: 'marp-slide', index: current, total: slides.length }, '*');
    }
    window.addEventListener('message', function(e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'marp-goto') show(e.data.index);
      if (e.data.type === 'marp-next') show(current + 1);
      if (e.data.type === 'marp-prev') show(current - 1);
      if (e.data.type === 'marp-print') {
        slides.forEach(function(s) { s.style.display = 'block'; });
        window.focus();
        window.print();
        show(current);
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') show(current + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(current - 1);
      else if (e.key === 'Home') show(0);
      else if (e.key === 'End') show(slides.length - 1);
    });
    show(0);
  })();
</script>
</body>
</html>`;
}

export function MarpViewer({ content }: MarpViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);

  const rendered = useMemo(() => {
    try {
      const marp = new Marp({ html: false });
      const { html, css } = marp.render(content);
      return { html, css, error: null as string | null };
    } catch (err) {
      return { html: '', css: '', error: err instanceof Error ? err.message : String(err) };
    }
  }, [content]);

  const srcDoc = useMemo(
    () => rendered.error ? '' : buildSrcDoc(rendered.html, rendered.css),
    [rendered],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'marp-slide') {
        setCurrent(e.data.index || 0);
        setTotal(e.data.total || 0);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const post = (msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  };

  if (rendered.error) {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--system-red, #d00)' }}>
        <strong>Marp-Rendering fehlgeschlagen</strong>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{rendered.error}</pre>
      </div>
    );
  }

  return (
    <div className="marp-viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => post({ type: 'marp-prev' })} disabled={current <= 0}>
          &larr; Zurueck
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => post({ type: 'marp-next' })} disabled={total > 0 && current >= total - 1}>
          Weiter &rarr;
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Slide {total > 0 ? current + 1 : 0} von {total}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => post({ type: 'marp-print' })} title="Alle Slides drucken">
          Drucken
        </button>
      </div>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: 'var(--bg-subtle, #000)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 2px 16px rgba(0,0,0,0.15)',
        }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          style={{ width: '100%', height: '100%', border: 0, background: 'transparent' }}
          title="Marp-Praesentation"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}
