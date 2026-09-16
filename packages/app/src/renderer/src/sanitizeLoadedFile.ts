/**
 * sanitizeLoadedFile — slice #233 Session 2 (round 8 prep).
 *
 * Run every section body through DOMPurify once on load so what we
 * render equals what we'd write. Non-destructive: unchanged bodies
 * come back as the same string so downstream byte-for-byte
 * comparisons still work.
 *
 * Extracted from App.tsx so `useFileState` (and the existing
 * `usePfbbOrphanMigration`) can share one definition.
 */

import type { FilePayload, SectionData } from "../../shared/ipc.js";
import { sanitizeBody } from "./sanitizeBody.js";

export function sanitizeLoadedFile(data: FilePayload): FilePayload {
  const rewrite = (s: SectionData): SectionData => {
    const cleaned = sanitizeBody(s.body);
    return cleaned === s.body ? s : { ...s, body: cleaned };
  };
  const rewriteRecord = (
    m: Record<number, SectionData[]>,
  ): Record<number, SectionData[]> => {
    const out: Record<number, SectionData[]> = {};
    for (const k of Object.keys(m)) {
      const id = Number(k);
      out[id] = m[id]!.map(rewrite);
    }
    return out;
  };
  return {
    ...data,
    sectionsByWorkSpec: rewriteRecord(data.sectionsByWorkSpec),
    sectionsByBdb: rewriteRecord(data.sectionsByBdb),
  };
}
