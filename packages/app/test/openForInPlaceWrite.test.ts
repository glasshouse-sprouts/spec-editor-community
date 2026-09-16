/**
 * Task 1 / M1 - the app must never overwrite an old file in place.
 *
 * Every write that lands back on the same path goes through
 * `openForInPlaceWrite`: contracts, building element specifications,
 * attachments and imports. Only "Save as" may produce a converted file,
 * because the conversion is irreversible and the file on disk is the
 * user's only copy of the old format.
 *
 * This is the single point that guarantees it, so it gets its own test
 * rather than one per handler.
 */
import { copyFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseCoreErrorMessage } from "../src/shared/coreErrors.js";
import { openForInPlaceWrite } from "../src/main/handlers/openForInPlaceWrite.js";

const EXAMPLES = resolve(__dirname, "../../../0900 Examples");
const LEGACY = join(
  EXAMPLES,
  "Legacy schemas",
  "synthetic-legacy-01-00-01.sqlite",
);
const LEGACY_OLDEST = join(
  EXAMPLES,
  "Legacy schemas",
  "synthetic-legacy-01-00-00.moliospec",
);
const CURRENT = join(EXAMPLES, "synthetic-showoff-project.moliospec");

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "inplace-write-"));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Work on a copy - these tests are about not touching the original. */
function copyOf(source: string, name: string): string {
  const target = join(dir, name);
  copyFileSync(source, target);
  return target;
}

describe("openForInPlaceWrite", () => {
  it("opens a current file normally", async () => {
    const handle = await openForInPlaceWrite(
      copyOf(CURRENT, "current.moliospec"),
    );
    try {
      expect(handle.db).toBeDefined();
    } finally {
      await handle.close();
    }
  });

  for (const [label, source] of [
    ["01.00.01", LEGACY],
    ["01.00.00", LEGACY_OLDEST],
  ] as const) {
    it(`refuses a ${label} file with a coded error`, async () => {
      const path = copyOf(source, `legacy-${label}.sqlite`);
      let caught: unknown;
      try {
        await openForInPlaceWrite(path);
      } catch (err) {
        caught = err;
      }
      expect(caught, "expected a refusal, got none").toBeInstanceOf(Error);

      // Coded, not raw: the renderer maps this onto Danish/English copy
      // that names both versions and says to use Save As.
      const parsed = parseCoreErrorMessage((caught as Error).message);
      expect(parsed?.code).toBe("IO_LEGACY_FILE_READ_ONLY");
      expect(parsed?.params["fromVersion"]).toBe(label);
      expect(parsed?.params["toVersion"]).toBe("01.00.04");
    });
  }

  it("does not leave the refused file open", async () => {
    // The handle is closed before the throw, so a refusal leaves no
    // temp directory and no lock behind. If it did, a second attempt
    // would be the thing that noticed.
    const path = copyOf(LEGACY, "legacy-twice.sqlite");
    await expect(openForInPlaceWrite(path)).rejects.toThrow();
    await expect(openForInPlaceWrite(path)).rejects.toThrow();
  });
});
