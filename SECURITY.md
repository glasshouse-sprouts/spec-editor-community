# Security Policy

## Reporting a vulnerability

Please report security issues **privately** - do not open a public issue.

Email **info@3dbyggeri.dk** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- the version / commit you tested.

We will acknowledge your report as soon as we can, keep you updated on progress,
and credit you when a fix ships (unless you prefer to remain anonymous).

## Supported versions

Security fixes are applied to the most recent release and to `main`; older
releases are not patched separately. Please test against the current `main`
before reporting.

## Scope

The application runs locally and opens `.moliospec` files (gzipped SQLite). The
file format is treated as untrusted input - reports about parsing, decompression,
or file-handling that could harm a user opening a malicious file are especially
welcome.
