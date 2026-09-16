/**
 * Slice #40 — friendly error mapping.
 *
 * Covers the three input shapes `friendlyError` must classify:
 *
 *   1. CoreError-encoded sentinel — picks the right `errors.code.<CODE>`
 *      key, substitutes params, and survives a JSON-stringify round-trip
 *      (proxy for the Electron IPC boundary, which stringifies Errors
 *      to plain `Error` instances).
 *
 *   2. Native errno errors (`EACCES`, `SQLITE_BUSY`) — picks the right
 *      `errors.system.<code>` key whether the code is on `.code` or
 *      embedded as a leading token in `err.message`.
 *
 *   3. Anything else — wrapped in the localised `errors.unexpected`
 *      envelope so the user never sees raw English exception text.
 *
 * The parser is also tested directly for the round-trip that the IPC
 * boundary exercises: build a CoreError, serialise via JSON, parse the
 * resulting message, recover the original code + params.
 */
import { describe, expect, it } from "vitest";

import { CoreError, parseCoreErrorMessage } from "@molio2-editor/core";

import {
  friendlyError,
  friendlyErrorForDialog,
} from "../src/renderer/src/i18n/friendlyError.js";
import { setLocale } from "../src/renderer/src/i18n/i18n.js";

describe("parseCoreErrorMessage", () => {
  it("returns null for a regular Error message (no sentinel)", () => {
    expect(parseCoreErrorMessage("regular old error text")).toBeNull();
  });

  it("extracts a code with no params", () => {
    const err = new CoreError("PFBB_NAME_EMPTY");
    const parsed = parseCoreErrorMessage(err.message);
    expect(parsed?.code).toBe("PFBB_NAME_EMPTY");
    expect(parsed?.params).toEqual({});
  });

  it("extracts a code with mixed-type params", () => {
    const err = new CoreError(
      "PFBB_DUPLICATE_NAME",
      { name: "Foo", workSpecId: 42 },
      "createPfbbChild: …",
    );
    const parsed = parseCoreErrorMessage(err.message);
    expect(parsed?.code).toBe("PFBB_DUPLICATE_NAME");
    expect(parsed?.params).toEqual({ name: "Foo", workSpecId: 42 });
  });

  it("survives a JSON round-trip (the Electron IPC boundary)", () => {
    const original = new CoreError("CONTRACT_HAS_REFERENCES", {
      contractId: 7,
      count: 3,
    });
    // Simulate the worst case: the IPC layer rebuilds the error as a
    // plain `Error` with just the message.
    const wireMessage = `Error invoking remote method 'deleteContract': Error: ${original.message}`;
    const parsed = parseCoreErrorMessage(wireMessage);
    expect(parsed?.code).toBe("CONTRACT_HAS_REFERENCES");
    expect(parsed?.params).toEqual({ contractId: 7, count: 3 });
  });

  it("escapes commas inside string params", () => {
    const err = new CoreError("PFBB_DUPLICATE_NAME", { name: "Has, a comma" });
    const parsed = parseCoreErrorMessage(err.message);
    expect(parsed?.params).toEqual({ name: "Has, a comma" });
  });
});

describe("friendlyErrorForDialog", () => {
  it("translates a known CoreError code (English)", () => {
    setLocale("en");
    const err = new CoreError("PFBB_NAME_EMPTY");
    expect(friendlyErrorForDialog(err)).toContain("Please enter a name");
  });

  it("substitutes params into the translated copy", () => {
    setLocale("en");
    const err = new CoreError("PFBB_DUPLICATE_NAME", { name: "Foo" });
    expect(friendlyErrorForDialog(err)).toContain('"Foo"');
  });

  it("maps a native EACCES error", () => {
    setLocale("en");
    // The renderer often loses `.code` across IPC; the prefix-token
    // form ("EACCES: …") is what's left in `err.message`.
    const err = new Error("EACCES: permission denied, open '/some/file'");
    const out = friendlyErrorForDialog(err);
    expect(out).toContain("Permission denied");
  });

  it("maps SQLITE_BUSY from the message body", () => {
    setLocale("en");
    const err = new Error("SQLITE_BUSY: database is locked");
    const out = friendlyErrorForDialog(err);
    expect(out).toContain("locked by another program");
  });

  it("falls through to the raw message for unclassified errors", () => {
    setLocale("en");
    const err = new Error("totally unexpected");
    expect(friendlyErrorForDialog(err)).toBe("totally unexpected");
  });

  it("respects the active locale (Danish)", () => {
    setLocale("da");
    const err = new CoreError("PFBB_NAME_EMPTY");
    expect(friendlyErrorForDialog(err)).toContain("Angiv venligst");
    setLocale("en"); // restore for the rest of the suite
  });
});

describe("friendlyError (with envelope)", () => {
  it("uses the prefix-and-envelope form for unknown errors", () => {
    setLocale("en");
    const err = new Error("oops");
    const out = friendlyError(err, "Saving the file failed");
    // Envelope: "<prefix>: <translated unexpected with {message}>"
    expect(out).toContain("Saving the file failed");
    expect(out).toContain("Unexpected error");
    expect(out).toContain("oops");
  });

  it("returns just the translated copy for a known code (no envelope)", () => {
    setLocale("en");
    const err = new CoreError("PFBB_NAME_EMPTY");
    const out = friendlyError(err, "Creating failed");
    // Code-mapped translations are user-actionable; we don't double-prefix.
    expect(out).toContain("Please enter a name");
    expect(out).not.toContain("Creating failed");
  });
});
