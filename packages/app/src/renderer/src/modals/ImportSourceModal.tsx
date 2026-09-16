/**
 * IMP-API — unified Import source picker.
 *
 * The user clicks the import icon in the top toolbar; this modal
 * opens with two source paths:
 *
 *   - **Browse Molio** — fetches the catalogue of `.moliospec`
 *     templates Molio publishes, lets the user free-text filter
 *     and multi-select rows, then downloads each selected file
 *     and feeds it into the existing Slice 6K import dialog.
 *
 *   - **Import a file** — opens the OS file picker, OR accepts a
 *     `.moliospec` file dragged onto the modal frame, and feeds
 *     the path into the same import dialog.
 *
 * After the user selects a source, this modal closes and the
 * existing `ImportModal` takes over via `importDialog` state. We
 * deliberately keep the two modals separate — the existing one
 * is large and well-tested, and wrapping it would just add
 * indirection. The transition is plain state in App.tsx.
 *
 * Multi-file from Browse Molio: when the user picks more than
 * one row and clicks "Load N", we download all selected files in
 * parallel, then call `onPickPath` for the first; the parent's
 * pending-import queue handles the remainder one-by-one.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import type { MolioListedFile } from "../../../shared/ipc.js";
import { useT } from "../i18n/i18n.js";
// Community edition: the Browse-Molio import tab is removed (local file only).
import { useEscToClose } from "./useEscToClose.js";

interface Props {
  /** User picked a source — close the modal and start the existing
   *  import flow with this path. Multiple paths are queued; the
   *  parent calls `requestWithPath` for the first and tracks the
   *  rest for follow-up imports. */
  onPickPaths: (paths: string[]) => void;
  /** User cancelled / closed without picking. */
  onClose: () => void;
}

type Tab = "browse" | "file";

export function ImportSourceModal({
  onPickPaths,
  onClose,
}: Props): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<Tab>("file");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  useEscToClose(busy ? () => undefined : onClose);

  // Drag-drop sensitivity on the entire modal body. A `.moliospec`
  // file dropped anywhere flows through the same path as the
  // "Choose file…" button.
  const [dragHover, setDragHover] = useState(false);
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    // NOTE: we do NOT call e.stopPropagation() here. The app-level
    // drop handler still needs to run so it can reset its own
    // drag-highlight state (the green "drop zone" overlay).
    // We rely on `e.defaultPrevented` (set by preventDefault above)
    // to signal "a child handled this drop" to the app handler,
    // which then skips its "open as project?" branch but still
    // clears the highlight. Earlier version of this fix used
    // stopPropagation and got it backwards: drop succeeded but
    // the green overlay was stuck visible forever.
    setDragHover(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // Electron exposes `webUtils.getPathForFile` (via the preload)
    // to extract the real filesystem path from a renderer-side
    // File object — Chromium 116+ removed `File.path`.
    const path = window.molio.getPathForFile(file);
    if (!path) {
      setErrorMsg(t("importSource.dropNoPath"));
      return;
    }
    onPickPaths([path]);
  };

  const handlePickFile = async (): Promise<void> => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const path = await window.molio.openFileDialog();
      if (path) onPickPaths([path]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-source-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        // Don't stopPropagation — the app-level handler needs
        // to see drag events to maintain its drag-counter state.
        // The visual collision (app green tint + modal drop
        // indicator) is harmless; both clear on drop.
        if (!busy) setDragHover(true);
      }}
      onDragLeave={() => setDragHover(false)}
      onDrop={(e) => void handleDrop(e)}
    >
      <div
        className={`import-source-modal${
          dragHover ? " import-source-modal--drop" : ""
        }`}
      >
        <header className="import-source-modal__header">
          <h2 id="import-source-title" className="import-source-modal__title">
            {t("importSource.title")}
          </h2>
          <button
            type="button"
            className="modal__button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
          >
            {t("common.close")}
          </button>
        </header>
        <nav className="import-source-modal__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "file"}
            className={`import-source-modal__tab${
              tab === "file" ? " import-source-modal__tab--active" : ""
            }`}
            onClick={() => setTab("file")}
          >
            {t("importSource.tab.file")}
          </button>
        </nav>
        <div className="import-source-modal__body">
          {tab === "file" && (
            <FilePickerTab
              onPickFile={() => void handlePickFile()}
              dragHover={dragHover}
              t={t}
              busy={busy}
              errorMsg={errorMsg}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  "Import a file" tab body                                          */
/* ------------------------------------------------------------------ */

function FilePickerTab({
  onPickFile,
  dragHover,
  t,
  busy,
  errorMsg,
}: {
  onPickFile: () => void;
  dragHover: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  busy: boolean;
  errorMsg: string | null;
}): JSX.Element {
  return (
    <div className="import-source-modal__file-tab">
      <p className="import-source-modal__hint">{t("importSource.file.hint")}</p>
      <div
        className={`import-source-modal__dropzone${
          dragHover ? " import-source-modal__dropzone--hover" : ""
        }`}
      >
        <p>{t("importSource.file.dropHere")}</p>
        <button
          type="button"
          className="modal__button modal__button--primary"
          onClick={onPickFile}
          disabled={busy}
        >
          {t("importSource.file.pickButton")}
        </button>
      </div>
      {errorMsg && <p className="import-source-modal__error">{errorMsg}</p>}
    </div>
  );
}

