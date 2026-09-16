/**
 * Slice #41 — keyboard shortcuts cheat sheet.
 *
 * A simple modal listing every shortcut the app honours, grouped by
 * area. Opens via the Help menu (⌘? / Ctrl+/) and via a question-mark
 * keypress on the document.
 *
 * Modifier symbols are platform-aware: macOS shows ⌘ / ⇧ / ⌥;
 * Windows/Linux show "Ctrl" / "Shift" / "Alt". The platform value
 * comes from preload (`window.molio.platform`).
 *
 * Stateless wrt. settings — the parent owns the open/close flag and
 * passes `onClose`.
 */

import { useT } from "../i18n/i18n.js";
import { useEscToClose } from "./useEscToClose.js";

interface ShortcutsCheatSheetProps {
  onClose: () => void;
}

interface ShortcutRow {
  /** i18n key for the action label, e.g. `shortcuts.open`. */
  labelKey: string;
  /** Tokens to join; "Mod" expands to ⌘ on mac, "Ctrl" elsewhere. */
  combo: ReadonlyArray<string>;
}

interface ShortcutGroup {
  /** i18n key for the group header. */
  titleKey: string;
  rows: ReadonlyArray<ShortcutRow>;
}

/**
 * The full list of shortcuts the app honours, grouped for display.
 * Adding a new shortcut is a two-step change: wire the action +
 * append a row here so it shows up in the sheet.
 */
const GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    titleKey: "shortcuts.group.file",
    rows: [
      { labelKey: "shortcuts.open", combo: ["Mod", "O"] },
      { labelKey: "shortcuts.save", combo: ["Mod", "S"] },
      { labelKey: "shortcuts.saveAs", combo: ["Mod", "Shift", "S"] },
      { labelKey: "shortcuts.import", combo: ["Mod", "I"] },
      { labelKey: "shortcuts.export", combo: ["Mod", "E"] },
      { labelKey: "shortcuts.closeTab", combo: ["Mod", "W"] },
    ],
  },
  {
    titleKey: "shortcuts.group.navigation",
    rows: [{ labelKey: "shortcuts.tabSwitch", combo: ["Mod", "1–9"] }],
  },
  {
    titleKey: "shortcuts.group.app",
    rows: [
      { labelKey: "shortcuts.settings", combo: ["Mod", ","] },
      { labelKey: "shortcuts.shortcuts", combo: ["Mod", "/"] },
      { labelKey: "shortcuts.dismissModal", combo: ["Esc"] },
    ],
  },
];

/**
 * Translate "Mod" to the platform-appropriate modifier symbol /
 * label. Other tokens are passed through unchanged.
 */
function formatToken(token: string, isMac: boolean): string {
  if (token === "Mod") return isMac ? "⌘" : "Ctrl";
  if (token === "Shift") return isMac ? "⇧" : "Shift";
  if (token === "Alt") return isMac ? "⌥" : "Alt";
  return token;
}

export function ShortcutsCheatSheet({
  onClose,
}: ShortcutsCheatSheetProps): JSX.Element {
  const t = useT();
  const isMac = window.molio.platform === "darwin";
  useEscToClose(onClose);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-dialog-title"
      onClick={(e) => {
        // Click outside the modal body closes it. Inner clicks
        // bubble past the backdrop, so we check the target.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2 id="shortcuts-dialog-title" className="modal__title">
          {t("shortcuts.title")}
        </h2>
        <div className="modal__body">
          {GROUPS.map((g) => (
            <section
              key={g.titleKey}
              style={{ marginBottom: "1rem" }}
              aria-labelledby={`${g.titleKey}-h`}
            >
              <h3
                id={`${g.titleKey}-h`}
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                  opacity: 0.7,
                }}
              >
                {t(g.titleKey)}
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.labelKey}>
                      <td style={{ padding: "0.25rem 0", textAlign: "left" }}>
                        {t(r.labelKey)}
                      </td>
                      <td
                        style={{
                          padding: "0.25rem 0",
                          textAlign: "right",
                          fontFamily:
                            "ui-monospace, 'SF Mono', Menlo, monospace",
                          fontSize: "0.875rem",
                        }}
                      >
                        {r.combo
                          .map((tok) => formatToken(tok, isMac))
                          .join(isMac ? "" : "+")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="modal__button modal__button--primary"
            onClick={onClose}
          >
            {t("shortcuts.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
