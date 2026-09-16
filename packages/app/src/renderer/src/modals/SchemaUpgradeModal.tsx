/**
 * Task 1 / M1 — the notice shown when an old file has been upgraded.
 *
 * Files written before schema 01.00.03 are upgraded to 01.00.04 when
 * the editor opens them. That is a real change to the user's document
 * and it cannot be undone, so it is not something to slip past them in
 * a banner: this dialog has to be clicked away.
 *
 * Three things it has to say, and it says all three:
 *   - the file is in an older format;
 *   - saving produces a NEW file, and the original is left alone;
 *   - for 01.00.00 files, control-plan links are not carried over.
 *
 * OK-only on purpose. There is nothing to decide here - the upgrade has
 * already happened in memory, and the user decides what to do with it by
 * choosing whether to save at all.
 */

import type { JSX } from "react";

import type { SchemaUpgradeInfo } from "../../../shared/ipc.js";
import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface Props {
  info: SchemaUpgradeInfo;
  /** Dismiss the notice. There is no other action. */
  onClose: () => void;
}

export function SchemaUpgradeModal({ info, onClose }: Props): JSX.Element {
  const t = useT();
  useEscToClose(onClose);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schema-upgrade-title"
    >
      <div className="modal">
        <h2 id="schema-upgrade-title" className="modal__title">
          {t("schemaUpgrade.title")}
        </h2>
        <p className="modal__body">
          {t("schemaUpgrade.body", {
            fromVersion: info.fromVersion,
            toVersion: info.toVersion,
          })}
        </p>
        <p className="modal__body">{t("schemaUpgrade.saveAs")}</p>
        {info.losesControlPlanLinks && (
          <p className="modal__body">{controlPlanText(t, info)}</p>
        )}
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onClose}
          >
            {t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The control-plan paragraph, in the three shapes it can take.
 *
 * The count matters to the reader: "one link was dropped" and "eleven
 * links were dropped" are different amounts of work to redo. And when
 * the file had none, saying so is kinder than a warning about something
 * that did not happen. The i18n layer has no plural support, so the
 * choice is made here rather than inside a template.
 */
function controlPlanText(
  t: (key: string, params?: Record<string, string | number>) => string,
  info: SchemaUpgradeInfo,
): string {
  if (info.droppedControlPlanLinks === 0) {
    return t("schemaUpgrade.controlPlans.none");
  }
  if (info.droppedControlPlanLinks === 1) {
    return t("schemaUpgrade.controlPlans.one");
  }
  return t("schemaUpgrade.controlPlans.many", {
    count: info.droppedControlPlanLinks,
  });
}
