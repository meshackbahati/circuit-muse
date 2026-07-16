/**
 * Cookie helpers for the `velxio_locale` cookie shared between the React
 * app and the Astro blog at velxio.dev/blog/. Both surfaces read this
 * cookie on initial render so a locale change in one carries over to the
 * other on next navigation.
 *
 * Cookie attributes:
 *   path=/        — readable from both /editor and /blog/
 *   max-age=1y    — sticky across sessions
 *   SameSite=Lax  — fine for first-party navigation, no third-party reads
 *   Secure        — only when served over HTTPS (skipped in dev)
 */

import { isLocale, type Locale } from "./config";

const COOKIE_NAME = "velxio_locale";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  return isLocale(value) ? value : null;
}

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${COOKIE_NAME}=${encodeURIComponent(locale)}` +
    `; Path=/` +
    `; Max-Age=${ONE_YEAR_S}` +
    `; SameSite=Lax` +
    secure;
}

export const LOCALE_COOKIE_NAME = COOKIE_NAME;
