import { useEffect, type ReactElement } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { EditorPage } from './pages/EditorPage';
import { ExamplesPage } from './pages/ExamplesPage';
import { DocsPage } from './pages/DocsPage';
// Login, Register, ForgotPassword, ResetPassword, Admin, UserProfile,
// Project, ProjectById — moved to the pro overlay in Phase 3 of the
// OSS split. They register themselves via registerProRoutes() inside
// mountPro() and appear under /login, /admin, /:username etc. only when
// the overlay is loaded.
import { ExampleDetailPage } from './pages/ExampleDetailPage';
import { ExampleEditorPage } from './pages/ExampleEditorPage';
import { ArduinoSimulatorPage } from './pages/ArduinoSimulatorPage';
import { ArduinoEmulatorPage } from './pages/ArduinoEmulatorPage';
import { AtmegaSimulatorPage } from './pages/AtmegaSimulatorPage';
import { ArduinoMegaSimulatorPage } from './pages/ArduinoMegaSimulatorPage';
import { Attiny85SimulatorPage } from './pages/Attiny85SimulatorPage';
import { CircuitSimulatorPage } from './pages/CircuitSimulatorPage';
import { SpiceSimulatorPage } from './pages/SpiceSimulatorPage';
import { ElectronicsSimulatorPage } from './pages/ElectronicsSimulatorPage';
import { CustomChipSimulatorPage } from './pages/CustomChipSimulatorPage';
import { Esp32SimulatorPage } from './pages/Esp32SimulatorPage';
import { Esp32S3SimulatorPage } from './pages/Esp32S3SimulatorPage';
import { Esp32C3SimulatorPage } from './pages/Esp32C3SimulatorPage';
import { RaspberryPiPicoSimulatorPage } from './pages/RaspberryPiPicoSimulatorPage';
import { RaspberryPiSimulatorPage } from './pages/RaspberryPiSimulatorPage';
import { Velxio2Page } from './pages/Velxio2Page';
import { Velxio25Page } from './pages/Velxio25Page';
import { AboutPage } from './pages/AboutPage';
import { PricingPlaceholder } from './pages/PricingPlaceholder';
import { LocaleSync } from './i18n/LocaleSync';
import { NON_DEFAULT_LOCALES } from './i18n/config';
import { useProRoutes } from './lib/proRoutes';
import { triggerSessionCheck } from './lib/proSession';
import './App.css';

/**
 * Single source of truth for the route tree. Each entry is registered
 * twice in <Routes> below: once at the root (default locale) and once
 * nested under each non-default locale prefix (e.g. `/es/editor`).
 *
 * Index entries (path === '') belong to the locale-prefixed parent's
 * `index` slot — they render at exactly `/<locale>/`.
 */
// In Tauri desktop builds the marketing landing page is a disorienting
// first screen — users opened the desktop app to land in the editor.
// `/` redirects there. Web builds still see the LandingPage.
const ROOT_ELEMENT: ReactElement = import.meta.env.VITE_DESKTOP ? (
  <Navigate to="/editor" replace />
) : (
  <LandingPage />
);

const ROUTES: { path: string; element: ReactElement; index?: boolean }[] = [
  { path: '/', element: ROOT_ELEMENT, index: true },
  { path: 'editor', element: <EditorPage /> },
  { path: 'examples', element: <ExamplesPage /> },
  // /examples/<id> = SEO landing (preview, badges, "Open in Simulator" CTA).
  // /example/<id>  = live editor with the example pre-loaded; the URL
  //                  stays pinned so links are shareable + bookmarkable.
  // Singular vs plural is intentional — Google indexes the plural landings.
  { path: 'examples/:exampleId', element: <ExampleDetailPage /> },
  { path: 'example/:exampleId', element: <ExampleEditorPage /> },
  { path: 'docs', element: <DocsPage /> },
  { path: 'docs/:section', element: <DocsPage /> },
  // SEO landing pages — keyword-targeted
  { path: 'circuit-simulator', element: <CircuitSimulatorPage /> },
  { path: 'spice-simulator', element: <SpiceSimulatorPage /> },
  { path: 'electronics-simulator', element: <ElectronicsSimulatorPage /> },
  { path: 'custom-chip-simulator', element: <CustomChipSimulatorPage /> },
  { path: 'attiny85-simulator', element: <Attiny85SimulatorPage /> },
  { path: 'arduino-simulator', element: <ArduinoSimulatorPage /> },
  { path: 'arduino-emulator', element: <ArduinoEmulatorPage /> },
  { path: 'atmega328p-simulator', element: <AtmegaSimulatorPage /> },
  { path: 'arduino-mega-simulator', element: <ArduinoMegaSimulatorPage /> },
  { path: 'esp32-simulator', element: <Esp32SimulatorPage /> },
  { path: 'esp32-s3-simulator', element: <Esp32S3SimulatorPage /> },
  { path: 'esp32-c3-simulator', element: <Esp32C3SimulatorPage /> },
  { path: 'raspberry-pi-pico-simulator', element: <RaspberryPiPicoSimulatorPage /> },
  { path: 'raspberry-pi-simulator', element: <RaspberryPiSimulatorPage /> },
  { path: 'v2', element: <Velxio2Page /> },
  { path: 'v2-5', element: <Velxio25Page /> },
  { path: 'about', element: <AboutPage /> },
  // Pricing — placeholder by default; private overlays portal-inject the real page
  { path: 'pricing', element: <PricingPlaceholder /> },
  // project/:id, :username/:projectName, :username — also moved to the
  // pro overlay (project persistence + public profiles are pro features).
];

function App() {
  // Pro overlay registers extra routes (login, register, admin, profile,
  // project-by-slug, …) via registerProRoutes() inside mountPro(). The
  // subscription is sync external store, so any registration after the
  // initial render triggers a re-render — no Not-Found flash for routes
  // the overlay was about to add.
  const proRoutes = useProRoutes();
  const allRoutes = [...ROUTES, ...proRoutes];

  useEffect(() => {
    // Pro overlay's mountPro() registers a session-check callback that
    // resolves the JWT cookie into a user object. No-op in OSS without
    // the overlay.
    triggerSessionCheck();
    // #root-seo is a static SEO fallback in index.html (position:absolute,
    // visibility:hidden). It still contributes to document scrollHeight, so
    // every page got a phantom scroll the size of the prerendered SEO body.
    document.getElementById('root-seo')?.remove();
  }, []);

  return (
    <Router>
      <LocaleSync>
        <Routes>
          {/* Default locale (English) — no URL prefix. */}
          {allRoutes.map((r) =>
            r.index ? (
              <Route key="root" path="/" element={r.element} />
            ) : (
              <Route key={r.path} path={`/${r.path}`} element={r.element} />
            )
          )}

          {/*
            Non-default locales — same routes nested under `/<locale>/`.
            We register one branch per locale rather than a `:lang` param
            so React Router doesn't accidentally swallow real top-level
            paths like `/circuit-simulator` as a locale segment.
          */}
          {NON_DEFAULT_LOCALES.map((locale) => (
            <Route key={`locale-${locale}`} path={`/${locale}`}>
              {allRoutes.map((r) =>
                r.index ? (
                  <Route key={`${locale}-root`} index element={r.element} />
                ) : (
                  <Route
                    key={`${locale}-${r.path}`}
                    path={r.path}
                    element={r.element}
                  />
                )
              )}
            </Route>
          ))}
        </Routes>
      </LocaleSync>
    </Router>
  );
}

export default App;
