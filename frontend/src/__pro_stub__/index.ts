// Open-source no-op stub for the @pro alias (see vite.config.ts).
// Private overlays (e.g. velxio-prod) replace this at build time by setting
// VITE_PRO_BUILD=true and PRO_OVERLAY_PATH to their real pro/frontend/src/pro
// directory. The dynamic `import('@pro/index')` in main.tsx is gated by
// VITE_PRO_BUILD, so this stub is unreachable in OSS builds — it exists only
// to keep the TypeScript and Vite resolvers happy.
export const mountPro = () => {};
