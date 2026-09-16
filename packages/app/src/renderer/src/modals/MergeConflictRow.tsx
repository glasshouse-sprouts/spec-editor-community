/**
 * RELOAD-Merge — one conflict row in the Merge dialog.
 *
 * Shows the two versions side by side with word-level differences
 * coloured (each column highlights the words unique to it), and a
 * three-way choice: keep mine, keep the disk version, or edit a
 * merged draft. The draft starts from the user's version; section
 * bodies open the app's normal rich-text editor (SectionEditor —
 * the same inline formatting as everywhere else), short fields a
 * plain text input.
 */

import { useMemo, useState } from "react";
import type { JSX } from "react";

import { SectionEditor } from "../SectionEditor.js";
import { htmlDiffOneSide } from "../compare/htmlDiff.js";
import type { DiffFormat } from "../compare/versionCompareFormat.js";
import { useT } from "../i18n/i18n.js";
import type { MergeConflict } from "../mergeOnReload.js";

export type Resolution = "mine" | "theirs" | "custom";

/** Fixed diff styles for the side-by-side — deliberately independent
 *  of the user's version-compare settings so the merge UI is stable. */
const YOURS_FMT: DiffFormat = {
  bold: true,
  italic: false,
  strikethrough: false,
  underline: false,
  color: "#16a34a",
  background: "#dcfce7",
};
const DISK_FMT: DiffFormat = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  color: "#b45309",
  background: "#fef3c7",
};

/**
 * The merged-draft editor. Section bodies open the app's rich-text
 * editor (SectionEditor) — full inline formatting, same as the rest
 * of the app. Short fields get a plain text input.
 *
 * Uncontrolled — the initial value is captured once so neither
 * editor re-initialises on a parent re-render.
 */
function CustomDraftEditor({
  initialValue,
  isHtml,
  onChange,
}: {
  initialValue: string;
  isHtml: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const [initial] = useState(initialValue);
  if (!isHtml) {
    return (
      <input
        type="text"
        className="merge-conflict__draft-input"
        defaultValue={initial}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <SectionEditor initialHtml={initial} onChange={onChange} autoFocus />;
}

interface Props {
  conflict: MergeConflict;
  /** The chosen side, or undefined until the user picks. */
  resolution: Resolution | undefined;
  /** The current merged-draft value for this conflict, if any. */
  draft: string | undefined;
  onResolve: (r: Resolution) => void;
  onDraft: (value: string) => void;
}

export function MergeConflictRow({
  conflict,
  resolution,
  draft,
  onResolve,
  onDraft,
}: Props): JSX.Element {
  const t = useT();
  const isHtml = conflict.kind === "sectionBody";

  // Side-by-side: each column shows its own version, with the words
  // unique to that side highlighted.
  const yoursHtml = useMemo(
    () => htmlDiffOneSide(conflict.mine, conflict.theirs, YOURS_FMT),
    [conflict.mine, conflict.theirs],
  );
  const diskHtml = useMemo(
    () => htmlDiffOneSide(conflict.theirs, conflict.mine, DISK_FMT),
    [conflict.mine, conflict.theirs],
  );
  const emptyMarkup = `<p class="merge-conflict__empty">${t(
    "mergeModal.empty",
  )}</p>`;

  return (
    <div className="merge-conflict">
      <div className="merge-conflict__label">{conflict.label}</div>

      <div className="merge-conflict__compare">
        <div className="merge-conflict__col">
          <div className="merge-conflict__col-label merge-conflict__col-label--mine">
            {t("mergeModal.colYours")}
          </div>
          <div
            className="merge-conflict__col-body"
            dangerouslySetInnerHTML={{ __html: yoursHtml || emptyMarkup }}
          />
        </div>
        <div className="merge-conflict__col">
          <div className="merge-conflict__col-label merge-conflict__col-label--theirs">
            {t("mergeModal.colDisk")}
          </div>
          <div
            className="merge-conflict__col-body"
            dangerouslySetInnerHTML={{ __html: diskHtml || emptyMarkup }}
          />
        </div>
      </div>

      <div className="merge-conflict__choices">
        {(["mine", "theirs", "custom"] as const).map((side) => (
          <label key={side} className="merge-conflict__choice">
            <input
              type="radio"
              name={`merge-${conflict.key}`}
              checked={resolution === side}
              onChange={() => onResolve(side)}
            />
            <span>
              {side === "mine"
                ? t("mergeModal.keepMine")
                : side === "theirs"
                  ? t("mergeModal.keepTheirs")
                  : t("mergeModal.editDraft")}
            </span>
          </label>
        ))}
      </div>

      {resolution === "custom" && (
        <div className="merge-conflict__draft">
          <div className="merge-conflict__draft-hint">
            {t("mergeModal.draftHint")}
          </div>
          <CustomDraftEditor
            initialValue={draft ?? conflict.mine}
            isHtml={isHtml}
            onChange={onDraft}
          />
        </div>
      )}
    </div>
  );
}
