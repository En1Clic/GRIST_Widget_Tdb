// Onglet Tableaux : tables de synthèse recalculées par le widget (donc filtrables), présentées
// avec barres de proportion, totaux, tri et carte de chaleur.
//   - Vision annuelle par catégorie   (nombre, montant, première date de début, dernière date de fin, ordre)
//   - Par entité, par thème           (nombre, montant, part)
//   - Détail mensuel par catégorie    (carte de chaleur nombre / montant)

import { h, fmtDate, fmtMonth } from './dom.js?v=20261117-1602';
import { fmtEuro, fmtInt } from './charts.js?v=20261117-1602';
import { valuesOf, month, monthRange, orderCategories, EMPTY } from './model.js?v=20261117-1602';

/** Agrège par valeur d'une dimension : nombre, montant, première date de début, dernière date de fin. */
function aggregate(rows, dim, m) {
  const out = new Map();
  for (const r of rows) {
    for (const k of valuesOf(r, dim)) {
      const a = out.get(k) || { key: k, n: 0, budget: 0, debut: null, fin: null };
      a.n++;
      a.budget += m.montant ? Number(r[m.montant]) || 0 : 0;
      const d = r[m.dateDebut], f = (m.dateFin && r[m.dateFin]) || d;
      if (d && (!a.debut || d < a.debut)) a.debut = d;
      if (f && (!a.fin || f > a.fin)) a.fin = f;
      out.set(k, a);
    }
  }
  return [...out.values()];
}

/**
 * ctx = { rows, mapping, colLabel, colorOf, meta, sorts:{}, onSort(id, col), onFilter(dim, v), filters, matrix:{measure} , onMatrix(measure) }
 */
export function renderTables(ctx) {
  const m = ctx.mapping;
  return h('div', { class: 'grid' },
    m.categorie ? summaryCard(ctx, 't-typo', `Vision annuelle par ${ctx.colLabel(m.categorie).toLowerCase()}`, m.categorie, { dates: true, metier: true, span: 12 }) : null,
    m.entite ? summaryCard(ctx, 't-etab', `Par ${ctx.colLabel(m.entite).toLowerCase()}`, m.entite, { span: 6, defaultSort: 'budget' }) : null,
    m.axe1 ? summaryCard(ctx, 't-them', `Par ${ctx.colLabel(m.axe1).toLowerCase()}`, m.axe1, { span: 6, defaultSort: 'n' }) : null,
    m.categorie && m.dateDebut ? matrixCard(ctx) : null);
}

function summaryCard(ctx, id, title, dim, { dates = false, metier = false, span = 6, defaultSort = null } = {}) {
  const m = ctx.mapping;
  const data = aggregate(ctx.rows, dim, m);
  const totN = data.reduce((s, a) => s + a.n, 0);
  const totB = data.reduce((s, a) => s + a.budget, 0);
  const sort = ctx.sorts[id] || (metier ? { col: 'ordre', dir: 1 } : { col: defaultSort || 'n', dir: -1 });
  const order = orderCategories(data.map((a) => a.key), ctx.meta[dim]);
  const rank = (k) => order.indexOf(k);
  data.sort((a, b) => {
    if (a.key === EMPTY) return 1;
    if (b.key === EMPTY) return -1;
    const v = { ordre: rank(a.key) - rank(b.key), key: a.key.localeCompare(b.key, 'fr'), n: a.n - b.n, budget: a.budget - b.budget,
      debut: (a.debut || '').localeCompare(b.debut || ''), fin: (a.fin || '').localeCompare(b.fin || '') }[sort.col] ?? 0;
    return v * sort.dir || rank(a.key) - rank(b.key);
  });
  const sel = ctx.filters[dim];
  const cols = [
    ['key', ctx.colLabel(dim), ''],
    ['n', 'Actions', 'num'],
    m.montant && ['budget', 'Budget', 'num'],
    m.montant && ['part', 'Part du budget', 'partcol'],
    dates && ['debut', 'Première date de début', 'num'],
    dates && ['fin', 'Dernière date de fin', 'num'],
  ].filter(Boolean);
  const th = ([k, l, cls]) => h('th', {
    class: cls + (sort.col === k ? ' sorted' : ''),
    onclick: k === 'part' ? null : () => ctx.onSort(id, { col: k, dir: sort.col === k ? -sort.dir : (k === 'key' || k === 'debut' ? 1 : -1) }),
  }, l, sort.col === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  const maxB = Math.max(1, ...data.map((a) => a.budget));
  const body = data.map((a) => h('tr', {
    class: 'clic' + (sel?.size ? (sel.has(a.key) ? ' choisi' : ' estompe') : ''),
    title: `Filtrer sur « ${a.key} »`, onclick: () => ctx.onFilter(dim, a.key),
  },
  h('td', {}, h('span', { class: 'gdot', style: { background: ctx.colorOf(dim, a.key) } }), a.key),
  h('td', { class: 'num' }, fmtInt(a.n)),
  m.montant ? h('td', { class: 'num' }, fmtEuro(a.budget)) : '',
  m.montant ? h('td', { class: 'partcol' }, h('div', { class: 'pbar' },
    h('span', { style: { width: (100 * a.budget / maxB) + '%', background: ctx.colorOf(dim, a.key) } })),
    h('small', {}, totB ? Math.round(100 * a.budget / totB) + ' %' : '')) : '',
  dates ? h('td', { class: 'num' }, fmtDate(a.debut) || '—') : '',
  dates ? h('td', { class: 'num' }, fmtDate(a.fin) || '—') : ''));
  const foot = h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', { class: 'num' }, fmtInt(totN)),
    m.montant ? h('td', { class: 'num' }, fmtEuro(totB)) : '', m.montant ? h('td', {}) : '',
    dates ? h('td', { class: 'num' }, fmtDate(data.reduce((x, a) => (a.debut && (!x || a.debut < x) ? a.debut : x), null)) || '—') : '',
    dates ? h('td', { class: 'num' }, fmtDate(data.reduce((x, a) => (a.fin && (!x || a.fin > x) ? a.fin : x), null)) || '—') : '');
  return h('section', { class: `card tcard span${span}` },
    h('h3', {}, title, h('span', { class: 'hint' }, 'cliquer une ligne pour filtrer')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'stable' },
      h('thead', {}, h('tr', {}, cols.map(th))), h('tbody', {}, body), h('tfoot', {}, foot))));
}

// Détail mensuel : catégories en lignes, mois en colonnes, intensité = valeur.
function matrixCard(ctx) {
  const m = ctx.mapping;
  const dim = m.categorie;
  const measure = ctx.matrix.measure;
  const cell = new Map();
  const rowsK = new Set(), monthsK = new Set();
  for (const r of ctx.rows) {
    const mo = month(r[m.dateDebut]);
    if (!mo) continue;
    monthsK.add(mo);
    const add = measure === 'budget' ? Number(r[m.montant]) || 0 : 1;
    for (const k of valuesOf(r, dim)) { rowsK.add(k); cell.set(k + '|' + mo, (cell.get(k + '|' + mo) || 0) + add); }
  }
  const months = monthRange([...monthsK].sort());
  const keys = orderCategories([...rowsK], ctx.meta[dim]);
  const max = Math.max(1, ...cell.values());
  const fmt = measure === 'budget' ? fmtEuro : fmtInt;
  const rowTot = (k) => months.reduce((s, mo) => s + (cell.get(k + '|' + mo) || 0), 0);
  const colTot = (mo) => keys.reduce((s, k) => s + (cell.get(k + '|' + mo) || 0), 0);
  const yearOf = (mo) => mo.slice(0, 4);
  const toggle = h('div', { class: 'seg' },
    [['n', 'Nombre'], m.montant && ['budget', 'Budget']].filter(Boolean).map(([k, l]) =>
      h('button', { class: measure === k ? 'on' : '', onclick: () => ctx.onMatrix(k) }, l)));
  return h('section', { class: 'card span12' },
    h('div', { class: 'thead' }, h('h3', {}, `Détail mensuel par ${ctx.colLabel(dim).toLowerCase()}`), toggle),
    months.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'heat' },
      h('thead', {},
        h('tr', {}, h('th', {}), months.map((mo, i) => (i === 0 || yearOf(mo) !== yearOf(months[i - 1])
          ? h('th', { class: 'yr', colspan: months.filter((x) => yearOf(x) === yearOf(mo)).length }, yearOf(mo)) : null)), h('th', {})),
        h('tr', {}, h('th', {}, ctx.colLabel(dim)), months.map((mo) => h('th', { class: 'mo' }, fmtMonth(mo).split(' ')[0])), h('th', { class: 'num' }, 'Total'))),
      h('tbody', {}, keys.map((k) => h('tr', {},
        h('th', { class: 'rowh' }, h('span', { class: 'gdot', style: { background: ctx.colorOf(dim, k) } }), k),
        months.map((mo) => {
          const v = cell.get(k + '|' + mo) || 0;
          const a = v ? 0.12 + 0.78 * (v / max) : 0;
          return h('td', { class: 'hc' + (a > 0.55 ? ' fonce' : ''), style: { '--a': a }, title: v ? `${k} — ${fmtMonth(mo)} : ${fmt(v)}` : '' }, v ? (measure === 'budget' ? fmtEuro(v).replace(' ', ' ') : v) : '');
        }),
        h('td', { class: 'num tot' }, fmt(rowTot(k)))))),
      h('tfoot', {}, h('tr', { class: 'total' }, h('th', {}, 'Total'), months.map((mo) => h('td', { class: 'num' }, colTot(mo) ? (measure === 'budget' ? '' : colTot(mo)) : '')),
        h('td', { class: 'num tot' }, fmt(keys.reduce((s, k) => s + rowTot(k), 0)))))))
      : h('div', { class: 'empty' }, 'Aucune action datée pour ces filtres.'));
}
