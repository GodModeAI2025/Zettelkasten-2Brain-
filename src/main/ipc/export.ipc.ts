import { ipcMain, dialog, BrowserWindow, app, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { glob } from 'glob';
import AdmZip from 'adm-zip';
import MarkdownIt from 'markdown-it';
import { ProjectService } from '../services/project.service';
import { toPageId, isSystemPage, parseFrontmatterBlock, generateWikilinkMap, updateIndexes } from '../core/vault';
import { buildOkfBundle, type ExportPage } from '../core/okf-export';
import { buildGraphData } from '../core/graph-build';
import { renderGraphHtml, type GraphHtmlBundle } from '../core/graph-html';
import { transformImportedPage } from '../core/wiki-import';
import { requireRootPrefix } from '../core/pathSafety';
import type { OkfExportResult, OkfImportResult } from '../../shared/api.types';

function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  md.inline.ruler.push('wikilink', (state, silent) => {
    const m = state.src.slice(state.pos).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!m) return false;
    if (!silent) {
      const token = state.push('wikilink', '', 0);
      token.meta = { target: m[1].trim(), label: (m[2] || m[1]).trim() };
      state.pos += m[0].length;
    }
    return true;
  });
  md.renderer.rules['wikilink'] = (tokens, idx) => {
    const { target, label } = tokens[idx].meta as { target: string; label: string };
    return `<a class="wikilink" href="#" data-wiki-target="${encodeURIComponent(target)}">${md.utils.escapeHtml(label)}</a>`;
  };
  return md;
}

export function registerExportHandlers(): void {
  ipcMain.handle(
    'okf:export',
    async (_event, projectName: string, opts?: { targetDir?: string; zip?: boolean }): Promise<OkfExportResult> => {
      const vault = ProjectService.getVault(projectName);

      const pages: ExportPage[] = (await vault.loadAllWikiPages())
        .filter((p) => !isSystemPage(basename(p.relativePath, '.md')))
        .filter((p) => p.frontmatter.reviewed !== false) // unreviewte Seiten ausschliessen
        .map((p) => ({ id: toPageId(p.relativePath), content: p.content }));

      let targetDir = opts?.targetDir;
      if (!targetDir) {
        const win = BrowserWindow.getFocusedWindow();
        const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
        const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        if (res.canceled || !res.filePaths[0]) return { canceled: true };
        targetDir = res.filePaths[0];
      }

      const bundle = buildOkfBundle(pages, {
        generator: `Zettelkasten ${app.getVersion()}`,
        generatedAt: new Date().toISOString(),
        bundleName: `${projectName} — Wiki`,
      });

      const bundleDir = join(targetDir, `${projectName}-okf`);
      await rm(bundleDir, { recursive: true, force: true });
      for (const file of bundle.files) {
        const dest = join(bundleDir, file.path);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, file.content, 'utf-8');
      }

      let zipPath: string | undefined;
      if (opts?.zip) {
        const zip = new AdmZip();
        zip.addLocalFolder(bundleDir);
        zipPath = `${bundleDir}.zip`;
        zip.writeZip(zipPath);
      }

      return {
        canceled: false,
        bundleDir,
        zipPath,
        pageCount: bundle.manifest.page_count,
        unresolvedCount: bundle.manifest.unresolved_links.length,
        collisionCount: bundle.manifest.alias_collisions.length,
      };
    },
  );

  ipcMain.handle(
    'wiki:export-html',
    async (_event, projectName: string, opts?: { targetPath?: string }): Promise<OkfExportResult> => {
      const vault = ProjectService.getVault(projectName);
      const allPages = await vault.loadAllWikiPages();
      const { index } = await vault.getSearchIndex(allPages);
      const graph = buildGraphData(allPages, index);

      const md = createMarkdown();
      const bodies: Record<string, string> = {};
      for (const [id, content] of graph.bodies) {
        bodies[id] = md.render(parseFrontmatterBlock(content).body);
      }
      const backlinks: Record<string, string[]> = {};
      for (const [id, list] of graph.backlinks) backlinks[id] = list;

      const htmlBundle: GraphHtmlBundle = {
        title: `${projectName} — Wissensgraph`,
        generatedAt: new Date().toISOString(),
        nodes: graph.nodes.map((n) => ({
          id: n.id, label: n.label, group: n.group,
          community: n.community, pagerank: n.pagerank, degree: n.degree,
        })),
        edges: graph.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
        bodies,
        backlinks,
      };

      let targetPath = opts?.targetPath;
      if (!targetPath) {
        const win = BrowserWindow.getFocusedWindow();
        const options: SaveDialogOptions = {
          defaultPath: `${projectName}-graph.html`,
          filters: [{ name: 'HTML', extensions: ['html'] }],
        };
        const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (res.canceled || !res.filePath) return { canceled: true };
        targetPath = res.filePath;
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, renderGraphHtml(htmlBundle), 'utf-8');

      return { canceled: false, bundleDir: targetPath, pageCount: graph.nodes.length };
    },
  );

  ipcMain.handle(
    'wiki:import-bundle',
    async (_event, projectName: string, opts?: { sourceDir?: string }): Promise<OkfImportResult> => {
      let sourceDir = opts?.sourceDir;
      if (!sourceDir) {
        const win = BrowserWindow.getFocusedWindow();
        const options: OpenDialogOptions = { properties: ['openDirectory'] };
        const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        if (res.canceled || !res.filePaths[0]) return { canceled: true };
        sourceDir = res.filePaths[0];
      }

      const vault = ProjectService.getVault(projectName);
      const mdFiles = await glob('**/*.md', { cwd: sourceDir, nodir: true });

      let imported = 0;
      const skipped: string[] = [];
      for (const rel of mdFiles) {
        const name = basename(rel, '.md');
        if (name === 'index' || name === 'log') { skipped.push(rel); continue; } // OKF-Reserved
        try {
          const raw = await readFile(join(sourceDir, rel), 'utf-8');
          const page = transformImportedPage(rel, raw);
          const safePath = requireRootPrefix(page.wikiRelativePath, 'wiki');
          await vault.writeFile(safePath, page.content);
          imported++;
        } catch {
          skipped.push(rel);
        }
      }

      if (imported > 0) {
        await generateWikilinkMap(vault.wikiDir);
        await updateIndexes(vault.wikiDir);
        await ProjectService.commitIfNeeded(projectName, `Bundle-Import: ${imported} Seite(n)`);
      }

      return { canceled: false, imported, skipped };
    },
  );
}
