/**
 * Favicon generator — converts favicon.svg into all required sizes.
 * Run from project root: node scripts/generate-favicons.mjs
 *
 * Generates:
 *   frontend/public/favicon-16x16.png
 *   frontend/public/favicon-32x32.png
 *   frontend/public/favicon-48x48.png
 *   frontend/public/apple-touch-icon.png   (180x180)
 *   frontend/public/android-chrome-192.png
 *   frontend/public/android-chrome-512.png
 *   frontend/public/favicon.ico            (16+32+48 multi-size)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const PUBLIC    = join(ROOT, 'frontend', 'public');

// ── install deps on the fly if missing ─────────────────────────────
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function ensureDep(pkg) {
  try { return await import(pkg); } catch {}
  console.log(`Installing ${pkg}…`);
  const { execSync } = await import('child_process');
  execSync(`npm install --no-save ${pkg}`, { stdio: 'inherit', cwd: ROOT });
  return await import(pkg);
}

const { Resvg }      = await ensureDep('@resvg/resvg-js');
const pngToIcoMod    = await ensureDep('png-to-ico');
const pngToIco       = pngToIcoMod.default ?? pngToIcoMod;

// ── render helper ───────────────────────────────────────────────────
const svgSrc = readFileSync(join(PUBLIC, 'favicon.svg'));

function renderPng(size) {
  const resvg = new Resvg(svgSrc, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

// ── generate PNGs ───────────────────────────────────────────────────
const sizes = [
  { name: 'favicon-16x16.png',      size: 16  },
  { name: 'favicon-32x32.png',      size: 32  },
  { name: 'favicon-48x48.png',      size: 48  },
  { name: 'apple-touch-icon.png',   size: 180 },
  { name: 'android-chrome-192.png', size: 192 },
  { name: 'android-chrome-512.png', size: 512 },
];

const pngBuffers = {};
for (const { name, size } of sizes) {
  const buf = renderPng(size);
  writeFileSync(join(PUBLIC, name), buf);
  pngBuffers[size] = buf;
  console.log(`✓ ${name}  (${size}x${size})`);
}

// ── generate favicon.ico (16 + 32 + 48) ────────────────────────────
const icoBuffer = await pngToIco([
  pngBuffers[16],
  pngBuffers[32],
  pngBuffers[48],
]);
writeFileSync(join(PUBLIC, 'favicon.ico'), icoBuffer);
console.log('✓ favicon.ico  (16+32+48)');

console.log('\nAll favicon assets generated in frontend/public/');
