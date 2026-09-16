/**
 * SectionMenuController — slice #233 Session 2.
 *
 * Owns the section right-click menu + the four modals it can open
 * (Add subsection / Add sibling at end / Rename / Delete). State
 * was previously inline in App.tsx alongside ~140 lines of IIFE
 * JSX; consolidating into a single component shrinks App.tsx and
 * keeps the menu/modal flow self-documenting.
 *
 * App.tsx interacts via:
 *   1. The `ref`'s imperative `open(specKind, specId, sectionId, coords)`
 *      method — called when the TOC fires `onSectionContextMenu`.
 *   2. Props: `data` (current FilePayload, for section lookups),
 *      `compactView` + `setCompactView` (auto-disable on add to
 *      keep newly-empty sections visible), `setEdits` (stage
 *      section-hierarchy patches).
 *
 * The component renders nothing when no menu / modal is open.
 */

import {
  forwardRef,
  useImperativeHandle,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { FilePayload, SectionData } from "../../shared/ipc.js";
import {
  type EditMap,
  stageSectionCreate,
  stageSectionDelete,
  stageSectionRename,
} from "./edits.js";
import { useT } from "./i18n/i18n.js";
import { SectionContextMenu } from "./SectionContextMenu.js";
import {
  AddSectionModal,
  DeleteSectionConfirmModal,
  RenameSectionModal,
} from "./SectionHierarchyModals.js";

interface SectionHierarchyTarget {
  specKind: "workSpec" | "bdb";
  specId: number;
  sectionId: number;
}

interface MenuState extends SectionHierarchyTarget {
  coords: { x: number; y: number };
}

interface ModalState extends SectionHierarchyTarget {
  kind: "addUnder" | "addAfter" | "rename" | "delete";
}

export interface SectionMenuRef {
  /** Open the right-click menu at the given coords for the
   *  identified section. */
  open: (
    specKind: "workSpec" | "bdb",
    specId: number,
    sectionId: number,
    coords: { x: number; y: number },
  ) => void;
}

interface Props {
  data: FilePayload;
  /** Currently-effective compact-view flag. We auto-disable
   *  when the user adds a new section so the (empty) section
   *  stays visible after save + reload. */
  compactView: boolean;
  setCompactView: (v: boolean) => void;
  /** Stage section-hierarchy patches into the edit buffer. */
  setEdits: Dispatch<SetStateAction<EditMap>>;
}

export const SectionMenuController = forwardRef<SectionMenuRef, Props>(
  function SectionMenuController(
    { data, compactView, setCompactView, setEdits },
    ref,
  ): JSX.Element | null {
    const t = useT();
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [modal, setModal] = useState<ModalState | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        open: (specKind, specId, sectionId, coords) => {
          setMenu({ specKind, specId, sectionId, coords });
        },
      }),
      [],
    );

    const closeMenu = (): void => setMenu(null);
    const closeModal = (): void => setModal(null);

    if (!menu && !modal) return null;

    return (
      <>
        {menu && renderMenu(menu, data, setModal, closeMenu, t)}
        {modal &&
          renderModal(
            modal,
            data,
            compactView,
            setCompactView,
            setEdits,
            closeModal,
            t,
          )}
      </>
    );
  },
);

// ---- Menu rendering -------------------------------------------------

function renderMenu(
  menu: MenuState,
  data: FilePayload,
  setModal: (m: ModalState) => void,
  closeMenu: () => void,
  t: (key: string, params?: Record<string, string | number>) => string,
): JSX.Element {
  const sections = sectionsForTarget(data, menu.specKind, menu.specId);
  const section = sections.find((s) => s.id === menu.sectionId);
  const label = section
    ? `${section.sectionNo ?? ""}  ${section.heading ?? ""}`.trim()
    : t("sectionMenu.unknownSection");
  return (
    <SectionContextMenu
      top={menu.coords.y}
      left={menu.coords.x}
      sectionLabel={label}
      onAddSubsection={() => setModal({ ...menu, kind: "addUnder" })}
      onAddSiblingAfter={() => setModal({ ...menu, kind: "addAfter" })}
      onRename={() => setModal({ ...menu, kind: "rename" })}
      onDelete={() => setModal({ ...menu, kind: "delete" })}
      onClose={closeMenu}
    />
  );
}

// ---- Modal rendering ------------------------------------------------

function renderModal(
  modal: ModalState,
  data: FilePayload,
  compactView: boolean,
  setCompactView: (v: boolean) => void,
  setEdits: Dispatch<SetStateAction<EditMap>>,
  closeModal: () => void,
  t: (key: string, params?: Record<string, string | number>) => string,
): JSX.Element | null {
  const sections = sectionsForTarget(data, modal.specKind, modal.specId);
  const section = sections.find((s) => s.id === modal.sectionId);
  if (!section) {
    // Section disappeared (stale state). Bounce out.
    closeModal();
    return null;
  }
  const sectionLabel =
    `${section.sectionNo ?? ""}  ${section.heading ?? ""}`.trim();
  const labelOrFallback = sectionLabel || t("sectionMenu.thisSectionFallback");
  const compactSuffix = compactView ? t("modal.addSection.compactSuffix") : "";

  // Common helper used by both Add modes — auto-disable compact view
  // so the freshly-inserted (empty-body) section stays visible after
  // save + reload. The user can re-enable once they've added content.
  const stageAdd = (parentId: number | null, heading: string): void => {
    setEdits((m) =>
      stageSectionCreate(m, {
        specKind: modal.specKind,
        specId: modal.specId,
        parentId,
        insertAfterSectionNo: null,
        heading,
      }),
    );
    if (compactView) setCompactView(false);
    closeModal();
  };

  if (modal.kind === "addUnder") {
    return (
      <AddSectionModal
        description={
          t("modal.addSubsection.body", { sectionLabel: labelOrFallback }) +
          compactSuffix
        }
        onCancel={closeModal}
        onConfirm={(heading) => stageAdd(modal.sectionId, heading)}
      />
    );
  }
  if (modal.kind === "addAfter") {
    return (
      <AddSectionModal
        description={
          t("modal.addSiblingAfter.body", { sectionLabel: labelOrFallback }) +
          compactSuffix
        }
        onCancel={closeModal}
        onConfirm={(heading) => stageAdd(section.parentId ?? null, heading)}
      />
    );
  }
  if (modal.kind === "rename") {
    return (
      <RenameSectionModal
        description={t("modal.renameSection.body", {
          sectionLabel: labelOrFallback,
        })}
        initialHeading={section.heading ?? ""}
        onCancel={closeModal}
        onConfirm={(heading) => {
          setEdits((m) =>
            stageSectionRename(m, {
              specKind: modal.specKind,
              sectionId: modal.sectionId,
              heading,
              originalHeading: section.heading ?? "",
            }),
          );
          closeModal();
        }}
      />
    );
  }
  // Delete confirm — compute descendant + child-supplement counts.
  const descendantIds = collectDescendantIds(sections, modal.sectionId);
  const childSupplementCount =
    modal.specKind === "bdb"
      ? countChildSupplementsAffected(
          data,
          modal.specId,
          new Set([modal.sectionId, ...descendantIds]),
        )
      : 0;
  return (
    <DeleteSectionConfirmModal
      sectionLabel={labelOrFallback}
      descendantCount={descendantIds.length}
      childSupplementCount={childSupplementCount}
      onCancel={closeModal}
      onConfirm={() => {
        setEdits((m) =>
          stageSectionDelete(m, {
            specKind: modal.specKind,
            sectionId: modal.sectionId,
          }),
        );
        closeModal();
      }}
    />
  );
}

// ---- Helpers --------------------------------------------------------

function sectionsForTarget(
  data: FilePayload,
  specKind: "workSpec" | "bdb",
  specId: number,
): SectionData[] {
  return specKind === "workSpec"
    ? (data.sectionsByWorkSpec[specId] ?? [])
    : (data.sectionsByBdb[specId] ?? []);
}

/** Walk children depth-first; identical to the helper that used to
 *  live at the top of App.tsx. Inlined here so the controller is
 *  self-contained. */
function collectDescendantIds(
  sections: readonly SectionData[],
  rootId: number,
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const s of sections) {
    const p = s.parentId ?? -1;
    const list = childrenByParent.get(p);
    if (list) list.push(s.id);
    else childrenByParent.set(p, [s.id]);
  }
  const out: number[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    const kids = childrenByParent.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
}

/** Count child supplements that point at any section in the
 *  subtree being deleted. Only meaningful when the target BDB is
 *  a PFBB master with live children. */
function countChildSupplementsAffected(
  data: FilePayload,
  targetBdbId: number,
  subtreeIds: ReadonlySet<number>,
): number {
  const targetBdb = data.bdbs.find((b) => b.id === targetBdbId);
  if (!targetBdb?.isPfbb) return 0;
  let count = 0;
  for (const other of data.bdbs) {
    if (other.pfbbId !== targetBdb.id) continue;
    const childSections = data.sectionsByBdb[other.id] ?? [];
    for (const cs of childSections) {
      if (cs.pfbbSectionId != null && subtreeIds.has(cs.pfbbSectionId)) {
        count += 1;
      }
    }
  }
  return count;
}
