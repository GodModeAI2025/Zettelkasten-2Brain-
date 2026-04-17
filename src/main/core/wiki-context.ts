export function buildWikiContext(
  pages: Array<{ relativePath: string; content: string }>,
  maxChars: number,
  emptyMessage = 'Keine relevanten Wiki-Seiten gefunden.'
): string {
  if (pages.length === 0) {
    return emptyMessage;
  }

  const sections: string[] = [];
  let totalChars = 0;

  for (const page of pages) {
    const section = `--- ${page.relativePath} ---\n${page.content}`;
    const remainingChars = maxChars - totalChars;
    if (remainingChars <= 0) {
      break;
    }

    if (section.length > remainingChars) {
      sections.push(`${section.slice(0, remainingChars)}\n[... gekuerzt ...]`);
      totalChars = maxChars;
      break;
    }

    sections.push(section);
    totalChars += section.length + 2;
  }

  const omittedCount = pages.length - sections.length;
  if (omittedCount > 0) {
    sections.push(
      `[${omittedCount} weitere relevante Seite(n) wurden aus Platzgruenden weggelassen]`
    );
  }

  return sections.join('\n\n');
}
