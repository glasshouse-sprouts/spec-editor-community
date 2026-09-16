/**
 * Vitest setup: force the i18n locale to English for all tests.
 *
 * Existing tests assert on English UI strings (e.g. "Edit metadata…"
 * "Delete BDB…"). The runtime default locale is Danish, which would
 * make those assertions fail. Pinning the test locale to English
 * keeps tests stable while letting end-users see Danish by default.
 *
 * To test Danish copy specifically, a test can call
 * `setLocale("da")` from `i18n.ts` in its own setup.
 */

import { setLocale } from "../src/renderer/src/i18n/i18n.js";

setLocale("en");
