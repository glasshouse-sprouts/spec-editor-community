/**
 * The About panel.
 *
 * Small, and the first thing a lot of people open. It answers three
 * questions: what is this, which version am I on, and am I up to date.
 *
 * Nothing here is written down twice. The product name, version,
 * edition and links all come from main (`appInfo.ts` + `edition.ts`),
 * so the version on screen is the version running - an About screen
 * with a hard-coded version is wrong the first time somebody forgets,
 * and stays wrong for months because nothing checks it.
 *
 * The update section is where the work from the update slice becomes
 * visible. Note what it does NOT have: a "download now" button. The
 * download is automatic and the install happens when the app next
 * quits, so the only thing to offer is an early restart - and even
 * that says no while there are unsaved edits.
 */

import { useState } from "react";

import type { AppInfo, UpdateState } from "../../../shared/ipc.js";
import { useT } from "../i18n/i18n.js";
import type { AppUpdater } from "../state/useAppUpdater.js";

import { useEscToClose } from "./useEscToClose.js";

interface AboutDialogProps {
  info: AppInfo | null;
  updater: AppUpdater;
  onClose: () => void;
}

/**
 * One line of plain language for whatever the updater is doing.
 *
 * Exported for tests: this mapping is the whole user-facing contract
 * of the update feature, and two of its states are easy to get wrong -
 * a build with no update channel is not a failure, and neither is
 * being offline.
 */
export function updateMessage(
  state: UpdateState,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "checking":
      return t("about.update.checking");
    case "upToDate":
      return t("about.update.upToDate");
    case "available":
      return t("about.update.available", { version: state.version });
    case "downloading":
      return t("about.update.downloading", { percent: state.percent });
    case "ready":
      return t("about.update.ready", { version: state.version });
    case "unsupported":
      return state.reason === "dev"
        ? t("about.update.devBuild")
        : t("about.update.unsupported");
    case "error":
      return state.message;
  }
}

export function AboutDialog({
  info,
  updater,
  onClose,
}: AboutDialogProps): JSX.Element {
  const t = useT();
  useEscToClose(onClose);
  // Set when the user asks to restart while holding unsaved edits.
  // Deliberately a message rather than a dialog on top of a dialog.
  const [unsaved, setUnsaved] = useState(false);

  const { state } = updater;
  const canRestart = state.kind === "ready";
  const busy = state.kind === "checking" || state.kind === "downloading";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2 id="about-dialog-title" className="modal__title">
          {info ? info.productName : t("about.title")}
        </h2>
        <div className="modal__body">
          {info && (
            <p className="about__version">
              {t("about.editionAndVersion", {
                edition: info.edition,
                version: info.version,
              })}
            </p>
          )}

          <p className="about__maker modal__muted">{t("about.maker")}</p>

          <section className="about__section" aria-labelledby="about-updates-h">
            <h3 id="about-updates-h" className="about__heading">
              {t("about.update.section")}
            </h3>
            {/* Says how updating works - but only in a build that
                actually does. Without it the button reads as "updates
                only happen if you press this", which is the opposite
                of the truth and exactly what the first person to see
                this panel asked.
                Hidden in EVERY unsupported state, not just a
                development run (Task 123). A packaged build without
                app-update.yml lands on reason "noChannel", and there
                this line sat two lines above "this edition does not
                update itself" - the panel contradicting itself in
                plain sight. Both reasons mean the same thing here:
                nothing updates, so do not describe how updating
                works. */}
            {state.kind !== "unsupported" && (
              <p className="about__hint modal__muted">
                {t("about.update.how")}
              </p>
            )}
            <p className="about__status">{updateMessage(state, t)}</p>
            {unsaved && (
              <p className="about__status modal__muted">
                {t("about.update.unsaved")}
              </p>
            )}
            <div className="about__buttons">
              <button
                type="button"
                className="modal__button"
                onClick={() => void updater.check()}
                disabled={busy || state.kind === "unsupported"}
              >
                {t("about.update.check")}
              </button>
              {canRestart && (
                <button
                  type="button"
                  className="modal__button modal__button--primary"
                  onClick={() => {
                    void (async () => {
                      const r = await updater.installNow();
                      setUnsaved(r.kind === "unsaved");
                    })();
                  }}
                >
                  {t("about.update.restart")}
                </button>
              )}
            </div>
          </section>

          {info && info.links.length > 0 && (
            <section className="about__section" aria-labelledby="about-links-h">
              <h3 id="about-links-h" className="about__heading">
                {t("about.links.section")}
              </h3>
              <ul className="about__links">
                {info.links.map((l) => (
                  <li key={l.url}>
                    {/* Plain anchors. Main routes http/https clicks out
                        to the system browser (see the window-open
                        handler in main/index.ts), so these open where
                        the user expects and never navigate the app
                        window away from itself. */}
                    <a className="about__link" href={l.url}>
                      {t(l.labelKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onClose}
          >
            {t("about.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
