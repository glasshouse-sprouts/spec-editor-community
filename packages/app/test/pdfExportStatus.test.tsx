/** @vitest-environment jsdom */
/**
 * Task 150 — the PDF export must tell the user what happened.
 *
 * Until 2026-09-24 `handleExport` ran the whole pipeline inside
 * `try { ... } finally { closeModal(); }`. The status line lives inside
 * the dialog, so every outcome closed it: a failed export vanished
 * without a word (that is why card 150 took a day to diagnose), and
 * cancelling the save dialog threw the user out of the export dialog.
 *
 * Now the dialog closes only after a clean success. These tests drive
 * the real hook with the PDF renderer and the save IPC stubbed.
 */
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilePayload } from "../src/shared/ipc.js";
import type { BatchExportStatus } from "../src/renderer/src/BatchExportModal.js";
import {
  CoverProvider,
  type CoverActiveTemplate,
  type CoverEngine,
} from "../src/renderer/src/coverContext.js";

const renderCpPdf = vi.fn<(args: unknown) => Promise<Uint8Array>>();
vi.mock("../src/renderer/src/pdf/renderPdf.js", async (orig) => ({
  ...(await orig<object>()),
  renderCpPdf: (args: unknown) => renderCpPdf(args),
}));

const { pdfExportShouldClose, useExportController } =
  await import("../src/renderer/src/useExportController.js");

/** Two control plans: the simplest exportable targets. */
function payload(): FilePayload {
  const cp = (id: number, title: string) => ({
    id,
    numberText: String(id),
    title,
    controlPlanType: 0,
    revision: "A",
    revisionDate: "2026-09-24",
  });
  return {
    path: "/tmp/t150.moliospec",
    dbVersion: "1.0",
    mtimeMs: 0,
    project: {
      projectGuid: "t150",
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
    controlPlans: [cp(1, "Plan A"), cp(2, "Plan B")],
    contracts: [],
    sectionsByWorkSpec: {},
    sectionsByBdb: {},
    cpHeadersByPlan: { 1: [], 2: [] },
    cpRowsByPlan: { 1: [], 2: [] },
    attachments: [],
    customData: [],
  } as unknown as FilePayload;
}

const savePdf = vi.fn();
const savePdfBatch = vi.fn();

beforeEach(() => {
  renderCpPdf.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  savePdf.mockReset();
  savePdfBatch.mockReset();
  (window as unknown as { molio: unknown }).molio = { savePdf, savePdfBatch };
});
afterEach(() => {
  delete (window as unknown as { molio?: unknown }).molio;
});

type ModalProps = {
  status: BatchExportStatus;
  onSelectionChange: (s: unknown) => void;
  onExport: () => void;
  onIncludeCoverPageChange: (v: boolean) => void;
};

/** Open the dialog, tick the given control plans, press Export. */
async function exportCps(cpIds: number[]) {
  const hook = renderHook(() => useExportController(payload()));
  act(() => hook.result.current.open());
  const props = () =>
    hook.result.current.modalElement?.props as ModalProps | undefined;
  act(() =>
    props()!.onSelectionChange({
      workAreas: new Set<number>(),
      bdbs: new Set<number>(),
      cps: new Set(cpIds),
    }),
  );
  await act(async () => {
    props()!.onExport();
    // Let the async pipeline (render, save IPC) run to the end.
    await new Promise((r) => setTimeout(r, 0));
  });
  return { hook, props };
}

describe("pdfExportShouldClose", () => {
  it("closes only on a clean success", () => {
    expect(
      pdfExportShouldClose({
        kind: "saved",
        directory: "/d",
        writtenCount: 1,
        errors: [],
      }),
    ).toBe(true);
    expect(
      pdfExportShouldClose({
        kind: "saved",
        directory: "/d",
        writtenCount: 1,
        errors: [{ fileBase: "x", message: "boom" }],
      }),
    ).toBe(false);
    expect(pdfExportShouldClose({ kind: "cancelled" })).toBe(false);
    expect(pdfExportShouldClose({ kind: "error", message: "boom" })).toBe(
      false,
    );
  });
});

describe("PDF export dialog outcome (Task 150)", () => {
  it("closes the dialog after a clean save", async () => {
    savePdf.mockResolvedValue({ kind: "saved", path: "/out/Plan A.pdf" });
    const { props } = await exportCps([1]);
    expect(savePdf).toHaveBeenCalledTimes(1);
    expect(props()).toBeUndefined();
  });

  it("keeps the dialog open with the build error when the PDF cannot be built", async () => {
    renderCpPdf.mockRejectedValue(
      new Error("Node id 'section-1236' already exists"),
    );
    const { props } = await exportCps([1]);
    expect(savePdf).not.toHaveBeenCalled();
    const status = props()?.status;
    expect(status?.kind).toBe("error");
    expect(status?.kind === "error" && status.message).toContain(
      "Node id 'section-1236' already exists",
    );
  });

  it("keeps the dialog open after the save dialog is cancelled", async () => {
    savePdf.mockResolvedValue({ kind: "cancelled" });
    const { props } = await exportCps([1]);
    expect(props()?.status).toEqual({ kind: "cancelled" });
  });

  it("keeps the dialog open when the save itself fails", async () => {
    savePdf.mockResolvedValue({ kind: "error", message: "Disk full" });
    const { props } = await exportCps([1]);
    expect(props()?.status).toEqual({ kind: "error", message: "Disk full" });
  });

  it("keeps the dialog open on a partial save and lists what failed", async () => {
    renderCpPdf
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockRejectedValueOnce(new Error("boom"));
    savePdf.mockResolvedValue({ kind: "saved", path: "/out/Plan A.pdf" });
    const { props } = await exportCps([1, 2]);
    const status = props()?.status;
    expect(status?.kind).toBe("saved");
    expect(status?.kind === "saved" && status.errors).toHaveLength(1);
  });

  it("keeps the dialog open when the save IPC throws", async () => {
    savePdf.mockRejectedValue(new Error("IPC gone"));
    const { props } = await exportCps([1]);
    expect(props()?.status.kind).toBe("error");
  });
});

/* ------------------------------------------------------------------ */
/*  Task 173 - the "include cover" tick governs the custom cover too   */
/* ------------------------------------------------------------------ */

/** A cover engine with an active custom template, every call recorded. */
function fakeCoverEngine() {
  const active = { __coverActive: "active" } as CoverActiveTemplate;
  const resolveActiveTemplate = vi.fn(async () => active);
  const applyCover = vi.fn(
    async (_a: CoverActiveTemplate, bytes: Uint8Array) =>
      new Uint8Array([9, ...bytes]),
  );
  const engine = {
    enabled: true,
    resolveActiveTemplate,
    resolveTemplateFromPath: async () => null,
    applyCover,
    openEditor: () => {},
    clearTemplate: () => {},
    activeTemplateLabel: "Tilpasset forside",
  } as unknown as CoverEngine;
  return { engine, resolveActiveTemplate, applyCover };
}

/** Export control plan 1 with a custom cover active and the tick set. */
async function exportWithCustomCover(includeCoverPage: boolean) {
  const cover = fakeCoverEngine();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(CoverProvider, { value: cover.engine }, children);
  const hook = renderHook(() => useExportController(payload()), { wrapper });
  act(() => hook.result.current.open());
  const props = () =>
    hook.result.current.modalElement?.props as ModalProps | undefined;
  act(() => props()!.onIncludeCoverPageChange(includeCoverPage));
  act(() =>
    props()!.onSelectionChange({
      workAreas: new Set<number>(),
      bdbs: new Set<number>(),
      cps: new Set([1]),
    }),
  );
  savePdf.mockResolvedValue({ kind: "saved", path: "/out/Plan A.pdf" });
  await act(async () => {
    props()!.onExport();
    await new Promise((r) => setTimeout(r, 0));
  });
  return cover;
}

describe("PDF export - include-cover tick and the custom cover (Task 173)", () => {
  it("tick OFF: no cover at all, even with a custom cover active", async () => {
    const cover = await exportWithCustomCover(false);
    expect(cover.resolveActiveTemplate).not.toHaveBeenCalled();
    expect(cover.applyCover).not.toHaveBeenCalled();
    // ... and the built-in cover is off too, with no page reserved.
    expect(renderCpPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        includeCoverPage: false,
        reserveCoverPage: false,
      }),
    );
    expect(savePdf).toHaveBeenCalledTimes(1);
  });

  it("tick ON: the custom cover replaces the built-in one", async () => {
    const cover = await exportWithCustomCover(true);
    expect(cover.resolveActiveTemplate).toHaveBeenCalledTimes(1);
    expect(cover.applyCover).toHaveBeenCalledTimes(1);
    // Built-in cover off, page 1 reserved for the custom one (Task 173
    // fase 3) so pdfmake counts it in the TOC page numbers.
    expect(renderCpPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        includeCoverPage: false,
        reserveCoverPage: true,
      }),
    );
  });
});
