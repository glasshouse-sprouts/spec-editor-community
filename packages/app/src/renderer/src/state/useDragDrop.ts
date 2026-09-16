/**
 * Drag-drop state + handlers for the main window.
 *
 * Slice #233 Session 2 — extracted from App.tsx. Owns:
 *   - the visual "drag-over" highlight (set when files are being
 *     dragged over the window)
 *   - the "pending drop" confirm modal (when a file is dropped
 *     while another is already loaded)
 *   - the inline drop-error banner (e.g. "not a .moliospec file")
 *
 * The hook tracks drag depth in a ref so the highlight survives
 * dragenter/dragleave bouncing off child elements — Chromium fires
 * leave-then-enter when the drag pointer crosses a nested element.
 *
 * Dependencies the hook needs:
 *   - `isLoaded`: whether a file is currently open. When true, a
 *     drop opens a confirm modal; otherwise it loads directly.
 *   - `openPath(path)`: function to open a moliospec file. Comes
 *     from App.tsx's main file-open path.
 */

import type { DragEvent } from "react";
import { useRef, useState } from "react";

import { isMoliospecFile } from "../fileUtils.js";

interface PendingDrop {
  path: string;
  name: string;
}

export interface UseDragDropArgs {
  /** True when a file is currently open in the editor. Drops while
   *  loaded show a "close-and-open?" confirm; drops while idle just
   *  call `openPath` directly. */
  isLoaded: boolean;
  /** Open the given filesystem path. Wired from App.tsx. */
  openPath: (path: string) => Promise<void>;
}

export interface UseDragDropResult {
  /** True while the user is dragging files over the window. */
  isDraggingOver: boolean;
  /** Pending-drop confirm state — a file was dropped while another
   *  was loaded, the user must confirm before we close the current
   *  file and open the new one. */
  pendingDrop: PendingDrop | null;
  /** Inline error banner copy (e.g. "not a .moliospec file"). */
  dropError: string | null;
  /** Spread on the container that should accept drops. */
  dragHandlers: {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => void;
  };
  /** User clicked "Open" on the pending-drop confirm. */
  confirmPendingDrop: () => void;
  /** User clicked "Cancel" on the pending-drop confirm. */
  cancelPendingDrop: () => void;
  /** User clicked the × on the inline error banner. */
  dismissDropError: () => void;
}

export function useDragDrop({
  isLoaded,
  openPath,
}: UseDragDropArgs): UseDragDropResult {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  // Drag depth counter — see module comment.
  const dragCounterRef = useRef(0);

  function onDragEnter(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current += 1;
    if (!isDraggingOver) setIsDraggingOver(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>): void {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    // If a child handler (e.g. the Import modal's drop zone) has
    // already called preventDefault on this event, treat the drop
    // as "handled by a child" — we still reset our own drag-state
    // (so the green highlight goes away), but we skip the
    // "open as project?" branch since the child has consumed the
    // file. Without this guard, dropping into the Import modal
    // would either (a) double-fire the open-as-project flow, or
    // (b) — if the child stopPropagation'd — leave our drag
    // highlight stuck on forever.
    const handledByChild = e.defaultPrevented;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    if (handledByChild) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const file = files[0]!;
    if (!isMoliospecFile(file.name)) {
      setDropError(
        `"${file.name}" is not a .moliospec file. Only .moliospec files can be opened.`,
      );
      return;
    }
    const path = window.molio.getPathForFile(file);
    if (!path) {
      setDropError(
        `Could not resolve a filesystem path for "${file.name}". Try using the Open file… button instead.`,
      );
      return;
    }
    setDropError(null);

    if (isLoaded) {
      setPendingDrop({ path, name: file.name });
    } else {
      void openPath(path);
    }
  }

  const confirmPendingDrop = (): void => {
    if (!pendingDrop) return;
    const p = pendingDrop.path;
    setPendingDrop(null);
    void openPath(p);
  };

  const cancelPendingDrop = (): void => setPendingDrop(null);
  const dismissDropError = (): void => setDropError(null);

  return {
    isDraggingOver,
    pendingDrop,
    dropError,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
    confirmPendingDrop,
    cancelPendingDrop,
    dismissDropError,
  };
}
