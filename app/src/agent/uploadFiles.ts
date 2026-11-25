import { readUploadedFile } from './fileReader';
import { useUploadsStore } from '../store/useUploadsStore';

/**
 * Parse files from the picker, a drop, or the clipboard and append them to the
 * attachment tray. Parsing runs in parallel because image and PDF extraction
 * can take a moment per file.
 */
export async function ingestFiles(files: Iterable<File>): Promise<void> {
  const list = Array.from(files);
  if (list.length === 0) return;
  const parsed = await Promise.all(list.map(readUploadedFile));
  const addFile = useUploadsStore.getState().addFile;
  for (const file of parsed) addFile(file);
}
