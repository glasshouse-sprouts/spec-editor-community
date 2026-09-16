/**
 * Ambient types so the renderer can see `window.molio` with the right shape.
 * Picked up by tsconfig.web.json via the src/shared/** include.
 */
import type { MolioBridge } from "./ipc.js";

declare global {
  interface Window {
    molio: MolioBridge;
  }
}

export {};
