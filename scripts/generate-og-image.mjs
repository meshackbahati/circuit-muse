/**
 * OG Image generator — converts og-image.svg to og-image.png (1200x630).
 * Run from project root:  node scripts/generate-og-image.mjs
 *
 * Generates:
 *   frontend/public/og-image.png   (1200×630 — required by OG / Twitter Card)
 *
 * Note: SVG images are NOT supported by most OG crawlers (Facebook, Slack,
 * WhatsApp, Google Search Console…). This script produces the required PNG.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const PUBLIC    = join(ROOT, 'frontend', 'public');

// ── install @resvg/resvg-js on the fly if missing ──────────────────
async function ensureDep(pkg) {
  try { return await import(pkg); } catch {}
  console.log(`Installing ${pkg}…`);
  const { execSync } = await import('child_process');
  execSync(`npm install --no-save ${pkg}`, { stdio: 'inherit', cwd: ROOT });
  return await import(pkg);
}

const { Resvg } = await ensureDep('@resvg/resvg-js');

// ── render og-image.svg at 1200 px wide ────────────────────────────
const svgPath = join(PUBLIC, 'og-image.svg');
const svgSrc  = readFileSync(svgPath);

const resvg = new Resvg(svgSrc, {
  fitTo: { mode: 'width', value: 1200 },
  font:  { loadSystemFonts: false },
});

const pngData   = resvg.render();
const pngBuffer = pngData.asPng();

writeFileSync(join(PUBLIC, 'og-image.png'), pngBuffer);

console.log(`✓ og-image.png  (1200×auto)`);
console.log('\nDone. og-image.png is ready in frontend/public/');
