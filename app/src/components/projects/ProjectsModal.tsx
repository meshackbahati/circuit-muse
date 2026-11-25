/**
 * Projects modal — list, open, delete, create new projects.
 */

import { useState, useEffect } from 'react';
import {
  getAllProjects,
  deleteProject,
  loadProjectIntoStores,
  saveCurrentWorkspace,
  type LocalProject,
} from '../../services/localProjectStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useAgentStore } from '../../store/useAgentStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

interface ProjectsModalProps {
  onClose: () => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({ onClose }) => {
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const projectId = useWorkspaceStore((s) => s.projectId);
  const projectName = useWorkspaceStore((s) => s.projectName);
  const setWorkspaceProject = useWorkspaceStore((s) => s.setProject);
  const renameProject = useWorkspaceStore((s) => s.renameProject);

  const refresh = () => {
    void getAllProjects().then((p) => {
      setProjects(p);
      setLoading(false);
    });
  };

  useEffect(refresh, []);

  const handleSave = async () => {
    const id = projectId ?? crypto.randomUUID();
    const name = projectName.trim() || 'Untitled Project';
    setWorkspaceProject(id, name);
    await saveCurrentWorkspace(id, name);
    refresh();
  };

  const handleOpen = async (id: string) => {
    const project = await loadProjectIntoStores(id);
    if (project) setWorkspaceProject(project.id, project.name);
    onClose();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const handleNew = () => {
    void useSimulatorStore.getState().loadProjectState({
      boards: [],
      fileGroups: {},
      components: [],
      wires: [],
      activeBoardId: null,
    });
    useEditorStore.getState().loadFiles([{ name: 'sketch.ino', content: '' }]);
    useAgentStore.getState().setMessages([]);
    setWorkspaceProject(crypto.randomUUID(), 'Untitled Project');
    onClose();
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vlx,.zip';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const { importProjectFile } = await import('../../utils/importProject');
      await importProjectFile(file);
      onClose();
    };
    input.click();
  };

  return (
    <div className="projects-overlay" onClick={onClose}>
      <div className="projects-modal" onClick={(e) => e.stopPropagation()}>
        <div className="projects-header">
          <h2>Projects</h2>
          <button className="projects-close" onClick={onClose} type="button">
            {'\u2715'}
          </button>
        </div>

        <div className="projects-actions">
          <input
            className="projects-name-input"
            value={projectName}
            onChange={(e) => renameProject(e.target.value)}
            placeholder="Project name"
            aria-label="Project name"
          />
          <button className="projects-btn projects-btn-primary" onClick={() => void handleSave()} type="button">
            Save Current
          </button>
          <button className="projects-btn" onClick={handleNew} type="button">
            New
          </button>
          <button className="projects-btn" onClick={handleImport} type="button">
            Import
          </button>
        </div>
        {projectId && (
          <button className="projects-btn projects-continue" onClick={() => void handleOpen(projectId)} type="button">
            Continue current project
          </button>
        )}

        <div className="projects-list">
          {loading && <div className="projects-loading">Loading...</div>}
          {!loading && projects.length === 0 && (
            <div className="projects-empty">
              No saved projects yet. Create one or import a .vlx file.
            </div>
          )}
          {projects.map((project) => (
            <div key={project.id} className="projects-item">
              <div className="projects-item-info" onClick={() => handleOpen(project.id)}>
                <div className="projects-item-name">{project.name || 'Untitled'}</div>
                <div className="projects-item-meta">
                  {project.boards.length} board{project.boards.length !== 1 ? 's' : ''} ·{' '}
                  {project.components.length} component{project.components.length !== 1 ? 's' : ''} ·{' '}
                  {project.messages?.length ?? 0} chat messages ·{' '}
                  {new Date(project.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                className="projects-item-delete"
                onClick={() => handleDelete(project.id)}
                title="Delete project"
                type="button"
              >
                {'\u2715'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .projects-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .projects-modal {
          width: 560px;
          max-height: 80vh;
          background: #1e1e23;
          border: 1px solid #2c2c33;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .projects-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid #2c2c33;
        }
        .projects-header h2 { margin: 0; font-size: 18px; }
        .projects-close {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 18px;
        }
        .projects-close:hover { color: #e6e6e9; }
        .projects-actions {
          display: flex;
          gap: 8px;
          padding: 12px 20px;
          border-bottom: 1px solid #2c2c33;
          flex-wrap: wrap;
          align-items: center;
        }
        .projects-name-input {
          flex: 1;
          min-width: 140px;
          background: #0c0c11;
          color: #e6e6e9;
          border: 1px solid #2c2c33;
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 13px;
          font-family: inherit;
        }
        .projects-continue {
          margin: 8px 20px 0;
          width: calc(100% - 40px);
        }
        .projects-btn {
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          border: 1px solid #2c2c33;
          background: transparent;
          color: #e6e6e9;
        }
        .projects-btn:hover { background: #2c2c33; }
        .projects-btn-primary {
          background: #007acc;
          border-color: #007acc;
          color: white;
        }
        .projects-btn-primary:hover { background: #005ea1; }
        .projects-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 0;
          content-visibility: auto;
        }
        .projects-loading, .projects-empty {
          padding: 40px 20px;
          text-align: center;
          color: #666;
        }
        .projects-item {
          display: flex;
          align-items: center;
          padding: 12px 20px;
          cursor: pointer;
        }
        .projects-item:hover { background: #15151b; }
        .projects-item-info { flex: 1; }
        .projects-item-name { font-size: 14px; font-weight: 500; }
        .projects-item-meta { font-size: 12px; color: #888; margin-top: 2px; }
        .projects-item-delete {
          background: transparent;
          border: none;
          color: #666;
          cursor: pointer;
          padding: 4px 8px;
          font-size: 14px;
        }
        .projects-item-delete:hover { color: #da3633; }
      `}</style>
    </div>
  );
};
