/**
 * Folder names the editor and the MCP server keep their files in,
 * and how a development run gets folders of its own.
 *
 * Why this lives in core
 * ----------------------
 * Two processes must agree on these names: the editor (`packages/app`)
 * writes its session lockfile into its userData folder, and the MCP
 * server (`packages/mcp-server`) reads it from there. Both also share
 * the MCP state file. `core` is the one package both depend on - the
 * same reason `paths.ts` lives here.
 *
 * The problem it solves (Task 192)
 * --------------------------------
 * The userData folder name was one fixed string for every run. A dev
 * app started with `npm run dev` therefore used the installed app's
 * real folder: its preferences, its session lockfile, its MCP
 * registration and its single-instance lock. Two dev apps from two git
 * worktrees shared one folder with each other as well.
 *
 * The rule
 * --------
 *   - Packaged app: the base name, unchanged. Moving it would lose
 *     every user's settings. The environment is not consulted.
 *   - Dev app: `<base>-dev-<profile>`. The profile comes from
 *     `MOLIO_EDITOR_DEV_PROFILE` and defaults to `default`, so two
 *     worktrees that set different profiles never share a folder.
 *   - MCP server: it cannot tell whether the editor it should talk to
 *     is packaged. It uses the dev folders only when
 *     `MOLIO_EDITOR_DEV_PROFILE` is set in its own environment.
 *
 * The base name itself ("GlasshouseSpec") stays at the two call sites,
 * because the Community export renames it there and only there.
 */

/** Environment variable that selects a dev profile. */
export const EDITOR_DEV_PROFILE_ENV = "MOLIO_EDITOR_DEV_PROFILE";

/** Profile a dev app uses when the variable is not set. */
export const DEFAULT_EDITOR_DEV_PROFILE = "default";

/** Folder name the MCP server's state file lives in (packaged). */
export const MCP_STATE_DIR = "molio-mcp-server";

// A profile becomes part of a folder name, so it must not be able to
// climb out of the app-data folder or carry a path separator.
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The dev profile named in `env`, or undefined when the variable is
 * unset or empty. Throws on a value that is not a plain folder-name
 * fragment, so a typo fails loudly instead of landing somewhere odd.
 */
export function readEditorDevProfile(
  env: Record<string, string | undefined>,
): string | undefined {
  const raw = env[EDITOR_DEV_PROFILE_ENV]?.trim();
  if (!raw) return undefined;
  if (!PROFILE_PATTERN.test(raw)) {
    throw new Error(
      `${EDITOR_DEV_PROFILE_ENV}="${raw}" is not a valid profile name. ` +
        "Use letters, digits, '.', '_' or '-' (max 64 characters).",
    );
  }
  return raw;
}

/**
 * The profile the editor itself runs with: undefined for a packaged
 * app, otherwise the named profile or the default one.
 */
export function editorDevProfile(
  isPackaged: boolean,
  env: Record<string, string | undefined>,
): string | undefined {
  if (isPackaged) return undefined;
  return readEditorDevProfile(env) ?? DEFAULT_EDITOR_DEV_PROFILE;
}

/** userData folder name for `profile` (undefined = packaged). */
export function editorUserDataDirName(
  base: string,
  profile: string | undefined,
): string {
  return profile === undefined ? base : `${base}-dev-${profile}`;
}

/** MCP state folder name for `profile` (undefined = packaged). */
export function mcpStateDirName(profile: string | undefined): string {
  return profile === undefined
    ? MCP_STATE_DIR
    : `${MCP_STATE_DIR}-dev-${profile}`;
}
