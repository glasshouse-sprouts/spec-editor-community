/**
 * Phase 8 round 2 — Reader mode (Læsetilstand).
 *
 * Smoke tests for the persistence helpers in `readerMode.ts`. The
 * Settings checkbox + banner + edit-locks are tested separately via
 * the boot smoke test (App renders) and the type system (every
 * edit-trigger handler in App.tsx is gated on `readerMode`).
 */
import { describe, expect, it } from "vitest";

import {
  READER_MODE_KEY,
  readReaderMode,
  writeReaderMode,
} from "../src/renderer/src/readerMode/readerMode.js";

function makeStore(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe("readerMode persistence", () => {
  it("defaults to false on first launch (no key in storage)", () => {
    const s = makeStore();
    expect(readReaderMode(s)).toBe(false);
  });

  it("round-trips true → true", () => {
    const s = makeStore();
    writeReaderMode(s, true);
    expect(s.data.get(READER_MODE_KEY)).toBe("true");
    expect(readReaderMode(s)).toBe(true);
  });

  it("round-trips false → false", () => {
    const s = makeStore();
    writeReaderMode(s, false);
    expect(s.data.get(READER_MODE_KEY)).toBe("false");
    expect(readReaderMode(s)).toBe(false);
  });

  it("treats malformed stored values as false (defensive)", () => {
    const s = makeStore();
    s.data.set(READER_MODE_KEY, "yes-please");
    expect(readReaderMode(s)).toBe(false);
  });

  it("swallows storage errors on read", () => {
    const broken = {
      getItem: () => {
        throw new Error("storage exploded");
      },
      setItem: () => {},
    };
    expect(readReaderMode(broken)).toBe(false);
  });

  it("swallows storage errors on write", () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage exploded");
      },
    };
    // Should not throw.
    expect(() => writeReaderMode(broken, true)).not.toThrow();
  });
});
