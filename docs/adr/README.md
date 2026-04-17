# Architecture Decision Records

Chronologische Liste der wichtigsten Architektur- und Feature-Entscheidungen fuer 2brain-desktop. Format: MADR-light (Kontext, Entscheidung, Konsequenzen).

| Nr | Titel | Status | Datum |
|----|-------|--------|-------|
| [0001](0001-bm25-ranking.md) | BM25-Ranking fuer Wiki-Kontextauswahl | Accepted | 2026-04-17 |
| [0002](0002-lint-lernvorschlaege.md) | Lint-Lernvorschlaege via Claude | Accepted | 2026-04-17 |
| [0003](0003-builtin-marp-skill.md) | Built-in Marp-Praesentations-Skill | Accepted | 2026-04-17 |
| [0004](0004-takeaway-diskussion-in-memory.md) | Takeaway-Diskussion nur in-memory | Accepted | 2026-04-17 |
| [0005](0005-persistenter-search-index.md) | Persistenter BM25-Search-Index | Accepted | 2026-04-17 |
| [0006](0006-marp-slide-rendering.md) | In-App Marp-Slide-Rendering | Accepted | 2026-04-17 |

## Wann eine neue ADR schreiben

- Wenn eine Entscheidung nicht-offensichtlich ist (Alternativen verworfen, Trade-off gewaehlt).
- Wenn die Entscheidung spaeter schwer rueckgaengig gemacht werden kann.
- Wenn eine Entscheidung bewusst _nicht_ getroffen wurde (Scope-Schutz, Design-Grenze).

Implementierungs-Details, die sich aus dem Code ablesen lassen, brauchen keine ADR.
