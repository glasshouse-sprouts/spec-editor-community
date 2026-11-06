/**
 * Task 118 - Ctrl+W closed the whole app on Windows instead of a tab.
 *
 * The Window menu had `{ role: "close" }` on Windows and Linux.
 * Electron gives that role Ctrl+W, the same keys as File > Close Tab,
 * and the role won. This test builds the real menu template for each
 * platform and locks that exactly one item answers to Ctrl+W, and that
 * it is "Close Tab". It also checks that no two items share a shortcut
 * at all, which is the kind of clash that also could stop
 * Ctrl+Shift+O (Load Version Reference) from reaching its item.
 *
 * Electron is not started: the test imports main/index.ts with
 * Electron and the modules that act on import replaced, and reads the
 * template that `Menu.buildFromTemplate` would get.
 *
 * Roles bring their own shortcut, which is not in the template.
 * `ROLE_DEFAULTS` lists Electron's defaults for the roles the menu
 * uses (electron/lib/browser/api/menu-item-roles.ts). A role missing
 * from the list fails the test, so a new role is looked at, not
 * skipped.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
  const app = {
    setName: () => {},
    setPath: () => {},
    getPath: () => "/tmp",
    getName: () => "bskriver",
    name: "bskriver",
    isPackaged: false,
    whenReady: () => new Promise(() => {}),
    on: () => {},
  };
  return {
    app,
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
    Menu: { buildFromTemplate: (t: unknown) => t },
    dialog: {},
    ipcMain: { handle: () => {}, on: () => {} },
    nativeTheme: {},
    shell: {},
  };
});
// Modules that do something as soon as they are imported.
vi.mock("../src/main/osFileOpen.js", () => ({ initOsFileOpen: () => false }));
vi.mock("../src/main/handlers/index.js", () => ({}));
vi.mock("../src/main/appUpdater.js", () => ({ initAppUpdater: () => {} }));
vi.mock("../src/main/glasshouseDeepLink.js", () => ({
  initGlasshouseDeepLink: () => {},
}));

const { appMenuTemplate } = await import("../src/main/index.js");

type Item = Electron.MenuItemConstructorOptions;

/** Electron's own shortcut per role, by platform. `null` = none. */
const ROLE_DEFAULTS: Record<string, (p: NodeJS.Platform) => string | null> = {
  about: () => null,
  services: () => null,
  hide: () => "CmdOrCtrl+H",
  hideOthers: (p) => (p === "darwin" ? "Command+Alt+H" : "Ctrl+Shift+H"),
  unhide: () => null,
  quit: (p) =>
    p === "win32" ? null : p === "darwin" ? "CmdOrCtrl+Q" : "Ctrl+Q",
  undo: () => "CmdOrCtrl+Z",
  redo: (p) => (p === "win32" ? "Ctrl+Y" : "Shift+CmdOrCtrl+Z"),
  cut: () => "CmdOrCtrl+X",
  copy: () => "CmdOrCtrl+C",
  paste: () => "CmdOrCtrl+V",
  selectAll: () => "CmdOrCtrl+A",
  reload: () => "CmdOrCtrl+R",
  forceReload: () => "Shift+CmdOrCtrl+R",
  toggleDevTools: (p) => (p === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I"),
  resetZoom: () => "CmdOrCtrl+0",
  zoomIn: () => "CmdOrCtrl+Plus",
  zoomOut: () => "CmdOrCtrl+-",
  togglefullscreen: (p) => (p === "darwin" ? "Control+Command+F" : "F11"),
  minimize: () => "CmdOrCtrl+M",
  zoom: () => null,
  front: () => null,
  close: () => "CmdOrCtrl+W",
};

/** One form per shortcut: "cmdorctrl+shift+o", modifiers sorted. */
function normalise(acc: string, p: NodeJS.Platform): string {
  const parts = acc.split("+").map((k) => k.toLowerCase());
  const key = parts.pop()!;
  const mods = parts.map((m) => {
    if (m === "commandorcontrol") return "cmdorctrl";
    if (p !== "darwin" && (m === "ctrl" || m === "control")) return "cmdorctrl";
    if (p === "darwin" && (m === "cmd" || m === "command")) return "cmdorctrl";
    if (m === "option") return "alt";
    return m;
  });
  return [...mods.sort(), key].join("+");
}

/** Every item with a shortcut, with the shortcut it really gets. */
function shortcuts(p: NodeJS.Platform): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (items: Item[]): void => {
    for (const it of items) {
      if (Array.isArray(it.submenu)) walk(it.submenu as Item[]);
      let acc = it.accelerator as string | undefined;
      if (!acc && it.role) {
        const def = ROLE_DEFAULTS[it.role];
        if (!def) throw new Error(`role "${it.role}" is not in ROLE_DEFAULTS`);
        acc = def(p) ?? undefined;
      }
      if (acc) out.push([it.label ?? `role:${it.role}`, normalise(acc, p)]);
    }
  };
  walk(appMenuTemplate(p));
  return out;
}

describe("Task 118 - the menu's keyboard shortcuts", () => {
  for (const p of ["win32", "linux", "darwin"] as const) {
    it(`${p}: exactly one item answers to Ctrl/Cmd+W, and it is Close Tab`, () => {
      const w = shortcuts(p).filter(([, a]) => a === "cmdorctrl+w");
      expect(w.map(([label]) => label)).toEqual(["Close Tab"]);
    });

    it(`${p}: no two items share a shortcut`, () => {
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const [label, acc] of shortcuts(p)) {
        const other = seen.get(acc);
        if (other) clashes.push(`${acc}: ${other} / ${label}`);
        seen.set(acc, label);
      }
      expect(clashes).toEqual([]);
    });

    // The Community edition has no Load Version Reference item, so
    // this checks that nothing else takes the keys, not that it exists.
    it(`${p}: only Load Version Reference uses Ctrl/Cmd+Shift+O`, () => {
      const o = shortcuts(p).filter(([, a]) => a === "cmdorctrl+shift+o");
      for (const [label] of o) expect(label).toBe("Load Version Reference…");
    });
  }

  it("macOS keeps its Window menu as before (no close role, Bring All to Front)", () => {
    const win = appMenuTemplate("darwin").find((m) => m.label === "Window")!;
    expect((win.submenu as Item[]).map((i) => i.role ?? i.type)).toEqual([
      "minimize",
      "zoom",
      "separator",
      "front",
    ]);
  });
});
