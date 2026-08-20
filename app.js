/* Visor tipo CHM sobre los sitemaps del manual de PHP.
   Sin dependencias ni build: funciona igual con file:// y con php -S.       */
(() => {
'use strict';

const BASE  = '../';            // viewer/ cuelga de la raíz del CHM
const STORE = 'chm.viewer';
const TOC   = window.CHM_TOC   || [];
const IDX   = window.CHM_INDEX || [];
const META  = window.CHM_META  || { title: 'Ayuda', home: 'res/index.html' };

const $ = (sel) => document.querySelector(sel);

// -------------------------------------------------------------- idiomas
/* Las cadenas viven en los <template class="i18n"> del HTML, no acá:
   añadir un idioma es copiar un bloque y traducir sus valores.            */
const PACKS = new Map();

for (const tpl of document.querySelectorAll('template.i18n')) {
  try {
    PACKS.set(tpl.dataset.lang, {
      locale:  tpl.dataset.locale || tpl.dataset.lang,
      label:   tpl.dataset.label  || tpl.dataset.lang,
      strings: JSON.parse(tpl.content.textContent),
    });
  } catch (e) {
    console.error('Paquete de idioma inválido:', tpl.dataset.lang, e.message);
  }
}

const FALLBACK = PACKS.keys().next().value || 'en';
let lang = FALLBACK;

/* t('note.capped', { shown: 5 }) — las {llaves} se sustituyen por su valor.
   Si falta una clave se cae al primer paquete y, en último caso, se
   devuelve la clave: un idioma incompleto nunca deja huecos en blanco.    */
function t(key, vars) {
  const raw = PACKS.get(lang)?.strings[key]
           ?? PACKS.get(FALLBACK)?.strings[key]
           ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : raw;
}

function num(value) {
  return value.toLocaleString(PACKS.get(lang)?.locale || 'en-US');
}

/* Rellena todo lo marcado con data-t / data-t-title / data-t-aria / data-t-ph. */
const SLOTS = [
  ['t',      'data-t',       (el, str) => { el.textContent = str; }],
  ['tTitle', 'data-t-title', (el, str) => el.setAttribute('title', str)],
  ['tAria',  'data-t-aria',  (el, str) => el.setAttribute('aria-label', str)],
  ['tPh',    'data-t-ph',    (el, str) => el.setAttribute('placeholder', str)],
];

function applyI18n(root = document) {
  for (const [prop, attr, set] of SLOTS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) set(el, t(el.dataset[prop]));
  }
}

function setLang(next) {
  lang = PACKS.has(next) ? next : FALLBACK;
  state.lang = lang;
  document.documentElement.lang = lang;
  applyI18n();
  refreshText();
  save();
}

/* Repinta lo que se genera desde JS y por tanto no lleva data-t. */
function refreshText() {
  $('#stat').textContent = t('side.stat', { topics: num(META.tocSize), entries: num(META.idxSize) });
  for (const [id, row] of rows) {
    if (!NODES[id].n) row.querySelector('.row__label').textContent = t('tree.untitled');
  }
  doFilter();
  doSearch();
  if (current) mark(current, false);
}

// ------------------------------------------------------------------ estado
const NODES = [];                 // {n, h, kids, parent, depth}
const ORDER = [];                 // ids con destino, en orden de lectura
const BY_HREF = new Map();        // href -> id (primera aparición)
const HREFS = new Set();

const ROOTS = (function flatten(list, parent, depth) {
  const ids = [];
  for (const raw of list) {
    const id = NODES.length;
    const node = { n: raw.n, h: raw.h || null, kids: [], parent, depth };
    NODES.push(node);
    ids.push(id);
    if (node.h) {
      HREFS.add(node.h);
      ORDER.push(id);
      if (!BY_HREF.has(node.h)) BY_HREF.set(node.h, id);
    }
    if (raw.c) node.kids = flatten(raw.c, id, depth + 1);
  }
  return ids;
})(TOC, -1, 0);

for (const e of IDX) if (e.h) HREFS.add(e.h);

const state = load();
let current = null;               // href mostrado
let expected = null;              // href que pedimos nosotros
const hist = { stack: [], at: -1 };

// -------------------------------------------------------- tipo de página
/* Los nombres de archivo de php.net codifican qué es cada página
   (function.array-map.html, class.pdo.html, pdo.query.html). Se aprovecha
   ese metadato para etiquetar cada resultado.                              */
const KIND = new Set([
  'function', 'class', 'book', 'ref', 'language', 'control', 'appendices',
  'features', 'security', 'faq', 'install', 'configuration', 'migration',
  'reserved', 'internals', 'intro', 'errorfunc', 'context', 'wrappers',
]);

const kindCache = new Map();

function kindOf(href) {
  if (!href) return { key: 'group', sym: false };
  if (kindCache.has(href)) return kindCache.get(href);

  const slug = href.replace(/^.*\//, '').replace(/\.html?$/i, '');
  const dot = slug.indexOf('.');
  let kind;

  if (dot < 0) {
    kind = { key: 'section', sym: false };
  } else {
    const head = slug.slice(0, dot);
    if (KIND.has(head)) {
      kind = { key: head, sym: head === 'function' || head === 'class' };
    } else if (HREFS.has('res/class.' + head + '.html')) {
      kind = { key: 'method', sym: true };        // p. ej. pdo.query.html
    } else {
      kind = { key: 'section', sym: false };
    }
  }

  kindCache.set(href, kind);
  return kind;
}

// ------------------------------------------------------------ navegación
const doc = $('#doc');

function resolve(href) { return BASE + href; }

function toHref(url) {
  const clean = String(url).split('#')[0].split('?')[0];
  const i = clean.lastIndexOf('/res/');
  return i < 0 ? null : clean.slice(i + 1);
}

function navigate(href, opts = {}) {
  if (!href) return;
  expected = href;
  doc.src = resolve(href);
  if (opts.push !== false) push(href);
  mark(href, opts.reveal !== false);
}

function push(href) {
  if (hist.stack[hist.at] === href) return;
  hist.stack.length = hist.at + 1;
  hist.stack.push(href);
  hist.at = hist.stack.length - 1;
  buttons();
}

function buttons() {
  $('#back').disabled = hist.at <= 0;
  $('#fwd').disabled = hist.at >= hist.stack.length - 1;

  const i = current ? ORDER.indexOf(BY_HREF.get(current) ?? -1) : -1;
  $('#prev').disabled = i <= 0;
  $('#next').disabled = i < 0 || i >= ORDER.length - 1;
}

function step(delta) {
  const id = current ? BY_HREF.get(current) : undefined;
  const i = id === undefined ? -1 : ORDER.indexOf(id);
  const next = NODES[ORDER[i + delta]];
  if (i >= 0 && next) navigate(next.h);
}

/* Marca el nodo activo, actualiza título y migas. */
function mark(href, reveal) {
  current = href;
  const id = BY_HREF.get(href);
  const node = id === undefined ? null : NODES[id];

  document.title = node ? `${node.n} — ${META.title}` : META.title;
  $('#docTitle').textContent = node ? node.n : META.title;
  $('#where').textContent = node ? trail(id) : href;

  for (const el of document.querySelectorAll('[aria-current="page"]')) el.removeAttribute('aria-current');

  if (node) {
    if (reveal) revealNode(id);
    const row = rows.get(id);
    if (row) row.setAttribute('aria-current', 'page');
  }
  for (const el of document.querySelectorAll(`.hit[data-h="${cssEsc(href)}"]`)) {
    el.setAttribute('aria-current', 'page');
  }

  if (location.hash.slice(1) !== href) history.replaceState(null, '', '#' + href);
  buttons();
  save();
}

function trail(id) {
  const parts = [];
  for (let i = id; i >= 0; i = NODES[i].parent) parts.unshift(NODES[i].n);
  return parts.join(t('trail.sep'));
}

// ----------------------------------------------------------------- árbol
const tree = $('#tree');
const rows = new Map();           // id -> elemento .row
const kidsBox = new Map();        // id -> contenedor .kids

const TWIST = '<span class="row__twist"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></span>';
const LEAF  = '<span class="row__twist row__twist--leaf"></span>';

function renderInto(box, ids) {
  const frag = document.createDocumentFragment();

  for (const id of ids) {
    const node = NODES[id];
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = id;
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = 8 + node.depth * 14 + 'px';
    row.innerHTML = (node.kids.length ? TWIST : LEAF) + '<span class="row__label"></span>';
    row.lastChild.textContent = node.n || t('tree.untitled');
    if (node.kids.length) row.setAttribute('aria-expanded', 'false');
    wrap.appendChild(row);
    rows.set(id, row);

    if (node.kids.length) {
      const kids = document.createElement('div');
      kids.className = 'kids';
      kids.hidden = true;
      wrap.appendChild(kids);
      kidsBox.set(id, kids);
    }

    frag.appendChild(wrap);
  }

  box.appendChild(frag);
}

/* Perezoso a propósito: 11.788 nodos de una vez congelan el navegador. */
function expand(id, on) {
  const node = NODES[id];
  if (!node.kids.length) return;

  const box = kidsBox.get(id);
  const row = rows.get(id);
  if (!box) return;

  if (on && !box.dataset.filled) {
    renderInto(box, node.kids);
    box.dataset.filled = '1';
  }
  box.hidden = !on;
  row.setAttribute('aria-expanded', String(on));

  if (on) state.open[id] = 1; else delete state.open[id];
  save();
}

function revealNode(id) {
  const chain = [];
  for (let i = NODES[id].parent; i >= 0; i = NODES[i].parent) chain.unshift(i);
  for (const p of chain) expand(p, true);

  const row = rows.get(id);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

tree.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const id = +row.dataset.id;
  const node = NODES[id];
  const onTwist = !!e.target.closest('.row__twist');

  if (node.kids.length && (onTwist || !node.h)) {
    expand(id, row.getAttribute('aria-expanded') !== 'true');
    return;
  }
  if (node.h) navigate(node.h, { reveal: false });
  if (node.kids.length && row.getAttribute('aria-expanded') !== 'true') expand(id, true);
  for (const el of document.querySelectorAll('[aria-current="page"]')) el.removeAttribute('aria-current');
  row.setAttribute('aria-current', 'page');
});

// --------------------------------------------------- índice y resultados
function hitEl(name, href, q) {
  const kind = kindOf(href);
  const el = document.createElement('div');
  el.className = 'hit';
  el.dataset.h = href;

  const label = document.createElement('span');
  label.className = 'hit__name' + (kind.sym ? ' hit__name--sym' : '');
  label.innerHTML = highlight(name, q);

  const tag = document.createElement('span');
  tag.className = 'hit__kind' + (kind.sym ? ' hit__kind--sym' : '');
  tag.textContent = t('kind.' + kind.key);

  el.append(label, tag);
  return el;
}

function highlight(name, q) {
  if (!q) return esc(name);
  const i = name.toLowerCase().indexOf(q);
  if (i < 0) return esc(name);
  return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
}

/* Última consulta pintada en cada panel, para saber si los resultados
   son nuevos o sólo se están repintando (p. ej. al cambiar de idioma).   */
const lastQuery = new WeakMap();

function renderHits(box, items, q, cap) {
  const fresh = lastQuery.get(box) !== q;
  lastQuery.set(box, q);

  const frag = document.createDocumentFragment();

  if (!items.length) {
    frag.appendChild(noteEl(t('empty.none')));
  } else {
    for (const it of items.slice(0, cap)) frag.appendChild(hitEl(it.n, it.h, q));
    if (items.length > cap) {
      frag.appendChild(noteEl(t('note.capped', { shown: num(cap), total: num(items.length) })));
    }
  }

  box.replaceChildren(frag);

  /* Vaciar y rellenar en la misma tarea no dispara un recálculo de layout,
     así que el navegador conserva el scroll y te deja a media lista de unos
     resultados que ya son otros. Como vienen ordenados por relevancia, una
     consulta nueva tiene que empezar arriba.                              */
  if (fresh) box.scrollTop = 0;

  if (current) for (const el of box.querySelectorAll(`.hit[data-h="${cssEsc(current)}"]`)) {
    el.setAttribute('aria-current', 'page');
  }
}

for (const box of [$('#idxList'), $('#results')]) {
  box.addEventListener('click', (e) => {
    const hit = e.target.closest('.hit');
    if (hit) navigate(hit.dataset.h);
  });
}

// -------------------------------------------------------------- búsqueda
const CORPUS = (() => {
  const seen = new Set();
  const out = [];
  const add = (n, h) => {
    if (!n || !h) return;
    const key = n + '\0' + h;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ n, h, l: n.toLowerCase() });
  };
  for (const e of IDX) add(e.n, e.h);
  for (const node of NODES) add(node.n, node.h);
  return out;
})();

const IDX_VIEW = IDX.map((e) => ({ n: e.n, h: e.h, l: e.n.toLowerCase() }));

/* 0 exacto · 1 prefijo · 2 límite de palabra · 3 contiene · 4 iniciales.
   `tight` desempata: cuanto más juntas caen las letras, mejor la coincidencia. */
function rank(lower, q) {
  if (lower === q)           return { s: 0, tight: 0 };
  if (lower.startsWith(q))   return { s: 1, tight: 0 };

  const i = lower.indexOf(q);
  if (i > 0) return { s: /[^a-z0-9]/.test(lower[i - 1]) ? 2 : 3, tight: i };

  /* Sin un límite de dispersión, «arrmap» casaría con
     variant_date_from_timestamp y con medio manual. */
  const span = subseq(lower, q);
  return span < 0 || span > q.length * 3 ? null : { s: 4, tight: span };
}

/* Devuelve la distancia entre la primera y la última letra casadas, o -1. */
function subseq(hay, needle) {
  let i = 0, first = -1;
  for (let p = 0; p < hay.length; p++) {
    if (hay[p] !== needle[i]) continue;
    if (first < 0) first = p;
    if (++i === needle.length) return p - first;
  }
  return -1;
}

function search(q, pool) {
  const hits = [];
  for (const it of pool) {
    const r = rank(it.l, q);
    if (r) hits.push({ n: it.n, h: it.h, s: r.s, tight: r.tight, len: it.n.length });
  }
  hits.sort((a, b) => a.s - b.s || a.tight - b.tight || a.len - b.len || a.n.localeCompare(b.n));
  return hits;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function doSearch() {
  const q = $('#q').value.trim().toLowerCase();
  if (!q) {
    $('#results').replaceChildren(noteEl(t('hint.search')));
    return;
  }
  renderHits($('#results'), search(q, CORPUS), q, 200);
}

function doFilter() {
  const q = $('#idxQ').value.trim().toLowerCase();
  renderHits($('#idxList'), q ? search(q, IDX_VIEW) : IDX_VIEW, q, 300);
}

const runSearch = debounce(doSearch, 80);
const runFilter = debounce(doFilter, 80);

$('#q').addEventListener('input', runSearch);
$('#idxQ').addEventListener('input', runFilter);

// --------------------------------------------------------------- solapas
function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.panel === name));
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.dataset.panel !== name;
  }
  state.tab = name;
  save();
  if (name === 'search') $('#q').focus();
  if (name === 'idx') $('#idxQ').focus();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.panel));
}

// ------------------------------------------------------------ separador
(() => {
  const grip = $('#grip');
  let dragging = false;

  const set = (px) => {
    const w = Math.max(220, Math.min(px, window.innerWidth - 320));
    document.documentElement.style.setProperty('--side-w', w + 'px');
    state.width = w;
  };

  grip.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= 720) return;
    dragging = true;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
  });

  grip.addEventListener('pointermove', (e) => { if (dragging) set(e.clientX); });

  grip.addEventListener('pointerup', (e) => {
    dragging = false;
    grip.releasePointerCapture(e.pointerId);
    document.body.classList.remove('dragging');
    save();
  });

  grip.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    set((state.width || 340) + d);
    save();
  });

  if (state.width) set(state.width);
})();

// ------------------------------------------------------------------ tema
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  state.theme = theme;
  save();
}

$('#theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));

// ----------------------------------------------------------- botonera
$('#back').addEventListener('click', () => { if (hist.at > 0) navigate(hist.stack[--hist.at], { push: false }); });
$('#fwd').addEventListener('click',  () => { if (hist.at < hist.stack.length - 1) navigate(hist.stack[++hist.at], { push: false }); });
$('#home').addEventListener('click', () => navigate(META.home));
$('#locate').addEventListener('click', () => { if (current) mark(current, true); });
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showTab('search');
    $('#q').select();
    return;
  }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); $('#back').click(); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); $('#fwd').click(); }
});

/* Sigue los enlaces pulsados dentro del propio contenido. En file:// algunos
   navegadores tratan cada archivo como origen opaco y bloquean esta lectura;
   el visor sigue funcionando, sólo sin resaltado automático.               */
doc.addEventListener('load', () => {
  let href = null;
  try { href = toHref(doc.contentWindow.location.href); } catch { /* cross-origin */ }
  if (!href || href === expected) return;
  push(href);
  mark(href, true);
});

window.addEventListener('hashchange', () => {
  const href = location.hash.slice(1);
  if (href && href !== current) navigate(href);
});

// ---------------------------------------------------------- persistencia
function load() {
  const base = { open: {}, tab: 'toc', theme: 'light', width: 0, last: '', lang: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (saved.tocSize !== META.tocSize) delete saved.open;   // datos regenerados
    return { ...base, ...saved, open: saved.open || {} };
  } catch { return base; }
}

function save() {
  state.last = current || state.last;
  state.tocSize = META.tocSize;
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* modo privado */ }
}

// --------------------------------------------------------------- utilidad
function noteEl(text) {
  const el = document.createElement('p');
  el.className = 'note';
  el.textContent = text;
  return el;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function cssEsc(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

// ---------------------------------------------------------------- arranque
document.documentElement.dataset.theme = state.theme;
$('#docTitle').textContent = META.title;

for (const [code, pack] of PACKS) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = pack.label;
  $('#lang').appendChild(opt);
}
$('#lang').hidden = PACKS.size < 2;
$('#lang').addEventListener('change', (e) => setLang(e.target.value));

setLang(state.lang || FALLBACK);
$('#lang').value = lang;

renderInto(tree, ROOTS);
for (const id of Object.keys(state.open)) expand(+id, true);
if (!Object.keys(state.open).length && NODES.length) expand(0, true);

showTab(state.tab);
navigate(location.hash.slice(1) || state.last || META.home, { push: true });
})();
