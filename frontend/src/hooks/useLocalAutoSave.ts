/**
 * Auto-save hook — saves project state to IndexedDB on changes.
 */

import { useEffect, useRef } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { saveProject, type LocalProject } from '../services/localProjectStore';

const DEBOUNCE_MS = 3000;

export function useLocalAutoSave(projectId: string | null, projectName: string) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const save = () => {
      const sim = useSimulatorStore.getState();
      const editor = useEditorStore.getState();

      const fileGroups: Record<string, Array<{ name: string; content: string }>> = {};
      for (const gid of Object.keys(editor.fileGroups)) {
        fileGroups[gid] = editor.fileGroups[gid].map((f) => ({
          name: f.name,
          content: f.content,
        }));
      }

      const project: LocalProject = {
        id: projectId,
        name: projectName,
        boards: sim.boards as unknown[],
        fileGroups,
        components: sim.components as unknown[],
        wires: sim.wires as unknown[],
        activeBoardId: sim.activeBoardId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveProject(project).catch(console.error);
    };

    // Subscribe to store changes
    const unsubSim = useSimulatorStore.subscribe(() => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(save, DEBOUNCE_MS);
    });

    const unsubEditor = useEditorStore.subscribe(() => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(save, DEBOUNCE_MS);
    });

    return () => {
      unsubSim();
      unsubEditor();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [projectId, projectName]);
}
