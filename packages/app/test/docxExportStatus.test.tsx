/** @vitest-environment jsdom */
/**
 * Task 151 — the Word export must tell the user what happened.
 *
 * Two bugs, both covered here:
 *   1. App.tsx threw away the export summary (`.finally(close)`), so a
 *      failed Word export closed the dialog without a word.
 *      `docxSummaryToStatus` is the piece that turns the summary into
 *      the modal's status line; it returns null only for a clean
 *      success, which is the one case where the dialog may close.
 *   2. Empty control plans were filtered out before anything was
 *      built ("DOCX-CP-EmptySkip"), so ticking one gave no file and no
 *      message. The PDF export writes a file for the same tick, so the
 *      Word export now does too.
 */
import { unzipSync, strFromU8 } from "fflate";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilePayload } from "../src/shared/ipc.js";
import {
  docxSummaryToStatus,
  useDocxExport,
  type DocxExportSummary,
} from "../src/renderer/src/useDocxExport.js";

const t = (key: string): string => `[${key}]`;

function summary(over: Partial<DocxExportSummary> = {}): DocxExportSummary {
  return { written: [], errors: [], cancelled: false, ...over };
}

describe("docxSummaryToStatus", () => {
  it("returns null for a clean success, so the dialog closes as before", () => {
    expect(
      docxSummaryToStatus(summary({ written: ["/a/b/x.docx"] }), t),
    ).toBeNull();
  });

  it("shows every build error when nothing was written", () => {
    const st = docxSummaryToStatus(
      summary({
        errors: [
          { ref: { kind: "cp", id: 1 }, label: "3.1 Beton", message: "boom" },
          { ref: { kind: "bdb", id: 2 }, label: "Vinduer", message: "bang" },
        ],
      }),
      t,
    );
    expect(st).toEqual({
      kind: "error",
      message: "3.1 Beton: boom; Vinduer: bang",
    });
  });

  it("reports a partial save as saved-with-errors, in Word wording", () => {
    const st = docxSummaryToStatus(
      summary({
        written: ["/Users/x/Desktop/P_A.docx"],
        errors: [{ ref: { kind: "bdb", id: 2 }, label: "B", message: "m" }],
      }),
      t,
    );
    expect(st).toEqual({
      kind: "saved",
      format: "docx",
      directory: "/Users/x/Desktop",
      writtenCount: 1,
      errors: [{ fileBase: "B", message: "m" }],
    });
  });

  it("derives the folder from a Windows path too", () => {
    const st = docxSummaryToStatus(
      summary({
        written: ["C:\\Users\\x\\P_A.docx"],
        errors: [{ ref: { kind: "bdb", id: 2 }, label: "B", message: "m" }],
      }),
      t,
    );
    expect(st).toMatchObject({ directory: "C:\\Users\\x" });
  });

  it("says so when the save dialog was cancelled", () => {
    expect(docxSummaryToStatus(summary({ cancelled: true }), t)).toEqual({
      kind: "cancelled",
    });
  });

  it("an error beats a cancel when both happened and nothing was written", () => {
    const st = docxSummaryToStatus(
      summary({
        cancelled: true,
        errors: [{ ref: { kind: "cp", id: 1 }, label: "L", message: "m" }],
      }),
      t,
    );
    expect(st).toEqual({ kind: "error", message: "L: m" });
  });

  it("never returns silence when nothing was written and there is no reason", () => {
    expect(docxSummaryToStatus(summary(), t)).toEqual({
      kind: "error",
      message: "[modal.batchExport.error.docxNothingWritten]",
    });
  });
});

// ---------------------------------------------------------------------------
// useDocxExport — empty control plans are exported, not skipped
// ---------------------------------------------------------------------------

const blankRow = (id: number, headerId: number) => ({
  id,
  headerId,
  controlType: 0,
  sectionNo: "",
  subject: "",
  reference: "",
  method: "",
  quantity: "",
  time: "",
  acceptanceCriteria: "",
  documentation: "",
  controlLevel: "",
  sampleLevel: "",
});

/** Three control plans that the old rule called "empty": no headings
 *  and no rows (metadata only), headings only, and headings plus
 *  blank rows. */
function emptyCpPayload(): FilePayload {
  const cp = (id: number, title: string) => ({
    id,
    numberText: String(id),
    title,
    controlPlanType: 0,
    revision: "A",
    revisionDate: "2026-09-24",
  });
  return {
    path: "/tmp/t151.moliospec",
    dbVersion: "1.0",
    mtimeMs: 0,
    project: {
      projectGuid: "t151",
      name: "Projekt",
      projectNumber: "1",
      builder: null,
      createdBySystem: "test",
      createdDate: "2026-01-01",
      modifiedDate: null,
      moliioReferencelistDate: null,
    },
    workSpecs: [],
    bdbs: [],
    controlPlans: [
      cp(1, "Kun metadata"),
      cp(2, "Kun overskrifter"),
      cp(3, "Overskrift og tomme rækker"),
    ],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: {
      1: [],
      2: [{ id: 20, header: "Materialer", headerNo: "1" }],
      3: [{ id: 30, header: "Udførelse", headerNo: "1" }],
    },
    cpRowsByPlan: { 1: [], 2: [], 3: [blankRow(300, 30), blankRow(301, 30)] },
    attachments: [],
    customData: [],
  } as unknown as FilePayload;
}

/** Body + running headers as one string. The CP title lands in the
 *  headers (see buildBdbDocx.test.ts, "patches header XMLs"), the
 *  group headings in the body. */
function allText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  return Object.keys(files)
    .filter((n) => /^word\/(document|header\d+)\.xml$/.test(n))
    .map((n) => strFromU8(files[n]!))
    .join("\n");
}

describe("useDocxExport — empty control plans (Task 151)", () => {
  afterEach(() => {
    delete (window as unknown as { molio?: unknown }).molio;
  });

  it.each([
    [1, "Kun metadata", null],
    [2, "Kun overskrifter", "Materialer"],
    [3, "Overskrift og tomme rækker", "Udførelse"],
  ])(
    "writes a Word file for control plan %i (%s)",
    async (id, title, heading) => {
      const saveDocx = vi.fn(
        async (a: { suggestedFileName: string; bytes: Uint8Array }) => ({
          kind: "saved" as const,
          path: `/out/${a.suggestedFileName}`,
        }),
      );
      (window as unknown as { molio: unknown }).molio = { saveDocx };
      const { result } = renderHook(() => useDocxExport(emptyCpPayload()));

      const out = await result.current.exportSpecs([{ kind: "cp", id }]);

      expect(out.errors).toEqual([]);
      expect(out.written).toHaveLength(1);
      expect(saveDocx).toHaveBeenCalledTimes(1);
      // The file is a real .docx that carries the plan's own title.
      const text = allText(saveDocx.mock.calls[0]![0].bytes);
      expect(text).toContain(title);
      if (heading) expect(text).toContain(heading);
      // And the dialog closes: a clean success maps to no status.
      expect(docxSummaryToStatus(out, t)).toBeNull();
    },
  );

  it("puts a build failure in `errors` instead of dropping it", async () => {
    const saveDocx = vi.fn();
    (window as unknown as { molio: unknown }).molio = { saveDocx };
    const { result } = renderHook(() => useDocxExport(emptyCpPayload()));

    // id 999 does not exist → the builder throws "no-cp".
    const out = await result.current.exportSpecs([{ kind: "cp", id: 999 }]);

    expect(saveDocx).not.toHaveBeenCalled();
    expect(out.written).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(docxSummaryToStatus(out, t)).toMatchObject({ kind: "error" });
  });
});
