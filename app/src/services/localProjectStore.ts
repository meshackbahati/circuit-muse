/**
 * Local project persistence using IndexedDB.
 * Projects auto-save and persist across sessions without a server.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { Message } from '../agent/types';
import type { UploadedFile } from '../store/useUploadsStore';

const DB_NAME = 'circuit-muse-projects';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

export interface LocalProject {
  id: string;
  name: string;
  description?: string;
  boards: unknown[];
  fileGroups: Record<string, Array<{ name: string; content: string }>>;
  components: unknown[];
  wires: unknown[];
  activeBoardId: string | null;
  messages?: Message[];
  uploads?: UploadedFile[];
  createdAt: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('name', 'name');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveProject(project: LocalProject): Promise<void> {
  const db = await getDb();
  const existing = await db.get(STORE_NAME, project.id);
  project.createdAt = existing?.createdAt ?? project.createdAt;
  project.updatedAt = new Date().toISOString();
  await db.put(STORE_NAME, project);
}

export async function getProject(id: string): Promise<LocalProject | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, id);
}

export async function getAllProjects(): Promise<LocalProject[]> {
  const db = await getDb();
  const all = await db.getAll(STORE_NAME);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

export async function getProjectCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_NAME);
}

/**
 * Auto-save the current editor state.
 * Debounced to avoid excessive writes.
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function autoSaveCurrentState(projectId: string, name: string): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const { useSimulatorStore } = await import('../store/useSimulatorStore');
    const { useEditorStore } = await import('../store/useEditorStore');
    const { useAgentStore } = await import('../store/useAgentStore');
    const { useUploadsStore } = await import('../store/useUploadsStore');

    const sim = useSimulatorStore.getState();
    const editor = useEditorStore.getState();
    const agent = useAgentStore.getState();
    const uploads = useUploadsStore.getState().files;

    const fileGroups: Record<string, Array<{ name: string; content: string }>> = {};
    for (const gid of Object.keys(editor.fileGroups)) {
      fileGroups[gid] = editor.fileGroups[gid].map(f => ({ name: f.name, content: f.content }));
    }

    await saveProject({
      id: projectId,
      name,
      boards: sim.boards as unknown[],
      fileGroups,
      components: sim.components as unknown[],
      wires: sim.wires as unknown[],
      activeBoardId: sim.activeBoardId,
      messages: agent.messages,
      uploads,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, 2000);
}

/**
 * Load a project from IndexedDB into the simulator stores.
 */
export async function saveCurrentWorkspace(projectId: string, name: string): Promise<void> {
  const { useSimulatorStore } = await import('../store/useSimulatorStore');
  const { useEditorStore } = await import('../store/useEditorStore');
  const { useAgentStore } = await import('../store/useAgentStore');
  const { useUploadsStore } = await import('../store/useUploadsStore');

  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();
  const agent = useAgentStore.getState();
  const uploads = useUploadsStore.getState().files;
  const fileGroups: Record<string, Array<{ name: string; content: string }>> = {};
  for (const gid of Object.keys(editor.fileGroups)) {
    fileGroups[gid] = editor.fileGroups[gid].map(f => ({ name: f.name, content: f.content }));
  }

  await saveProject({
    id: projectId,
    name,
    boards: sim.boards as unknown[],
    fileGroups,
    components: sim.components as unknown[],
    wires: sim.wires as unknown[],
    activeBoardId: sim.activeBoardId,
    messages: agent.messages,
    uploads,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function loadProjectIntoStores(id: string): Promise<LocalProject | null> {
  const project = await getProject(id);
  if (!project) return null;

  const { useSimulatorStore } = await import('../store/useSimulatorStore');
  const { useAgentStore } = await import('../store/useAgentStore');
  const { useUploadsStore } = await import('../store/useUploadsStore');
  useAgentStore.getState().setMessages(project.messages ?? []);
  useUploadsStore.getState().setFiles(project.uploads ?? []);
  useSimulatorStore.getState().loadProjectState({
    boards: project.boards as never[],
    fileGroups: project.fileGroups,
    components: project.components as never[],
    wires: project.wires as never[],
    activeBoardId: project.activeBoardId,
  });

  return project;
}
