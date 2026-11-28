/**
 * Download the current circuit as KiCad files. Loaded lazily by the export
 * menu and the schematic view.
 */
import { triggerDownload } from '../utils/exportFormats';
import { exportKicad, kicadSafeName } from './kicad';
import { schematicInputFromStore } from './fromStore';

export type KicadFormat = 'kicad_sch' | 'net' | 'zip';

export async function downloadKicad(format: KicadFormat, projectName: string): Promise<void> {
  const name = kicadSafeName(projectName);
  const bundle = exportKicad(schematicInputFromStore(), { projectName: name });
  if (format === 'kicad_sch') {
    triggerDownload(new Blob([bundle.schematic], { type: 'text/plain' }), `${name}.kicad_sch`);
    return;
  }
  if (format === 'net') {
    triggerDownload(new Blob([bundle.netlist], { type: 'text/plain' }), `${name}.net`);
    return;
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const dir = zip.folder(name)!;
  dir.file(`${name}.kicad_pro`, bundle.project);
  dir.file(`${name}.kicad_sch`, bundle.schematic);
  dir.file(`${name}.net`, bundle.netlist);
  triggerDownload(await zip.generateAsync({ type: 'blob' }), `${name}-kicad.zip`);
}
