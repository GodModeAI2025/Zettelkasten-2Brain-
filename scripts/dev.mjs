#!/usr/bin/env node
/**
 * Dev-Script: Baut Renderer + Main + Preload statisch, startet Electron.
 * Kein Dev-Server — alles lokal gebuendelt wie eine richtige App.
 *
 * Usage: npm run dev
 */
import { spawn } from 'node:child_process';
import { build } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, cpSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let electronProc = null;

async function buildRenderer() {
  const outDir = join(ROOT, '.vite', 'renderer', 'main_window');
  await build({
    configFile: join(ROOT, 'vite.renderer.config.ts'),
    root: ROOT,
    build: {
      outDir,
      emptyOutDir: true,
    },
  });
  console.log('[dev] Renderer gebaut');
}

async function buildMain() {
  await build({
    configFile: join(ROOT, 'vite.main.config.ts'),
    root: ROOT,
    build: {
      outDir: join(ROOT, '.vite', 'build'),
      lib: {
        entry: join(ROOT, 'src/main/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        external: [
          'electron',
          /^node:/,
          'fs', 'fs/promises', 'path', 'crypto', 'buffer', 'stream', 'zlib',
          'http', 'https', 'querystring', 'url', 'os', 'events', 'util',
          'child_process', 'net', 'tls', 'assert', 'constants', 'module',
          'dns', 'tty', 'worker_threads',
          // Native/Worker-basierte Pakete nicht bundlen
          'pdf-parse', /^pdf-parse\//, 'pdfjs-dist', /^pdfjs-dist\//,
          'mammoth', 'node-html-markdown',
        ],
      },
      minify: false,
      emptyOutDir: false,
    },
    define: {
      // Kein Dev-Server — Electron laedt index.html direkt vom Dateisystem
      MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
      MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
    },
  });
  console.log('[dev] Main-Prozess gebaut');
}

async function buildPreload() {
  await build({
    configFile: join(ROOT, 'vite.preload.config.ts'),
    root: ROOT,
    build: {
      outDir: join(ROOT, '.vite', 'build'),
      lib: {
        entry: join(ROOT, 'src/preload/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      rollupOptions: {
        external: ['electron'],
      },
      minify: false,
      emptyOutDir: false,
    },
  });
  console.log('[dev] Preload gebaut');
}

function startElectron() {
  const electronPath = join(ROOT, 'node_modules', '.bin', 'electron');
  electronProc = spawn(electronPath, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  electronProc.on('close', (code) => {
    console.log(`[dev] Electron beendet (code ${code})`);
    process.exit(code ?? 0);
  });
  console.log('[dev] Electron gestartet — App oeffnet sich');
}

function cleanup() {
  if (electronProc && !electronProc.killed) {
    electronProc.kill();
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

try {
  console.log('[dev] Baue App...');
  // Alle drei parallel bauen
  await Promise.all([buildRenderer(), buildMain(), buildPreload()]);
  // Electron starten
  startElectron();
} catch (err) {
  console.error('[dev] Build-Fehler:', err);
  process.exit(1);
}
