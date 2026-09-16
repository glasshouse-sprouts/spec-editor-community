/**
 * Handler registration barrel.
 *
 * Each handler module under this folder calls `ipcMain.handle(...)`
 * at module top level — importing the module registers its handlers
 * as a side-effect. The `main/index.ts` entry point imports THIS
 * file once at startup to wire everything up.
 *
 * Order doesn't matter — `ipcMain.handle` is just a registry.
 *
 * Extracted from `main/index.ts` in slice #233-followup.
 */

import "./file.js";
import "./cp.js";
import "./bdb.js";
import "./contract.js";
import "./attachments.js";
import "./import.js";
import "./pdf.js";
import "./docx.js";
// Community edition: Molio API and MCP server handlers removed.
import "./preferences.js";
import "./cover.js";
