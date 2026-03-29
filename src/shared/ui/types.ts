export const uiLocales = ["el", "en"] as const;
export const uiThemes = ["light", "dark"] as const;

export type UiLocale = (typeof uiLocales)[number];
export type UiTheme = (typeof uiThemes)[number];

export const localeCookieName = "company-assistant-locale";
export const themeCookieName = "company-assistant-theme";

export function normalizeLocale(value: string | null | undefined): UiLocale {
  return value === "en" ? "en" : "el";
}

export function normalizeTheme(value: string | null | undefined): UiTheme {
  return value === "dark" ? "dark" : "light";
}

export function translate<T>(locale: UiLocale, values: { el: T; en: T }) {
  return locale === "en" ? values.en : values.el;
}

export function getIntlLocale(locale: UiLocale) {
  return locale === "en" ? "en-US" : "el-GR";
}
