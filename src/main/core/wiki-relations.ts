import { basename } from 'path';
import { isSystemPage, toPageId } from './vault';
import { extractWikilinks, linkTargetAliases, pageAliases } from './wikilinks';

export interface WikiRelationPage {
  relativePath: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export interface WikiBacklink {
  path: string;
  title: string;
  count: number;
  matches: string[];
}

function activePagePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^wiki\//, '');
}

function pageTitle(page: WikiRelationPage): string {
  const title = page.frontmatter?.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return basename(toPageId(page.relativePath)).replace(/-/g, ' ');
}

export function findBacklinks(pages: WikiRelationPage[], targetRelativePath: string): WikiBacklink[] {
  const targetId = toPageId(targetRelativePath);
  const targetName = basename(targetId);
  const targetAliases = new Set(pageAliases(targetId, targetName));
  const backlinks: WikiBacklink[] = [];

  for (const page of pages) {
    const sourceId = toPageId(page.relativePath);
    if (sourceId === targetId) continue;
    if (isSystemPage(basename(sourceId))) continue;

    const matches: string[] = [];
    for (const link of extractWikilinks(page.content)) {
      const pointsToTarget = linkTargetAliases(link.target).some((alias) => targetAliases.has(alias));
      if (pointsToTarget) matches.push(link.displayText || link.target);
    }

    const uniqueMatches = [...new Set(matches.map((match) => match.trim()).filter(Boolean))];
    if (uniqueMatches.length === 0) continue;

    backlinks.push({
      path: activePagePath(page.relativePath),
      title: pageTitle(page),
      count: matches.length,
      matches: uniqueMatches,
    });
  }

  return backlinks.sort((a, b) => a.title.localeCompare(b.title));
}
