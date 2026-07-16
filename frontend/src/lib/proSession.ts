/**
 * Pro-session registry.
 *
 * App.tsx used to call useAuthStore.getState().checkSession() on mount to
 * resolve the existing JWT cookie into a user object. After Phase 3 of
 * the OSS split, useAuthStore lives in the pro overlay — OSS has no
 * auth state at all. The overlay registers a session-check callback
 * here; App.tsx invokes it on mount through a stable, side-effect-free
 * hook that no-ops in pure OSS.
 */

let _hook: (() => void | Promise<void>) | null = null;

export function registerSessionCheck(hook: () => void | Promise<void>): void {
  _hook = hook;
}

export function triggerSessionCheck(): void {
  if (_hook) {
    try {
      void _hook();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[oss] session-check hook threw:', err);
    }
  }
}
