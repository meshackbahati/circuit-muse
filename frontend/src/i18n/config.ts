/**
 * Locale registry — must stay in lockstep with `pro/blog/src/i18n/config.ts`
 * in the velxio_blog repo (the static blog at velxio.dev/blog/). Cookie sync
 * uses the `velxio_locale` cookie shared between both surfaces, so the lists
 * MUST agree on locale codes character-for-character.
 *
 * When adding or removing a locale, update both files plus
 * `scripts/translate/locales.mjs` in velxio_blog.
 */

export const LOCALES = [
  "en",
  "es",
  "pt-br",
  "it",
  "fr",
  "zh-cn",
  "de",
  "ja",
  "ru",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const NON_DEFAULT_LOCALES = LOCALES.filter(
  (l): l is Exclude<Locale, "en"> => l !== DEFAULT_LOCALE
);

export type LocaleMeta = {
  /** BCP-47 tag used in `<html lang>` and `hreflang`. */
  htmlLang: string;
  /** Native-language label shown in the language switcher. */
  nativeName: string;
  /** Open Graph locale code (Facebook). */
  ogLocale: string;
  /** Writing direction. */
  dir: "ltr" | "rtl";
};

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { htmlLang: "en", nativeName: "English", ogLocale: "en_US", dir: "ltr" },
  es: { htmlLang: "es", nativeName: "Español", ogLocale: "es_ES", dir: "ltr" },
  "pt-br": {
    htmlLang: "pt-BR",
    nativeName: "Português (BR)",
    ogLocale: "pt_BR",
    dir: "ltr",
  },
  it: { htmlLang: "it", nativeName: "Italiano", ogLocale: "it_IT", dir: "ltr" },
  fr: { htmlLang: "fr", nativeName: "Français", ogLocale: "fr_FR", dir: "ltr" },
  "zh-cn": {
    htmlLang: "zh-CN",
    nativeName: "简体中文",
    ogLocale: "zh_CN",
    dir: "ltr",
  },
  de: { htmlLang: "de", nativeName: "Deutsch", ogLocale: "de_DE", dir: "ltr" },
  ja: { htmlLang: "ja", nativeName: "日本語", ogLocale: "ja_JP", dir: "ltr" },
  ru: { htmlLang: "ru", nativeName: "Русский", ogLocale: "ru_RU", dir: "ltr" },
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
