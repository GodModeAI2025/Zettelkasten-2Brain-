# ADR 0006 — In-App Marp-Slide-Rendering

- **Status:** Accepted
- **Datum:** 2026-04-17

## Kontext

Der Marp-Skill (ADR 0003) erzeugt Marp-Markdown als Output. Bisher konnte der Nutzer das Ergebnis nur als Rohmarkdown im `MarkdownViewer` betrachten — die Slide-Struktur (Trennung via `---`, Titel-Layout, Speaker-Notes) war nicht visuell erlebbar. Externe Tools (Marp CLI, VS-Code-Plugin) waren noetig.

## Entscheidung

Inline-Rendering der Marp-Slides im Output-Result-View. Technik:

- Abhaengigkeit: `@marp-team/marp-core` im Renderer-Prozess.
- Detektion: `isMarpContent(content)` in `marpDetect.ts` — prueft YAML-Frontmatter auf `marp: true`. Rein stringbasiert, damit separat testbar ohne DOM.
- Komponente: `src/renderer/components/output/MarpViewer.tsx`. `marp.render()` liefert `{ html, css }`; beides wird in einen sandboxed iframe via `srcDoc` eingebettet. Styles bleiben so vom App-CSS isoliert.
- Navigation: Pfeiltasten / Space / Home / End innerhalb des iframe, postMessage zurueck an den Parent fuer Slide-Index-Anzeige. Buttons "Zurueck", "Weiter", "Drucken" im Parent.
- Drucken-Button im Viewer macht alle Slides im iframe sichtbar und triggert `window.print()` im iframe-Kontext — so druckt Electron alle Slides, nicht nur die aktive.
- Integration: OutputPage schaltet im Result-View via `isMarpContent` zwischen `MarkdownViewer` und `MarpViewer`.

## Konsequenzen

**Positiv**
- Nutzer sieht sofort, wie die Praesentation aussieht, ohne Export oder externes Tool.
- Iframe-Sandbox isoliert Marp-CSS vom App-Theme.
- Navigation per Tastatur macht Praesentations-Flow in der App moeglich.

**Negativ**
- Bundle waechst um ~1.5 MB gzip (Marp-Core + Abhaengigkeiten).
- `@marp-team/marp-core` zieht `mathjax-full` mit bekannten Audit-Warnings (low/moderate severity, nicht im Programmpfad des Renderers).
- Kein Theme-Wechsel zwischen Light/Dark (Marp nutzt eigene Themes). Akzeptabel — Praesentation soll nicht wie App aussehen.

## Alternativen

- **Rohansicht beibehalten:** User muss Marp CLI nutzen. Funktioniert, aber Reibungsverlust im Workflow.
- **Eigene Slide-Engine:** Aufwand nicht gerechtfertigt, Marp ist Referenz-Renderer.
- **Direkt-DOM-Rendering ohne iframe:** Marp-CSS mit `:root`-Selektoren wuerde App-Styles ueberschreiben — iframe ist die sauberste Isolation.
