/**
 * SPLIT-Merge (#248) — fill an empty target work area's sections
 * from a chosen source work area.
 *
 * Flow:
 *   1. Show the existing `ImportSourceModal` so the user picks a
 *      source moliospec (Molio standard via API, or a local file).
 *   2. Read the chosen source's work areas via `readImportSource`.
 *      If exactly one work area → auto-pick it. Otherwise show a
 *      small radio list.
 *   3. Single "Indlæs" click runs `fillEmptyWorkSpec` against the
 *      target on disk. Target keeps its identity; only sections
 *      come over.
 *
 * Scope decisions (locked with Tore 2026-06-12):
 *   - Target must be empty (0 sections). The empty check is
 *     enforced both client-side (we only show the entry point on
 *     empty work areas) and inside `fillEmptyWorkSpec` on the
 *     core side.
 *   - Source's own metadata (name, code, locked Molio GUIDs) does
 *     NOT travel. Target identity is preserved.
 *   - Source's BDBs and control plans are NOT brought over —
 *     this is a section-only fill. For full structure, use the
 *     regular Import flow.
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";

import type {
  FillEmptyWorkSpecResult,
  ImportSourceWorkArea,
} from "../../../shared/ipc.js";
import { useT } from "../i18n/i18n.js";
import { friendlyError } from "../i18n/friendlyError.js";
import { ImportSourceModal } from "./ImportSourceModal.js";
import { useEscToClose } from "./useEscToClose.js";

interface Props {
  /** The target work area's id (the empty one being filled). */
  targetWorkSpecId: number;
  /** Display label for the target — typically "S240.01 Vinduer…". */
  targetLabel: string;
  /** Path of the currently-open .moliospec (the target lives in here). */
  targetPath: string;
  /** The on-disk mtime the renderer last saw — used for the
   *  concurrency check inside `fillEmptyWorkSpec`. */
  storedMtimeMs: number;
  /** Called on successful fill — receives the new mtime so the
   *  renderer can update its state. */
  onSuccess: (mtimeMs: number, sectionsCopied: number) => void;
  /** User cancelled the whole flow. */
  onClose: () => void;
}

/** Internal step. We delegate step 1 to ImportSourceModal entirely
 *  and only render our own UI from step 2 onward. */
type Step = "pick-source" | "pick-workarea" | "applying";

export function FillFromStandardModal(props: Props): JSX.Element {
  const t = useT();
  const [step, setStep] = useState<Step>("pick-source");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [workAreas, setWorkAreas] = useState<ImportSourceWorkArea[] | null>(
    null,
  );
  const [chosenSourceWsId, setChosenSourceWsId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Esc closes from the workarea-pick + applying steps. The
  // pick-source step has its own Esc handling inside
  // ImportSourceModal.
  useEscToClose(step === "pick-source" ? () => undefined : props.onClose);

  // After source is picked, read its work areas.
  useEffect(() => {
    if (sourcePath == null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await window.molio.readImportSource({
          sourcePath,
        });
        if (cancelled) return;
        if (result.kind === "missing") {
          setErrorMsg(t("modal.fillFromStandard.errors.sourceMissing"));
          return;
        }
        const wsArr = result.summary.workAreas;
        if (wsArr.length === 0) {
          setErrorMsg(t("modal.fillFromStandard.errors.noWorkAreas"));
          return;
        }
        setWorkAreas(wsArr);
        if (wsArr.length === 1 && wsArr[0]) {
          setChosenSourceWsId(wsArr[0].id);
        }
        setStep("pick-workarea");
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            friendlyError(err, t("modal.fillFromStandard.errors.generic")),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourcePath, t]);

  const handleApply = async (): Promise<void> => {
    if (chosenSourceWsId == null || sourcePath == null) return;
    setStep("applying");
    setErrorMsg(null);
    try {
      const res: FillEmptyWorkSpecResult = await window.molio.fillEmptyWorkSpec(
        {
          path: props.targetPath,
          storedMtimeMs: props.storedMtimeMs,
          force: false,
          sourcePath,
          sourceWorkSpecId: chosenSourceWsId,
          targetWorkSpecId: props.targetWorkSpecId,
        },
      );
      if (res.kind === "ok") {
        props.onSuccess(res.mtimeMs, res.summary.sectionsCopied);
        return;
      }
      if (res.kind === "missing") {
        setErrorMsg(t("modal.fillFromStandard.errors.targetMissing"));
      } else if (res.kind === "source-missing") {
        setErrorMsg(t("modal.fillFromStandard.errors.sourceMissing"));
      } else if (res.kind === "conflict") {
        setErrorMsg(t("modal.fillFromStandard.errors.conflict"));
      } else {
        setErrorMsg(t("modal.fillFromStandard.errors.generic"));
      }
      setStep("pick-workarea");
    } catch (err) {
      setErrorMsg(
        friendlyError(err, t("modal.fillFromStandard.errors.generic")),
      );
      setStep("pick-workarea");
    }
  };

  // Step 1 — source picker: delegate to ImportSourceModal.
  if (step === "pick-source") {
    return (
      <ImportSourceModal
        onPickPaths={(paths) => {
          const first = paths[0];
          if (!first) return;
          setSourcePath(first);
        }}
        onClose={props.onClose}
      />
    );
  }

  // Step 2/3 — work-area pick + apply.
  const busy = step === "applying";
  const canApply = chosenSourceWsId != null && !busy;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal modal--wide">
        <h2 className="modal__title">{t("modal.fillFromStandard.title")}</h2>
        <div className="modal__body">
          <p className="modal__lead">
            {t("modal.fillFromStandard.target")}{" "}
            <strong>{props.targetLabel}</strong>
          </p>
          <p className="hint">{t("modal.fillFromStandard.bodyExplain")}</p>

          {workAreas && workAreas.length > 1 && (
            <div className="modal__field">
              <div className="modal__label">
                {t("modal.fillFromStandard.pickWorkAreaLabel")}
              </div>
              <ul className="fill-modal__wa-list">
                {workAreas.map((w) => (
                  <li key={w.id}>
                    <label>
                      <input
                        type="radio"
                        name="fill-from-standard-ws"
                        checked={chosenSourceWsId === w.id}
                        disabled={busy}
                        onChange={() => setChosenSourceWsId(w.id)}
                      />
                      <span>
                        {w.workAreaCode ? `${w.workAreaCode} ` : ""}
                        {w.workAreaName ?? ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {workAreas && workAreas.length === 1 && workAreas[0] && (
            <p className="modal__lead">
              {t("modal.fillFromStandard.sourceSingleWaPrefix")}{" "}
              <strong>
                {workAreas[0].workAreaCode
                  ? `${workAreas[0].workAreaCode} `
                  : ""}
                {workAreas[0].workAreaName ?? ""}
              </strong>
            </p>
          )}

          {errorMsg && <p className="modal__error">{errorMsg}</p>}
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button"
            onClick={props.onClose}
            disabled={busy}
          >
            {t("modal.fillFromStandard.cancel")}
          </button>
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={() => void handleApply()}
            disabled={!canApply}
          >
            {busy
              ? t("modal.fillFromStandard.applying")
              : t("modal.fillFromStandard.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
