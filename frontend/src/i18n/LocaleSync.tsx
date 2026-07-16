/**
 * Top-level locale wiring. Sits inside `<Router>` and reacts to URL
 * changes by:
 *   1. Telling i18next to use the locale that the URL implies.
 *   2. Loading the locale's resource bundle on demand (English is preloaded).
 *   3. Persisting the locale to the `velxio_locale` cookie so the blog at
 *      velxio.dev/blog/ picks it up on the next navigation.
 *   4. Mirroring the locale onto `<html lang>` and `dir`.
 *
 * Should wrap the entire `<Routes>` tree.
 */

import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { i18n, loadLocale } from "./index";
import { LOCALE_META, DEFAULT_LOCALE } from "./config";
import { getLocaleFromPath } from "./path";
import { writeLocaleCookie } from "./cookie";

type Props = { children: ReactNode };

export function LocaleSync({ children }: Props) {
  const { pathname } = useLocation();
  const target = getLocaleFromPath(pathname);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (i18n.language !== target) {
        await loadLocale(target);
        if (cancelled) return;
        await i18n.changeLanguage(target);
      }
      writeLocaleCookie(target);
      const meta = LOCALE_META[target] ?? LOCALE_META[DEFAULT_LOCALE];
      document.documentElement.lang = meta.htmlLang;
      document.documentElement.dir = meta.dir;
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  return <>{children}</>;
}
