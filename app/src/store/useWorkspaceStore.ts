import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  projectId: string | null;
  projectName: string;
  setProject: (id: string, name: string) => void;
  renameProject: (name: string) => void;
  clearProject: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      projectId: null,
      projectName: 'Untitled Project',
      setProject: (projectId, projectName) => set({ projectId, projectName }),
      renameProject: (projectName) => set({ projectName }),
      clearProject: () => set({ projectId: null, projectName: 'Untitled Project' }),
    }),
    { name: 'circuit-muse-workspace' },
  ),
);
