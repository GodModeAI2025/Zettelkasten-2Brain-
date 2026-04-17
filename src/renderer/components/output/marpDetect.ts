/**
 * Erkennt Marp-Markdown anhand des Frontmatter-Eintrags `marp: true`.
 * Akzeptiert YAML-Frontmatter, das mit `---` oeffnet und schliesst.
 */
export function isMarpContent(content: string): boolean {
  if (!content.startsWith('---')) return false;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return false;
  const fm = content.slice(3, end);
  return /^\s*marp\s*:\s*true\s*$/m.test(fm);
}
