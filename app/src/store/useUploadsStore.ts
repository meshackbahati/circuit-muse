import { create } from 'zustand';

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'docx' | 'binary';
  text?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

interface UploadsState {
  files: UploadedFile[];
  addFile: (file: UploadedFile) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  setFiles: (files: UploadedFile[]) => void;
}

export const useUploadsStore = create<UploadsState>((set) => ({
  files: [],
  addFile: (file) => set((s) => ({ files: [...s.files, file] })),
  removeFile: (id) => set((s) => ({ files: s.files.filter(f => f.id !== id) })),
  clearFiles: () => set({ files: [] }),
  setFiles: (files) => set({ files }),
}));
