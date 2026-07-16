import { create } from 'zustand';
import type { ProjectVisibility } from '../services/projectService';

interface CurrentProject {
  id: string;
  slug: string;
  ownerUsername: string;
  isPublic: boolean;
  // Phase 1 D1.3 — three-level visibility. Kept in sync with isPublic
  // (which legacy callers still read) by setVisibility().
  visibility?: ProjectVisibility;
}

interface ProjectState {
  currentProject: CurrentProject | null;
  setCurrentProject: (project: CurrentProject) => void;
  clearCurrentProject: () => void;
  // Updated to accept either the legacy boolean OR the new enum so the
  // ShareModal callsite and any older callers keep working uniformly.
  setVisibility: (next: boolean | ProjectVisibility) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  setCurrentProject: (project) => set({ currentProject: project }),
  clearCurrentProject: () => set({ currentProject: null }),
  setVisibility: (next) =>
    set((s) => {
      if (!s.currentProject) return s;
      // Translate boolean → enum and vice versa so both fields are
      // always coherent.
      let isPublic: boolean;
      let visibility: ProjectVisibility;
      if (typeof next === 'boolean') {
        isPublic = next;
        visibility = next ? 'public' : 'private';
      } else {
        visibility = next;
        isPublic = next === 'public';
      }
      return {
        currentProject: { ...s.currentProject, isPublic, visibility },
      };
    }),
}));
