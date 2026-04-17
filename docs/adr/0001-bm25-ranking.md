# ADR 0001 — BM25-Ranking fuer Wiki-Kontextauswahl

- **Status:** Accepted
- **Datum:** 2026-04-17

## Kontext

Beim Ingest, bei Query-Antworten und bei Takeaway-Diskussionen muss aus potentiell tausenden Wiki-Seiten eine kleine Kontextmenge fuer Claude ausgewaehlt werden. Die urspruengliche Auswahl basierte auf simpler Keyword-Substring-Suche mit gewichtetem Score — sie lieferte bei Keyword-Ueberlappung keine differenzierten Relevanzen und verwaesserte den Kontext bei wachsendem Wiki.

## Entscheidung

BM25 (Best Match 25) als Ranking-Algorithmus fuer Wiki-Seiten. Implementierung in `src/main/core/search.ts`:

- Tokenisierung via `keywords.ts` (Lowercase, Umlaut-Normalisierung, Stopword-Filter).
- Parameter: k1=1.5, b=0.75 (BM25-Defaults).
- Title-Boost (x3) fuer Treffer im Titel, Phrase-Boost (+2) fuer zusammenhaengende Mehrwort-Phrasen.
- Fallback auf Substring-Zaehlung bei Korpus < 5 Seiten.

## Konsequenzen

**Positiv**
- Statistisch fundierte Relevanz statt Keyword-Zaehlung.
- Title-Boost hebt thematisch zentrale Seiten hervor.
- Phrase-Boost bewahrt Multiword-Begriffe, die durch Tokenisierung sonst zerfallen wuerden.

**Negativ**
- Doc-Stats (tf/df/avgLen) werden pro Aufruf neu berechnet — bei grossen Wikis spuerbar (siehe ADR 0005, der das adressiert).
- Stopword-Liste in `keywords.ts` ist nur auf Deutsch/Englisch abgestimmt.

## Alternativen

- **TF-IDF:** Einfacher, aber BM25 dampft Term-Saturation besser und behandelt Dokumentlaengen robust.
- **Embeddings:** Semantisch staerker, aber zusaetzliche API-Calls, Latenz und Kosten — unverhaeltnismaessig fuer die aktuelle Wiki-Groesse.
