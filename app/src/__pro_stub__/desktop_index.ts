// Open-source no-op stub for the @pro/desktop_index alias (see vite.config.ts).
// Mirrors index.ts: the dynamic `import('@pro/desktop_index')` in main.tsx is
// gated by VITE_DESKTOP, so this stub is unreachable in OSS builds — it exists
// only to keep the TypeScript and Vite resolvers happy when main.tsx
// statically references the module.
export const mountProDesktop = () => {};
