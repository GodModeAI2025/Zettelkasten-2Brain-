#!/usr/bin/env node
/**
 * Generiert ein einfaches 2brain App-Icon als PNG.
 * Benoetigt keine externen Abhaengigkeiten - nutzt Canvas ueber Node.
 * Falls canvas nicht verfuegbar: erstellt eine SVG-Datei als Basis.
 */
import { writeFileSync } from 'fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#000099"/>
      <stop offset="100%" style="stop-color:#1a1a6e"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <text x="512" y="580" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif" font-size="420" font-weight="800" fill="white">2b</text>
  <circle cx="780" cy="280" r="80" fill="#FE8F11"/>
</svg>`;

writeFileSync('assets/icon.svg', svg);
console.log('Icon SVG geschrieben: assets/icon.svg');
console.log('');
console.log('Um ein .icns fuer macOS zu erstellen:');
console.log('  1. SVG in PNG konvertieren (z.B. mit Inkscape oder sips)');
console.log('  2. iconutil oder png2icns verwenden');
console.log('  3. In forge.config.ts unter packagerConfig.icon angeben');
