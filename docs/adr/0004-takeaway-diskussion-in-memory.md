# ADR 0004 — Takeaway-Diskussion nur in-memory

- **Status:** Accepted
- **Datum:** 2026-04-17

## Kontext

Nach einem Ingest zeigt die App die von Claude extrahierten Kernaussagen (Takeaways). Ohne interaktives Follow-up bleiben diese einzelne Statements ohne Verdichtung. Ziel: pro Takeaway ein Sparring-Chat mit Claude, der bestehenden Wiki-Kontext nutzt, und optional zu einer Synthese-Seite verdichtet werden kann.

## Entscheidung

**Implementiert (Phase 4A):**

- Zwei IPC-Handler: `takeaway:discuss` (ein-Shot-Antwort mit BM25-Wiki-Kontext, Allow-List der Seiten-IDs, Historie) und `takeaway:synthesize` (JSON-Output nach `wiki/synthesis/`, Git-Commit).
- Renderer-Store `useTakeawayStore` mit `conversations` keyed pro Takeaway-Index + Quelldatei.
- UI-Integration in `TakeawayList`: pro Takeaway ausklappbares Chat-Panel mit "Diskutieren", "Als Synthese speichern", "Zuruecksetzen".
- `IngestResult.sourceFile` wird beim Ingest gesetzt, sodass die Diskussion die Quelldatei kennt.

**Explizit nicht implementiert:** Cross-Session-Persistenz der Diskussionen (urspruenglich als Phase 4B geplant).

## Konsequenzen

**Positiv**
- Diskussionen sind augenblicklich nutzbar, keine Migration, keine Schema-Fragen.
- Keine Vermischung zwischen gesyncten und nicht-gesyncten Projekten (siehe Rationale).

**Negativ**
- Beim App-Neustart gehen laufende Diskussionen verloren. User muss wichtige Erkenntnisse via "Als Synthese speichern" sichern, bevor er die App schliesst.

## Rationale gegen Persistenz

2brain-Projekte sind strikt getrennt — manche werden per Git gesynct, andere nicht. Persistierte Takeaway-Dateien wuerden unvermeidlich Datenfluss erzeugen:

- **Im Projektordner:** landet in Sync-Projekten automatisch im Remote.
- **In userData:** vermischt Daten aus gesyncten und ungesyncten Projekten unter derselben Identitaet; beim Sync-Status-Wechsel unklar, was wohin gehoert.

Diese Grenze ist Designprinzip, nicht Feature-Backlog. Wer eine Diskussion langfristig behalten will, synthetisiert sie zu einer Wiki-Seite — die folgt dann dem normalen Sync-Regime des Projekts.
