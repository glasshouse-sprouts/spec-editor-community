/** @vitest-environment jsdom */
/**
 * Tests for what the About panel tells the user about updates.
 *
 * This mapping is the entire user-facing surface of automatic
 * updating: main does the work, and this one line of text is how
 * anybody knows what happened. Two of its states are easy to get
 * wrong in a way nobody would notice until users complained -
 * "unsupported" is not a failure, and neither is being offline.
 *
 * Also checks that every string the panel asks for exists in BOTH
 * catalogues. A missing key falls back to the key itself, so the
 * failure mode is `about.update.ready` printed on screen in place of
 * a sentence - which reviews fine in the language you happened to
 * test in.
 */
import React from "react";
// `render` is aliased: this file already has a local `render` helper
// (an i18n stub) further down, and the two would collide silently -
// the component call would quietly return a string instead of
// mounting anything.
import {
  cleanup,
  render as renderComponent,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AboutDialog,
  updateMessage,
} from "../src/renderer/src/modals/AboutDialog.js";
import type { AppUpdater } from "../src/renderer/src/state/useAppUpdater.js";
import type { UpdateState } from "../src/shared/ipc.js";
import da from "../src/renderer/src/i18n/messages.da.json";
import en from "../src/renderer/src/i18n/messages.en.json";

/** A `t` that returns the key, so we can see WHICH key was asked for. */
const keyOnly = (key: string): string => key;

/** A `t` that renders like the real one, for the interpolation checks. */
const render = (
  key: string,
  params?: Record<string, string | number>,
): string => {
  const template = (en as Record<string, string>)[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, n: string) =>
    String(params[n] ?? `{${n}}`),
  );
};

describe("updateMessage", () => {
  it("says nothing at all when nothing has happened yet", () => {
    expect(updateMessage({ kind: "idle" }, keyOnly)).toBe("");
  });

  it("reports a build with no update channel as a fact, not an error", () => {
    // Every Community user is in this state. A red failure message
    // they cannot act on would be worse than saying nothing.
    expect(
      updateMessage({ kind: "unsupported", reason: "noChannel" }, keyOnly),
    ).toBe("about.update.unsupported");
  });

  it("does not tell a developer that the app cannot update itself", () => {
    // Same state, different cause. A development run is not an
    // edition, and saying "this edition does not update itself" there
    // is simply false - about the released app, to the one audience
    // that would repeat it.
    expect(updateMessage({ kind: "unsupported", reason: "dev" }, keyOnly)).toBe(
      "about.update.devBuild",
    );
  });

  it("passes an error message through as written", () => {
    // Main has already turned network failures into plain language;
    // the panel must not second-guess it or bury it behind a generic
    // "something went wrong".
    expect(
      updateMessage(
        { kind: "error", message: "Could not reach the update server." },
        keyOnly,
      ),
    ).toBe("Could not reach the update server.");
  });

  it("names the version when one is waiting", () => {
    const msg = updateMessage({ kind: "ready", version: "1.0.1" }, render);
    expect(msg).toContain("1.0.1");
    // The promise that matters: it will NOT restart on its own.
    expect(msg.toLowerCase()).toContain("close the app");
  });

  it("shows progress while downloading", () => {
    const msg = updateMessage(
      { kind: "downloading", version: "1.0.1", percent: 42 },
      render,
    );
    expect(msg).toContain("42");
    expect(msg).not.toContain("{percent}");
  });

  it("leaves no placeholder unfilled in any state", () => {
    const states = [
      { kind: "checking" } as const,
      { kind: "upToDate", checkedAt: 0 } as const,
      { kind: "available", version: "1.0.1" } as const,
      { kind: "downloading", version: "1.0.1", percent: 7 } as const,
      { kind: "ready", version: "1.0.1" } as const,
      { kind: "unsupported", reason: "noChannel" } as const,
      { kind: "unsupported", reason: "dev" } as const,
    ];
    for (const s of states) {
      expect(updateMessage(s, render)).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("About panel translations", () => {
  const keys = [
    "about.title",
    "about.close",
    "about.editionAndVersion",
    "about.maker",
    "about.update.section",
    "about.update.check",
    "about.update.checking",
    "about.update.upToDate",
    "about.update.available",
    "about.update.downloading",
    "about.update.ready",
    "about.update.restart",
    "about.update.unsaved",
    "about.update.unsupported",
    "about.update.devBuild",
    "about.update.how",
    "about.links.section",
    "about.link.website",
    "about.link.help",
    "about.link.openSource",
    "about.link.license",
  ];

  for (const [name, catalog] of [
    ["English", en],
    ["Danish", da],
  ] as const) {
    it(`has every About string in ${name}`, () => {
      const missing = keys.filter(
        (k) => !(k in (catalog as Record<string, string>)),
      );
      expect(missing).toEqual([]);
    });
  }

  it("keeps the same placeholders in both languages", () => {
    // A translation that drops {version} loses the information; one
    // that renames it prints the placeholder verbatim.
    for (const k of keys) {
      const a = (en as Record<string, string>)[k] ?? "";
      const b = (da as Record<string, string>)[k] ?? "";
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(b)).toEqual(placeholders(a));
    }
  });
});


describe("the 'how updating works' line (Task 123)", () => {
  // The bug: a packaged build with no app-update.yml showed this line
  // AND "this edition does not update itself", two lines apart. The
  // old condition only hid the line for reason "dev".
  afterEach(cleanup);

  const stubUpdater = (state: UpdateState): AppUpdater => ({
    state,
    check: () => Promise.resolve(),
    installNow: () => Promise.resolve({ kind: "notReady" as const }),
  });

  const renderPanel = (state: UpdateState): void => {
    renderComponent(
      React.createElement(AboutDialog, {
        info: null,
        updater: stubUpdater(state),
        onClose: () => {},
      }),
    );
  };

  const howLine = en["about.update.how"] as string;
  const noChannelLine = en["about.update.unsupported"] as string;

  it("is hidden in a packaged build with no update channel", () => {
    renderPanel({ kind: "unsupported", reason: "noChannel" });
    expect(screen.queryByText(howLine)).toBeNull();
    // ...and the one true sentence is the only one left.
    expect(screen.getByText(noChannelLine)).toBeTruthy();
  });

  it("is hidden in a development run, as before", () => {
    renderPanel({ kind: "unsupported", reason: "dev" });
    expect(screen.queryByText(howLine)).toBeNull();
  });

  it("is shown in an ordinary build that does update itself", () => {
    renderPanel({ kind: "idle" });
    expect(screen.getByText(howLine)).toBeTruthy();
  });

  it("is shown while a check is running", () => {
    renderPanel({ kind: "checking" });
    expect(screen.getByText(howLine)).toBeTruthy();
  });
});
