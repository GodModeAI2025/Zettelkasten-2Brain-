# ADR 0003 — Built-in Marp-Praesentations-Skill

- **Status:** Accepted
- **Datum:** 2026-04-17

## Kontext

Fuer Output-Generierung (`src/main/ipc/output.ipc.ts`) koennen Skills als Prompt-Bausteine angehaengt werden. Ein Marp-Praesentations-Skill war wiederholt manuell zu erstellen — mit Fehleranfaelligkeit bei Frontmatter, Slide-Trennern und Speaker-Notes. Es braucht einen sofort verfuegbaren, getesteten Skill.

## Entscheidung

"Built-in Skills" als neue Kategorie, geliefert mit der App. Implementierung:

- `src/main/core/skills/builtin.ts` definiert `BUILTIN_SKILLS: BuiltinSkill[]`.
- Aktuell: `marp-presentation` mit detaillierten Anweisungen zu Frontmatter (`marp: true`, theme, paginate), Slide-Struktur, Wikilink-Ersetzung durch Fettdruck, Speaker-Notes als HTML-Kommentare.
- `installBuiltinSkills(outputDir)` kopiert neue Skills nicht-destruktiv nach `output/_skills/` — bestehende bleiben unveraendert.
- Auto-Install bei Projektanlage (`ProjectService.create`); plus Button "Built-in installieren" in der OutputPage fuer bestehende Projekte.
- Neue IPC-Handler `skill:list-builtin` und `skill:install-builtin`.

## Konsequenzen

**Positiv**
- Sofort nutzbarer Marp-Workflow ohne Copy/Paste.
- Skill-Inhalt ist versionskontrolliert mit der App — Updates kommen automatisch.
- User kann installierten Skill nachtraeglich editieren (normales Skill-Handling).

**Negativ**
- Zusaetzlicher Pfad im Output-Ordner (`_skills/`). Konflikte mit User-Skills gleicher Namen theoretisch moeglich — `installBuiltinSkills` ist deshalb non-destructive.

## Abgrenzung

Kein neues Output-Format `marp` im UI: Nutzer waehlen weiterhin `format=markdown` und haengen den Skill an. Das vereinfacht das Datenmodell.
