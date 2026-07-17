/**
 * Editor Page — main editor + simulator with resizable panels
 */

import React, { useRef, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { startSimulation } from '../simulation/spice/start';
import { useSEO } from '../utils/useSEO';
import { CodeEditor } from '../components/editor/CodeEditor';
import { EditorToolbar } from '../components/editor/EditorToolbar';
import { FileTabs } from '../components/editor/FileTabs';
import { FileExplorer } from '../components/editor/FileExplorer';

const RaspberryPiWorkspace = lazy(() =>
  import('../components/raspberry-pi/RaspberryPiWorkspace').then((m) => ({
    default: m.RaspberryPiWorkspace,
  })),
);
import { CompilationConsole } from '../components/editor/CompilationConsole';
import { SimulatorCanvas } from '../components/simulator/SimulatorCanvas';
import { SerialMonitor } from '../components/simulator/SerialMonitor';
import { Oscilloscope } from '../components/simulator/Oscilloscope';
import { triggerSaveAction } from '../lib/proSaveAction';
import { AgentChatPanel } from '../agent/components/AgentChatPanel';
import { useAgentStore } from '../store/useAgentStore';
import { ProjectsModal } from '../components/projects/ProjectsModal';
import { ExportMenu } from '../components/projects/ExportMenu';
import { SetupWizard } from '../components/projects/SetupWizard';
import { useLocalAutoSave } from '../hooks/useLocalAutoSave';
import { useSimulatorStore, DEFAULT_BOARD_POSITION } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { useCompileLogsStore } from '../store/useCompileLogsStore';
import { useOscilloscopeStore } from '../store/useOscilloscopeStore';
import { useProjectStore } from '../store/useProjectStore';
import { useAutoSaveProject } from '../hooks/useAutoSaveProject';
import type { CompilationLog } from '../utils/compilationLogger';
import '../App.css';

const MOBILE_BREAKPOINT = 768;

const BOTTOM_PANEL_MIN = 80;
const BOTTOM_PANEL_MAX = 600;
const BOTTOM_PANEL_DEFAULT = 200;

const EXPLORER_MIN = 110;
const EXPLORER_MAX = 500;
const EXPLORER_DEFAULT = 165;

const resizeHandleStyle: React.CSSProperties = {
  height: 5,
  flexShrink: 0,
  cursor: 'row-resize',
  background: '#2a2d2e',
  borderTop: '1px solid #3c3c3c',
  borderBottom: '1px solid #3c3c3c',
};

export const EditorPage: React.FC = () => {
  const { t } = useTranslation();
  useSEO({
    title: 'Multi-Board Simulator Editor — Arduino, ESP32, RP2040, RISC-V | CircuitMuse',
    description:
      'Write, compile and simulate Arduino, ESP32, Raspberry Pi Pico, ESP32-C3, and Raspberry Pi 3 code in your browser. 19 boards, 5 CPU architectures, 48+ components. Free and open-source.',
    url: 'https://circuit-muse.dev/editor',
  });

  // Silent auto-save for the loaded project (only fires when authed AND
  // currentProject has a UUID — see useAutoSaveProject for the gating rules).
  const autoSave = useAutoSaveProject();

  const [editorWidthPct, setEditorWidthPct] = useState(45);
  // Desktop-only 3-way layout switch (code-only / circuit-only / both).
  // Lets users hide a pane to give the right-docked chat more room.
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const serialMonitorOpen = useSimulatorStore((s) => s.serialMonitorOpen);
  const activeBoardId = useSimulatorStore((s) => s.activeBoardId);
  const activeBoardKind = useSimulatorStore(
    (s) => s.boards.find((b) => b.id === s.activeBoardId)?.boardKind,
  );
  const isRaspberryPi3 = activeBoardKind === 'raspberry-pi-3';
  const oscilloscopeOpen = useOscilloscopeStore((s) => s.open);
  const [consoleOpen, setConsoleOpen] = useState(false);
  // compileLogs live in a Zustand store so the circuit-muse-pro agent overlay
  // (mounted in a separate React tree via mount system) can subscribe and
  // build a "diagnose this failure" prompt without prop-drilling.
  const compileLogs = useCompileLogsStore((s) => s.logs);
  const setCompileLogs = useCompileLogsStore((s) => s.setLogs);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(BOTTOM_PANEL_DEFAULT);

  const agentPanelOpen = useAgentStore((s) => s.panelOpen);
  const agentPanelWidth = useAgentStore((s) => s.panelWidth);
  const toggleAgentPanel = useAgentStore((s) => s.togglePanel);
  const [showProjects, setShowProjects] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Auto-save to IndexedDB
  const currentProjectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const currentProjectName = useProjectStore((s) => s.currentProject?.slug ?? 'untitled');
  useLocalAutoSave(currentProjectId, currentProjectName);

  // Show setup wizard on every launch unless user clicked "Don't show again"
  useEffect(() => {
    if (!localStorage.getItem('circuit-muse_setup_skipped')) {
      setShowSetup(true);
    }
  }, []);

  // ── Electrical simulation (one-time mount) ────────────────────────────────
  // `startSimulation()` is the single entry point: it constructs the
  // CircuitSimulationService, mounts the ADC bridge, and subscribes
  // PinManager → service.handleMcuEdge.  No more legacy paths — the
  // WASM ngspice (via NgSpiceWorkerAdapter) is the only solver.
  useEffect(() => {
    return startSimulation();
  }, []);

  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches,
  );
  // Slot element for SimulatorCanvas to portal its header into. When set, the
  // canvas board selector / Serial / Scope / zoom / Add buttons render here
  // instead of above the canvas — keeping the top bar a single full-width row
  // that doesn't reflow when the editor/canvas splitter is dragged.
  const [canvasHeaderSlot, setCanvasHeaderSlot] = useState<HTMLDivElement | null>(null);
  // Default to 'code' on mobile — show the editor so users can write/view code
  const [mobileView, setMobileView] = useState<'code' | 'circuit'>('code');

  // Save is dispatched to the app, which inspects auth state and
  // shows the right modal (Save vs Login prompt). In Without the
  // overlay this is a no-op today and becomes the .vlx Export entry
  // point in Iteration of the desktop split.
  const handleSaveClick = useCallback(() => {
    triggerSaveAction();
  }, []);

  const handleNewClick = useCallback(() => {
    if (
      !window.confirm(
        'Start a new workspace? This clears every board, component, wire and file. This cannot be undone.',
      )
    ) {
      return;
    }
    const sim = useSimulatorStore.getState();
    sim.boards.forEach((b) => sim.stopBoard(b.id));
    const ids = sim.boards.map((b) => b.id);
    ids.forEach((id) => sim.removeBoard(id));
    sim.setComponents([]);
    sim.setWires([]);
    useProjectStore.getState().clearCurrentProject();
    const newId = useSimulatorStore
      .getState()
      .addBoard('arduino-uno', DEFAULT_BOARD_POSITION.x, DEFAULT_BOARD_POSITION.y);
    useSimulatorStore.getState().setActiveBoardId(newId);
  }, []);

  // Track mobile breakpoint
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const update = (e: MediaQueryListEvent | MediaQueryList) => {
      const mobile = e.matches;
      setIsMobile(mobile);
      if (mobile) setExplorerOpen(false);
    };
    update(mq);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveClick();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSaveClick]);

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — canvas undo/redo. Skipped when the
  // user is typing in any input/textarea/contenteditable so the Monaco
  // editor's per-file history (and the AI chat composer, etc.) keep
  // working untouched.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
          return;
        }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const sim = useSimulatorStore.getState();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        sim.undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        sim.redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Prevent body scroll on the editor page
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = '';
      body.style.overflow = '';
    };
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setEditorWidthPct(Math.max(20, Math.min(80, pct)));
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleBottomPanelResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = bottomPanelHeight;

      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setBottomPanelHeight(
          Math.max(BOTTOM_PANEL_MIN, Math.min(BOTTOM_PANEL_MAX, startHeight + delta)),
        );
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [bottomPanelHeight],
  );

  const handleExplorerResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = explorerWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setExplorerWidth(Math.max(EXPLORER_MIN, Math.min(EXPLORER_MAX, startWidth + delta)));
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [explorerWidth],
  );

  return (
    <div className="app">

      {/* ── Mobile tab bar (top, above panels) ── */}
      {isMobile && (
        <nav className="mobile-tab-bar">
          <button
            className={`mobile-tab-btn${mobileView === 'code' ? ' mobile-tab-btn--active' : ''}`}
            onClick={() => setMobileView('code')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>&lt;/&gt; {t('editor.shell.code')}</span>
          </button>
          <button
            className={`mobile-tab-btn${mobileView === 'circuit' ? ' mobile-tab-btn--active' : ''}`}
            onClick={() => setMobileView('circuit')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <line x1="12" y1="12" x2="12" y2="16" />
              <line x1="10" y1="14" x2="14" y2="14" />
            </svg>
            <span>{t('editor.shell.circuit')}</span>
          </button>
        </nav>
      )}

      {/* ── Unified top toolbar (desktop only) ──
          Editor controls + canvas controls share a single full-width row so
          the bar doesn't reflow when the editor/canvas splitter is dragged.
          The canvas controls (board selector, Serial, Scope, zoom, Add) are
          portaled into `canvasHeaderSlot` from inside SimulatorCanvas. */}
      {!isMobile && (
        <div className="unified-toolbar">
          <button
            className="explorer-toggle-btn unified-toolbar-explorer-toggle"
            onClick={() => setExplorerOpen((v) => !v)}
            title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {/* View-mode toggle: Code / Both / Circuit. Lets users hide a
              pane to give the right-docked AI chat more breathing room.
              Hidden on mobile — there's already a code/circuit toggle in
              the mobile bottom-nav. */}
          <div
            role="group"
            aria-label={t('editor.shell.viewMode')}
            className="view-mode-toggle"
            style={{
              display: 'flex',
              gap: 1,
              background: '#252526',
              border: '1px solid #3c3c3c',
              borderRadius: 4,
              overflow: 'hidden',
              alignSelf: 'center',
              margin: '0 6px',
            }}
          >
            {(
              [
                { key: 'code', label: t('editor.shell.code'), path: 'M16 18l6-6-6-6M8 6l-6 6 6 6' },
                { key: 'both', label: t('editor.shell.both'), path: 'M3 3h7v18H3zM14 3h7v18h-7z' },
                { key: 'circuit', label: t('editor.shell.circuit'), path: 'M5 12h14M12 5v14' },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => setViewMode(m.key)}
                aria-pressed={viewMode === m.key}
                style={{
                  background: viewMode === m.key ? '#0e639c' : 'transparent',
                  color: viewMode === m.key ? 'white' : '#aaa',
                  border: 'none',
                  height: 28,
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={m.path} />
                </svg>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          {/* ── Hamburger menu + Action buttons ── */}
          <div style={{ display: 'flex', gap: 2, marginLeft: 8, alignItems: 'center', position: 'relative' }}>
            {/* Hamburger menu */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ background: menuOpen ? '#2c2c33' : 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', padding: '6px 8px', borderRadius: 3, fontSize: 16, lineHeight: 1 }}
              title="Menu"
            >
              {'\u2630'}
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                background: '#1e1e23',
                border: '1px solid #2c2c33',
                borderRadius: 6,
                padding: '4px 0',
                minWidth: 180,
                zIndex: 10000,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {[
                  { label: 'Projects', action: () => { setShowProjects(true); setMenuOpen(false); } },
                  { label: 'Export', action: () => { setShowExport(true); setMenuOpen(false); } },
                  { label: 'Examples', action: () => { window.location.href = '/examples'; setMenuOpen(false); } },
                  { label: 'Docs', action: () => { window.location.href = '/docs'; setMenuOpen(false); } },
                  { label: 'Setup', action: () => { setShowSetup(true); setMenuOpen(false); } },
                  { label: 'GitHub', action: () => { window.open('https://github.com/meshackbahati/circuit-muse', '_blank'); setMenuOpen(false); } },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'transparent', border: 'none', color: '#d4d4d8', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#2c2c33')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {/* Agent toggle */}
            <button
              onClick={toggleAgentPanel}
              style={{ background: agentPanelOpen ? '#7c3aed' : 'transparent', border: 'none', color: agentPanelOpen ? 'white' : '#aaa', cursor: 'pointer', padding: '4px 8px', borderRadius: 3, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
              title="AI Agent"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27a7 7 0 0 1-12.46 0H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
              Agent
            </button>
          </div>
          <div className="unified-toolbar-editor">
            <EditorToolbar
              consoleOpen={consoleOpen}
              setConsoleOpen={setConsoleOpen}
              compileLogs={compileLogs}
              setCompileLogs={setCompileLogs}
              centerSlot={!isRaspberryPi3 ? <FileTabs /> : null}
            />
          </div>
          <div className="unified-toolbar-canvas" ref={setCanvasHeaderSlot} />
        </div>
      )}

      <div className="app-container" ref={containerRef}>
        {/* ── Editor side ── */}
        <div
          className="editor-panel"
          style={{
            width: isMobile
              ? '100%'
              : viewMode === 'code'
              ? '100%'
              : viewMode === 'circuit'
              ? '0%'
              : `${editorWidthPct}%`,
            display:
              (isMobile && mobileView !== 'code') || (!isMobile && viewMode === 'circuit')
                ? 'none'
                : 'flex',
            flexDirection: 'row',
          }}
        >
          {/* File explorer sidebar + resize handle */}
          {explorerOpen && (
            <>
              <div
                style={{ width: explorerWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}
              >
                <FileExplorer onSaveClick={handleSaveClick} onNewClick={handleNewClick} />
              </div>
              {!isMobile && (
                <div
                  className="explorer-resize-handle"
                  onMouseDown={handleExplorerResizeMouseDown}
                />
              )}
            </>
          )}

          {/* Editor main area */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            {/* Mobile-only: explorer toggle + editor toolbar inside the panel.
                On desktop these are hoisted into the unified top toolbar. */}
            {isMobile && (
              <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
                <button
                  className="explorer-toggle-btn"
                  onClick={() => setExplorerOpen((v) => !v)}
                  title={explorerOpen ? 'Hide file explorer' : 'Show file explorer'}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EditorToolbar
                    consoleOpen={consoleOpen}
                    setConsoleOpen={setConsoleOpen}
                    compileLogs={compileLogs}
                    setCompileLogs={setCompileLogs}
                    centerSlot={!isRaspberryPi3 ? <FileTabs /> : null}
                  />
                </div>
              </div>
            )}

            {/* Editor area: Pi workspace or Monaco editor */}
            <div className="editor-wrapper" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              {isRaspberryPi3 && activeBoardId ? (
                <Suspense
                  fallback={
                    <div style={{ color: '#666', padding: 16, fontSize: 12 }}>
                      Loading Pi workspace…
                    </div>
                  }
                >
                  <RaspberryPiWorkspace boardId={activeBoardId} />
                </Suspense>
              ) : (
                <CodeEditor />
              )}
            </div>

            {/* Console */}
            {consoleOpen && (
              <>
                <div
                  onMouseDown={handleBottomPanelResizeMouseDown}
                  style={resizeHandleStyle}
                  title={t('editor.shell.dragResize')}
                />
                <div style={{ height: bottomPanelHeight, flexShrink: 0 }}>
                  <CompilationConsole
                    isOpen={consoleOpen}
                    onClose={() => setConsoleOpen(false)}
                    logs={compileLogs}
                    onClear={() => setCompileLogs([])}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Resize handle (desktop only, and only when both panes are visible) */}
        {!isMobile && viewMode === 'both' && (
          <div className="resize-handle" onMouseDown={handleResizeMouseDown}>
            <div className="resize-handle-grip" />
          </div>
        )}

        {/* ── Simulator side ── */}
        <div
          className="simulator-panel"
          style={{
            width: isMobile
              ? '100%'
              : viewMode === 'circuit'
              ? '100%'
              : viewMode === 'code'
              ? '0%'
              : `${100 - editorWidthPct}%`,
            display:
              (isMobile && mobileView !== 'circuit') || (!isMobile && viewMode === 'code')
                ? 'none'
                : 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
            <SimulatorCanvas headerSlot={!isMobile ? canvasHeaderSlot : null} />
          </div>
          {serialMonitorOpen && (
            <>
              <div
                onMouseDown={handleBottomPanelResizeMouseDown}
                style={resizeHandleStyle}
                title={t('editor.shell.dragResize')}
              />
              <div style={{ height: bottomPanelHeight, flexShrink: 0 }}>
                <SerialMonitor />
              </div>
            </>
          )}
          {oscilloscopeOpen && (
            <>
              <div
                onMouseDown={handleBottomPanelResizeMouseDown}
                style={resizeHandleStyle}
                title={t('editor.shell.dragResize')}
              />
              <div style={{ height: bottomPanelHeight, flexShrink: 0 }}>
                <Oscilloscope />
              </div>
            </>
          )}
        </div>
        {/* ── Agent panel: pushes workspace ── */}
        {agentPanelOpen && (
          <div
            style={{
              width: agentPanelWidth,
              flexShrink: 0,
              borderLeft: '1px solid #2c2c33',
              background: '#1e1e23',
            }}
          >
            <AgentChatPanel />
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showProjects && <ProjectsModal onClose={() => setShowProjects(false)} />}
      {showExport && <ExportMenu onClose={() => setShowExport(false)} />}
      {showSetup && <SetupWizard onClose={() => setShowSetup(false)} />}
    </div>
  );
};
