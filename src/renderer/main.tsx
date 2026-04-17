import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

const root = document.getElementById('root');
if (root) {
  try {
    createRoot(root).render(<App />);
  } catch (err) {
    root.innerHTML = `<div style="padding:40px;text-align:center;font-family:system-ui">
      <h2 style="color:#dc3545">Render-Fehler</h2>
      <pre style="color:#6c757d;font-size:13px">${err instanceof Error ? err.message : String(err)}</pre>
    </div>`;
  }
} else {
  document.body.innerHTML = '<p style="padding:40px;color:red">Root-Element nicht gefunden.</p>';
}
