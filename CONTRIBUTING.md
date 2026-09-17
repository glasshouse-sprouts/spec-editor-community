# Contributing

Thanks for your interest in improving Spec Editor.

## How this repository works

This public repository is a **generated snapshot** of an internal canonical
source tree. We develop in the canonical source and periodically export a clean
public version here. Practically, that means:

- **Issues are very welcome** - bug reports, reproduction steps, and feature
  ideas all help and are the best way to influence the project.
- **Pull requests are welcome for focused fixes** (bugs, docs, small
  improvements). Because the canonical source lives elsewhere, an accepted
  change is integrated upstream by a maintainer and then appears here on the
  next sync - so your PR may be merged "indirectly" rather than with a normal
  merge button. We will always credit the contribution.
- For larger changes, please **open an issue first** so we can agree on the
  approach before you invest time.

## Development setup

See [README.md](README.md) for prerequisites and how to run, test and
type-check the app.

Before opening a PR, please make sure:

- `npm test` passes,
- `npm run typecheck` is clean,
- `npm run lint` reports no new errors, and
- code is formatted with Prettier (`npm run format`).

### One thing to know before you build an installer

`npm run dev` is unaffected by this, but an installer you build from this
repository keeps the `publish` configuration that points at our GitHub
releases. On Windows it will update itself to the next official release,
replacing whatever you built. On macOS it cannot replace your build, because
macOS refuses an update that does not satisfy the installed app's own code
requirement - but it keeps downloading the release and reporting the failure in
the About panel. If you are building often while working on a change, neither
is what you want.

Delete the `publish` block from `packages/app/electron-builder.yml` in your
working copy. Leave it out of any patch you send us: the block is what makes
the official release self-updating for everyone else.

## Code style

- TypeScript throughout; the shared `core` package is UI- and Electron-free.
- Formatting is enforced by Prettier; linting by ESLint. Keep changes focused
  and avoid unrelated reformatting.
- Write tests for behaviour changes - the suite is a first-class part of the
  codebase.

## Reporting security issues

Please do **not** open a public issue for security problems. See
[SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
