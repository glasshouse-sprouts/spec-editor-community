/**
 * Tests for the attachment open-safety allowlist (code-review punkt 5d).
 *
 * Deny-by-default: only known-safe document/image/office types open
 * automatically; executables, scripts, HTML, SVG, and unknown/missing
 * extensions are blocked so the user is warned instead of code running on
 * a click.
 */

import { describe, expect, it } from "vitest";

import {
  attachmentExtension,
  isSafeToOpenAttachment,
} from "../src/main/handlers/attachmentSafety.js";

describe("attachmentExtension", () => {
  it("returns the lower-cased extension", () => {
    expect(attachmentExtension("report.PDF")).toBe("pdf");
    expect(attachmentExtension("photo.JPeG")).toBe("jpeg");
  });

  it("returns null when there is no usable extension", () => {
    expect(attachmentExtension("README")).toBeNull();
    expect(attachmentExtension(".bashrc")).toBeNull(); // leading-dot only
    expect(attachmentExtension("trailingdot.")).toBeNull();
  });

  it("uses only the final extension segment", () => {
    expect(attachmentExtension("archive.tar.gz")).toBe("gz");
    expect(attachmentExtension("invoice.pdf.command")).toBe("command");
  });
});

describe("isSafeToOpenAttachment", () => {
  it("allows common document, image and office types", () => {
    for (const name of [
      "spec.pdf",
      "notes.txt",
      "data.csv",
      "drawing.png",
      "photo.jpg",
      "sheet.xlsx",
      "letter.docx",
      "deck.pptx",
    ]) {
      expect(isSafeToOpenAttachment(name)).toBe(true);
    }
  });

  it("blocks executable and script types", () => {
    for (const name of [
      "run.command",
      "install.bat",
      "setup.cmd",
      "tool.exe",
      "script.sh",
      "macro.scpt",
      "payload.js",
      "evil.vbs",
      "thing.app",
    ]) {
      expect(isSafeToOpenAttachment(name)).toBe(false);
    }
  });

  it("blocks HTML and SVG (local phishing / scriptable XML)", () => {
    expect(isSafeToOpenAttachment("invoice.html")).toBe(false);
    expect(isSafeToOpenAttachment("page.htm")).toBe(false);
    expect(isSafeToOpenAttachment("logo.svg")).toBe(false);
  });

  it("blocks unknown or missing extensions (deny by default)", () => {
    expect(isSafeToOpenAttachment("mystery")).toBe(false);
    expect(isSafeToOpenAttachment("weird.zzz")).toBe(false);
  });
});
