/**
 * Round-trip fidelity test.
 *
 * For every sample file we can open, we:
 *   1. capture the SHA-256 of the decompressed SQLite image
 *   2. save it back out via `saveAs` (gzip, but we don't compare the gzip
 *      bytes because gzip output is implementation-dependent)
 *   3. open the result and capture its SQLite SHA-256
 *   4. assert the two SHAs are identical → the SQLite payload is byte-equal
 *
 * This proves we can open and re-write `.moliospec` files without losing,
 * corrupting, or reordering any data. It is the foundation everything else
 * builds on.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openMoliospec, readMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();

describe("round-trip save/reopen", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-rt-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  for (const sample of samples) {
    it(`preserves SQLite payload: ${sample.label}`, async () => {
      const source = await openMoliospec(sample.path);
      const originalSha = await source.sqliteSha256();
      const originalFile = readMoliospec(source);

      const target = join(
        workDir,
        `${sample.label.replace(/[\\/]/g, "_")}_roundtrip.moliospec`,
      );
      await source.saveAs(target);
      await source.close();

      const reopened = await openMoliospec(target);
      const newSha = await reopened.sqliteSha256();
      const reopenedFile = readMoliospec(reopened);
      await reopened.close();

      expect(newSha).toBe(originalSha);
      // Also check a few logical counts for extra safety (and nicer error messages).
      expect(reopenedFile.workSpecs.length).toBe(originalFile.workSpecs.length);
      expect(reopenedFile.workSpecSections.length).toBe(
        originalFile.workSpecSections.length,
      );
      expect(reopenedFile.constructionElementSpecs.length).toBe(
        originalFile.constructionElementSpecs.length,
      );
      expect(reopenedFile.constructionElementSpecSections.length).toBe(
        originalFile.constructionElementSpecSections.length,
      );
      expect(reopenedFile.attachments.length).toBe(
        originalFile.attachments.length,
      );
      expect(reopenedFile.contracts.length).toBe(originalFile.contracts.length);
      expect(reopenedFile.dbVersion).toBe(originalFile.dbVersion);
    });
  }
});
