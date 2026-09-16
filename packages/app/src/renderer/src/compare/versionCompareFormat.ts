/**
 * Slice "Version compare" — per-user diff-mark formatting settings.
 *
 * The Settings dialog lets the user pick how added / deleted / moved
 * runs should look in the read-only diff views (aligned-view
 * reference column, side-by-side preview modal, "Mark version
 * changes" PDF export). Three independent format records, each
 * with the same six axes:
 *
 *   - bold          (boolean)
 *   - italic        (boolean)
 *   - strikethrough (boolean)
 *   - color         (hex string or null = "no override")
 *   - background    (hex string or null = "no override")
 *   - underline     (boolean — added 2026-04-26 since deletions
 *                   often want strikethrough OR underline depending
 *                   on local convention)
 *
 * State + persistence live here as a tiny module with the same
 * pattern as the i18n locale state — module variable + listener set
 * + a React hook subscribers can use without prop-drilling.
 *
 * "Moved" is configurable even though Phase B doesn't detect moves
 * yet (Tore's call: ship the settings now so they're ready when the
 * detection lands later).
 */

import { useEffect, useState } from "react";

import { prefStore } from "../prefs.js";

/** Display style for one of the three diff kinds. */
export interface DiffFormat {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  /** Hex e.g. "#22c55e" or null for "use default text color". */
  color: string | null;
  /** Hex e.g. "#dcfce7" or null for "no background fill". */
  background: string | null;
}

export type DiffMarkKind = "added" | "deleted" | "moved";

/** Convenience union for all three kinds — used by the Settings UI. */
export const DIFF_MARK_KINDS: ReadonlyArray<DiffMarkKind> = [
  "added",
  "deleted",
  "moved",
] as const;

/** Settings record persisted to localStorage. */
export interface VersionCompareFormat {
  added: DiffFormat;
  deleted: DiffFormat;
  moved: DiffFormat;
}

/**
 * Defaults: green-bold for adds, red-strikethrough for deletes,
 * blue-italic for moves. Matches Tore's spec at slice intake (green
 * = added, red = deleted, blue = moved).
 */
export const DEFAULT_VERSION_COMPARE_FORMAT: VersionCompareFormat = {
  added: {
    bold: true,
    italic: false,
    strikethrough: false,
    underline: false,
    color: "#16a34a", // green-600
    background: null,
  },
  deleted: {
    bold: false,
    italic: false,
    strikethrough: true,
    underline: false,
    color: "#dc2626", // red-600
    background: null,
  },
  moved: {
    bold: false,
    italic: true,
    strikethrough: false,
    underline: false,
    color: "#2563eb", // blue-600
    background: null,
  },
};

const STORAGE_KEY = "molio.versionCompareFormat";

/**
 * Read the persisted setting from the prefs store, falling back to
 * the defaults when missing or unparseable. Tolerant of partial /
 * older shapes — every kind merges over the default so a corrupted
 * entry still produces a usable record.
 *
 * PREFS migration (2026-04-27): switched from `window.localStorage`
 * to the IPC-backed prefs store so settings survive Electron's
 * dev-mode storage wipes.
 */
export function readStoredFormat(): VersionCompareFormat {
  try {
    const raw = prefStore().getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw) as Partial<VersionCompareFormat>;
    return {
      added: mergeFormat(DEFAULT_VERSION_COMPARE_FORMAT.added, parsed.added),
      deleted: mergeFormat(
        DEFAULT_VERSION_COMPARE_FORMAT.deleted,
        parsed.deleted,
      ),
      moved: mergeFormat(DEFAULT_VERSION_COMPARE_FORMAT.moved, parsed.moved),
    };
  } catch {
    return cloneDefault();
  }
}

function cloneDefault(): VersionCompareFormat {
  return {
    added: { ...DEFAULT_VERSION_COMPARE_FORMAT.added },
    deleted: { ...DEFAULT_VERSION_COMPARE_FORMAT.deleted },
    moved: { ...DEFAULT_VERSION_COMPARE_FORMAT.moved },
  };
}

function mergeFormat(
  base: DiffFormat,
  override: Partial<DiffFormat> | undefined,
): DiffFormat {
  if (!override) return { ...base };
  return {
    bold: typeof override.bold === "boolean" ? override.bold : base.bold,
    italic:
      typeof override.italic === "boolean" ? override.italic : base.italic,
    strikethrough:
      typeof override.strikethrough === "boolean"
        ? override.strikethrough
        : base.strikethrough,
    underline:
      typeof override.underline === "boolean"
        ? override.underline
        : base.underline,
    color:
      typeof override.color === "string" || override.color === null
        ? override.color
        : base.color,
    background:
      typeof override.background === "string" || override.background === null
        ? override.background
        : base.background,
  };
}

function writeStoredFormat(value: VersionCompareFormat): void {
  try {
    prefStore().setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage layer guards against errors; this catch is belt &
    // braces in case a future store implementation throws.
  }
}

/* --------------------------------------------------------------------- */
/*  Module state + React hook                                            */
/* --------------------------------------------------------------------- */

let currentFormat: VersionCompareFormat = readStoredFormat();
const listeners = new Set<() => void>();

/** Read the current format (synchronous, module state). */
export function getVersionCompareFormat(): VersionCompareFormat {
  return currentFormat;
}

/**
 * Replace the whole format record. Persists to localStorage and
 * notifies every subscriber. Use this for batch updates; for
 * single-field tweaks see `patchVersionCompareFormat`.
 */
export function setVersionCompareFormat(next: VersionCompareFormat): void {
  currentFormat = next;
  writeStoredFormat(next);
  for (const fn of listeners) fn();
}

/**
 * Convenience: patch one kind's format without writing the others.
 * `patch` partially overrides the named kind; unspecified axes keep
 * their current values.
 */
export function patchVersionCompareFormat(
  kind: DiffMarkKind,
  patch: Partial<DiffFormat>,
): void {
  setVersionCompareFormat({
    ...currentFormat,
    [kind]: { ...currentFormat[kind], ...patch },
  });
}

/** Reset to the shipping defaults. Mostly for a "Reset" button. */
export function resetVersionCompareFormat(): void {
  setVersionCompareFormat(cloneDefault());
}

/**
 * React hook returning the current format + a setter. Components
 * using this re-render whenever the format changes anywhere in the
 * app (Settings dialog, tests, etc.).
 */
export function useVersionCompareFormat(): [
  VersionCompareFormat,
  (next: VersionCompareFormat) => void,
] {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = (): void => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [currentFormat, setVersionCompareFormat];
}

/**
 * Lower-level subscription used by tests so they can clean up
 * listeners without mounting React.
 */
export function _subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
