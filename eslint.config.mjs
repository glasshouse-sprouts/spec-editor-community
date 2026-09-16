// ESLint flat config (ESLint 10) for the Molio 2.0 monorepo.
//
// Scope (moderate, decided 2026-06-13):
//   - Lints TypeScript/TSX source in all three packages, plus the `.mjs`
//     build scripts.
//   - typescript-eslint "recommended" WITHOUT type-checking, so it stays
//     fast and the first run isn't drowning in noise on already-clean code.
//   - react-hooks rules on the renderer (catch real bugs: conditional hooks,
//     stale deps).
//   - eslint-config-prettier last, so ESLint never fights Prettier over
//     formatting (Prettier owns layout; ESLint owns correctness).
//
// A few rules are tuned so the baseline is 0 errors (CI-able). The remaining
// warnings (unused vars, exhaustive-deps) are a real but non-blocking
// clean-up backlog — tackled opportunistically once git is in place, and
// alongside the file-size work (punkt 6b).
//
// Not linted (deliberate): `*.cjs` Node scripts, generated bundles, dist/out,
// deploy tree, and the throwaway `_probe_*.mjs` scratch files.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // What ESLint should never look at.
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "packages/mcp-server/deploy/**",
      "**/coverage/**",
      "**/*.config.*.mjs", // cached electron-vite / vitest configs
      "**/*.cjs", // Node CJS build + helper scripts (not linted yet)
      "**/_probe_*.mjs", // throwaway dev probe scripts
    ],
  },

  // Base rule sets.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Everything runs under Node (the `.mjs` scripts, the app's main + preload,
  // core, mcp-server). Applies to all files; the renderer adds browser on top.
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Project-wide rule tunings.
  {
    rules: {
      // The codebase deliberately uses control-character ranges in regexes to
      // strip them out of untrusted filenames / input. That's the intent, not
      // an accidental control char — so this rule would be a false positive.
      "no-control-regex": "off",
      // Real but low-priority "value assigned then never read" findings. Keep
      // visible as a warning; fix opportunistically (deferred until git).
      "no-useless-assignment": "warn",
    },
  },

  // TypeScript-specific tunings.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Allow intentionally-unused names prefixed with `_` (e.g. `_event`,
      // `_enc`), which the codebase already uses for ignored callback args.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // An empty interface that only extends one type is a valid nominal
      // alias, used intentionally in the IPC types.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },

  // The renderer runs in the browser and uses React hooks.
  {
    files: ["packages/app/src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Must stay last: disables every formatting-related lint rule so Prettier
  // is the single source of truth for layout.
  prettier,
);
