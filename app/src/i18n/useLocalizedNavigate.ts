/**
 * Hooks that wrap React Router's navigate / Link helpers so they keep
 * the user inside the active locale.
 *
 * Components rendering nav should prefer these over raw `<Link to="/foo">`,
 * otherwise clicking "Editor" from `/es/` would drop the visitor back to
 * the English `/editor` instead of staying at `/es/editor`.
 */

import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getLocaleFromPath, localizedPath } from "./path";
import type { Locale } from "./config";

/** The active locale for the current URL. */
export function useCurrentLocale(): Locale {
  const { pathname } = useLocation();
  return getLocaleFromPath(pathname);
}

/**
 * Returns a `localize(path)` function bound to the current locale.
 * The returned path is suitable for `<Link to={...}>`.
 */
export function useLocalizedHref(): (path: string) => string {
  const locale = useCurrentLocale();
  return useCallback((path: string) => localizedPath(path, locale), [locale]);
}

/**
 * `navigate('/foo')` that re-prefixes the path with the active locale.
 * Drop-in replacement for `useNavigate()` for in-app navigation.
 */
export function useLocalizedNavigate() {
  const navigate = useNavigate();
  const locale = useCurrentLocale();
  return useMemo(
    () => (path: string, opts?: Parameters<typeof navigate>[1]) =>
      navigate(localizedPath(path, locale), opts),
    [navigate, locale]
  );
}
