/**
 * Copies monaco-editor's min/vs assets into public/monaco/vs and writes a
 * .gitignore so the generated files are never tracked in git.
 * Cross-platform replacement for the Unix-only shell one-liner.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const src = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const dest = join(root, 'public', 'monaco', 'vs');
const monacoDir = join(root, 'public', 'monaco');

if (!existsSync(src)) {
  console.error('monaco-editor not found in node_modules — skipping copy.');
  process.exit(0);
}

mkdirSync(monacoDir, { recursive: true });

// Write a .gitignore that ignores everything inside public/monaco/
writeFileSync(join(monacoDir, '.gitignore'), '*\n!.gitignore\n');

cpSync(src, dest, { recursive: true });

console.log('monaco-editor assets copied to public/monaco/vs');
