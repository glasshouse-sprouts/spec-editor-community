/**
 * Subtle banner shown across the top of the app when Reader mode
 * is on.
 *
 * Renders nothing when reader mode is OFF — caller can drop it
 * unconditionally into the layout.
 *
 * Styling: a thin amber strip across the full width below the
 * top toolbar. Not a modal, not blocking — just enough to make
 * "I can't edit anything" non-mysterious. Matches the rest of
 * the app's banner / pill aesthetic (license pill, PFBB broken
 * supplements banner).
 */

import type { JSX } from "react";

import { useT } from "../i18n/i18n.js";
import { useReaderMode } from "./ReaderModeContext.js";

export function ReaderModeBanner(): JSX.Element | null {
  const t = useT();
  const readerMode = useReaderMode();
  if (!readerMode) return null;
  return (
    <div className="reader-mode-banner" role="status">
      <span className="reader-mode-banner__icon" aria-hidden="true">
        🔒
      </span>
      <span className="reader-mode-banner__text">{t("readerMode.banner")}</span>
    </div>
  );
}
