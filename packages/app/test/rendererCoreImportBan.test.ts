/**
 * Guard test (#234) — fail the build if any renderer-side file
 * imports `@molio2-editor/core` (or reaches into `packages/core/`
 * via a relative path).
 *
 * Why this exists: the renderer ships as a browser bundle. The core
 * package transitively imports Node-only modules (`better-sqlite3`,
 * `node:fs`, `node:zlib`, …). A stray import from any file under
 * `packages/app/src/renderer/` will break the dev build at runtime
 * with a "blank window + module not found" — and the failure mode
 * is silent enough that we lost half a day to it during slice 10H.
 *
 * Implementation: walk every `.ts` / `.tsx` file under the renderer
 * directory, grep for the forbidden import patterns, and fail with
 * a list of offenders. Pure Node fs/path; no new dev-deps.
 *
 * Allowed in the renderer:
 *   - "../../shared/ipc.js" — the IPC contract types live in
 *     packages/app/src/shared, which is browser-safe.
 *   - "../../shared/<other>.js" — same shared folder.
 *
 * Banned:
 *   - `from "@molio2-editor/core"` or `import "@molio2-editor/core/..."`
 *   - any relative path that climbs out of packages/app and into
 *     packages/core, e.g. `../../../core/src/...`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RENDERER_ROOT = resolve(HERE, "..", "src", "renderer");

/** Files we're willing to walk into. */
const SOURCE_EXTS = new Set([".ts", ".tsx"]);

/**
 * Patterns we forbid in renderer source. Matches anywhere on a line —
 * we don't try to parse imports cleanly because the simpler textual
 * check is good enough for the bug class we're guarding against.
 */
const BANNED_PATTERNS: { pattern: RegExp; description: string }[] = [
  {
    pattern: /from\s+["']@molio2-editor\/core(?:\/[^"']*)?["']/,
    description: "imports `@molio2-editor/core` package",
  },
  {
    pattern: /import\s+["']@molio2-editor\/core(?:\/[^"']*)?["']/,
    description: "side-effect imports `@molio2-editor/core`",
  },
  {
    // Relative path that climbs into packages/core. E.g.
    // ../../../core/src/types.js. We tolerate any depth.
    pattern: /from\s+["'](?:\.{2}\/){2,}core\/[^"']*["']/,
    description: "relative import that reaches into packages/core",
  },
];

interface Offender {
  file: string;
  line: number;
  text: string;
  why: string;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!SOURCE_EXTS.has(extOf(name))) continue;
    out.push(full);
  }
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot);
}

function findOffenders(): Offender[] {
  const files: string[] = [];
  walk(RENDERER_ROOT, files);
  const offenders: Offender[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip pure-comment lines so doc references to the package
      // name don't trigger false positives.
      const stripped = line.trim();
      if (stripped.startsWith("//") || stripped.startsWith("*")) continue;
      for (const { pattern, description } of BANNED_PATTERNS) {
        if (pattern.test(line)) {
          offenders.push({
            file: relative(resolve(HERE, "..", ".."), file),
            line: i + 1,
            text: line.trim(),
            why: description,
          });
          break;
        }
      }
    }
  }
  return offenders;
}

describe("renderer ↛ core import guard (#234)", () => {
  it("no file under packages/app/src/renderer/ may import @molio2-editor/core", () => {
    const offenders = findOffenders();
    if (offenders.length === 0) {
      expect(offenders).toEqual([]);
      return;
    }
    const formatted = offenders
      .map((o) => `  ${o.file}:${o.line}  (${o.why})\n     → ${o.text}`)
      .join("\n");
    throw new Error(
      "Forbidden core imports found in renderer source.\n" +
        "The renderer ships as a browser bundle and core pulls in\n" +
        "Node-only modules (better-sqlite3, node:fs, …). Move the\n" +
        "needed types into packages/app/src/shared/ or inline a\n" +
        "renderer-safe copy.\n\n" +
        "Offenders:\n" +
        formatted,
    );
  });
});
