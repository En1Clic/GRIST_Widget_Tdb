// Rôles des colonnes, filtres et agrégats. Fonctions pures : aucune dépendance à Grist ni au DOM.

// Chaque rôle : comment le reconnaître automatiquement, et quels types il accepte.
export const ROLES = [
  { key: 'titre',      label: 'Intitulé',              kinds: ['text', 'category'], hint: /intitul|titre|title|name|nom/i },
  { key: 'entite',     label: 'Entité',                kinds: ['category', 'text'], hint: /entit|etabl|agence|site|service|unit/i },
  { key: 'categorie',  label: 'Catégorie',             kinds: ['category', 'text'], hint: /categ|^typolog|^type/i },
  { key: 'axe1',       label: 'Thème',                 kinds: ['category', 'text'], hint: /theme|themat|sujet/i },
  { key: 'axe2',       label: 'Demandeur',             kinds: ['category', 'text'], hint: /demandeur|client|commandit|sponsor/i },
  { key: 'axe3',       label: 'Statut',                kinds: ['category', 'text'], hint: /statut|status|etat|^cadre/i },
  { key: 'dateDebut',  label: 'Date de début',         kinds: ['date'],             hint: /debut|start|date_?d/i },
  { key: 'dateFin',    label: 'Date de fin',           kinds: ['date'],             hint: /fin_eff|fin|end/i },
  { key: 'montant',    label: 'Montant',               kinds: ['number'],           hint: /montant|budget|amount|cout|co[uû]t/i },
  { key: 'manquants',  label: 'Champs à compléter',    kinds: ['text'],             hint: /manquant|missing|incomplet/i },
];

/** Propose un rôle pour chaque colonne, d'après son identifiant et son type. */
export function autoMapping(columns) {
  const map = {};
  const used = new Set();
  for (const role of ROLES) {
    const cands = columns.filter((c) => role.kinds.includes(c.kind) && !used.has(c.id));
    // Préférer une colonne dont l'identifiant correspond ; DATE_FIN_EFF avant DATE_FIN.
    const hit = cands.filter((c) => role.hint.test(c.id) || role.hint.test(c.label))
      .sort((a, b) => (/_EFF$/i.test(b.id) ? 1 : 0) - (/_EFF$/i.test(a.id) ? 1 : 0))[0];
    if (hit) { map[role.key] = hit.id; used.add(hit.id); }
  }
  return map;
}

/** Garde de la configuration enregistrée ce qui existe encore dans la table, complète le reste. */
export function resolveMapping(saved, columns) {
  const ids = new Set(columns.map((c) => c.id));
  const auto = autoMapping(columns);
  const out = {};
  for (const r of ROLES) {
    const s = saved?.[r.key];
    if (s === '') out[r.key] = '';                    // désactivé volontairement
    else if (s && ids.has(s)) out[r.key] = s;
    else out[r.key] = auto[r.key] || '';
  }
  return out;
}

// ---- Valeurs dérivées ----
export const year = (d) => (d ? d.slice(0, 4) : null);
export const month = (d) => (d ? d.slice(0, 7) : null);
export function durationDays(a, b) {
  if (!a) return null;
  const end = b || a;
  return Math.round((Date.parse(end) - Date.parse(a)) / 86400000) + 1;
}
const EMPTY = '(non renseigné)';
const asList = (v) => (Array.isArray(v) ? v : [v]);
export const valuesOf = (row, col) => {
  const v = row[col];
  const list = asList(v).filter((x) => x != null && x !== '');
  return list.length ? list.map(String) : [EMPTY];
};

// ---- Filtres ----
// filters = { annee: Set, <colId>: Set } ; un ensemble vide = pas de filtre.
export function applyFilters(rows, filters, mapping, except = null) {
  const active = Object.entries(filters).filter(([k, s]) => k !== except && s && s.size);
  if (!active.length) return rows;
  return rows.filter((r) => active.every(([k, s]) => {
    if (k === 'annee') return s.has(year(r[mapping.dateDebut]) || EMPTY);
    return valuesOf(r, k).some((v) => s.has(v));
  }));
}

/** Valeurs proposées par un filtre, avec effectif (calculé sur les autres filtres seulement). */
export function filterOptions(rows, filters, mapping, key, meta) {
  const base = applyFilters(rows, filters, mapping, key);
  const counts = new Map();
  const all = new Set();
  for (const r of rows) for (const v of key === 'annee' ? [year(r[mapping.dateDebut]) || EMPTY] : valuesOf(r, key)) all.add(v);
  for (const r of base) for (const v of key === 'annee' ? [year(r[mapping.dateDebut]) || EMPTY] : valuesOf(r, key)) counts.set(v, (counts.get(v) || 0) + 1);
  return orderCategories([...all], key === 'annee' ? null : meta?.[key], key === 'annee')
    .map((v) => ({ value: v, count: counts.get(v) || 0 }));
}

// ---- Agrégats ----
export function orderCategories(values, meta, chrono = false) {
  const order = meta?.order || {};
  return [...values].sort((a, b) => {
    if (a === EMPTY) return 1;
    if (b === EMPTY) return -1;
    if (chrono) return a < b ? -1 : a > b ? 1 : 0;
    const oa = order[a], ob = order[b];
    if (oa != null && ob != null) return oa - ob;
    if (oa != null) return -1;
    if (ob != null) return 1;
    return a.localeCompare(b, 'fr');
  });
}

/** Effectif ou somme par catégorie. measure = null → nombre de lignes. */
export function groupBy(rows, col, measure = null, keyFn = null) {
  const m = new Map();
  for (const r of rows) {
    const keys = keyFn ? [keyFn(r) || EMPTY] : valuesOf(r, col);
    const add = measure ? (Number(r[measure]) || 0) : 1;
    for (const k of keys) m.set(k, (m.get(k) || 0) + add);
  }
  return m;
}

/** Tableau croisé : lignes × séries. */
export function pivot(rows, rowKeyFn, seriesCol, measure = null) {
  const out = new Map();
  const series = new Set();
  for (const r of rows) {
    const rk = rowKeyFn(r) || EMPTY;
    const add = measure ? (Number(r[measure]) || 0) : 1;
    for (const s of valuesOf(r, seriesCol)) {
      series.add(s);
      if (!out.has(rk)) out.set(rk, new Map());
      const inner = out.get(rk);
      inner.set(s, (inner.get(s) || 0) + add);
    }
  }
  return { table: out, series: [...series] };
}

export function kpis(rows, mapping) {
  const m = mapping;
  const n = rows.length;
  const total = m.montant ? rows.reduce((s, r) => s + (Number(r[m.montant]) || 0), 0) : null;
  const durees = m.dateDebut ? rows.map((r) => durationDays(r[m.dateDebut], m.dateFin ? r[m.dateFin] : null)).filter((x) => x != null && x > 0) : [];
  const entites = m.entite ? new Set(rows.flatMap((r) => valuesOf(r, m.entite)).filter((v) => v !== EMPTY)).size : null;
  const aCompleter = m.manquants ? rows.filter((r) => r[m.manquants]).length : null;
  return {
    actions: n,
    entites,
    budget: total,
    budgetMoyen: n && total != null ? total / n : null,
    dureeMoyenne: durees.length ? durees.reduce((a, b) => a + b, 0) / durees.length : null,
    aCompleter,
  };
}

/** Complète une liste triée de mois 'AAAA-MM' avec les mois vides intermédiaires. */
export function monthRange(sorted) {
  const months = sorted.filter((k) => /^\d{4}-\d{2}$/.test(k));
  const rest = sorted.filter((k) => !/^\d{4}-\d{2}$/.test(k));
  if (months.length < 2) return sorted;
  const out = [];
  let [y, m] = months[0].split('-').map(Number);
  const [ye, me] = months[months.length - 1].split('-').map(Number);
  while (y < ye || (y === ye && m <= me)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return [...out, ...rest];
}

/**
 * Tendance d'un indicateur le long d'une colonne de dates :
 *  - delta : variation (%) entre la seconde moitié des lignes (ordonnées par date) et la première,
 *            même méthode qu'Advanced Charts (« vs période précédente ») ;
 *  - spark : valeur de l'indicateur mois par mois (mois vides comblés).
 * agg(sousEnsembleDeLignes) -> nombre.
 */
export function trend(rows, dateCol, agg) {
  if (!dateCol) return { delta: null, spark: [] };
  const dated = rows.filter((r) => r[dateCol]).sort((a, b) => String(a[dateCol]).localeCompare(String(b[dateCol])));
  let delta = null;
  if (dated.length > 3) {
    const mid = Math.floor(dated.length / 2);
    const prev = agg(dated.slice(0, mid)), curr = agg(dated.slice(mid));
    if (prev) delta = Math.round(((curr - prev) / Math.abs(prev)) * 10000) / 100;
  }
  const byMonth = new Map();
  for (const r of dated) { const k = month(r[dateCol]); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(r); }
  const months = monthRange([...byMonth.keys()].sort());
  const spark = months.map((k) => (byMonth.has(k) ? agg(byMonth.get(k)) || 0 : 0));
  return { delta, spark };
}

/** Agrégats réutilisables par les cartes. */
export const AGG = {
  count: () => (rs) => rs.length,
  countd: (col) => (rs) => new Set(rs.flatMap((r) => valuesOf(r, col)).filter((v) => v !== EMPTY)).size,
  sum: (col) => (rs) => rs.reduce((s, r) => s + (Number(r[col]) || 0), 0),
  avg: (col) => (rs) => (rs.length ? rs.reduce((s, r) => s + (Number(r[col]) || 0), 0) / rs.length : 0),
  nonEmpty: (col) => (rs) => rs.filter((r) => r[col]).length,
  avgDays: (d0, d1) => (rs) => {
    const ds = rs.map((r) => durationDays(r[d0], d1 ? r[d1] : null)).filter((x) => x != null && x > 0);
    return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
  },
};

export { EMPTY };
