/**
 * Slice "Highlights & formatting" — tab body.
 *
 * Lists every user-applied 6L.1 formatting run (4 highlight
 * backgrounds + 4 text colors) across every section in the project,
 * grouped by mark kind. Each row has two affordances:
 *   - Click the text → switch to the section's tab AND set a
 *     pendingScroll directive so the SectionEditor scrolls to the
 *     specific run + flashes it briefly. (Option A from the
 *     planning notes.)
 *   - Click the preview icon on the right → open
 *     SectionPreviewModal as an overlay; it shows the section
 *     read-only with an "Edit here" button that closes the preview
 *     and routes through the same pendingScroll path. (Option B-2.)
 *
 * Originally a modal (HighlightsModal); promoted to a tab on
 * 2026-04-26 so the list survives navigation between sections.
 * Closeable like any non-project tab; re-opens via the Highlighter
 * icon in the top header.
 */

import { useMemo, useState } from "react";
import { Eye as EyeIcon } from "lucide-react";

import {
  ALL_MARK_KINDS,
  BG_MARK_KINDS,
  TC_MARK_KINDS,
  type MarkKind,
} from "./highlights/markKinds.js";
import {
  type Highlight,
  type HighlightLocation,
  truncateForDisplay,
} from "./highlights/findHighlights.js";
import { useT } from "./i18n/i18n.js";
import { SectionPreviewModal } from "./modals/SectionPreviewModal.js";

interface HighlightsViewProps {
  highlights: ReadonlyArray<Highlight>;
  /** Build the breadcrumb (Work area / BDB / Section …) for a row. */
  describeLocation: (loc: HighlightLocation) => string;
  /**
   * Look up the section's heading + body for the preview modal.
   * Returns null when the section can't be resolved (missing data
   * after a stale-tab race) so the row's preview button just no-ops.
   */
  resolveSection: (
    loc: HighlightLocation,
  ) => { heading: string; body: string; sectionNo: number } | null;
  /**
   * Click-to-jump handler for the row's text. App.tsx routes to
   * `openOrFocusTab` + sets pendingScroll for the destination tab.
   */
  onJumpTo: (h: Highlight) => void;
}

/** Group highlights by kind, preserving the canonical kind order. */
function groupByKind(
  highlights: ReadonlyArray<Highlight>,
): Map<MarkKind, Highlight[]> {
  const buckets = new Map<MarkKind, Highlight[]>();
  for (const k of ALL_MARK_KINDS) buckets.set(k, []);
  for (const h of highlights) {
    buckets.get(h.markKind)?.push(h);
  }
  return buckets;
}

export function HighlightsView({
  highlights,
  describeLocation,
  resolveSection,
  onJumpTo,
}: HighlightsViewProps): JSX.Element {
  const t = useT();
  const groups = useMemo(() => groupByKind(highlights), [highlights]);
  const totalCount = highlights.length;

  // Local state — which highlight is currently being previewed.
  // Identified by index into the flat list so resolveSection can
  // re-derive the section content. `null` = preview closed.
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const previewHighlight =
    previewIdx != null ? (highlights[previewIdx] ?? null) : null;
  const previewSection = previewHighlight
    ? resolveSection(previewHighlight.location)
    : null;

  return (
    // `.main-pane__scroll` is the standard outer wrapper used by every
    // other single-column tab body (workSpec / bdb / controlPlan). It's
    // a `flex: 1` block that fills the available width inside the
    // flex-based `.main-pane` host — without it, this tab's content
    // div collapses to its natural width and `margin: 0 auto` becomes
    // a no-op (centring inside a 0-extra-space container).
    <div className="main-pane__scroll">
      <div
        style={{
          // Comfortable reading width for a list of snippet+breadcrumb
          // rows. The 980 we tried first was too wide; the previous
          // collapsed-to-content render was too narrow. ~720 sits in
          // the readable-column range that documents and chat UIs use.
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h2 style={{ marginTop: 0 }}>
          {t("highlights.modal.title")}{" "}
          <span style={{ opacity: 0.6, fontWeight: 400 }}>({totalCount})</span>
        </h2>
        {totalCount === 0 ? (
          <p style={{ opacity: 0.65, fontStyle: "italic" }}>
            {t("highlights.modal.empty")}
          </p>
        ) : (
          <>
            <HighlightGroupSection
              title={t("highlights.modal.group.backgrounds")}
              kinds={BG_MARK_KINDS}
              groups={groups}
              t={t}
              describeLocation={describeLocation}
              onJumpTo={onJumpTo}
              onPreview={(h) => {
                const idx = highlights.indexOf(h);
                if (idx >= 0) setPreviewIdx(idx);
              }}
            />
            <HighlightGroupSection
              title={t("highlights.modal.group.textColors")}
              kinds={TC_MARK_KINDS}
              groups={groups}
              t={t}
              describeLocation={describeLocation}
              onJumpTo={onJumpTo}
              onPreview={(h) => {
                const idx = highlights.indexOf(h);
                if (idx >= 0) setPreviewIdx(idx);
              }}
            />
          </>
        )}
      </div>

      {previewHighlight && previewSection && (
        <SectionPreviewModal
          heading={previewSection.heading}
          sectionNo={previewSection.sectionNo}
          bodyHtml={previewSection.body}
          breadcrumb={describeLocation(previewHighlight.location)}
          onEditHere={() => {
            const h = previewHighlight;
            setPreviewIdx(null);
            onJumpTo(h);
          }}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </div>
  );
}

interface HighlightGroupSectionProps {
  title: string;
  kinds: ReadonlyArray<MarkKind>;
  groups: Map<MarkKind, Highlight[]>;
  t: (key: string, params?: Record<string, string | number>) => string;
  describeLocation: (loc: HighlightLocation) => string;
  onJumpTo: (h: Highlight) => void;
  onPreview: (h: Highlight) => void;
}

function HighlightGroupSection({
  title,
  kinds,
  groups,
  t,
  describeLocation,
  onJumpTo,
  onPreview,
}: HighlightGroupSectionProps): JSX.Element | null {
  const total = kinds.reduce((acc, k) => acc + (groups.get(k)?.length ?? 0), 0);
  if (total === 0) return null;
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h3
        style={{
          fontSize: "0.875rem",
          fontWeight: 600,
          opacity: 0.75,
          marginBottom: "0.5rem",
          borderBottom: "1px solid rgba(0,0,0,0.1)",
          paddingBottom: "0.25rem",
        }}
      >
        {title} <span style={{ opacity: 0.6, fontWeight: 400 }}>({total})</span>
      </h3>
      {kinds.map((k) => {
        const items = groups.get(k) ?? [];
        if (items.length === 0) return null;
        return (
          <KindBlock
            key={k}
            kind={k}
            items={items}
            t={t}
            describeLocation={describeLocation}
            onJumpTo={onJumpTo}
            onPreview={onPreview}
          />
        );
      })}
    </section>
  );
}

interface KindBlockProps {
  kind: MarkKind;
  items: Highlight[];
  t: (key: string, params?: Record<string, string | number>) => string;
  describeLocation: (loc: HighlightLocation) => string;
  onJumpTo: (h: Highlight) => void;
  onPreview: (h: Highlight) => void;
}

function KindBlock({
  kind,
  items,
  t,
  describeLocation,
  onJumpTo,
  onPreview,
}: KindBlockProps): JSX.Element {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div
        style={{
          fontSize: "0.8125rem",
          fontWeight: 500,
          marginBottom: "0.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <ColorSwatch kind={kind} />
        <span>{t(`highlights.kind.${kind}`)}</span>
        <span style={{ opacity: 0.6, fontWeight: 400 }}>({items.length})</span>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
        }}
      >
        {items.map((h, idx) => (
          <li
            key={`${h.markKind}-${idx}`}
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: "0.25rem",
            }}
          >
            <button
              type="button"
              onClick={() => onJumpTo(h)}
              style={{
                flex: 1,
                textAlign: "left",
                padding: "0.375rem 0.5rem",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "0.125rem",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.04)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ fontSize: "0.875rem" }}>
                {truncateForDisplay(h.text) || (
                  <em style={{ opacity: 0.6 }}>
                    {t("highlights.modal.emptyRun")}
                  </em>
                )}
              </span>
              <span style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                {describeLocation(h.location)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onPreview(h)}
              className="icon-button"
              aria-label={t("highlights.row.preview")}
              title={t("highlights.row.preview")}
              style={{
                width: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
                opacity: 0.7,
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                e.currentTarget.style.opacity = "1";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.opacity = "0.7";
              }}
            >
              <EyeIcon size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorSwatch({ kind }: { kind: MarkKind }): JSX.Element {
  const isBg = kind.startsWith("bg-");
  const tone = kind.slice(3);
  const hex =
    tone === "yellow"
      ? "#fff26b"
      : tone === "blue"
        ? "#9ed6ff"
        : tone === "red"
          ? "#ff8b8b"
          : "#b7f0a3";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: 3,
        background: isBg ? hex : "transparent",
        border: isBg ? "1px solid rgba(0,0,0,0.15)" : `2px solid ${hex}`,
        boxSizing: "border-box",
      }}
    />
  );
}
