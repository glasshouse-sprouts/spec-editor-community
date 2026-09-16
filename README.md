# Spec Editor Community

An open-source desktop application for viewing and editing construction
specification files (`.moliospec`). Built with Electron and TypeScript.

> This is the open-source Community edition of **bskriver**, the free desktop
> app for Molio 2.0 specifications published at [bskriver.dk](https://bskriver.dk).
> bskriver is free and stays free; there is no paid edition. The two differ in
> the six features listed below, not in price. This repository is generated
> from an internal canonical source; see CONTRIBUTING.md for how that affects
> contributions.

## Features

- Open, edit and save `.moliospec` files.
- Building element specifications, work areas, control plans, contracts and
  attachments - the full schema.
- RELOAD-Merge: safely reconcile in-editor edits with a file changed on disk.
- PDF and DOCX export, with the built-in automatic cover page.
- Reader mode (read-only viewing).
- Project-shared building element specifications (PFBB) support.
- Danish and English UI.

## What Community does not include

Six features of bskriver are not part of this repository. They fall in two
groups.

**Content owned by Molio.** These three cannot live in open source because the
content they show is Molio's. In bskriver they require signing in with a free
Glasshouse account AND an approved Molio licence for Beskrivelsesværktøj 2.0.
The licence is a matter between you and Molio.

1. Molio reference content (Basis, Vejledning, Referenceliste, Paradigme).
2. Molio's standard control plan.
3. Browse Molio (templates from Molio's library when importing).

**Our own work, kept out of the open source.** These three need no sign-in and
work in bskriver without a Glasshouse account.

4. The cover page tool (custom cover template). The automatic cover page IS
   included; only the tool for designing your own is not.
5. Compare versions / Revisions.
6. AI integration (MCP server).

"Load from standard specification" exists in both editions; only the
"Molio standard" source is missing here, a local file works in both.

## Requirements

- Node.js `^20.19` or `>=22.12`
- macOS or Windows (the app uses a native SQLite module, `better-sqlite3`,
  which is built for your platform on install)

## Getting started

```sh
npm install                          # installs deps + builds the native module
npm run build -w @molio2-editor/core # build the shared core package
npm run dev                          # launch the app in development
npm test                             # run the test suite
npm run typecheck                    # type-check all packages
```

Building installers is handled by electron-builder; see the `package` scripts in
`packages/app/package.json`.

### Builds you make yourself will update themselves

Official releases will be published on GitHub Releases, and the app updates
itself from there. Note that no release has been published yet - for now, a
build you make yourself is the only way to run this edition.

Once the first release is out, this matters to you: an installer you build from
this repository carries the same `publish` configuration, so it will behave the
same way. When we publish a newer version, your build downloads it and installs
it over your own changes on the next restart.

To opt out, delete the `publish` block from
`packages/app/electron-builder.yml` in your copy. The app then reports that it
does not update itself, which is the truth for that build.

## Project layout

- `packages/core` - file-format logic for `.moliospec` files (pure TypeScript,
  no Electron, no UI).
- `packages/app` - the Electron desktop application (main process + renderer).

### A note on the cover page seam

`packages/app/src/main/handlers/cover.ts`, `renderer/src/coverContext.ts`
and `renderer/src/CoverCard.tsx` (plus the cover types in `shared/ipc.ts`) are
the seam where the cover page tool plugs in. In this repository they are inert:
without the tool, `coverContext.ts` passes the PDF bytes through untouched and
the export uses the automatic cover page. They are kept so the shared code
stays identical across editions rather than being patched around.

## License

Apache License 2.0 - see [LICENSE](LICENSE).

This project is based on prior internal development; its public history starts
from a clean snapshot.
