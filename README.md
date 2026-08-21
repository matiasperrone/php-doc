# php-doc

The **PHP Manual** in Windows HTML Help (CHM) form, plus a self-contained HTML
viewer that reproduces the three-pane CHM experience — Contents / Index / Search
on the left, the page on the right — in any browser, on any OS, with no build
step and no dependencies.

The repository holds two things that are usually kept apart:

1. **The CHM material itself** — the sitemaps (`.hhp`, `.hhc`, `.hhk`) and the
   11,794 HTML pages under `res/`, exactly as rendered by
   [php/phd](https://github.com/php/phd).
2. **`viewer/`** — a static HTML/CSS/JS reader for that material, so you do not
   need Windows or an HTML Help control to browse it.

---

## Contents

| Path | Tracked | What it is |
|---|---|---|
| `php_manual_en.hhp` | yes | HTML Help *project*: title, default topic, window definition, and the full `[FILES]` list. |
| `php_manual_en.hhc` | yes | *Contents* sitemap — the hierarchical table of contents. |
| `php_manual_en.hhk` | yes | *Index* sitemap — the flat alphabetical index (11,796 entries). |
| `res/` | yes | 11,794 self-contained HTML pages (103 MB) + `res/styles/` and `res/images/`. Untouched PhD output. |
| `images/` | yes | Assets the manual's stylesheet requests from the site root — see [Known limitations](#known-limitations). |
| `php_manual_en.chm` | **no** (`.gitignore`) | The compiled help file. Build it yourself — see below. |
| `build-viewer.php` | yes | Generator: turns the sitemaps into JS data for the viewer. |
| `viewer/` | yes | The viewer: `index.html`, `app.css`, `app.js`, `data/*.js`. |

---

## Part 1 — Building the manual with PhD

The PHP manual is written in DocBook XML. [PhD](https://github.com/php/phd)
(*[PH]P based [D]ocBook renderer*) turns that XML into the output formats
php.net publishes, CHM among them. Producing a `.chm` is a two-stage job:
**PhD renders the CHM sources**, then **a help compiler packs them into the
binary `.chm`**.

### Requirements

- PHP 8.1+ with the `dom`, `libxml`, `xmlreader` and `sqlite3` extensions
- `git`
- For the final compile step: Microsoft **HTML Help Workshop** (`hhc.exe`),
  which is Windows-only — see [Compiling the `.chm`](#3-compile-the-chm)

### 1. Get the sources

The three repositories must be siblings, and the language checkout must be
named after its language code:

```shell
mkdir phpdoc && cd phpdoc
git clone https://github.com/php/doc-en en      # the English manual sources
git clone https://github.com/php/doc-base       # the build/validation tooling
git clone https://github.com/php/phd            # the renderer
```

For a translation, clone `doc-<lang>` into a directory named `<lang>`
(`doc-es` → `es`, `doc-pt_br` → `pt_br`, …).

### 2. Combine and render

`configure.php` validates the XML and merges the whole tree into one file,
`doc-base/.manual.xml`:

```shell
php doc-base/configure.php --with-lang=en
```

Then hand that file to PhD and ask for the `chm` format of the `PHP` package:

```shell
php phd/render.php --docbook doc-base/.manual.xml --package PHP --format chm --output ./output
```

The result lands in **`./output/chm/`** and looks exactly like the root of this
repository:

```
output/chm/
├── php_manual_en.hhp
├── php_manual_en.hhc
├── php_manual_en.hhk
└── res/
    ├── index.html
    ├── function.array-map.html
    └── … 11,792 more
```

The language suffix follows `--with-lang`, so a Spanish build yields
`php_manual_es.*`.

Useful `render.php` options:

| Option | Effect |
|---|---|
| `-d`, `--docbook <file>` | The DocBook file to render. |
| `-P`, `--package <name>` | `PHP`, `PEAR`, `IDE` or `Generic`. |
| `-f`, `--format <name>` | `chm`, `enhancedchm`, `xhtml`, `php`, `epub`, `manpage`, … |
| `-o`, `--output <dir>` | Output directory (default `.`). |
| `-I`, `--noindex` | Skip re-indexing and reuse the cache — much faster on re-runs. |
| `-l`, `--list` | List every supported package/format pair. |

The first run indexes the entire manual and takes a while; subsequent runs with
`-I` are far quicker.

> **`chm` vs `enhancedchm`** — both emit the same sitemaps and `res/` tree.
> `enhancedchm` additionally ships a JavaScript search page inside the help file.
> Either one feeds the viewer in this repository.

### 3. Compile the `.chm`

The sitemaps are just text; the `.chm` is a compiled binary. Microsoft's HTML
Help Workshop does the packing, and there is no native Linux equivalent:

```shell
# On Windows
hhc.exe output\chm\php_manual_en.hhp
```

Or open `php_manual_en.hhp` in HTML Help Workshop and choose *File → Compile*.
`hhc.exe` exits with status `1` on success — that is normal, not an error.

On Linux/macOS the practical options are Wine (`wine hhc.exe php_manual_en.hhp`)
or a Windows VM. **Or skip the compile entirely and use `viewer/`**, which is
precisely why it exists.

The compiled file is written next to the project as
`output/chm/php_manual_en.chm` — the name comes from `Compiled file=` in the
`[OPTIONS]` section of the `.hhp`.

### Starting from an existing `.chm` instead

If you already have a `php_manual_en.chm` and only want the viewer, extract it
rather than rendering from XML. The archive contains the same
`php_manual_en.hh*` + `res/` layout:

```shell
hh.exe -decompile out php_manual_en.chm    # Windows
7z x php_manual_en.chm                     # 7-Zip, any OS
extract_chmLib php_manual_en.chm out       # chmlib
```

---

## Part 2 — How this repository works

### The problem

The `.hhc` and `.hhk` files are *sitemaps*: HTML fragments where every entry is
an `<object type="text/sitemap">` carrying `<param name="Name">` and
`<param name="Local">`. Only the Windows HTML Help control knows how to render
them. Every page in `res/`, on the other hand, is ordinary self-contained HTML
that links to its neighbours with relative hrefs (`href="tutorial.html"`) — it
displays perfectly in any browser, it simply has no navigation around it.

So the viewer only has to supply what HTML Help used to: the tree, the index,
the search, and the chrome. The pages themselves are shown untouched in an
`<iframe>`.

### `build-viewer.php` — sitemaps to JavaScript

```shell
php build-viewer.php                       # defaults to this directory
php build-viewer.php --src=/path/to/chm --out=/path/to/chm/viewer
```

It reads the `.hhp` for the title and default topic, walks the `.hhc` and
`.hhk`, and writes three files into `viewer/data/`:

```js
window.CHM_TOC   = [{ n: "Preface", h: "res/index.html", c: [ …children… ] }, …]
window.CHM_INDEX = [{ n: "array_map", h: "res/function.array-map.html" }, …]
window.CHM_META  = { title, home, tocSize, idxSize, built }
```

Three deliberate decisions live in that script:

- **`.js`, not `.json`.** Opened over `file://`, Chrome blocks `fetch()` as a
  cross-origin request, but a local `<script src>` still loads. Assigning to
  `window` is what makes double-clicking `viewer/index.html` work.
- **One-letter keys.** With ~11,800 nodes, `n`/`h`/`c` instead of
  `name`/`href`/`children` measurably shrinks the 800 KB data files.
- **A linear, stack-based walk of the sitemap.** In HHC files a nested `<ul>` is
  emitted as a *sibling* of its parent `<li>`, not inside it, so a DOM parser
  hands you a flat list. The parser instead scans the file with a stack: on
  `<ul>` the parent becomes the last item emitted at the current level, on
  `</ul>` it pops.

It also converts Windows-1252 to UTF-8, deduplicates the `.hhk` (which repeats
entries), sorts the index with `strnatcasecmp`, drops nodes that carry neither a
name nor a target, and unwraps the anonymous root node PhD leaves at the top of
the tree.

Current output: **11,788 TOC nodes, 11,796 index entries.**

Re-run it whenever the sitemaps change; the files under `viewer/data/` are
generated and should not be edited by hand.

### `viewer/` — the reader

| File | Role |
|---|---|
| `index.html` | Three-pane layout, tabs, toolbar, `iframe`, and the UI language packs. |
| `app.css` | Light/dark theming via CSS custom properties, splitter, tree, results. |
| `app.js` | Tree, index, search, history, hash routing, persistence, i18n. |
| `data/*.js` | Generated. Do not edit. |

What it does:

- **Lazy tree.** Building the DOM for 11,788 nodes at once freezes the browser,
  so children are created only when a node is expanded. Expansion state survives
  a reload.
- **Index panel.** Filters as you type and renders at most ~300 matches, always
  stating how many were left out — never a silent truncation. A new query
  returns the list to the top.
- **Search.** Ranked over the TOC and index together: exact, then prefix, then
  substring on a word boundary, then substring, then a fuzzy subsequence match
  that is rejected when the characters are too far apart (which is what keeps
  `arrmap` from matching `variant_date_from_timestamp`). `Ctrl`/`Cmd`+`K`
  focuses the field.
- **Typed badges.** php.net encodes the page type in the filename —
  `function.*`, `class.*`, `book.*`, `ref.*`, and `<class>.<method>.html` — so
  results are labelled *function*, *method*, *class*, *extension* or *section*.
  It is how you tell `PDO` the extension from `PDO` the class at a glance.
- **Sync with the content.** Navigating inside the `iframe` locates the page in
  the tree, expands its ancestors and highlights it.
- **Hash routing.** `#res/function.array-map.html` restores the page on reload
  and makes links shareable.
- **Navigation.** Back/Forward (`Alt`+`←`/`→`), Home, and Previous/Next computed
  by walking the TOC in reading order.
- **Draggable splitter**, with the width persisted.
- **Light/dark theme.** Dark mode themes the application chrome only; the manual
  pages keep their own stylesheet, because inverting them would wreck the syntax
  highlighting in the code samples.

Panel, theme, splitter width, expansion state, last page and language are stored
in `localStorage` under the key `chm.viewer`.

### Running it

Double-click `viewer/index.html`, or serve the repository root:

```shell
php -S 127.0.0.1:8000
# → http://127.0.0.1:8000/viewer/
```

Both work by design. One caveat under `file://`: some browsers treat every local
file as an opaque origin, so reading the `iframe`'s location can throw. That is
caught — the viewer keeps working, it just may not auto-highlight the current
node in the tree. Served over HTTP it always does.

**The viewer must sit next to `res/`.** `app.js` resolves page hrefs against
`BASE = '../'`, i.e. it expects `viewer/` to be a direct child of the CHM root.
Moving it elsewhere means changing that constant.

### UI languages

All interface strings live in `<template class="i18n">` elements at the bottom
of `viewer/index.html`, one per language, each holding a JSON object:

```html
<template class="i18n" data-lang="en" data-locale="en-US" data-label="English">{
  "tab.contents": "Contents",
  "side.stat": "{topics} topics · {entries} index entries",
  ...
}</template>
```

Markup references them through `data-t` (text), `data-t-title`, `data-t-aria`
and `data-t-ph` (placeholder). To add a language, copy an existing template,
change `data-lang` / `data-locale` / `data-label`, and translate the values —
no JavaScript changes. The picker in the sidebar footer appears automatically
once more than one pack is present, and the first template is the fallback for
any missing key. `{placeholders}` are substituted at runtime and numbers are
formatted with the pack's `data-locale`.

English and Spanish ship by default. This only affects the viewer's own chrome —
the manual's content is whatever language you rendered.

---

## Deploying

`.github/workflows/deploy-manual.yml` publishes to GitHub Pages on every push to
`main`, and on demand via *Run workflow*.

Because `app.js` resolves pages against `../res/`, the viewer cannot be deployed
on its own. The workflow assembles both halves into a `_site/` directory and
uploads that as a Pages artifact:

```
_site/
├── index.html      # redirects to viewer/
├── images/
├── res/
└── viewer/
```

The sitemaps are deliberately left out — they are inputs to `build-viewer.php`,
not runtime assets, so ~5 MB never leaves the repository.

> **One-time setup:** in the repository's **Settings → Pages → Build and
> deployment**, set **Source** to **GitHub Actions**. While it is still set to
> *Deploy from a branch*, the workflow fails at its `deploy-pages` step.

The site is uploaded as a tarball artifact rather than force-pushed to a
`gh-pages` branch, which keeps ~103 MB and 11,794 files out of this
repository's git history on every deploy.

---

## Known limitations

- **No full-text search.** Search covers titles and index entries, not page
  bodies. Building an inverted index over the 103 MB of `res/` is a deliberate
  second pass: the generator is structured for it and both panels already route
  through a single `search(q)`, so the UI would not change.
- **`/images/bg-texture-00.svg` only resolves at a site root.** PhD's stylesheet
  sets `html { background-image: url('/images/bg-texture-00.svg') }`
  (`res/styles/…-theme-medium.css`), a 4×4 crosshatch tile the CHM never shipped.
  The genuine file from php.net now lives in `images/`, so the reference
  resolves — but only where `/` is the manual's root:

  | Opened as | Resolves? |
  |---|---|
  | `php -S` from the repository root | yes |
  | `file://` | no — `/images/…` points at the filesystem root |
  | GitHub Pages project site (`/php-doc/`) | no — unless served from a custom domain root |

  The remaining 404 is cosmetic: it costs one failed request per page and the
  background texture is absent. `res/` is deliberately left as pristine PhD
  output, so the absolute path is not rewritten.
- **A second absolute reference never fires.** `…-theme-base.css` also asks for
  `/images/mobile-menu.png`, but its selector (`#mainmenu-toggle-overlay`, under
  `max-width:767px`) matches no page in `res/`, so no request is ever made and
  the file is not vendored.

---

## Credits

The manual is © The PHP Documentation Group, licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/legalcode). Sources:
[php/doc-en](https://github.com/php/doc-en) ·
[php/doc-base](https://github.com/php/doc-base) ·
[php/phd](https://github.com/php/phd).
