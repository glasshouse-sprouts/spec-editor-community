/**
 * Tiny hand-rolled i18n.
 *
 * Why hand-rolled instead of react-intl / react-i18next?
 *   - The project is small. Two locales, ~200 strings. A library
 *     is overkill — and harder for a non-programmer to follow.
 *   - We don't need ICU plurals, gender, or any of the fancy
 *     formatting libraries provide. Placeholder substitution
 *     (`{name}`) is enough.
 *   - Easy to swap to a library later if the catalog grows or we
 *     need richer formatting.
 *
 * Usage:
 *   - In a component: `const t = useT(); return <span>{t("common.save")}</span>;`
 *   - With params:     `t("errors.attachment.tooLarge", { maxMb: 100 })`
 *   - Outside React:   `import { t } from "../i18n/i18n.js"; t("common.save")`
 *
 * The current locale lives in module state plus a prefs-store
 * mirror (PREFS, 2026-04-27 — was localStorage before), so the
 * choice survives refresh and renderer restarts.
 * React components subscribe via `useT()` (which uses `useLocale`
 * internally) — they re-render automatically when the locale
 * changes via `setLocale(...)`.
 *
 * Fallback chain when a key is missing in the current locale:
 *   1. The Danish catalog (DEFAULT_LOCALE).
 *   2. The key string itself, surfaced verbatim (so we notice
 *      missing translations during development).
 */

import { useEffect, useState } from "react";

import { prefStore } from "../prefs.js";
import messagesDa from "./messages.da.json";
import messagesEn from "./messages.en.json";

export type Locale = "da" | "en";

/** Primary language. Used as fallback for any missing keys. */
const DEFAULT_LOCALE: Locale = "da";

const STORAGE_KEY = "molio.locale";

const catalogs: Record<Locale, Record<string, string>> = {
  da: messagesDa,
  en: messagesEn,
};

function readStoredLocale(): Locale {
  try {
    const raw = prefStore().getItem(STORAGE_KEY);
    return raw === "da" || raw === "en" ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    prefStore().setItem(STORAGE_KEY, locale);
  } catch {
    // Locale is still applied for the session via the in-memory
    // module state — persistence is a best-effort step.
  }
}

let currentLocale: Locale = readStoredLocale();
const listeners = new Set<() => void>();

/** Read the current locale (synchronous, module state). */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Switch the active locale. Persists the choice in localStorage and
 * notifies every component using `useLocale()` / `useT()` so they
 * re-render with the new strings.
 */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  writeStoredLocale(locale);
  for (const fn of listeners) fn();
}

/**
 * Look up a translated string. Substitutes `{paramName}` placeholders
 * if `params` is provided.
 *
 * Falls back through:
 *   1. current locale
 *   2. DEFAULT_LOCALE (Danish)
 *   3. the key itself
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  const catalog = catalogs[currentLocale];
  const fallback = catalogs[DEFAULT_LOCALE];
  const template = catalog[key] ?? fallback[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

/**
 * React hook returning the current locale + a setter. Components
 * using this re-render when the locale changes.
 */
export function useLocale(): [Locale, (next: Locale) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = (): void => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [currentLocale, setLocale];
}

/**
 * React hook returning the `t()` function bound to the current
 * locale. Subscribes to locale changes — components automatically
 * re-render with new strings on `setLocale(...)`.
 */
export function useT(): typeof t {
  // Subscribe to locale changes; we don't actually need the value.
  useLocale();
  return t;
}
