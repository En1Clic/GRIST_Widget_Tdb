// Source de données unique pour l'écran : Grist en direct, ou jeu de démonstration.
// Les deux renvoient le même « jeu » normalisé, si bien que l'écran ne sait pas d'où
// viennent les lignes (même principe que le provider d'Advanced Charts).
//
// Jeu = {
//   live: bool, tables: [id], table: id,
//   columns: [{ id, label, type, kind }],     kind : date | number | category | list | bool | text
//   rows: [{ id, COL: valeur normalisée }],   dates 'AAAA-MM-JJ', références en libellés
//   meta: { COL: { colors: {libellé: '#hex'}, order: {libellé: rang} } }
// }

import * as bridge from './grist-bridge.js';

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const COLOR_COL = /^(couleur|color|colour)$/i;
const ORDER_COL = /^(ordre|order|rang|position)$/i;

function kindOf(type) {
  if (bridge.zoneOfType(type) !== undefined) return 'date';
  if (/^(Numeric|Int)$/.test(type)) return 'number';
  if (type === 'Bool') return 'bool';
  if (/^Ref:/.test(type) || type === 'Choice') return 'category';
  if (/^RefList:/.test(type) || type === 'ChoiceList') return 'list';
  return 'text';
}

// ['L', a, b] -> [a, b]
const listOf = (v) => (Array.isArray(v) ? (v[0] === 'L' ? v.slice(1) : v) : (v == null || v === '' ? [] : [v]));

export async function loadGrist(tableId) {
  const tables = await bridge.listTables();
  const table = tables.includes(tableId) ? tableId : (tables.includes('Actions') ? 'Actions' : tables[0]);
  if (!table) return { live: true, tables, table: null, columns: [], rows: [], meta: {} };

  const cols = await bridge.getColumns(table);
  const raw = await bridge.fetchRows(table);

  // Une lecture par table référencée, pour traduire les identifiants en libellés et
  // récupérer couleur et ordre si le référentiel en porte.
  const targets = [...new Set(cols.map((c) => c.refTable).filter((t) => t && tables.includes(t)))];
  const refRows = {};
  await Promise.all(targets.map(async (t) => {
    try { refRows[t] = { rows: await bridge.fetchRows(t), cols: await bridge.getColumns(t) }; }
    catch (e) { console.warn('[KPI] référentiel illisible', t, e); }
  }));

  const meta = {};
  const resolvers = {};
  for (const c of cols) {
    if (!c.refTable) continue;
    const ref = refRows[c.refTable];
    if (!ref) continue;
    const vis = c.refVisibleCol;
    const colorCol = ref.cols.find((x) => COLOR_COL.test(x.id))?.id;
    const orderCol = ref.cols.find((x) => ORDER_COL.test(x.id))?.id;
    const labels = Object.create(null);
    const m = { colors: {}, order: {} };
    for (const r of ref.rows) {
      const label = vis ? String(r[vis] ?? '') : String(r.id);
      labels[r.id] = label;
      if (colorCol && HEX.test(String(r[colorCol] || ''))) m.colors[label] = r[colorCol];
      if (orderCol && typeof r[orderCol] === 'number') m.order[label] = r[orderCol];
    }
    resolvers[c.id] = labels;
    meta[c.id] = m;
  }
  // Colonnes Choice : couleurs et ordre portés par la colonne elle-même.
  for (const c of cols) {
    if (c.type !== 'Choice' && c.type !== 'ChoiceList') continue;
    const m = meta[c.id] = { colors: {}, order: {} };
    (c.widgetOptions?.choices || []).forEach((ch, i) => { m.order[ch] = i; });
    for (const [ch, o] of Object.entries(c.widgetOptions?.choiceOptions || {})) {
      if (HEX.test(o?.fillColor || '')) m.colors[ch] = o.fillColor;
    }
  }

  const columns = cols.map((c) => ({ id: c.id, label: c.label, type: c.type, kind: kindOf(c.type) }));
  const rows = raw.map((r) => {
    const o = { id: r.id };
    for (const c of cols) {
      const v = r[c.id];
      const kind = kindOf(c.type);
      if (kind === 'date') o[c.id] = bridge.toDayString(v, bridge.zoneOfType(c.type));
      else if (/^Ref:/.test(c.type)) o[c.id] = v ? (resolvers[c.id]?.[v] ?? String(v)) : '';
      else if (/^RefList:/.test(c.type)) o[c.id] = listOf(v).map((x) => resolvers[c.id]?.[x] ?? String(x));
      else if (c.type === 'ChoiceList') o[c.id] = listOf(v).map(String);
      else if (Array.isArray(v) && v[0] === 'E') o[c.id] = null;          // cellule en erreur
      else o[c.id] = v;
    }
    return o;
  });
  return { live: true, tables, table, columns, rows, meta };
}

export async function loadDemo() {
  const res = await fetch('demo/actions-demo.json');
  const data = await res.json();
  return { live: false, tables: [data.table], ...data };
}
