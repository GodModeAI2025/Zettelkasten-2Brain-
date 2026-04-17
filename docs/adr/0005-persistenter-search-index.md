# ADR 0005 — Persistenter BM25-Search-Index

- **Status:** Accepted
- **Datum:** 2026-04-17

## Kontext

Das BM25-Ranking (ADR 0001) tokenisiert bei jedem Aufruf alle Wiki-Seiten neu. Pro Query eines Wikis mit ~500 Seiten sind das 500x `tokenize()` auf dem vollen Content — bei Takeaway-Diskussionen, Lint-Suggest und Query-Context jedes Mal. Profiling zeigte, dass die Tokenisierung der dominante Kostenanteil ist; das Datei-I/O ist demgegenueber klein.

## Entscheidung

Persistenter Index pro Vault-Root mit mtime-basierter Invalidierung:

- `src/main/core/search-index.ts` — Index-Datenstruktur `SearchIndex = { version, entries: Record<relativePath, DocEntry> }` mit `DocEntry = { mtime, tf, titleTokens, length, title }`.
- `refreshIndex(prior, pages)` diff't via mtime: unveraenderte Seiten behalten ihren Eintrag, geaenderte/neue werden tokenisiert, geloeschte entfernt.
- Modul-Level Cache `inMemoryCache: Map<root, SearchIndex>` ueberbrueckt kurzlebige Vault-Instanzen (ProjectService erstellt pro Aufruf eine neue).
- Persistierung als `.search-index.json` im Vault-Root (ausserhalb `wiki/`, sodass Git-Commits im `wiki/`-Ordner davon unberuehrt sind).
- Neue Funktion `bm25RankWithIndex(pages, query, index, opts)` nutzt die gecachten Stats, `bm25Rank` bleibt fuer Kontexte ohne Index (Ingest-Schleifen mit dynamischem Page-Cache).
- Aufrufer: `Vault.findRelevantPages`, `takeaway:discuss`, `lint:suggest`.

## Konsequenzen

**Positiv**
- Tokenisierung entfaellt fuer unveraenderte Seiten — O(1) Index-Lookup statt O(Tokens) Tokenisierung.
- Ueberlebt App-Restarts: erster Query nach Neustart ist genauso schnell wie nachfolgende.
- Keine neue Sync-Semantik: `.search-index.json` im Vault-Root kann per `.gitignore` des User-Repos ausgeschlossen werden; Cache bleibt lokal.

**Negativ**
- Zusaetzliche Datei pro Projekt. User muss sie ggf. in `.gitignore` eintragen, falls sie nicht mitcommittet werden soll.
- `refreshIndex` macht `stat()` pro Page — bei 5000 Seiten noch im Millisekunden-Bereich, aber nicht gratis.
- Modul-Level Cache ist pro Main-Prozess; bei Multi-Window-Electron (aktuell nicht genutzt) waere Synchronisation noetig.

## Alternativen

- **Kein Cache, ueberall tokenisieren:** einfach, aber bei wachsendem Wiki schmerzhaft.
- **Vollstaendiger Volltext-Index (SQLite FTS):** maechtiger, aber Overkill fuer BM25-Reranking einer kleinen Seitenmenge; zusaetzliche Dependency.
- **Vault-Instanzen zu Singletons machen:** reduziert Neu-Instanziierung, loest aber nicht das Persistenz-Problem ueber Neustarts.
