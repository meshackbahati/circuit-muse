/**
 * Editor dialogs must never display raw translation keys. This guard scans the
 * components for literal translation keys in the editor namespace and fails
 * when the English bundle has no value for one of them, which is how the
 * property dialog and the component picker regressed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n';

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

describe('editor translations', () => {
  it('defines every literal editor key used by the UI', () => {
    const used = new Set<string>();
    for (const file of sourceFiles('src')) {
      if (file.includes('__tests__')) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?<![\w.])t\(\s*(['"])(editor\.[^'"]+)\1/g)) {
        used.add(match[2]);
      }
    }
    expect(used.size).toBeGreaterThan(50);
    const missing = [...used].filter((key) => i18n.t(key) === key);
    expect(missing).toEqual([]);
  });
});
