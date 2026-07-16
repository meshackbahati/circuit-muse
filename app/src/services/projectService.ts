import axios from 'axios';
import { getApiBase } from '../lib/apiBase';

// baseURL is resolved on every request so a host (e.g. the Tauri desktop
// shell) can swap the backend port at runtime.
const api = axios.create({ withCredentials: true });
api.interceptors.request.use((config) => {
  config.baseURL = getApiBase();
  return config;
});

export interface SketchFile {
  name: string;
  content: string;
}

export interface FileGroup {
  groupId: string;
  files: SketchFile[];
}

// Phase 1 D1.3 — three-level visibility enum mirroring the backend
// projects.visibility column. Keep aligned with pro/backend/app/schemas/
// project.py::Visibility.
export type ProjectVisibility = 'public' | 'unlisted' | 'private';

export interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_public: boolean;
  // Phase 1 D1.3 — present on rows after the migration; older serializations
  // (cached pages or rolled-back deploys) might miss it. Treat undefined as
  // 'public' if is_public is true, otherwise 'private', mirroring the
  // backend's _to_response fallback.
  visibility?: ProjectVisibility;
  board_type: string;
  files: SketchFile[]; // active board's files (legacy)
  file_groups: FileGroup[]; // all boards' file groups
  code: string; // legacy fallback
  components_json: string;
  wires_json: string;
  boards_json: string; // serialized BoardInstance[]
  libraries_json?: string; // P2.4 — declared library manifest (compile scope)
  owner_username: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectSaveData {
  name: string;
  description?: string;
  is_public: boolean;
  // Phase 1 D1.3 — optional explicit visibility. When omitted the backend
  // resolves from `is_public` for backward compat with old clients. New
  // clients (ShareModal post-D1.4) always send this.
  visibility?: ProjectVisibility;
  board_type: string;
  files: SketchFile[]; // legacy: active board's files
  file_groups?: FileGroup[]; // multi-board: all groups
  code?: string; // legacy fallback
  components_json: string;
  wires_json: string;
  boards_json?: string; // serialized BoardInstance[]
  libraries_json?: string; // P2.4 — declared library manifest (compile scope)
}

export async function getMyProjects(): Promise<ProjectResponse[]> {
  const { data } = await api.get<ProjectResponse[]>('/projects/me');
  return data;
}

export async function getUserProjects(username: string): Promise<ProjectResponse[]> {
  const { data } = await api.get<ProjectResponse[]>(`/user/${username}`);
  return data;
}

export async function getProjectById(id: string): Promise<ProjectResponse> {
  const { data } = await api.get<ProjectResponse>(`/projects/${id}`);
  return data;
}

export async function getProject(username: string, slug: string): Promise<ProjectResponse> {
  const { data } = await api.get<ProjectResponse>(`/user/${username}/${slug}`);
  return data;
}

export async function createProject(data: ProjectSaveData): Promise<ProjectResponse> {
  const { data: result } = await api.post<ProjectResponse>('/projects/', data);
  return result;
}

export async function updateProject(
  id: string,
  data: Partial<ProjectSaveData>,
): Promise<ProjectResponse> {
  const { data: result } = await api.put<ProjectResponse>(`/projects/${id}`, data);
  return result;
}

export async function deleteProject(id: string): Promise<void> {
  await api.delete(`/projects/${id}`);
}
