# ADR 0002 — Lint-Lernvorschlaege via Claude

- **Status:** Accepted
- **Datum:** 2026-04-17

## Kontext

Der Lint-Prozess erkannte bisher nur mechanische Wiki-Probleme (Broken Links, Orphans, Stale-Seiten). Fuer einen Wissensarbeiter ist aber auch die inhaltliche Dimension interessant: Welche Fragen wirft das aktuelle Wiki auf? Welche Luecken bestehen? Welche Seiten wuerden eine Synthese ergeben?

## Entscheidung

Neuer IPC-Handler `lint:suggest`, der via Claude vier Kategorien von Lernvorschlaegen erzeugt:

1. **Fragen** — offene Fragen, die sich aus dem Material ergeben, mit Bezug zu relevanten Seiten.
2. **Gaps** — Themenluecken, die in Quellen/Seiten angedeutet sind, aber noch keine eigene Seite haben.
3. **Source-Suggestions** — fehlende Quellen-Typen (z.B. "eine Primaerquelle zu X fehlt").
4. **Synthesis-Candidates** — Seiten-Cluster, die als Synthese zusammengefasst werden koennten.

Kontextaufbau: BM25-Ranking auf Top-Tags der Wiki-Seiten sampelt 20 relevante Seiten, ergaenzt durch Index, Pending-Stubs und Log-Tail. In der UI (`LintPage`) wird jede Vorschlagskategorie mit "Im Chat fragen"-Button an den Query-Chat uebergeben (via `useQueryStore`).

## Konsequenzen

**Positiv**
- Ergaenzt mechanisches Lint um inhaltliche Impulse.
- Nahtloser Uebergang vom Vorschlag in den Chat — keine Copy/Paste-Reibung.

**Negativ**
- Zusaetzliche Claude-API-Kosten pro Aufruf (User-triggered, nicht automatisch).
- Qualitaet der Vorschlaege haengt von BM25-Sample und Wiki-Reife ab.
