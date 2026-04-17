# Zettelkasten Desktop

KI-gestuetztes persoenliches Wissensmanagementsystem als Electron Desktop-App.
Nutzt die Claude API um Rohdaten in ein strukturiertes, verlinktes Markdown-Wiki zu kompilieren.
Urspruenglich als CLI (2brain), jetzt als Desktop-App mit React-UI.

## Architektur

- **Desktop:** Electron 41 + Vite + TypeScript
- **Frontend:** React 19 + React Router + Zustand
- **AI:** @anthropic-ai/sdk (Main-Process, Streaming + Request)
- **Git:** isomorphic-git (Main-Process, pure JS)
- **Konvertierung:** mammoth (DOCX), pdf-parse (PDF), node-html-markdown (HTML)
- **Graph:** react-force-graph-2d (d3-basiert)
- **Markdown:** markdown-it + Wikilink-Plugin (vendored mzmd-engine)
- **Secrets:** Electron safeStorage (API-Key + Git-Token verschluesselt)
- **Build:** electron-forge + Vite (3 Build-Targets: main, preload, renderer)

## Struktur

```
src/
├── main/                    # MAIN PROCESS (Node.js)
│   ├── index.ts             # App-Entry, BrowserWindow, IPC-Registry
│   ├── ipc/                 # IPC-Handler (1 Datei pro Domaene)
│   │   ├── registry.ts      # Zentrale Handler-Registrierung
│   │   ├── settings.ipc.ts  # App-Einstellungen + Secrets
│   │   ├── git.ipc.ts       # Clone/Pull/Push/Sync/Status
│   │   ├── project.ipc.ts   # Projekt CRUD + Status
│   │   ├── files.ipc.ts     # Upload mit Konvertierung + Duplikat-Erkennung
│   │   ├── wiki.ipc.ts      # Seiten, Graph-Daten, Pending Stubs
│   │   ├── ingest.ipc.ts    # KI-Ingestion mit Progress-Events
│   │   ├── query.ipc.ts     # KI-Query mit Streaming
│   │   ├── lint.ipc.ts      # Gesundheitscheck + Auto-Fix
│   │   ├── forget.ipc.ts    # Quelle vergessen + Wiki bereinigen
│   │   └── output.ipc.ts    # Output-Verwaltung + KI-Generierung
│   ├── services/
│   │   ├── git.service.ts       # isomorphic-git Wrapper
│   │   ├── project.service.ts   # Multi-Projekt + Vault-Instanzen
│   │   ├── settings.service.ts  # safeStorage + Migration
│   │   └── convert.service.ts   # Dateiformat-Konvertierung
│   ├── core/                # Wiederverwendet aus CLI
│   │   ├── vault.ts         # Dateizugriff mit Path-Safety
│   │   ├── config.ts        # BrainConfig laden/schreiben
│   │   ├── claude.ts        # Anthropic SDK (ask, askStreaming, parseClaudeJson)
│   │   ├── pathSafety.ts    # Path-Traversal-Schutz
│   │   ├── wiki-context.ts  # Wiki-Kontext fuer Claude-Prompts
│   │   ├── wikilinks.ts     # [[Wikilink|Text]] Parser
│   │   └── prompts/index.ts # System-Prompts (Ingest, Query, Lint, Forget)
│   └── util/
│       └── paths.ts         # app.getPath()-Helfer
├── preload/
│   └── preload.ts           # contextBridge — exponiert window.api
├── renderer/                # RENDERER PROCESS (React)
│   ├── App.tsx              # Router + Shell
│   ├── main.tsx             # React-Root
│   ├── api/bridge.ts        # window.api Typisierung
│   ├── stores/              # Zustand Stores
│   ├── pages/               # 10 Seiten (Dashboard, Raw, Wiki, Graph, ...)
│   ├── components/          # Wiederverwendbare Komponenten
│   └── styles/globals.css   # Gesamtes Styling
└── shared/
    └── api.types.ts         # Typen fuer Main <-> Renderer IPC
```

## Befehle

- `npm run dev` — Baut alles (main + preload + renderer) und startet Electron
- `npm run start` — electron-forge start (erwartet vorhandenen Build)
- `npm run lint` — ESLint
- `npx tsc --noEmit` — TypeScript-Check ohne Build
- `npm run package` — Paketieren fuer aktuelle Plattform
- `npm run make` — Installer erstellen (DMG/ZIP/Squirrel/Deb)

## Konventionen

- Named Exports, keine Default Exports (ausser forge.config.ts)
- TypeScript strict mode
- IPC-Kanaele: `domain:action` (z.B. `files:upload`, `wiki:list-pages`)
- Alle UI-Texte auf Deutsch mit korrekten Umlauten (ae/oe/ue)
- Prompts in src/main/core/prompts/index.ts als Template-Strings
- Claude-Antworten werden als JSON in Markdown-Codebloecken erwartet
- Git-Commits nach Upload, Ingest, Forget, Output automatisch
- Path-Safety: Vault-Klasse verhindert Zugriff ausserhalb des Projekt-Ordners

## IPC-Muster

Handler in `src/main/ipc/*.ipc.ts` registrieren sich via `ipcMain.handle()`.
Preload exponiert typisierte API via `contextBridge.exposeInMainWorld()`.
Renderer nutzt `window.api` (typisiert als `BridgeApi` aus shared/api.types.ts).
Events (Main -> Renderer) via `webContents.send()` + `on()` im Preload.

## Dateiformat-Konvertierung

Upload akzeptiert: .md, .txt, .docx, .pdf, .html, .json, .csv, .log
Alles wird zu Markdown konvertiert und in raw/ gespeichert.
Duplikate erhalten automatisch einen Hex-Suffix (z.B. `datei-a3f2b1.md`).
