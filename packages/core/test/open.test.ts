/**
 * Sanity tests: every sample file should open, report a db_version, and expose
 * the expected tables.
 */

import { afterAll, describe, expect, it } from "vitest";
import { openMoliospec, readMoliospec } from "../src/index.js";
import { findAllSamples } from "./samples.js";

const samples = findAllSamples();

describe("openMoliospec", () => {
  it("finds at least one sample file on disk", () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  for (const sample of samples) {
    describe(sample.label, () => {
      let handle: Awaited<ReturnType<typeof openMoliospec>> | null = null;

      afterAll(async () => {
        if (handle) await handle.close();
      });

      it("opens without throwing", async () => {
        handle = await openMoliospec(sample.path);
        expect(handle.db).toBeDefined();
      });

      it("reports a db_version", async () => {
        handle ??= await openMoliospec(sample.path);
        const file = readMoliospec(handle);
        expect(file.dbVersion).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
      });

      it("has the expected schema tables", async () => {
        handle ??= await openMoliospec(sample.path);
        const names = handle.db
          .prepare(
            "select name from sqlite_master where type='table' order by name",
          )
          .all()
          .map((r) => (r as { name: string }).name);
        for (const required of [
          "project",
          "work_spec",
          "work_spec_section",
          "construction_element_spec",
          "construction_element_spec_section",
          "attachment",
          "attachment_type",
          "control_plan",
          "custom_data",
        ]) {
          expect(names).toContain(required);
        }
      });

      it("reads into a typed MoliospecFile", async () => {
        handle ??= await openMoliospec(sample.path);
        const file = readMoliospec(handle);
        // Basic sanity: counts are non-negative integers, arrays are arrays.
        expect(Array.isArray(file.workSpecs)).toBe(true);
        expect(Array.isArray(file.workSpecSections)).toBe(true);
        expect(Array.isArray(file.constructionElementSpecs)).toBe(true);
        expect(Array.isArray(file.constructionElementSpecSections)).toBe(true);
      });
    });
  }
});
