import { useEffect, type ReactElement, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { EditorPage } from './pages/EditorPage';
import { ExamplesPage } from './pages/ExamplesPage';
import { ExampleDetailPage } from './pages/ExampleDetailPage';
import { ExampleEditorPage } from './pages/ExampleEditorPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

const DocsPage = lazy(() => import('./pages/DocsPage'));

function App() {
  return (
    <ErrorBoundary>
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
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="/examples/:exampleId" element={<ExampleDetailPage />} />
          <Route path="/example/:exampleId" element={<ExampleEditorPage />} />

          {/* Fallback to editor */}
          <Route path="*" element={<EditorPage />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
