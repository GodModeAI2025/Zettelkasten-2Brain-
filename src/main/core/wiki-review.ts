import { basename } from 'path';
import type { WikiReviewItem, WikiReviewReason } from '../../shared/api.types';
import { isSystemPage, toPageId } from './vault';

interface WikiReviewPage {
  relativePath: string;
  frontmatter: Record<string, unknown>;
}

function pathWithoutWikiPrefix(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^wiki\//, '');
}

function pageTitle(page: WikiReviewPage): string {
  const title = page.frontmatter.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return basename(toPageId(page.relativePath)).replace(/-/g, ' ');
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function reviewReasons(frontmatter: Record<string, unknown>): WikiReviewReason[] {
  const reasons: WikiReviewReason[] = [];
  const status = frontmatter.status;
  const confidence = frontmatter.confidence;

  if (frontmatter.reviewed === false) reasons.push('unreviewed');
  if (status === 'stale') reasons.push('stale');
  if (status === 'seed') reasons.push('seed');
  if (confidence === 'low') reasons.push('low-confidence');
  if (confidence === 'uncertain') reasons.push('uncertain');

  return reasons;
}

function priorityFor(reasons: WikiReviewReason[]): number {
  let priority = 0;
  if (reasons.includes('unreviewed')) priority += 50;
  if (reasons.includes('stale')) priority += 40;
  if (reasons.includes('seed')) priority += 25;
  if (reasons.includes('low-confidence')) priority += 15;
  if (reasons.includes('uncertain')) priority += 15;
  return priority;
}

export function buildWikiReviewQueue(pages: WikiReviewPage[]): WikiReviewItem[] {
  return pages
    .filter((page) => !isSystemPage(basename(toPageId(page.relativePath))))
    .map((page) => {
      const reasons = reviewReasons(page.frontmatter);
      const priority = priorityFor(reasons);
      return {
        path: pathWithoutWikiPrefix(page.relativePath),
        title: pageTitle(page),
        status: stringField(page.frontmatter.status),
        confidence: stringField(page.frontmatter.confidence),
        reviewed: page.frontmatter.reviewed === true,
        created: stringField(page.frontmatter.created),
        updated: stringField(page.frontmatter.updated),
        reasons,
        priority,
      };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.title.localeCompare(b.title);
    });
}
