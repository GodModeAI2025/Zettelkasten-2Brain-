import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface BuiltinSkill {
  name: string;
  description: string;
  content: string;
}

const MARP_SKILL_CONTENT = `---
description: Erzeugt Praesentations-Slides im Marp-Format aus Wiki-Inhalten.
---

# Marp-Praesentation

Du bist ein Slide-Designer. Erzeuge eine Praesentation im Marp-Format (marp.app) aus dem Wiki-Kontext.

## Ausgabeformat

Antworte mit reinem Markdown, das direkt von Marp verarbeitet werden kann. Keine Code-Fences um das gesamte Ergebnis, keine Erklaerung davor oder danach.

## Struktur

1. **Marp-Frontmatter** am Anfang:

   \`\`\`
   ---
   marp: true
   theme: default
   paginate: true
   ---
   \`\`\`

2. **Slides** durch eine Zeile mit \`---\` getrennt (jeweils mit Leerzeilen davor und danach).

3. **Erste Slide** ist die Titel-Slide mit \`<!-- _class: lead -->\` direkt nach dem Slide-Separator.

4. **Slide-Inhalt**:
   - Genau eine Ueberschrift pro Slide (\`#\` oder \`##\`).
   - Knappe Aussagen als Bullets — keine ganzen Absaetze.
   - Max. 5-7 Bullets pro Slide. Bei dichten Themen lieber mehr Slides statt eine ueberfuellte.
   - Fettdruck fuer Schluesselbegriffe.

5. **Wikilinks**: Ersetze \`[[Name]]\` durch Fettdruck \`**Name**\`. Marp rendert keine Wikilinks.

6. **Speaker Notes**: HTML-Kommentare \`<!-- Notiz fuer den Sprecher -->\` nach dem Slide-Inhalt. KEINE \`_notes:\`-Direktive verwenden.

## Layout-Hinweise

- Titel-Slide: \`<!-- _class: lead -->\` direkt nach dem \`---\`.
- Abschnitts-Trenner (\`## Teil 1\` etc.) duerfen alleine stehen.
- Agenda / Ausblick als klassische Bullet-Liste.
- Quellenhinweise am Ende in kleiner Schrift, z.B. \`<small>Quelle: [[wiki/sources/xy.md]] → **xy**</small>\`.

## Umfang

- Titel-Slide + Agenda + 5-10 Inhalts-Slides + Abschluss-Slide.
- Bei umfangreicherem Material mehr Inhalts-Slides; bei knappem Material lieber kuerzer bleiben.

## Beispiel-Struktur

\`\`\`
---
marp: true
theme: default
paginate: true
---

<!-- _class: lead -->

# Titel der Praesentation

Untertitel oder Autor

<!-- Einleitende Bemerkungen -->

---

## Agenda

- Punkt 1
- Punkt 2
- Punkt 3

---

## Thema X

- Kernaussage in einem Satz
- Beleg oder Beispiel
- Offene Frage

<!-- Sprecher erklaert hier Hintergrund -->

---

## Zusammenfassung

- Haupterkenntnis 1
- Haupterkenntnis 2
\`\`\`
`;

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'marp-presentation',
    description: 'Erzeugt Praesentations-Slides im Marp-Format aus Wiki-Inhalten.',
    content: MARP_SKILL_CONTENT,
  },
];

export function builtinSkillsDir(outputDir: string): string {
  return join(outputDir, '_skills');
}

/**
 * Installiert alle fehlenden Built-in-Skills in das Projekt.
 * Ueberschreibt bestehende Skills NICHT. Gibt Liste der neu installierten Namen zurueck.
 */
export async function installBuiltinSkills(outputDir: string): Promise<string[]> {
  const dir = builtinSkillsDir(outputDir);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const installed: string[] = [];
  for (const skill of BUILTIN_SKILLS) {
    const target = join(dir, `${skill.name}.md`);
    if (existsSync(target)) continue;
    await writeFile(target, skill.content, 'utf-8');
    installed.push(skill.name);
  }
  return installed;
}
