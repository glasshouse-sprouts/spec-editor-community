import { describe, expect, it } from "vitest";

import {
  isMoliospecFile,
  suggestUpgradedName,
} from "../src/renderer/src/fileUtils.js";

describe("isMoliospecFile", () => {
  it("accepts the canonical lowercase extension", () => {
    expect(isMoliospecFile("project.moliospec")).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(isMoliospecFile("project.MOLIOSPEC")).toBe(true);
    expect(isMoliospecFile("Project.MolioSpec")).toBe(true);
  });

  it("rejects other file types, including near-misses", () => {
    expect(isMoliospecFile("project.moliospec.bak")).toBe(false);
    expect(isMoliospecFile("project.txt")).toBe(false);
    expect(isMoliospecFile("project")).toBe(false);
    expect(isMoliospecFile("")).toBe(false);
  });

  it("accepts paths too — not just bare filenames", () => {
    // The check is purely on the suffix, so absolute paths work the same.
    expect(isMoliospecFile("/home/me/docs/spec.moliospec")).toBe(true);
    expect(isMoliospecFile("C:\\Users\\me\\spec.moliospec")).toBe(true);
  });
});

describe("suggestUpgradedName", () => {
  it("swaps a legacy .sqlite extension for .moliospec", () => {
    // Molio's older sample files are plain SQLite, but what the app
    // writes after an upgrade is a gzipped 01.00.04 .moliospec.
    expect(suggestUpgradedName("/a/b/Projekt 2021.sqlite")).toBe(
      "Projekt 2021.moliospec",
    );
  });

  it("leaves an existing .moliospec name alone", () => {
    expect(suggestUpgradedName("/a/b/Projekt.moliospec")).toBe(
      "Projekt.moliospec",
    );
    expect(suggestUpgradedName("/a/b/Projekt.MOLIOSPEC")).toBe(
      "Projekt.MOLIOSPEC",
    );
  });

  it("keeps dots inside the name and only replaces the last extension", () => {
    expect(suggestUpgradedName("/a/S012_01_20_R00.00_2021.sqlite")).toBe(
      "S012_01_20_R00.00_2021.moliospec",
    );
  });

  it("adds the extension when there is none", () => {
    expect(suggestUpgradedName("/a/b/Projekt")).toBe("Projekt.moliospec");
  });

  it("handles Windows separators", () => {
    expect(suggestUpgradedName("C:\\Users\\me\\gammel.mspec")).toBe(
      "gammel.moliospec",
    );
  });
});
