/**
 * Hardening tests for opening untrusted `.moliospec` files
 * (code-review punkt 5a + 5b).
 *
 * Threat model: "anyone can email a .moliospec". We guard against:
 *   5a — zip bombs: a tiny gzip that inflates to fill the disk. The
 *        decompression stream aborts past a configurable byte cap.
 *   5b — corrupt/tampered SQLite: a file with a valid magic header but a
 *        broken body must fail with a coded error, not crash.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openMoliospec } from "../src/index.js";

const SQLITE_MAGIC = Buffer.concat([
  Buffer.from("SQLite format 3", "utf8"),
  Buffer.from([0]),
]);

describe("openMoliospec — untrusted-file hardening", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "moliospec-hardening-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("5a: aborts decompression past the byte cap with a coded error", async () => {
    // 1 MB of zeros compresses to a few KB — a miniature zip bomb.
    const inflated = Buffer.alloc(1024 * 1024, 0);
    const bombPath = join(workDir, "bomb.moliospec");
    await writeFile(bombPath, gzipSync(inflated));

    await expect(
      // Cap well below the inflated size so the guard trips.
      openMoliospec(bombPath, { maxDecompressedBytes: 4096 }),
    ).rejects.toThrow(/MOLIO_ERR:IO_DECOMPRESS_TOO_LARGE/);
  });

  it("5a: a normal-sized payload under the cap still opens fine", async () => {
    // A valid file's decompressed size is far below the default cap, so
    // the guard must never interfere with legitimate use. We assert that
    // a payload under a generous cap is NOT rejected for being too large
    // (it fails later for not being SQLite, which is a different error).
    const small = Buffer.alloc(1024, 0);
    const p = join(workDir, "small.moliospec");
    await writeFile(p, gzipSync(small));

    await expect(
      openMoliospec(p, { maxDecompressedBytes: 1024 * 1024 }),
    ).rejects.toThrow(/MOLIO_ERR:(?!IO_DECOMPRESS_TOO_LARGE)/);
  });

  it("5b: a file with a valid magic header but broken body is rejected", async () => {
    // Valid 16-byte magic so the format probe accepts it, then a zeroed
    // body — the page-size field at offset 16 is 0, which is invalid, so
    // SQLite refuses the file / quick_check fails.
    const tampered = Buffer.concat([SQLITE_MAGIC, Buffer.alloc(2048, 0)]);
    const p = join(workDir, "tampered.sqlite");
    await writeFile(p, tampered);

    await expect(openMoliospec(p)).rejects.toThrow(
      /MOLIO_ERR:IO_INTEGRITY_CHECK_FAILED/,
    );
  });
});
