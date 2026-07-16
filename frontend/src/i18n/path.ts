/**
 * Path helpers that translate between locale-prefixed URLs and their
 * locale-less canonical form. Mirrors `pro/blog/src/utils/i18n.ts` so a
 * round-trip across the velxio ↔ blog boundary always lands on the right
 * locale variant.
 *
 * Routing convention (matches the blog):
 *   - Default locale ("en") is served at the root with NO prefix.
 *   - Non-default locales mount under `/<locale>/...`.
 */

import { LOCALES, DEFAULT_LOCALE, type Locale, isLocale } from "./config";

/** Detect the locale segment of a pathname. Returns DEFAULT_LOCALE if none. */
export function getLocaleFromPath(pathname: string): Locale {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return DEFAULT_LOCALE;
  const first = segments[0].toLowerCase();
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    return first;
  }
  return DEFAULT_LOCALE;
}

/**
 * Strip the locale prefix from a pathname so we can re-localise it for
 * another language. Always returns a path that starts with `/`.
 */
export function stripLocaleFromPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const first = segments[0].toLowerCase();
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    const rest = segments.slice(1);
    return rest.length === 0 ? "/" : `/${rest.join("/")}`;
  }
  return `/${segments.join("/")}`;
}

/**
 * Re-attach a locale prefix to a path. Default locale → no prefix.
 * Trailing slashes are preserved.
 */
export function localizedPath(path: string, locale: Locale): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return cleanPath;
  return `/${locale}${cleanPath === "/" ? "" : cleanPath}`;
}

/** Convenience: rebuild the current path under a different locale. */
export function switchLocale(currentPathname: string, target: Locale): string {
  const stripped = stripLocaleFromPath(currentPathname);
  return localizedPath(stripped, target);
}

/** Comma-listed regex pattern of non-default locales for React Router. */
export const NON_DEFAULT_LOCALE_PATTERN = LOCALES.filter(
  l => l !== DEFAULT_LOCALE
).join("|");

/**
 * Build the blog URL for the given locale. The blog lives at /blog/ on
 * the same origin and uses the same default-no-prefix convention, so:
 *
 *   en      -> /blog/
 *   es      -> /blog/es/
 *   zh-cn   -> /blog/zh-cn/
 */
export function blogUrlFor(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/blog/" : `/blog/${locale}/`;
}
