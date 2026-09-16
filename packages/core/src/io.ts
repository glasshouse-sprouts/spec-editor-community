/**
 * File IO for Molio 2.0 `.moliospec` files.
 *
 * A `.moliospec` file is a gzip-compressed SQLite database. This module:
 *   - detects whether a given file is gzip-wrapped or raw SQLite
 *   - decompresses to a temp path
 *   - opens the SQLite database via `better-sqlite3`
 *   - provides a `saveAs` that re-compresses to a new target path
 */

import Database, {
  type Database as BetterSqliteDatabase,
} from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

import { atomicReplace } from "./atomicReplace.js";
import { CoreError } from "./errors.js";
import { migrateToCurrent, type MigrationResult } from "./migrate.js";

/**
 * Default cap on decompressed output (5a — zip-bomb guard). Gzip can
 * compress ~1000:1, so a 50 MB `.moliospec` could otherwise inflate to
 * ~50 GB and fill the disk. A real Molio file is a few MB; 2 GiB is far
 * above any legitimate document but well below "fill the disk". Override
 * per call via `openMoliospec(path, { maxDecompressedBytes })`.
 */
const DEFAULT_MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

export interface OpenMoliospecOptions {
  /** Abort decompression if the output exceeds this many bytes. */
  maxDecompressedBytes?: number;
  /**
   * Upgrade a pre-01.00.03 file to the current schema (Task 1 / M1).
   *
   * Off by default, and deliberately so. The upgrade is irreversible, so
   * it must be a decision somebody made — the editor turns it on because
   * it can warn the user and force "Save as"; a read-only consumer that
   * can do neither should leave old files as they are.
   *
   * The upgrade only ever touches the temp copy. The user's file on disk
   * is not modified by opening it, with or without this flag.
   */
  migrate?: boolean;
}

/** How a `.moliospec` should be wrapped on the way back to disk. */
export interface SaveAsOptions {
  /**
   * Force gzip wrapping regardless of how the source file arrived.
   *
   * Used for migrated files: what we write is a new 01.00.04
   * `.moliospec`, and Molio ships those gzipped. Without this, an old
   * raw `.sqlite` would be saved as raw bytes under a `.moliospec` name.
   */
  gzip?: boolean;
}

/** First two bytes of a gzip file. */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
/** First six bytes of a SQLite 3 file (+ space; 16 bytes in total is 'SQLite format 3\0'). */
const SQLITE_MAGIC = Buffer.from("SQLite format 3\u0000", "utf8");

/** Returns true if the first bytes of `buf` look like a gzip file. */
export function isGzipped(buf: Buffer): boolean {
  return (
    buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]
  );
}

/** Returns true if the first bytes of `buf` look like a SQLite 3 database file. */
export function isSqlite(buf: Buffer): boolean {
  if (buf.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (buf[i] !== SQLITE_MAGIC[i]) return false;
  }
  return true;
}

/**
 * A handle to an opened `.moliospec` file.
 *
 * Holds both an open `better-sqlite3` connection and metadata about where the
 * decompressed SQLite bytes live on disk.
 */
export class MoliospecHandle {
  readonly db: BetterSqliteDatabase;
  /** Directory we created for temp files. Will be cleaned up on close. */
  private readonly tmpDir: string;
  /** Path to the uncompressed SQLite file backing `db`. */
  readonly sqlitePath: string;
  /** Path to the original `.moliospec` file we were opened from. */
  readonly sourcePath: string;
  /** True if the source file was gzip-wrapped. */
  readonly wasGzipped: boolean;
  /**
   * What the schema upgrade did on open, or null when it was not asked
   * for. `migration.migrated === true` means this handle now holds a
   * converted copy: the caller MUST route the user to "Save as" rather
   * than overwriting the original.
   */
  readonly migration: MigrationResult | null;

  constructor(args: {
    db: BetterSqliteDatabase;
    tmpDir: string;
    sqlitePath: string;
    sourcePath: string;
    wasGzipped: boolean;
    migration?: MigrationResult | null;
  }) {
    this.db = args.db;
    this.tmpDir = args.tmpDir;
    this.sqlitePath = args.sqlitePath;
    this.sourcePath = args.sourcePath;
    this.wasGzipped = args.wasGzipped;
    this.migration = args.migration ?? null;
  }

  /** Close the database connection and remove temp files. */
  async close(): Promise<void> {
    try {
      this.db.close();
    } finally {
      await rm(this.tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Save the current SQLite state to a new `.moliospec` (gzip + SQLite).
   *
   * Crash-safe (security review H1): the bytes go to a temp file next to
   * the target and are renamed over it as the very last step, so an app
   * crash, a disk error or a power cut can never leave the user with a
   * half-written project file. See `atomicReplace` for the details.
   *
   * Does NOT close the handle — the caller may continue editing and save again.
   */
  async saveAs(targetPath: string, options: SaveAsOptions = {}): Promise<void> {
    // Flush write-ahead-log pages into the main SQLite file first, so the
    // image we are about to copy out is complete and current.
    this.checkpointWal();

    // A migrated file is a new 01.00.04 `.moliospec` regardless of how
    // its source happened to be wrapped, so the caller can insist on gzip.
    const gzip = options.gzip ?? this.wasGzipped;

    await atomicReplace(targetPath, async (tempPath) => {
      if (gzip) {
        await gzipFile(this.sqlitePath, tempPath);
      } else {
        // Preserve original wrapping: if the source was raw SQLite, save raw.
        // (This should be rare in practice — Molio ships gzipped.)
        const bytes = await readFile(this.sqlitePath);
        await writeFile(tempPath, bytes);
      }
    });
  }

  /** Compute SHA-256 of the uncompressed SQLite image. Useful for round-trip tests. */
  async sqliteSha256(): Promise<string> {
    this.checkpointWal();
    const bytes = await readFile(this.sqlitePath);
    return createHash("sha256").update(bytes).digest("hex");
  }

  /**
   * Flush the write-ahead log into the main database file.
   *
   * Why this is not a "best effort, ignore errors" step (L1 in the
   * security review): in WAL mode, committed changes can still live in
   * the `-wal` sidecar file. We only copy the main database file out, so
   * if the checkpoint does not complete we would write a file that is
   * perfectly valid but MISSING the user's most recent edits. Silent
   * stale data is worse than a visible error, so we refuse to save.
   *
   * A database that is not in WAL mode has nothing to flush; SQLite may
   * return -1 counters or throw, and both are fine.
   */
  private checkpointWal(): void {
    let journalMode = "";
    try {
      journalMode = String(
        this.db.pragma("journal_mode", { simple: true }),
      ).toLowerCase();
    } catch {
      /* leave empty: treated as "not WAL" below */
    }

    // Declared without an initial value on purpose: every path below
    // either assigns it, returns, or throws.
    let busy: number;
    try {
      const rows = this.db.pragma("wal_checkpoint(TRUNCATE)") as
        | { busy?: number }[]
        | undefined;
      busy = rows?.[0]?.busy ?? 0;
    } catch (err) {
      if (journalMode !== "wal") return; // nothing to flush
      throw new CoreError(
        "IO_WAL_CHECKPOINT_FAILED",
        {},
        `wal_checkpoint(TRUNCATE) failed: ${String(err)}`,
      );
    }

    // busy = 1 means the checkpoint could not flush every frame (another
    // connection was reading). Data would be left behind in the -wal file.
    if (busy !== 0) {
      throw new CoreError(
        "IO_WAL_CHECKPOINT_FAILED",
        {},
        "wal_checkpoint(TRUNCATE) reported busy — the write-ahead log was not fully flushed",
      );
    }
  }
}

/**
 * Open a `.moliospec` file (or a raw `.sqlite` file) for reading/editing.
 *
 * The file is not modified. We decompress (if needed) into a temp directory
 * and open SQLite on that copy. Call `handle.close()` when done.
 */
export async function openMoliospec(
  sourcePath: string,
  options: OpenMoliospecOptions = {},
): Promise<MoliospecHandle> {
  const maxBytes =
    options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES;

  // Read first 16 bytes to detect format.
  const probe = await readFirstBytes(sourcePath, 16);
  const wasGzipped = isGzipped(probe);
  const wasSqlite = isSqlite(probe);
  if (!wasGzipped && !wasSqlite) {
    throw new CoreError(
      "IO_NOT_MOLIOSPEC",
      { path: sourcePath },
      `File does not look like a .moliospec (expected gzip or SQLite header): ${sourcePath}`,
    );
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "moliospec-"));
  const sqlitePath = join(tmpDir, "document.sqlite");

  // Materialise the SQLite file in temp. On any failure (e.g. zip-bomb
  // cap tripped) clean up the temp dir before rethrowing.
  try {
    if (wasGzipped) {
      await gunzipFile(sourcePath, sqlitePath, maxBytes);
    } else {
      // Copy so we never accidentally mutate the user's file.
      const bytes = await readFile(sourcePath);
      await writeFile(sqlitePath, bytes);
    }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true });
    throw err;
  }

  // Verify the resulting file really is SQLite.
  const verifyProbe = await readFirstBytes(sqlitePath, SQLITE_MAGIC.length);
  if (!isSqlite(verifyProbe)) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new CoreError(
      "IO_NOT_SQLITE",
      { path: sourcePath },
      `Decompressed payload is not a SQLite database: ${sourcePath}`,
    );
  }

  // Opening can itself throw on a malformed/tampered file (SQLITE_NOTADB
  // etc.). Wrap that into a coded error and clean up.
  let db: BetterSqliteDatabase;
  try {
    db = new Database(sqlitePath);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new CoreError(
      "IO_INTEGRITY_CHECK_FAILED",
      {},
      `SQLite refused to open the file: ${String(err)}`,
    );
  }

  // 5b — integrity hardening for files from untrusted senders. SQLite's
  // own recommendations for opening foreign databases: run quick_check,
  // and disable schema-driven code execution.
  try {
    const quick = db.pragma("quick_check", { simple: true });
    if (quick !== "ok") {
      throw new CoreError(
        "IO_INTEGRITY_CHECK_FAILED",
        { result: String(quick) },
        `SQLite quick_check failed: ${String(quick)}`,
      );
    }
    db.pragma("trusted_schema = OFF");
    db.pragma("cell_size_check = ON");
    db.pragma("foreign_keys = ON");
  } catch (err) {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
    // `new Database()` opens lazily, so a malformed/tampered file often
    // first errors here (e.g. "file is not a database") rather than at
    // open. Surface everything as a coded integrity failure; pass our
    // own CoreError through unchanged.
    if (err instanceof CoreError) throw err;
    throw new CoreError(
      "IO_INTEGRITY_CHECK_FAILED",
      {},
      `SQLite integrity check failed: ${String(err)}`,
    );
  }

  const handle = new MoliospecHandle({
    db,
    tmpDir,
    sqlitePath,
    sourcePath,
    wasGzipped,
  });

  if (!options.migrate) return handle;

  // Upgrade the temp copy, not the user's file. On failure clean up and
  // let the coded error through — an old file the app cannot upgrade is
  // better refused at open than half-opened.
  try {
    const migration = migrateToCurrent(handle);
    return new MoliospecHandle({
      db,
      tmpDir,
      sqlitePath,
      sourcePath,
      wasGzipped,
      migration,
    });
  } catch (err) {
    await handle.close();
    throw err;
  }
}

// --- helpers ---------------------------------------------------------------

async function readFirstBytes(path: string, n: number): Promise<Buffer> {
  const bytes = await readFile(path);
  return bytes.subarray(0, Math.min(n, bytes.length));
}

/**
 * Stream transform that passes bytes through but aborts the pipeline
 * (with a coded error) once cumulative output exceeds `maxBytes`. This
 * is the zip-bomb guard: a tiny gzip can otherwise expand without bound.
 */
function byteCapTransform(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb): void {
      total += chunk.length;
      if (total > maxBytes) {
        cb(
          new CoreError(
            "IO_DECOMPRESS_TOO_LARGE",
            { maxBytes },
            `Decompressed output exceeded the ${maxBytes}-byte limit`,
          ),
        );
        return;
      }
      cb(null, chunk);
    },
  });
}

async function gunzipFile(
  source: string,
  target: string,
  maxBytes: number,
): Promise<void> {
  await mkdir(join(target, ".."), { recursive: true });
  await pipeline(
    createReadStream(source),
    createGunzip(),
    byteCapTransform(maxBytes),
    createWriteStream(target),
  );
}

async function gzipFile(source: string, target: string): Promise<void> {
  await mkdir(join(target, ".."), { recursive: true });
  await pipeline(
    createReadStream(source),
    createGzip(),
    createWriteStream(target),
  );
}
