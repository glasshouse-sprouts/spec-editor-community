/** @vitest-environment jsdom */
/**
 * Slice 10I / 10I.b / #71 — CustomDataAccordion tests.
 *
 * Coverage:
 *   - Empty list → accordion still renders (with "Add entry" CTA in
 *     10I.b), count label shows "(0 entries)".
 *   - Non-empty → count label is accurate.
 *   - Toggle shows the entry list (UTF-8 value as text; binary as
 *     "(binary, N bytes)"; zero-byte as "(empty)").
 *   - Edit flow: click Edit → textarea appears → Save change →
 *     `onSet(key, newBase64)` fires once with the typed UTF-8.
 *   - Delete flow: click Delete → "Confirm delete" appears → click
 *     Confirm → `onDelete(key)` fires once.
 *   - Add-entry flow: click Add entry → key + value fields appear →
 *     Add entry → `onSet(newKey, newBase64)` fires.
 *   - Third-party warning: rows whose key contains a dot show a
 *     warning note; plain keys don't.
 *   - Binary warning while editing: editing a binary-detected row
 *     shows a note explaining the save will replace bytes with text.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

void React;

afterEach(() => {
  cleanup();
});

import { CustomDataAccordion } from "../src/renderer/src/CustomDataAccordion.tsx";
import type { EffectiveCustomDataEntry } from "../src/renderer/src/edits.ts";

function utf8Entry(key: string, value: string): EffectiveCustomDataEntry {
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return {
    key,
    valueBase64: b64,
    byteLength: Buffer.byteLength(value, "utf8"),
    pendingKind: null,
  };
}
function binaryEntry(key: string, bytes: number[]): EffectiveCustomDataEntry {
  const buf = Buffer.from(bytes);
  return {
    key,
    valueBase64: buf.toString("base64"),
    byteLength: buf.length,
    pendingKind: null,
  };
}
function noopHandlers(): {
  onSet: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onClearPending: ReturnType<typeof vi.fn>;
} {
  return {
    onSet: vi.fn(),
    onDelete: vi.fn(),
    onClearPending: vi.fn(),
  };
}

describe("CustomDataAccordion", () => {
  it("renders with zero-entries count label and still offers Add", () => {
    const h = noopHandlers();
    render(<CustomDataAccordion entries={[]} {...h} />);
    expect(screen.getByText(/custom_data \(0 entries\)/)).toBeDefined();
    // The toggle is always rendered.
    expect(screen.getByTestId("custom-data-accordion-toggle")).toBeDefined();
  });

  it("shows the entry count and expands on click", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion
        entries={[utf8Entry("foo", "bar"), utf8Entry("baz", "qux")]}
        {...h}
      />,
    );
    expect(screen.getByText(/\(2 entries\)/)).toBeDefined();
    // Rows not visible until toggled open.
    expect(screen.queryByTestId("custom-data-row-foo")).toBeNull();
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    expect(screen.getByTestId("custom-data-row-foo")).toBeDefined();
  });

  it("renders UTF-8 values as text and binary values as '(binary, N bytes)'", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion
        entries={[
          utf8Entry("notes", "Hello world"),
          binaryEntry("plugin.state", [0x00, 0x01, 0x02, 0xff, 0xfe]),
          {
            key: "empty-blob",
            valueBase64: "",
            byteLength: 0,
            pendingKind: null,
          },
        ]}
        {...h}
      />,
    );
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    expect(screen.getByText("Hello world")).toBeDefined();
    expect(screen.getByText(/\(binary, 5 B\)/)).toBeDefined();
    expect(screen.getByText("(empty)")).toBeDefined();
  });

  it("Edit flow stages a set through onSet", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion entries={[utf8Entry("notes", "Hello")]} {...h} />,
    );
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    fireEvent.click(screen.getByTestId("custom-data-edit-notes"));

    const textarea = screen.getByTestId(
      "custom-data-value-textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello, world!" } });
    fireEvent.click(screen.getByTestId("custom-data-save-edit"));

    expect(h.onSet).toHaveBeenCalledTimes(1);
    const [key, b64] = h.onSet.mock.calls[0]!;
    expect(key).toBe("notes");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("Hello, world!");
  });

  it("Delete flow requires confirm before onDelete fires", () => {
    const h = noopHandlers();
    render(<CustomDataAccordion entries={[utf8Entry("my-key", "v")]} {...h} />);
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    fireEvent.click(screen.getByTestId("custom-data-delete-my-key"));
    expect(h.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("custom-data-confirm-delete-my-key"));
    expect(h.onDelete).toHaveBeenCalledWith("my-key");
  });

  it("Add-entry flow stages a new set through onSet", () => {
    const h = noopHandlers();
    render(<CustomDataAccordion entries={[]} {...h} />);
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    fireEvent.click(screen.getByTestId("custom-data-add-button"));

    const keyInput = screen.getByTestId(
      "custom-data-add-key",
    ) as HTMLInputElement;
    const valueTa = screen.getByTestId(
      "custom-data-add-value",
    ) as HTMLTextAreaElement;
    fireEvent.change(keyInput, { target: { value: "my-project.notes" } });
    fireEvent.change(valueTa, { target: { value: "Some notes." } });
    fireEvent.click(screen.getByTestId("custom-data-confirm-add"));

    expect(h.onSet).toHaveBeenCalledTimes(1);
    const [key, b64] = h.onSet.mock.calls[0]!;
    expect(key).toBe("my-project.notes");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("Some notes.");
  });

  it("Add-entry refuses duplicate keys", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion entries={[utf8Entry("already-here", "x")]} {...h} />,
    );
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    fireEvent.click(screen.getByTestId("custom-data-add-button"));
    const keyInput = screen.getByTestId(
      "custom-data-add-key",
    ) as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "already-here" } });
    // Confirm button should be disabled (duplicate) — clicking does nothing.
    const confirmBtn = screen.getByTestId(
      "custom-data-confirm-add",
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(screen.getByText(/already exists/)).toBeDefined();
  });

  it("shows the third-party warning on dot-namespaced keys", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion
        entries={[
          utf8Entry("glasshouse.v1.notes", "x"),
          utf8Entry("plain-key", "y"),
        ]}
        {...h}
      />,
    );
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    // One warning rendered, not two.
    const warnings = screen.getAllByRole("note");
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.textContent).toMatch(/third-party state/);
  });

  it("shows the binary warning when editing a binary value", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion
        entries={[binaryEntry("plugin.state", [0x00, 0x01, 0xff])]}
        {...h}
      />,
    );
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    fireEvent.click(screen.getByTestId("custom-data-edit-plugin.state"));
    expect(screen.getByText(/replaces the binary value/)).toBeDefined();
  });

  it("Save is disabled when the typed value equals the original", () => {
    const h = noopHandlers();
    render(
      <CustomDataAccordion
        entries={[utf8Entry("unchanged", "keep me")]}
        {...h}
      />,
    );
    fireEvent.click(screen.getByTestId("custom-data-accordion-toggle"));
    fireEvent.click(screen.getByTestId("custom-data-edit-unchanged"));
    // Textarea already seeded with "keep me" (the decoded disk text).
    const btn = screen.getByTestId(
      "custom-data-save-edit",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
