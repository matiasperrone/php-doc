# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A decompiled PHP manual CHM plus a dependency-free web viewer that replaces the Windows HTML Help
viewer. Two halves:

- **Decompiled CHM payload** (checked in, not hand-edited): `php_manual_en.hhp` (project),
  `php_manual_en.hhc` (TOC sitemap), `php_manual_en.hhk` (index sitemap), and `res/` — ~11.8k topic
  pages plus `res/images/` and `res/styles/`. `php_manual_en.chm` is gitignored (`*.chm`).
- **Viewer** (`viewer/`) + its generator (`build-viewer.php`).

## Commands

```bash
php build-viewer.php                 # regenerate viewer/data/*.js from the .hhp/.hhc/.hhk
php build-viewer.php --src=. --hhp=php_manual_en.hhp --out=viewer
php -S localhost:8000                # from the repo root, then open /viewer/index.html
```

There is no package.json, bundler, linter, or test suite — the viewer is hand-written ES2020 +
CSS served as-is. Verification is manual: rebuild, reload, exercise Contents / Index / Search.
The viewer also runs straight from `file://`.

## Data pipeline

`build-viewer.php` reads `[OPTIONS]` from the `.hhp` (Title, Default topic, Contents file, Index
file), parses both sitemaps, and writes three files to `viewer/data/`:

| File | Global | Shape |
| --- | --- | --- |
| `toc.js` | `window.CHM_TOC` | tree of `{n, h?, c?}` (name, href, children) |
| `index.js` | `window.CHM_INDEX` | flat sorted `{n, h}` |
| `meta.js` | `window.CHM_META` | `{title, home, tocSize, idxSize, built}` |

They are `.js` assigning globals rather than `.json` **on purpose**: `fetch()` is blocked under
`file://`, `<script src>` is not. Keep it that way.

Parsing quirks the code depends on (see the comments in `build-viewer.php`):

- HHC nests `<ul>` as a **sibling** of the parent `<li>`, so a DOM parse yields a flat tree. The
  parser scans tokens linearly with an explicit stack instead.
- The PhD-generated HHC opens its first `<ul>` with no preceding `<li>`; `unwrap()` drops the
  resulting anonymous bridge node so the tree starts at the first real chapter.
- The `.hhk` contains duplicates (deduped on name+href) and sitemaps are often windows-1252
  (`read_text()` transcodes to UTF-8).
- Hrefs are normalized relative to the CHM root, i.e. `res/function.array-map.html`.

## Viewer architecture (`viewer/`)

- `index.html` — markup plus **all UI strings**, held in `<template class="i18n">` blocks
  (`data-lang` / `data-locale` / `data-label`, body is a JSON object). Adding a language = copying
  a block and translating it.
- `app.js` — one IIFE, no modules or dependencies. On load it flattens `CHM_TOC` into `NODES`
  (`{n, h, kids, parent, depth}`) with `ORDER` (reading order, for Prev/Next) and `BY_HREF`.
- `app.css` — CSS custom properties on `:root`, dark palette under `:root[data-theme="dark"]`.
  Palette is php.net indigo (`#4f5b93` / `#8892bf`) by intent.

Things to know before editing `app.js`:

- `BASE = '../'` — the viewer resolves topics as `../res/...`, so `viewer/` must stay a sibling
  of `res/`.
- The tree renders **lazily** (`expand()` fills children on first open); rendering all 11,788
  nodes up front freezes the browser.
- `kindOf()` infers a page's type from php.net filename conventions
  (`function.*`, `class.*`, `book.*`, … and `pdo.query.html` → method when `class.pdo.html` exists).
  Every kind needs a matching `kind.<key>` string in *every* i18n block.
- `rank()` scores matches 0 exact / 1 prefix / 2 word boundary / 3 substring / 4 subsequence, with
  a dispersion cap so acronym-style queries don't match half the manual.
- State (open nodes, tab, theme, sidebar width, last topic, language) is persisted in
  `localStorage` under `chm.viewer`; the saved open-node set is discarded whenever `tocSize`
  changes, since node ids are positional.
- Current topic is mirrored to `location.hash`; the iframe `load` handler recovers in-content
  navigation, which silently no-ops cross-origin under `file://`.

## Conventions

- Code comments and CLI output are in **Spanish**; user-facing viewer strings go through `t()`,
  never inline. Match that when editing.
- Don't hand-edit `viewer/data/*.js` or anything under `res/` — regenerate instead.

## Deployment

`.github/workflows/deploy-manual.yml` publishes `./viewer` to GitHub Pages on push to `main`.
Note the mismatch: `res/` is not part of `publish_dir`, so `../res/...` links resolve outside the
published tree — check this before relying on the deployed site.

## Repo housekeeping

`LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `CODE_OF_CONDUCT.md` are boilerplate carried over
from an unrelated project (vue-hotel-datepicker) and describe npm/Vue workflows that do not exist
here. Treat them as stale, not as guidance.
