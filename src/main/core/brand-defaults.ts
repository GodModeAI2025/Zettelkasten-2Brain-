/** Seed-Inhalte fuer den Brand-Foundation-Layer eines neu erstellten Projekts. */

export const BRAND_DEFAULTS: Record<'voice' | 'style' | 'positioning', string> = {
  voice: `# Voice

## Ton

Beschreibe hier wie du klingst. Kurz, direkt, fachlich, warm, provokant — was auch immer. Die KI liest diesen Abschnitt vor jeder Query und jedem Ingest und richtet ihre Sprache danach aus.

## Banned Words

Worte die niemals in KI-generierten Texten vorkommen sollen. Ein Eintrag pro Zeile.

- delve
- leverage
- revolutionaer
- bahnbrechend

## Banned Phrases

Formulierungen die sofort nach KI klingen. Ein Eintrag pro Zeile.

- In der heutigen schnelllebigen Welt
- Es ist wichtig zu beachten
- Lass uns eintauchen

## Typische Wendungen

Formulierungen, Satzmuster, Metaphern die fuer dich typisch sind. Die KI darf sie nutzen.
`,
  style: `# Style

## Formatierung

- Kurze Absaetze (max. 3-4 Zeilen).
- Aufzaehlungen statt Fliesstext wo moeglich.
- Zwischenueberschriften ab ca. 200 Woertern.

## Markdown-Konventionen

- H1 nur einmal pro Seite (der Titel).
- Fettdruck fuer Begriffe, Kursiv nur sparsam.
- Inline-Code fuer Dateinamen und Pfade.

## Laenge

Default: so knapp wie moeglich, so ausfuehrlich wie noetig. Kein Fuelltext, keine Zusammenfassungen am Ende.

## Beispiele

Fuege hier Beispiel-Ausschnitte ein die dein Stil-Ideal konkret machen.
`,
  positioning: `# Positioning

## Zielgruppe

Wer liest das? Was weiss er/sie schon, was muss nicht erklaert werden?

## Thesen

Was sind deine Kernthesen? Welche Position nimmst du in deinem Themenfeld ein?

-
-
-

## Abgrenzung

Wogegen positionierst du dich bewusst? Welche verbreiteten Meinungen teilst du nicht?

## Themenfokus

Worueber schreibst/denkst du, worueber nicht?
`,
};
