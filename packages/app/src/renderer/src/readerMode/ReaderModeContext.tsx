/**
 * React context for Reader mode (Læsetilstand).
 *
 * Wrapping the app tree in `<ReaderModeProvider value={readerMode}>`
 * lets every edit-capable component read the current state via
 * `useReaderMode()` without threading a boolean prop through every
 * layer.
 *
 * Default value `false` keeps the editor fully editable when no
 * provider is present (e.g. unit tests that mount a single
 * subtree). Components opt in by calling the hook; ones that don't
 * call it stay editable, which matches the pre-RM behaviour.
 *
 * Convention: callers use the hook in render and AT THE TOP of any
 * edit-trigger handler:
 *
 *   const readerMode = useReaderMode();
 *   const handleEdit = useCallback(() => {
 *     if (readerMode) return;
 *     // ...real work
 *   }, [readerMode]);
 *
 * Visual disabling (e.g. `disabled={readerMode}`) layers on top so
 * users see WHY the action does nothing.
 */

import { createContext, useContext } from "react";

const ReaderModeContext = createContext<boolean>(false);

/** Wrap the app (or a test subtree) in this to make `useReaderMode`
 *  return the supplied value. */
export const ReaderModeProvider = ReaderModeContext.Provider;

/** Read the current reader-mode flag. Returns `false` outside any
 *  provider — components keep their old behaviour. */
export function useReaderMode(): boolean {
  return useContext(ReaderModeContext);
}
