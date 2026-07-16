/**
 * Unified project import dispatcher.
 *
 * CircuitMuse accepts multiple project formats:
 *
 *   - `.vlx`  — Native single-file JSON (boards + components + wires + code)
 *   - `.zip`  — Wokwi-compatible bundle (diagram.json + sketch files)
 *   - `.fzz`  — Fritzing project (XML in ZIP with breadboard layout + code)
 *   - `.json` — Raw JSON (boards, components, wires, fileGroups)
 *
 * All UI entry points route through this dispatcher.
 */

import type { Wire } from '../types/wire';
import { importVlxFile, VlxParseError } from './vlxFile';
import { importFromWokwiZip, type CircuitMuseComponent } from './wokwiZip';
import { importFritzingFile, loadFritzingIntoStores, type FritzingImportResult } from './fritzingImport';

export type ProjectImportResult =
  | { kind: 'vlx' }
  | {
      kind: 'zip';
      boardType: string;
      boardPosition: { x: number; y: number };
      components: CircuitMuseComponent[];
      wires: Wire[];
      files: Array<{ name: string; content: string }>;
      libraries: string[];
    }
  | { kind: 'fritzing'; result: FritzingImportResult }
  | { kind: 'json' };

export async function importProjectFile(file: File): Promise<ProjectImportResult> {
  const lower = file.name.toLowerCase();

  // .vlx — native format
  if (lower.endsWith('.vlx') || (file.type === 'application/json' && !lower.endsWith('.zip') && !lower.endsWith('.json'))) {
    try {
      await importVlxFile(file);
      return { kind: 'vlx' };
    } catch (err) {
      const msg = err instanceof VlxParseError ? err.message : (err as Error).message;
      throw new Error(`Could not load .vlx file:\n\n${msg}`);
    }
  }

  // .fzz — Fritzing format (check before .zip since it's also a ZIP)
  if (lower.endsWith('.fzz')) {
    const result = await importFritzingFile(file);
    loadFritzingIntoStores(result);
    return { kind: 'fritzing', result };
  }

  // .zip — Wokwi bundle
  if (lower.endsWith('.zip')) {
    const result = await importFromWokwiZip(file);
    return { kind: 'zip', ...result };
  }

  // .json — raw JSON
  if (lower.endsWith('.json')) {
    const text = await file.text();
    const data = JSON.parse(text);
    // Import as VlxPayload if it has the right shape
    if (data.format === 'velxio-project' || (data.boards && data.fileGroups)) {
      const { useSimulatorStore } = await import('../store/useSimulatorStore');
      useSimulatorStore.getState().loadProjectState({
        boards: data.boards ?? [],
        fileGroups: data.fileGroups ?? {},
        components: data.components ?? [],
        wires: data.wires ?? [],
        activeBoardId: data.activeBoardId ?? null,
      });
      return { kind: 'json' };
    }
    throw new Error('Invalid JSON project file');
  }

  throw new Error(
    `Unsupported file: ${file.name}.\nSupported formats: .vlx, .zip, .fzz, .json`,
  );
}

export const PROJECT_FILE_ACCEPT = '.vlx,.zip,.fzz,.json,application/json,application/zip';
