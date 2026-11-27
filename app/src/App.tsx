import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { EditorPage } from './pages/EditorPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CustomTitleBar } from './components/layout/CustomTitleBar';
import './App.css';

const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI__;

const DocsPage = lazy(() =>
  import('./pages/DocsPage').then((module) => ({ default: module.DocsPage })),
);
// The example pages carry the full example catalogue (over 1 MB of circuit
// and code data). Loading them on demand keeps it out of the editor's memory.
const ExamplesPage = lazy(() =>
  import('./pages/ExamplesPage').then((module) => ({ default: module.ExamplesPage })),
);
const ExampleDetailPage = lazy(() =>
  import('./pages/ExampleDetailPage').then((module) => ({ default: module.ExampleDetailPage })),
);
const ExampleEditorPage = lazy(() =>
  import('./pages/ExampleEditorPage').then((module) => ({ default: module.ExampleEditorPage })),
);

const pageFallback = <div style={{ padding: 40, color: '#888' }}>Loading...</div>;

function App() {
  return (
    <ErrorBoundary>
      <div className="app-frame">
        {isDesktop && <CustomTitleBar />}
        <div className="app-view">
      <Router>
        <Routes>
          {/* Desktop: everything routes to the editor workspace */}
          <Route path="/" element={<EditorPage />} />
          <Route path="/editor" element={<EditorPage />} />

          {/* Docs accessible from within the workspace */}
          <Route path="/docs" element={
            <Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading docs...</div>}>
              <DocsPage />
            </Suspense>
          } />
          <Route path="/docs/:section" element={
            <Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading docs...</div>}>
              <DocsPage />
            </Suspense>
          } />

          {/* Examples */}
          <Route path="/examples" element={<Suspense fallback={pageFallback}><ExamplesPage /></Suspense>} />
          <Route path="/examples/:exampleId" element={<Suspense fallback={pageFallback}><ExampleDetailPage /></Suspense>} />
          <Route path="/example/:exampleId" element={<Suspense fallback={pageFallback}><ExampleEditorPage /></Suspense>} />

          {/* Fallback to editor */}
          <Route path="*" element={<EditorPage />} />
        </Routes>
      </Router>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
