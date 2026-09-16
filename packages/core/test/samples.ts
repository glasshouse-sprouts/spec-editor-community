/**
 * Helpers for locating the real sample `.moliospec` / `.sqlite` files
 * that ship with the repo under `0000 Background info/` and `0900 Examples/`.
 */

import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo root (three levels up from packages/core/test). */
export const REPO_ROOT = resolve(THIS_DIR, "..", "..", "..");

const SAMPLE_ROOTS = ["0900 Examples", "0000 Background info"];

const SAMPLE_EXTENSIONS = [".moliospec", ".mspec", ".mspectpl", ".sqlite"];

export interface Sample {
  path: string;
  label: string;
}

/** Walk the sample roots and return every file with a sample-y extension. */
export function findAllSamples(): Sample[] {
  const out: Sample[] = [];
  for (const root of SAMPLE_ROOTS) {
    const rootPath = join(REPO_ROOT, root);
    walk(rootPath, out, root);
  }
  return out;
}

function walk(dir: string, out: Sample[], labelPrefix: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out, `${labelPrefix}/${name}`);
    } else if (
      SAMPLE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
    ) {
      out.push({ path: full, label: `${labelPrefix}/${name}` });
    }
  }
}
