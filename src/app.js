// Écran du widget : en-tête, filtres, quatre onglets (Vue d'ensemble, Par entité, Planning, Tableaux),
// réglages.

import * as bridge from './grist-bridge.js?v=20261118-1056';
import { loadGrist, loadDemo } from './source.js?v=20261118-1056';
import * as M from './model.js?v=20261118-1056';
import * as C from './charts.js?v=20261118-1056';
import { renderGantt } from './gantt.js?v=20261118-1056';
import { renderTables } from './tables.js?v=20261118-1056';
import { $, h, debounce, fmtMonth, fmtDate } from './dom.js?v=20261118-1056';

const OPTION_KEY = 'kpiConfig';
const echarts = window.echarts;

const state = {
  data: null,          // jeu normalisé (voir source.js)
  mapping: {},         // rôle -> colonne
  filters: {},         // clé -> Set de valeurs
  tab: 'ensemble',
  sort: { col: null, dir: 1 },
  search: '',
  page: 0,
  settingsOpen: false,
  palette: 'douce',    // 'douce' (bleus/verts) | 'referentiel' (couleurs du document)
  gantt: { groupBy: null, zoom: 'tout', collapsed: new Set() },
  tables: { sorts: {}, matrix: { measure: 'n' } },
  chartKinds: {},      // représentation choisie par graphique (anneau / barres)
  filtersOpen: true,   // barre de filtres dépliée (sinon : une ligne des filtres actifs)
  shownFilters: ['annee', 'categorie', 'entite', 'axe1'],   // filtres proposés en haut (réglable)
  scroll: {},          // position de défilement par onglet
};
const FILTER_CHOICES = [['annee', 'Année'], ['categorie', null], ['entite', null], ['axe1', null], ['axe2', null], ['axe3', null]];
const charts = new Map();
const paletteCache = new Map();

const colLabel = (id) => state.data.columns.find((c) => c.id === id)?.label || id;

/** Couleur d'une valeur d'une dimension, identique dans tous les graphiques et le Gantt. */
function colorOf(dimKey, value) {
  if (!paletteCache.has(dimKey)) {
    const all = new Set();
    for (const r of state.data.rows) for (const v of M.valuesOf(r, dimKey)) all.add(v);
    const meta = state.data.meta[dimKey];
    const ordered = M.orderCategories([...all, ...Object.keys(meta?.order || {})].filter((v, i, a) => a.indexOf(v) === i), meta);
    paletteCache.set(dimKey, C.paletteFor(ordered, meta, state.palette));
  }
  return value === M.EMPTY ? '#b8c4c0' : (paletteCache.get(dimKey).get(value) || C.ECO[0]);
}

// ---------- démarrage ----------
async function boot() {
  const live = await bridge.connect();
  let saved = null;
  if (live) saved = await bridge.getOption(OPTION_KEY);
  if (saved?.palette) state.palette = saved.palette;
  if (Array.isArray(saved?.filtres)) state.shownFilters = saved.filtres;
  await load(saved?.table, saved?.mapping);
  if (live) bridge.onDataChange(debounce(() => load(state.data.table, state.mapping, true), 400));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());
  new ResizeObserver(debounce(() => charts.forEach((c) => c.resize()), 100)).observe(document.body);
}

async function load(table, mapping, keepFilters = false) {
  try {
    state.data = bridge.isLive() ? await loadGrist(table) : await loadDemo();
  } catch (e) {
    console.error(e);
    $('#app').replaceChildren(h('div', { class: 'empty' }, 'Lecture impossible : ', String(e.message || e),
      bridge.isLive() && bridge.accessLevel() !== 'full' ? ' — donnez au widget l\'accès « complet » dans le panneau de droite.' : ''));
    return;
  }
  state.mapping = M.resolveMapping(mapping, state.data.columns);
  paletteCache.clear();
  if (!keepFilters) state.filters = {};
  render();
}

async function saveConfig() {
  await bridge.setOption(OPTION_KEY, { table: state.data.table, mapping: state.mapping, palette: state.palette, filtres: state.shownFilters });
}

// ---------- filtres ----------
// Les filtres sont communs à tous les onglets et restent actifs quand on change d'onglet.
function filterKeys() {
  const m = state.mapping;
  return state.shownFilters.map((role) => {
    if (role === 'annee') return m.dateDebut && { key: 'annee', label: 'Année', style: 'chips' };
    const col = m[role];
    if (!col) return null;
    const n = new Set(state.data.rows.flatMap((r) => M.valuesOf(r, col))).size;
    return { key: col, label: colLabel(col), style: n <= 9 ? 'chips' : 'menu' };
  }).filter(Boolean);
}

// Ligne compacte : un jeton par valeur filtrée, retirable d'un clic.
function activeChips() {
  const out = [];
  for (const [k, s] of Object.entries(state.filters)) {
    for (const v of s) {
      out.push(h('button', { class: 'achip', title: 'Retirer ce filtre', onclick: () => toggleFilter(k, v) },
        h('span', { class: 'ak' }, k === 'annee' ? 'Année' : colLabel(k)), ' ', v, ' ×'));
    }
  }
  return out;
}

function toggleFilter(key, value) {
  const s = state.filters[key] || (state.filters[key] = new Set());
  s.has(value) ? s.delete(value) : s.add(value);
  state.page = 0;
  render();
}
function clearFilter(key) { delete state.filters[key]; state.page = 0; render(); }

function renderFilterBar() {
  const actifs = activeChips();
  const toggle = h('button', { class: 'ftoggle', 'aria-expanded': state.filtersOpen ? 'true' : 'false',
    onclick: () => { state.filtersOpen = !state.filtersOpen; render(); } },
  state.filtersOpen ? 'Replier les filtres ▴' : `Filtres${actifs.length ? ` (${actifs.length})` : ''} ▾`);
  if (!state.filtersOpen) {
    return h('div', { class: 'filters compact' }, toggle,
      actifs.length ? h('div', { class: 'achips' }, actifs) : h('span', { class: 'muted' }, 'Aucun filtre : toutes les actions.'),
      actifs.length ? h('button', { class: 'linkbtn', onclick: () => { state.filters = {}; render(); } }, 'Tout effacer') : '');
  }
  const bar = h('div', { class: 'filters' });
  bar.append(toggle);
  for (const f of filterKeys()) {
    const opts = M.filterOptions(state.data.rows, state.filters, state.mapping, f.key, state.data.meta);
    const sel = state.filters[f.key] || new Set();
    if (f.style === 'chips') {
      bar.append(h('div', { class: 'fgroup' },
        h('span', { class: 'flabel' }, f.label),
        h('div', { class: 'chips' }, opts.map((o) => h('button', {
          class: 'chip' + (sel.has(o.value) ? ' on' : '') + (o.count ? '' : ' zero'),
          'aria-pressed': sel.has(o.value) ? 'true' : 'false',
          onclick: () => toggleFilter(f.key, o.value),
        }, o.value, h('span', { class: 'cnt' }, o.count))))));
    } else {
      bar.append(menuFilter(f, opts, sel));
    }
  }
  const active = Object.entries(state.filters).filter(([, s]) => s.size);
  if (active.length) {
    bar.append(h('button', { class: 'linkbtn', onclick: () => { state.filters = {}; render(); } }, 'Effacer les filtres'));
  }
  return bar;
}

// Liste déroulante à choix multiples, avec recherche et effectifs.
function menuFilter(f, opts, sel) {
  const summary = sel.size === 0 ? 'Tous' : sel.size === 1 ? [...sel][0] : `${sel.size} sélectionnés`;
  const wrap = h('div', { class: 'fgroup' }, h('span', { class: 'flabel' }, f.label));
  const btn = h('button', { class: 'menubtn' + (sel.size ? ' on' : ''), 'aria-haspopup': 'listbox' }, h('span', { class: 'menutxt' }, summary), ' ▾');
  const pop = h('div', { class: 'pop', hidden: true });
  const search = h('input', { type: 'search', placeholder: 'Rechercher…', class: 'popsearch', value: menuQuery[f.key] || '' });
  const list = h('div', { class: 'poplist' });
  const fill = () => {
    menuQuery[f.key] = search.value;
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...opts.filter((o) => !q || o.value.toLowerCase().includes(q)).map((o) => h('label', { class: 'popitem' + (o.count ? '' : ' zero') },
      h('input', { type: 'checkbox', checked: sel.has(o.value), onchange: () => toggleFilter(f.key, o.value) }),
      h('span', { class: 'popval' }, o.value), h('span', { class: 'cnt' }, o.count))));
  };
  search.addEventListener('input', fill);
  fill();
  pop.append(search, list, sel.size ? h('button', { class: 'linkbtn', onclick: () => clearFilter(f.key) }, 'Tout désélectionner') : '');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll('.pop').forEach((p) => { p.hidden = true; });
    pop.hidden = !open;
    if (open) { search.focus(); openMenu = f.key; } else openMenu = null;
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  if (openMenu === f.key) pop.hidden = false;      // reste ouvert après un clic sur une case
  wrap.append(btn, pop);
  return wrap;
}
let openMenu = null;
const menuQuery = {};
document.addEventListener('click', () => { if (openMenu) { openMenu = null; document.querySelectorAll('.pop').forEach((p) => { p.hidden = true; }); } });

// ---------- blocs ----------
// Icônes des cartes (SVG constants, aucune ressource externe).
const ICONS = {
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  donut: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  bars: '<path d="M4 6h10M4 12h16M4 18h7"/>',
};
function svgIcon(name, cls = 'ico') {
  const s = h('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return s;
}
function sparkline(data) {
  if (!data || data.length < 2) return '';
  const w = 200, ht = 36, max = Math.max(...data, 0), min = Math.min(...data, 0), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, ht - 3 - ((v - min) / span) * (ht - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const s = h('div', { class: 'kspark', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none"><path class="kspark-a" d="${line} L${w},${ht} L0,${ht} Z"/><path class="kspark-l" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
  return s;
}

/** Carte indicateur : libellé, valeur, icône, variation vs période précédente, courbe mensuelle. */
function kpiCard(label, value, { icon = 'layout', rows = null, agg = null, sub = null } = {}) {
  const t = rows && agg ? M.trend(rows, state.mapping.dateDebut, agg) : { delta: null, spark: [] };
  const up = t.delta != null && t.delta >= 0;
  return h('div', { class: 'kpi' },
    h('div', { class: 'khead' }, h('div', { class: 'kpil' }, label), svgIcon(icon, 'kico')),
    h('div', { class: 'kpiv' }, value),
    t.delta != null ? h('div', { class: 'kdelta ' + (up ? 'up' : 'down') }, (up ? '↑ +' : '↓ ') + t.delta.toLocaleString('fr-FR') + ' %',
      h('span', {}, ' vs période précédente')) : sub ? h('div', { class: 'kpisub' }, sub) : h('div', { class: 'kpisub' }, '\u00a0'),
    sparkline(t.spark));
}

function chartCard(id, title, span, option, onClick, hint, { subtitle = null, chip = null } = {}) {
  const el = h('div', { class: 'chart' });
  const card = h('section', { class: `card span${span}` },
    h('div', { class: 'chead' },
      h('div', {}, h('h3', {}, title), subtitle ? h('div', { class: 'csub' }, subtitle) : (hint ? h('div', { class: 'csub' }, hint) : '')),
      chip || ''),
    el);
  queueMicrotask(() => {
    const inst = echarts.init(el, null, { renderer: 'canvas' });
    inst.setOption(option);
    // Le rendu suivant détruit ce graphique : on sort d'abord du gestionnaire d'ECharts.
    if (onClick) inst.on('click', (p) => setTimeout(() => onClick(p)));
    charts.set(id, inst);
  });
  return card;
}

// Graphique sur une dimension : il ignore son propre filtre (pour garder toutes les barres) et
// estompe les valeurs non retenues — le même principe que les filtres croisés d'un tableau de bord.
function dimChart(id, title, span, dimKey, { measure = null, kind = 'bar', limit = 0, sortByValue = true } = {}) {
  if (!dimKey) return null;
  kind = state.chartKinds[id] || kind;
  const rows = M.applyFilters(state.data.rows, state.filters, state.mapping, dimKey);
  const meta = state.data.meta[dimKey];
  const g = M.groupBy(rows, dimKey, measure);
  let cats = M.orderCategories([...g.keys()], meta);
  if (sortByValue) cats.sort((a, b) => (g.get(b) || 0) - (g.get(a) || 0));
  if (limit && cats.length > limit) cats = cats.slice(0, limit);
  const colors = cats.map((c) => colorOf(dimKey, c));
  const values = cats.map((c) => g.get(c) || 0);
  const selected = state.filters[dimKey];
  const opt = kind === 'doughnut' ? C.doughnut(cats, values, colors, { selected })
    : C.barH(cats, values, colors, { money: !!measure, selected });
  const subtitle = `${measure ? 'Somme de ' + colLabel(measure).toLowerCase() : 'Nombre d\'actions'} par ${colLabel(dimKey).toLowerCase()} · cliquer pour filtrer`;
  const chip = h('button', { class: 'cchip', title: 'Changer de représentation',
    onclick: () => { state.chartKinds[id] = kind === 'doughnut' ? 'bar' : 'doughnut'; render(); } },
  svgIcon(kind === 'doughnut' ? 'donut' : 'bars', 'cico'), kind === 'doughnut' ? 'Anneau' : 'Barres');
  return chartCard(id, title, span, opt, (p) => toggleFilter(dimKey, p.name), null, { subtitle, chip });
}

function stackChart(id, title, span, rowKeyFn, rowDim, seriesCol, { chrono = false, rotate = 0 } = {}) {
  if (!seriesCol) return null;
  const rows = M.applyFilters(state.data.rows, state.filters, state.mapping);
  const { table, series } = M.pivot(rows, rowKeyFn, seriesCol);
  const meta = state.data.meta[seriesCol];
  const ser = M.orderCategories(series, meta);
  let cats = [...table.keys()];
  if (chrono) cats = M.monthRange(M.orderCategories(cats, null, true));
  else cats.sort((a, b) => sum(table.get(b)) - sum(table.get(a)));
  const data = ser.map((s) => cats.map((c) => table.get(c)?.get(s) || 0));
  const colors = ser.map((s) => colorOf(seriesCol, s));
  const opt = C.stacked(chrono ? cats.map(fmtMonth) : cats, ser, data, colors, { rotate });
  const click = rowDim ? (p) => toggleFilter(rowDim, cats[p.dataIndex]) : null;
  return chartCard(id, title, span, opt, click, null,
    { subtitle: `Nombre d'actions par ${colLabel(seriesCol).toLowerCase()}${rowDim ? ' · cliquer pour filtrer' : ''}` });
}
const sum = (m) => [...(m?.values() || [])].reduce((a, b) => a + b, 0);

// ---------- onglets ----------
function tabEnsemble() {
  const m = state.mapping;
  const rows = M.applyFilters(state.data.rows, state.filters, m);
  const k = M.kpis(rows, m);
  return [
    h('div', { class: 'kpis' },
      kpiCard('Actions', C.fmtInt(k.actions), { icon: 'layout', rows, agg: M.AGG.count() }),
      m.entite ? kpiCard(`${colLabel(m.entite).replace(/([^sx])$/, '$1s')} ${/(ité|ion|ure|ance|ence|ie|ée|e)$/i.test(colLabel(m.entite)) && !/(re|me|ge)$/i.test(colLabel(m.entite)) ? 'actives' : 'actifs'}`, C.fmtInt(k.entites), { icon: 'users', rows, agg: M.AGG.countd(m.entite) }) : '',
      m.montant ? kpiCard('Budget total', C.fmtEuro(k.budget), { icon: 'coins', rows, agg: M.AGG.sum(m.montant) }) : '',
      m.manquants ? kpiCard('Actions à compléter', C.fmtInt(k.aCompleter), { icon: 'target', rows, agg: M.AGG.nonEmpty(m.manquants), sub: k.actions ? `${Math.round(100 * k.aCompleter / k.actions)} % des actions` : null }) : ''),
    h('div', { class: 'grid' },
      dimChart('e-typo', `Actions par ${colLabel(m.categorie).toLowerCase()}`, 6, m.categorie),
      m.montant ? dimChart('e-typo-budget', `Budget par ${colLabel(m.categorie).toLowerCase()}`, 6, m.categorie, { measure: m.montant }) : null,
      m.dateDebut ? stackChart('e-mois', `Actions par mois de début${m.categorie ? ' et ' + colLabel(m.categorie).toLowerCase() : ''}`, 12,
        (r) => M.month(r[m.dateDebut]), null, m.categorie, { chrono: true }) : null,
      dimChart('e-axe1', `Par ${colLabel(m.axe1).toLowerCase()}`, 4, m.axe1, { kind: 'doughnut', sortByValue: false }),
      dimChart('e-axe2', `Par ${colLabel(m.axe2).toLowerCase()}`, 4, m.axe2, { kind: 'doughnut', sortByValue: false }),
      dimChart('e-axe3', `Par ${colLabel(m.axe3).toLowerCase()}`, 4, m.axe3, { kind: 'doughnut', sortByValue: false })),
  ];
}

function tabEntite() {
  const m = state.mapping;
  if (!m.entite) return [h('div', { class: 'empty' }, 'Choisissez la colonne « Entité » dans les réglages (⚙).')];
  const rows = M.applyFilters(state.data.rows, state.filters, m);
  const k = M.kpis(rows, m);
  return [
    h('div', { class: 'kpis' },
      kpiCard('Actions', C.fmtInt(k.actions), { icon: 'layout', rows, agg: M.AGG.count() }),
      m.montant ? kpiCard('Budget', C.fmtEuro(k.budget), { icon: 'coins', rows, agg: M.AGG.sum(m.montant) }) : '',
      m.montant ? kpiCard('Budget moyen par action', C.fmtEuro(k.budgetMoyen), { icon: 'trend', rows, agg: M.AGG.avg(m.montant) }) : '',
      m.dateDebut ? kpiCard('Durée moyenne', k.dureeMoyenne == null ? '—' : `${Math.round(k.dureeMoyenne)} j`, { icon: 'clock', rows, agg: M.AGG.avgDays(m.dateDebut, m.dateFin) }) : ''),
    h('div', { class: 'grid' },
      dimChart('t-etab', `Actions par ${colLabel(m.entite).toLowerCase()}`, 6, m.entite),
      m.montant ? dimChart('t-etab-budget', `Budget par ${colLabel(m.entite).toLowerCase()}`, 6, m.entite, { measure: m.montant }) : null,
      m.categorie ? stackChart('t-etab-typo', `${colLabel(m.categorie)} par ${colLabel(m.entite).toLowerCase()}`, 12,
        (r) => M.valuesOf(r, m.entite)[0], m.entite, m.categorie, { rotate: 35 }) : null,
      listCard(rows)),
  ];
}

function tabTableaux() {
  const rows = M.applyFilters(state.data.rows, state.filters, state.mapping);
  return [renderTables({
    rows, mapping: state.mapping, colLabel, colorOf, meta: state.data.meta, filters: state.filters,
    sorts: state.tables.sorts, matrix: state.tables.matrix,
    onSort: (id, s) => { state.tables.sorts[id] = s; render(); },
    onFilter: (dim, v) => toggleFilter(dim, v),
    onMatrix: (measure) => { state.tables.matrix.measure = measure; render(); },
  })];
}

function tabPlanning() {
  const m = state.mapping;
  if (!m.dateDebut) return [h('div', { class: 'empty' }, 'Choisissez la colonne « Date de début » dans les réglages (⚙).')];
  const rows = M.applyFilters(state.data.rows, state.filters, m);
  if (state.gantt.groupBy == null) state.gantt.groupBy = m.entite || m.categorie || '';
  return [renderGantt({
    rows, mapping: m, gantt: state.gantt, colLabel, colorOf,
    orderValues: (dim, values) => M.orderCategories(values, state.data.meta[dim]),
    onChange: () => render(),
    onFilter: (key, value) => toggleFilter(key, value),
  })];
}

function listCard(rows) {
  const m = state.mapping;
  const cols = [m.entite, m.titre, m.categorie, m.axe1, m.dateDebut, m.dateFin, m.montant, m.axe2].filter(Boolean);
  const q = state.search.trim().toLowerCase();
  let list = q ? rows.filter((r) => cols.some((c) => String(r[c] ?? '').toLowerCase().includes(q))) : rows.slice();
  const { col, dir } = state.sort;
  if (col) list.sort((a, b) => {
    const x = a[col], y = b[col];
    if (x == null || x === '') return 1;
    if (y == null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * dir;
  });
  const size = 15;
  const pages = Math.max(1, Math.ceil(list.length / size));
  state.page = Math.min(state.page, pages - 1);
  const slice = list.slice(state.page * size, state.page * size + size);
  const kindOf = (c) => state.data.columns.find((x) => x.id === c)?.kind;
  const cell = (r, c) => {
    const v = r[c];
    if (c === m.montant) return h('td', { class: 'num' }, v == null ? '' : C.fmtEuro(v));
    if (kindOf(c) === 'date') return h('td', { class: 'nowrap' }, fmtDate(v));
    return h('td', {}, Array.isArray(v) ? v.join(', ') : v ?? '');
  };
  const search = h('input', { type: 'search', placeholder: 'Rechercher dans la liste…', value: state.search, class: 'tsearch' });
  search.addEventListener('input', debounce(() => { state.search = search.value; state.page = 0; render(); keepFocus('.tsearch'); }, 250));
  return h('section', { class: 'card span12' },
    h('div', { class: 'thead' }, h('h3', {}, `Liste des actions (${list.length})`), search),
    h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', {
        class: (c === col ? 'sorted' : '') + (c === m.montant ? ' num' : ''),
        onclick: () => { state.sort = { col: c, dir: c === col ? -dir : 1 }; render(); },
      }, colLabel(c), c === col ? (dir > 0 ? ' ▲' : ' ▼') : '')))),
      h('tbody', {}, slice.length ? slice.map((r) => h('tr', {}, cols.map((c) => cell(r, c))))
        : h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, 'Aucune action pour ces filtres.'))))),
    pages > 1 ? h('div', { class: 'pager' },
      h('button', { disabled: state.page === 0, onclick: () => { state.page--; render(); } }, '‹'),
      ` ${state.page + 1} / ${pages} `,
      h('button', { disabled: state.page >= pages - 1, onclick: () => { state.page++; render(); } }, '›')) : '');
}
function keepFocus(sel) { const el = $(sel); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }

// ---------- réglages : branchement sur une table et rôle de chaque colonne ----------
function settingsPanel() {
  const d = state.data;
  const tableSel = h('select', { onchange: async (e) => { await load(e.target.value, null); await saveConfig(); } },
    d.tables.map((t) => h('option', { value: t, selected: t === d.table }, t)));
  const rows = M.ROLES.map((r) => {
    const sel = h('select', { onchange: async (e) => { state.mapping[r.key] = e.target.value; state.filters = {}; await saveConfig(); render(); } },
      h('option', { value: '' }, '— aucune —'),
      d.columns.filter((c) => r.kinds.includes(c.kind)).map((c) => h('option', { value: c.id, selected: state.mapping[r.key] === c.id }, `${c.label} (${c.id})`)));
    return h('label', { class: 'srow' }, h('span', {}, r.label), sel);
  });
  const paletteSel = h('select', { onchange: async (e) => { state.palette = e.target.value; paletteCache.clear(); await saveConfig(); render(); } },
    h('option', { value: 'douce', selected: state.palette === 'douce' }, 'Palette douce (bleus et verts)'),
    h('option', { value: 'referentiel', selected: state.palette === 'referentiel' }, 'Couleurs des référentiels du document'));
  const filterBoxes = FILTER_CHOICES.filter(([role]) => role === 'annee' ? state.mapping.dateDebut : state.mapping[role]).map(([role, label]) =>
    h('label', { class: 'scheck' },
      h('input', { type: 'checkbox', checked: state.shownFilters.includes(role), onchange: async (e) => {
        state.shownFilters = e.target.checked ? FILTER_CHOICES.map(([r]) => r).filter((r) => r === role || state.shownFilters.includes(r))
          : state.shownFilters.filter((r) => r !== role);
        await saveConfig(); render();
      } }), label || colLabel(state.mapping[role])));
  return h('aside', { class: 'settings' },
    h('h3', {}, 'Apparence'),
    h('label', { class: 'srow' }, h('span', {}, 'Couleurs'), paletteSel),
    h('h3', {}, 'Filtres affichés en haut'), filterBoxes,
    h('p', { class: 'muted' }, 'Un filtre masqué reste actif tant qu\'il n\'est pas effacé.'),
    h('h3', {}, 'Branchement'),
    h('label', { class: 'srow' }, h('span', {}, 'Table source'), tableSel),
    h('p', { class: 'muted' }, bridge.isLive()
      ? 'Les choix sont enregistrés dans les options du widget (rien n\'est écrit dans les tables).'
      : 'Mode démonstration : données fictives embarquées, rien n\'est enregistré.'),
    h('h3', {}, 'Rôle des colonnes'), rows,
    h('button', { class: 'linkbtn', onclick: async () => { state.mapping = M.autoMapping(d.columns); await saveConfig(); render(); } }, 'Détection automatique'));
}

// ---------- rendu ----------
function render() {
  charts.forEach((c) => c.dispose());
  charts.clear();
  const d = state.data;
  const header = h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('strong', {}, 'Pilotage des actions'),
      h('span', { class: 'badge ' + (d.live ? 'live' : 'demo') }, d.live ? `Grist · ${d.table} · ${d.rows.length} lignes` : `Démonstration · ${d.rows.length} lignes fictives`)),
    h('nav', { class: 'tabs', role: 'tablist' },
      [['ensemble', 'Vue d\'ensemble'], ['entite', `Par ${colLabel(state.mapping.entite || 'entité').toLowerCase()}`], ['planning', 'Planning'], ['tableaux', 'Tableaux']].map(([k, l]) =>
        h('button', { role: 'tab', 'aria-selected': state.tab === k ? 'true' : 'false', class: 'tab' + (state.tab === k ? ' on' : ''), onclick: () => { state.tab = k; render(); } }, l))),
    h('div', { class: 'actions' },
      d.live ? h('button', { class: 'iconbtn', title: 'Relire les données', onclick: () => { bridge.invalidateMeta(); load(d.table, state.mapping, true); } }, '↻') : '',
      h('button', { class: 'iconbtn' + (state.settingsOpen ? ' on' : ''), title: 'Réglages', onclick: () => { state.settingsOpen = !state.settingsOpen; render(); } }, '⚙')));
  const tabs = { ensemble: tabEnsemble, entite: tabEntite, planning: tabPlanning, tableaux: tabTableaux };
  const body = d.table ? tabs[state.tab]() : [h('div', { class: 'empty' }, 'Aucune table dans ce document.')];
  // En-tête et filtres restent en haut ; seul le contenu de l'onglet défile, et chaque onglet
  // retrouve sa position de défilement après un changement de filtre ou d'onglet.
  const tab = state.tab;
  const main = h('main', { class: 'content' }, ...body);
  main.addEventListener('scroll', () => { state.scroll[tab] = main.scrollTop; }, { passive: true });
  $('#app').replaceChildren(header, h('div', { class: 'filterzone' }, renderFilterBar()),
    h('div', { class: 'layout' + (state.settingsOpen ? ' withside' : '') }, main, state.settingsOpen ? settingsPanel() : ''));
  main.scrollTop = state.scroll[tab] || 0;
}

boot();
