/**
 * Unified project import dispatcher.
 *
 * CircuitMuse accepts multiple project formats:
 *
 *   - `.vlx`  — Native single-file JSON (boards + components + wires + code + chat)
 *   - `.zip`  — Wokwi-compatible bundle (diagram.json + sketch files)
 *   - `.fzz`  — Fritzing project (XML in ZIP with breadboard layout + code)
 *   - `.json` — Raw JSON export (same shape as .vlx, or the older raw dump)
 *
 * All UI entry points route through this dispatcher. Every format is parsed
 * and validated completely BEFORE the workspace is touched, and the load
 * itself restores the previous workspace if it fails, so a bad file can
 * never wipe the user's project. Errors are thrown as readable messages.
 */

import {
  applyProjectPayload,
  parseVlxText,
  VlxParseError,
  type VlxPayload,
} from './vlxFile';
import { importFromWokwiZip } from './wokwiZip';
import { importFritzingFile, buildFritzingPayload } from './fritzingImport';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

export interface ProjectImportResult {
  kind: 'vlx' | 'zip' | 'fritzing' | 'json';
  payload: VlxPayload;
  /** Libraries the project declares (Wokwi libraries.txt etc.). */
  libraries: string[];
  /** Non-fatal issues (skipped parts / wires) to show the user. */
  warnings: string[];
}

/** Hard cap so a wrong multi-GB file can't freeze the tab. */
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

function projectNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || 'Imported Project';
}

async function parseProjectFile(file: File): Promise<ProjectImportResult> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.fzz')) {
    const result = await importFritzingFile(file);
    const payload = buildFritzingPayload(result);
    return { kind: 'fritzing', payload, libraries: result.libraries, warnings: result.warnings };
  }

  if (lower.endsWith('.zip')) {
    const result = await importFromWokwiZip(file);
    return { kind: 'zip', payload: result.payload, libraries: result.libraries, warnings: result.warnings };
  }

  const isJson = lower.endsWith('.json');
  if (lower.endsWith('.vlx') || isJson || file.type === 'application/json') {
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      throw new VlxParseError(`Could not read file: ${(err as Error).message}`);
    }
    // Raw JSON exports from older versions have no "format" field.
    const payload = parseVlxText(text, { allowMissingFormat: isJson });
    const libraries = [...new Set(payload.boards.flatMap((b) => b.libraries ?? []))];
    return { kind: isJson ? 'json' : 'vlx', payload, libraries, warnings: [] };
  }

  throw new VlxParseError(
    `Unsupported file: ${file.name}.\nSupported formats: .vlx, .zip, .fzz, .json`,
  );
}

/**
 * Parse `file`, then replace the workspace with it. Throws an Error with a
 * user-facing message on failure; the current workspace is left untouched.
 */
export async function importProjectFile(file: File): Promise<ProjectImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`Could not import ${file.name}:\n\nThe file is larger than 200 MB.`);
  }
  let parsed: ProjectImportResult;
  try {
    parsed = await parseProjectFile(file);
    applyProjectPayload(parsed.payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not import ${file.name}:\n\n${msg}`);
  }
  // The imported project is a new local project: keep auto-save from
  // writing it over the project that was open before.
  useWorkspaceStore
    .getState()
    .setProject(crypto.randomUUID(), parsed.payload.name?.trim() || projectNameFromFile(file.name));
  return parsed;
}

export const PROJECT_FILE_ACCEPT = '.vlx,.zip,.fzz,.json,application/json,application/zip';
