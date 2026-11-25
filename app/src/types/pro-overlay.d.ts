// The @pro alias points at the no-op stub in OSS builds and at the private
// overlay in pro builds. Vite resolves it; TypeScript needs these declarations.

declare module '@pro/index' {
  export function mountPro(): void;
}

declare module '@pro/desktop_index' {
  export function mountProDesktop(): void;
}
