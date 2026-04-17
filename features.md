# 2brain Desktop — Features

## Was ist 2brain?

2brain ist ein KI-gestuetztes Wissensmanagementsystem als Desktop-App. Es verwandelt Dokumente, PDFs, Bilder und Notizen in ein strukturiertes, verlinktes Wiki — automatisch organisiert, durchsuchbar und visualisierbar. Die KI liest, versteht und verknuepft dein Wissen. Du fragst, sie antwortet.

---

## Dokumente hochladen & konvertieren

Ziehe Dateien per Drag-and-Drop in die App. 2brain akzeptiert PDF, Word (DOCX), HTML, Markdown, Text, CSV, JSON, Logdateien und Bilder (JPG, PNG, GIF, WEBP). Textbasierte Binaerformate werden automatisch in Markdown konvertiert. Bilder werden ueber die Claude Vision-API analysiert — die KI erkennt Diagramme, Screenshots, Infografiken, Fotos und handschriftliche Notizen und extrahiert daraus strukturiertes Wissen. Duplikate werden erkannt und mit einem Suffix versehen, damit nichts verloren geht.

Jede Datei zeigt ihren Status: neu, verarbeitet oder fehlerhaft. Du kannst Dateien einzeln vorschauen (Bilder als Bildvorschau, Text als Rohansicht), neu verarbeiten oder komplett aus dem Wiki entfernen lassen.

---

## KI-Ingestion

Das Herzstuck: Die KI liest deine Rohdokumente und erzeugt daraus ein strukturiertes Wiki.

- **Quellen-Seiten** fassen jedes Dokument zusammen
- **Entitaeten** (Personen, Organisationen, Produkte, Werkzeuge) werden automatisch extrahiert
- **Konzepte** (Theorien, Frameworks, Methoden, Muster) werden erkannt und eingeordnet
- **Wikilinks** vernetzen alles untereinander
- **Widersprueche** zwischen Quellen werden erkannt und dokumentiert
- **Versionierung**: Veraltete Informationen werden als "stale" markiert und auf die neuere Seite verwiesen

Du entscheidest, welche Dateien verarbeitet werden. Der Fortschritt laeuft im Hintergrund — du kannst weiterarbeiten waehrend die KI dein Wiki aufbaut.

---

## Takeaway-Diskussion

Nach dem Ingest zeigt die App die Kernaussagen, die Claude aus deinen Quellen destilliert hat. Jede dieser Aussagen kannst du als Sparring-Chat weiterfuehren:

- **Diskutieren**: Oeffne ein Chat-Panel pro Takeaway. Claude antwortet mit Bezug auf die Quelldatei und die relevantesten Wiki-Seiten.
- **Gegenpositionen, Nachfragen, Anschluesse**: Die KI agiert als Sparringspartner, nicht als Echo.
- **Als Synthese speichern**: Gute Diskussionen lassen sich in eine `wiki/synthesis/`-Seite verdichten — mit korrektem Frontmatter und automatischem Git-Commit.
- Diskussionen leben nur in der laufenden Session (bewusst keine Cross-Session-Persistenz — siehe ADR 0004).

---

## Wiki durchsuchen & lesen

Das Wiki organisiert sich in drei Bereiche:

- **sources/** — Zusammenfassungen deiner Originaldokumente
- **entities/** — Konkrete Dinge: Menschen, Firmen, Tools, Orte
- **concepts/** — Abstrakte Ideen: Methoden, Theorien, Prinzipien

Jede Seite zeigt Metadaten als Badges: Status (seed/confirmed/stale), Vertrauensniveau, Quellen, Tags und Zeitstempel. Wikilinks sind klickbar und fuehren direkt zur Zielseite. Die Seitennavigation ist durchsuchbar und nach Ordnern gruppiert.

---

## Wissensgraph

Eine interaktive Visualisierung aller Wiki-Seiten und ihrer Verbindungen.

- **Farbcodierung** nach Kategorie: Quellen (blau), Entitaeten (orange), Konzepte (gruen)
- **Knotengroesse** spiegelt die Anzahl der Verbindungen wider
- **Interaktiv**: Zoomen, verschieben, Knoten anklicken fuer Details
- **Suchfilter**: Finde bestimmte Knoten im Graphen
- **Abstandsregler**: Passe die Dichte der Darstellung an
- **Detail-Panel**: Zeigt eingehende und ausgehende Links fuer jeden Knoten

---

## Fragen stellen

Stelle Fragen an dein Wiki und erhalte fundierte Antworten.

- Die KI durchsucht relevante Wiki-Seiten und synthetisiert eine Antwort
- **BM25-Ranking** waehlt die relevantesten Seiten aus — statistisch fundiert statt simpler Keyword-Zaehlung, mit Title- und Phrasen-Boost
- **Persistenter Index**: Token-Statistiken werden pro Seite gecacht und per mtime invalidiert — erster Query nach Neustart ist genauso schnell wie alle folgenden
- **Streaming**: Die Antwort erscheint Wort fuer Wort
- **Quellenangaben**: Jede Antwort listet die verwendeten Wiki-Seiten
- **Vertrauensniveau**: Die KI schaetzt ein, wie sicher sie sich ist — und erklaert warum
- **Aktualitaetswarnung**: Wenn zitierte Quellen als veraltet markiert sind
- **Als Synthese speichern**: Gute Antworten koennen als neue Wiki-Seite gesichert werden

---

## Gesundheitscheck

Prueft die Integritaet des Wikis auf:

- **Broken Links**: Wikilinks die ins Leere zeigen
- **Verwaiste Seiten**: Seiten ohne eingehende Links
- **Index-Luecken**: Seiten die im Inhaltsverzeichnis fehlen
- **Veraltungsrisiken**: Seed-Seiten ueber 90 Tage alt, ersetzte Seiten ohne Stale-Markierung
- **Fehlende Metadaten**: Seiten ohne Status- oder Vertrauensfeld

Die automatische Reparatur arbeitet in drei Phasen:

1. **Mechanisch**: Frontmatter-Fehler korrigieren (fehlende Felder ergaenzen, Status anpassen)
2. **KI-gestuetzt**: Fuer Broken Links erstellt die KI aus dem vorhandenen Wiki-Material echte Seiten — keine leeren Stubs, sondern inhaltlich fundierte Eintraege
3. **Indexes**: Wikilink-Map und Inhaltsverzeichnisse automatisch aktualisieren

Ein Fortschrittsdialog zeigt jeden Schritt mit Status-Icons (ausstehend, aktiv, erledigt, Fehler) und einem aufklappbaren Detail-Log.

### Lernvorschlaege

Zusaetzlich zum mechanischen Check: Claude erzeugt auf Knopfdruck vier Kategorien inhaltlicher Impulse — **offene Fragen**, **Themenluecken**, **fehlende Quellentypen**, **Synthese-Kandidaten**. Jeder Vorschlag ist mit einem Button "Im Chat fragen" direkt in den Query-Chat uebertragbar.

---

## Outputs generieren

Erstelle massgeschneiderte Dokumente aus deinem Wiki-Wissen.

- **Quellmuster**: Waehle per Glob-Pattern welche Wiki-Seiten einfliessen (z.B. `wiki/concepts/**/*.md`)
- **Eigener Prompt**: Schreibe Anweisungen, was die KI aus dem Material erstellen soll
- **Skills**: Wiederverwendbare Instruktionsvorlagen, die an Outputs angehaengt werden koennen
- **Built-in Skills**: Mitgelieferte Vorlagen wie `marp-presentation` — per Klick installiert und sofort nutzbar
- **Marp-Slides**: Outputs mit `marp: true`-Frontmatter werden direkt in der App als Slide-Deck gerendert — mit Tastatur-Navigation (Pfeiltasten), Slide-Zaehler und Drucken-Funktion fuer alle Slides
- **Hintergrund-Generierung**: Die App bleibt bedienbar waehrend die KI arbeitet
- **Auto-Update**: Wenn sich Wiki-Inhalte aendern (durch Ingest oder Reparatur), werden betroffene Outputs automatisch neu generiert
- **Drucken**: Jedes Ergebnis kann ueber einen Druck-Dialog sauber ausgedruckt werden

---

## Git-Synchronisation

Das gesamte Wiki ist ein Git-Repository.

- **Automatische Commits** nach Upload, Ingest, Reparatur und Output-Generierung
- **Pull & Push**: Aenderungen mit einem Remote-Repository synchronisieren
- **Force Pull / Force Push**: Fuer Konfliktfaelle
- **Status-Anzeige**: Zeigt ob lokale Aenderungen vorliegen und wie viele Commits voraus/zurueck

---

## Multi-Projekt

Verwalte mehrere Wissensbasen in einer App.

- Jedes Projekt hat eigenes Themenfeld, Sprache und KI-Einstellungen
- Eigene Entity- und Konzepttypen pro Projekt konfigurierbar
- Verschiedene Claude-Modelle fuer Ingest, Query und Lint waehlbar
- Schneller Projektwechsel ueber die Einstellungen

---

## Quellenmanagement

Entscheide, was in deinem Wiki bleibt.

- **Vergessen**: Entferne eine Quelle und alle davon abhaengigen Informationen
- **Vorschau**: Sieh vorher, welche Wiki-Seiten betroffen waeren
- **Intelligentes Loeschen**: Die KI entfernt nur quellenspezifische Informationen — Fakten die durch andere Quellen gestuetzt werden, bleiben erhalten

---

## Sicherheit & Datenschutz

- **Lokale Verarbeitung**: Alle Daten liegen auf deinem Rechner
- **Verschluesselte Secrets**: API-Key und Git-Token werden mit Electron safeStorage geschuetzt
- **Path-Safety**: Die App verhindert Zugriffe ausserhalb des Projektordners
- **Kein Cloud-Zwang**: Git-Sync ist optional — das Wiki funktioniert auch rein lokal
