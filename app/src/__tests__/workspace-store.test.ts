import { describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

describe('workspace identity', () => {
  it('keeps the active project id and name', () => {
    useWorkspaceStore.getState().setProject('project-1', 'Surge Detector');
    const state = useWorkspaceStore.getState();
    expect(state.projectId).toBe('project-1');
    expect(state.projectName).toBe('Surge Detector');
  });
});
