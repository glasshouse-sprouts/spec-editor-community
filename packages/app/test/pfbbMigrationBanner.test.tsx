/** @vitest-environment jsdom */
/**
 * Slice 10H.6b — PfbbMigrationBanner rendering + interaction tests.
 *
 * Presentational component only: no state, no IPC. We assert the
 * user-visible copy, the action callbacks, and the disabled/busy state
 * when a migration is in flight.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// JSX transform compiles to React.createElement in this file.
void React;

afterEach(() => {
  cleanup();
});

import { PfbbMigrationBanner } from "../src/renderer/src/PfbbMigrationBanner.tsx";

describe("PfbbMigrationBanner", () => {
  it("renders nothing when orphanCount is 0", () => {
    const { container } = render(
      <PfbbMigrationBanner
        orphanCount={0}
        sourceWorkAreaNames={[]}
        onMigrate={() => {}}
        onDismiss={() => {}}
        isMigrating={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title, count, and source work-area names", () => {
    render(
      <PfbbMigrationBanner
        orphanCount={2}
        sourceWorkAreaNames={["Beton", "Tag"]}
        onMigrate={() => {}}
        onDismiss={() => {}}
        isMigrating={false}
      />,
    );
    expect(
      screen.getByText(/Non-standard PFBB placement detected/),
    ).toBeTruthy();
    const bannerText =
      screen.getByTestId("pfbb-migration-banner").textContent ?? "";
    expect(bannerText).toContain("2 PFBB masters");
    expect(bannerText).toContain("'Beton' and 'Tag'");
    expect(bannerText).toContain("Projektfælles bygningsdelsbeskrivelser");
  });

  it("uses singular grammar for exactly one orphan in one work area", () => {
    render(
      <PfbbMigrationBanner
        orphanCount={1}
        sourceWorkAreaNames={["Beton"]}
        onMigrate={() => {}}
        onDismiss={() => {}}
        isMigrating={false}
      />,
    );
    const body = screen.getByTestId("pfbb-migration-banner").textContent;
    expect(body).toContain("1 PFBB master");
    expect(body).toContain("lives in regular work area");
    expect(body).not.toContain("masters");
  });

  it("calls onMigrate when 'Move them now' is clicked", () => {
    const onMigrate = vi.fn();
    render(
      <PfbbMigrationBanner
        orphanCount={1}
        sourceWorkAreaNames={["Beton"]}
        onMigrate={onMigrate}
        onDismiss={() => {}}
        isMigrating={false}
      />,
    );
    fireEvent.click(screen.getByTestId("pfbb-migration-banner-move"));
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when 'Not now' is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <PfbbMigrationBanner
        orphanCount={3}
        sourceWorkAreaNames={["A", "B"]}
        onMigrate={() => {}}
        onDismiss={onDismiss}
        isMigrating={false}
      />,
    );
    fireEvent.click(screen.getByTestId("pfbb-migration-banner-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while migrating and shows 'Moving…' label", () => {
    render(
      <PfbbMigrationBanner
        orphanCount={2}
        sourceWorkAreaNames={["Beton"]}
        onMigrate={() => {}}
        onDismiss={() => {}}
        isMigrating={true}
      />,
    );
    const moveBtn = screen.getByTestId(
      "pfbb-migration-banner-move",
    ) as HTMLButtonElement;
    const dismissBtn = screen.getByTestId(
      "pfbb-migration-banner-dismiss",
    ) as HTMLButtonElement;
    expect(moveBtn.disabled).toBe(true);
    expect(dismissBtn.disabled).toBe(true);
    expect(moveBtn.textContent).toBe("Moving…");
  });

  it("omits the work-area list when no names were supplied (all null)", () => {
    render(
      <PfbbMigrationBanner
        orphanCount={1}
        sourceWorkAreaNames={[]}
        onMigrate={() => {}}
        onDismiss={() => {}}
        isMigrating={false}
      />,
    );
    // No colon-separated list; still mentions "regular work area".
    const body = screen.getByTestId("pfbb-migration-banner").textContent ?? "";
    expect(body).toContain("regular work area");
    expect(body).not.toContain("'"); // no quoted names in the list
  });
});
