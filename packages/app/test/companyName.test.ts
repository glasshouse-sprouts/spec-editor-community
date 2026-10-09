/** @vitest-environment jsdom */
/**
 * Task 185 - the company name app setting ("Firmanavn").
 *
 * Owner's decision 2026-10-08: one value for every project, set in
 * Settings, in both bskriver and Community. Used by the PDF footer and
 * the built-in cover. Empty field -> empty footer, never a placeholder.
 * Stored where the UI language is stored (prefStore -> preferences.json
 * in userData), so it survives a restart.
 *
 *   1. read / write / trim (companyNamePrefs)
 *   2. D2: the value is saved through the app's real store and read back
 *      after a "restart" (a fresh prefStore seeded from the saved file)
 *   3. the export passes it on: single (work area, BDB, control plan)
 *      and composite. The builders themselves are covered in
 *      pdfNoPlaceholders.test.ts ("Task 185 - ...").
 *
 * The PDF renderer is stubbed; the stub captures what the export passes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderSpecPdf = vi.fn(async (_args: unknown) => new Uint8Array([1]));
const renderCpPdf = vi.fn(async (_args: unknown) => new Uint8Array([2]));
const renderCompositePdf = vi.fn(async (_args: unknown) => new Uint8Array([3]));
vi.mock("../src/renderer/src/pdf/renderPdf.js", async (orig) => ({
  ...(await orig<object>()),
  renderSpecPdf: (args: unknown) => renderSpecPdf(args),
  renderCpPdf: (args: unknown) => renderCpPdf(args),
  renderCompositePdf: (args: unknown) => renderCompositePdf(args),
}));

import type {
  FilePayload,
  ReferenceLinks,
  SectionData,
} from "../src/shared/ipc.js";
import {
  COMPANY_NAME_KEY,
  companyNameForPdf,
  readCompanyName,
  writeCompanyName,
  type KeyValueStore,
} from "../src/renderer/src/companyNamePrefs.js";
import { buildBytesFor, buildTargets } from "../src/renderer/src/ExportCard.js";
import { buildBytesForCompositeJob } from "../src/renderer/src/executeCompositeExport.js";
import {
  buildExportTree,
  emptySelection,
} from "../src/renderer/src/exportTree.js";
import {
  buildPdfExportJobs,
  type PdfExportJob,
} from "../src/renderer/src/exportGrouping.js";

const COMPANY = "Eksempel Rådgivning A/S";

function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

// ---------------------------------------------------------------------------
// 1. read / write / trim
// ---------------------------------------------------------------------------

describe("companyNamePrefs", () => {
  it("is empty when nothing is saved", () => {
    expect(readCompanyName(fakeStore())).toBe("");
    expect(companyNameForPdf(fakeStore())).toBeNull();
  });

  it("round-trips through write + read, as typed", () => {
    const s = fakeStore();
    writeCompanyName(s, "  Eksempel Rådgivning A/S ");
    expect(readCompanyName(s)).toBe("  Eksempel Rådgivning A/S ");
  });

  it("gives the PDF a trimmed name, or null for empty / whitespace", () => {
    expect(
      companyNameForPdf(fakeStore({ [COMPANY_NAME_KEY]: ` ${COMPANY} ` })),
    ).toBe(COMPANY);
    expect(companyNameForPdf(fakeStore({ [COMPANY_NAME_KEY]: "" }))).toBeNull();
    expect(
      companyNameForPdf(fakeStore({ [COMPANY_NAME_KEY]: "   " })),
    ).toBeNull();
  });

  it("clearing the field clears the PDF value", () => {
    const s = fakeStore();
    writeCompanyName(s, COMPANY);
    writeCompanyName(s, "");
    expect(companyNameForPdf(s)).toBeNull();
  });

  it("never throws when the store does", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
    };
    expect(readCompanyName(broken)).toBe("");
    expect(() => writeCompanyName(broken, "x")).not.toThrow();
  });

  it("uses its own key next to the language's", () => {
    expect(COMPANY_NAME_KEY).toBe("molio.companyName");
  });
});

// ---------------------------------------------------------------------------
// 2. D2 - saved through the app's store, read back after a restart
// ---------------------------------------------------------------------------

interface MutableWindow {
  molio?: {
    prefs?: {
      initial: Record<string, string>;
      set: (k: string, v: string) => Promise<void>;
      delete: (k: string) => Promise<void>;
    };
  };
}

describe("D2 - the value survives a restart (same store as the language)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as MutableWindow).molio;
  });
  afterEach(() => {
    delete (window as MutableWindow).molio;
  });

  it("is written to the preferences file and read back on the next launch", async () => {
    // Launch 1: empty preferences file. The user types a name.
    const saved: Record<string, string> = { "molio.locale": "da" };
    const set = vi.fn(async (k: string, v: string) => {
      saved[k] = v;
    });
    (window as MutableWindow).molio = {
      prefs: { initial: { ...saved }, set, delete: vi.fn() },
    };
    let { prefStore } = await import("../src/renderer/src/prefs.js");
    writeCompanyName(prefStore(), COMPANY);
    expect(set).toHaveBeenCalledWith(COMPANY_NAME_KEY, COMPANY);

    // Launch 2: a fresh renderer, seeded from what launch 1 saved.
    vi.resetModules();
    (window as MutableWindow).molio = {
      prefs: { initial: { ...saved }, set: vi.fn(), delete: vi.fn() },
    };
    ({ prefStore } = await import("../src/renderer/src/prefs.js"));
    expect(readCompanyName(prefStore())).toBe(COMPANY);
    expect(companyNameForPdf(prefStore())).toBe(COMPANY);
    // The language is untouched.
    expect(prefStore().getItem("molio.locale")).toBe("da");
  });
});

// ---------------------------------------------------------------------------
// 3. The export passes the name on
// ---------------------------------------------------------------------------

const EMPTY_REFS: ReferenceLinks = {
  basisGuid: null,
  basisRevisionGuid: null,
  paradigmGuid: null,
  paradigmRevisionGuid: null,
  referencelistArea: null,
  referencelistAreaDate: null,
};

const sections: SectionData[] = [
  {
    id: 1,
    sectionNo: 1,
    heading: "Omfang",
    body: "<p>x</p>",
    parentId: null,
    pfbbSectionId: null,
  },
];

function payload(): FilePayload {
  return {
    path: "/tmp/fake.moliospec",
    dbVersion: "01.00.04",
    mtimeMs: 0,
    project: { name: "Projekt", builder: "Bygherre A/S" },
    contracts: [{ id: 1, contractCode: "E11", contractName: "Råhus" }],
    workSpecs: [
      {
        id: 10,
        workAreaCode: "S100",
        workAreaName: "Beton",
        workAreaType: 0,
        revision: null,
        revisionDate: null,
        contractId: 1,
        refs: EMPTY_REFS,
      },
    ],
    bdbs: [
      {
        id: 20,
        name: "Fundering",
        workSpecId: 10,
        isPfbb: false,
        pfbbId: null,
        revision: null,
        revisionDate: null,
        controlPlanIds: [30],
        refs: EMPTY_REFS,
      },
    ],
    controlPlans: [
      { id: 30, numberText: "KP1", title: "Kontrol", controlPlanType: 0 },
    ],
    attachments: [],
    sectionsByWorkSpec: { 10: sections },
    sectionsByBdb: { 20: sections },
    cpHeadersByPlan: { 30: [] },
    cpRowsByPlan: { 30: [] },
  } as unknown as FilePayload;
}

describe("the export passes the company name to the PDF builders", () => {
  beforeEach(() => {
    renderSpecPdf.mockClear();
    renderCpPdf.mockClear();
    renderCompositePdf.mockClear();
  });

  for (const [kind, fn] of [
    ["workSpec", renderSpecPdf],
    ["bdb", renderSpecPdf],
    ["cp", renderCpPdf],
  ] as const) {
    it(`single ${kind}: with and without a name`, async () => {
      const data = payload();
      const target = buildTargets(data).find((t) => t.kind === kind)!;
      for (const [companyName, expected] of [
        [COMPANY, COMPANY],
        [null, null],
        [undefined, null],
      ] as const) {
        fn.mockClear();
        await buildBytesFor(data, target, {
          includeCoverPage: true,
          compact: false,
          ...(companyName !== undefined ? { companyName } : {}),
        });
        const args = fn.mock.calls[0]![0] as { companyName?: string | null };
        expect(args.companyName ?? null).toBe(expected);
      }
    });
  }

  it("composite: with and without a name", async () => {
    const data = payload();
    const sel = emptySelection();
    sel.workAreas.add(10);
    sel.bdbs.add(20);
    const job = buildPdfExportJobs({
      data,
      tree: buildExportTree(data),
      selection: sel,
      groupBy: "perContract",
    }).find(
      (j): j is Extract<PdfExportJob, { kind: "composite" }> =>
        j.kind === "composite",
    )!;
    for (const [companyName, expected] of [
      [COMPANY, COMPANY],
      [null, null],
    ] as const) {
      renderCompositePdf.mockClear();
      await buildBytesForCompositeJob(data, job, {
        includeCoverPage: true,
        compact: false,
        companyName,
      });
      const args = renderCompositePdf.mock.calls[0]![0] as {
        cover: { companyName?: string | null };
      };
      expect(args.cover.companyName ?? null).toBe(expected);
    }
  });
});
