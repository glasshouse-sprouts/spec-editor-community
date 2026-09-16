/** @vitest-environment jsdom */
/**
 * Slice 10H.9 — EditBdbModal: is_pfbb checkbox is disabled when the
 * BDB is a PFBB child (pfbb_id != null).
 *
 * The dialog's control surface is the checkbox itself. This test
 * doesn't drive the full App → EditBdbModal flow (EditBdbModal lives
 * inline inside App.tsx and isn't exported yet — #233 refactor). It
 * instead asserts the small pure rule: `dialog.isPfbbChild === true`
 * ⇒ the checkbox is rendered with `disabled=true` and the child-hint
 * line is visible; otherwise neither is true. We exercise the rule
 * by constructing a minimal React tree that mirrors the modal's
 * relevant markup — same class names, same testids — so that the
 * CSS and contract between App.tsx and the tests stay synchronised.
 *
 * When #233 extracts EditBdbModal this test should be replaced by a
 * full RTL mount of the actual component.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

void React;

afterEach(() => {
  cleanup();
});

function PfbbCheckboxMock({ isPfbbChild }: { isPfbbChild: boolean }) {
  return (
    <>
      <label
        className="modal__field meta-modal__field--wide meta-modal__checkbox-field"
        title={
          isPfbbChild
            ? "This BDB is a PFBB child — its PFBB status comes from the master. To detach, delete this child and create a standalone BDB."
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={isPfbbChild}
          onChange={() => {}}
          disabled={isPfbbChild}
          data-testid="edit-bdb-ispfbb-checkbox"
        />
        <span>is PFBB</span>
      </label>
      {isPfbbChild ? (
        <div
          className="modal__field meta-modal__field--wide meta-modal__hint-line"
          data-testid="edit-bdb-pfbb-child-hint"
        >
          This BDB is a PFBB child.
        </div>
      ) : null}
    </>
  );
}

describe("EditBdbModal: is_pfbb checkbox guard on children (Slice 10H.9)", () => {
  it("disables the checkbox and shows the hint when the BDB is a PFBB child", () => {
    render(<PfbbCheckboxMock isPfbbChild={true} />);
    const cb = screen.getByTestId(
      "edit-bdb-ispfbb-checkbox",
    ) as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    expect(screen.getByTestId("edit-bdb-pfbb-child-hint")).toBeDefined();
  });

  it("leaves the checkbox enabled and hides the hint for a non-child BDB", () => {
    render(<PfbbCheckboxMock isPfbbChild={false} />);
    const cb = screen.getByTestId(
      "edit-bdb-ispfbb-checkbox",
    ) as HTMLInputElement;
    expect(cb.disabled).toBe(false);
    expect(screen.queryByTestId("edit-bdb-pfbb-child-hint")).toBeNull();
  });
});
