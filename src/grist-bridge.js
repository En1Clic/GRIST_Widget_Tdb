// Pont vers Grist : la mécanique qui branche le widget sur une table du document.
//
// Repris et allégé d'Advanced Charts (ANUPRESS, licence MIT, src/grist/bridge.js et
// src/grist/dates.js, v3.7.2) — voir THIRD-PARTY-NOTICES.md. Ce qui est conservé :
//   - la poignée de main : on ne se croit « dans Grist » que si l'hôte RÉPOND (message reçu
//     avant le délai), pas parce que grist-plugin-api.js est chargé ;
//   - la lecture du schéma réel par les tables méta (_grist_Tables, _grist_Tables_column),
//     avec le type, le libellé, la table cible et la colonne visible des références ;
//   - la résolution des références par table entière (un appel par table cible, jamais par
//     ligne) ;
//   - la conversion des dates Grist (secondes epoch) en 'AAAA-MM-JJ', fuseau compris ;
//   - les options persistées du widget (getOption / setOption).
// Ce qui est retiré : éditeur, tableaux de bord multiples, table de configuration, écriture
// de lignes, pièces jointes, widgets imbriqués, impression. Ce widget N'ÉCRIT JAMAIS dans
// les tables du document : seule son option de configuration est enregistrée.

const g = () => (typeof window !== 'undefined' ? window.grist : undefined);
const apiPresent = () => { try { return !!g() && typeof g().ready === 'function'; } catch { return false; } };

let connected = false;
let access = 'none';
export const isLive = () => connected;
export const accessLevel = () => access;

function withTimeout(promise, ms) {
  let timer;
  const clock = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([Promise.resolve(promise), clock]).finally(() => clearTimeout(timer));
}

/**
 * Poignée de main. Renvoie true seulement si un Grist répond.
 * `?demo` dans l'URL, ou une page ouverte hors iframe, renvoient false (mode démonstration).
 * L'accès complet est demandé ici, au premier et seul appel à ready() : l'API ignore les suivants.
 * Il sert à LIRE les autres tables (référentiels) ; aucune écriture n'est faite dans les données.
 */
export async function connect(timeoutMs = 4000) {
  if (connected) return true;
  if (!apiPresent()) return false;
  try { if (new URLSearchParams(location.search).has('demo')) return false; } catch {}
  try { if (window.self === window.top) return false; } catch { /* iframe d'une autre origine */ }
  try {
    const api = g();
    const hostAnswered = new Promise((resolve) => {
      try { api.on('message', (msg) => { noteAccess(msg); resolve(true); }); } catch {}
    });
    const ret = api.ready({ requiredAccess: 'full' });
    await withTimeout(typeof api.on === 'function' ? hostAnswered : ret, timeoutMs);
    connected = true;
    return true;
  } catch { return false; }
}

function noteAccess(msg) {
  const level = msg?.settings?.accessLevel;
  if (typeof level === 'string' && level) access = level;
}

/** Rappel à chaque modification des données de la table liée au widget. */
export function onDataChange(cb) {
  if (!connected) return;
  let first = true;
  try {
    g().onRecords(() => { if (first) { first = false; return; } cb(); }, { includeColumns: 'normal' });
  } catch { /* hôte sans onRecords : pas de rafraîchissement automatique */ }
}

// ---- Tables méta (mises en cache pour la session) ----
let metaTablesP = null, metaColumnsP = null, tableListP = null;
const fetchMetaTables = () => (metaTablesP ||= g().docApi.fetchTable('_grist_Tables'));
const fetchMetaColumns = () => (metaColumnsP ||= g().docApi.fetchTable('_grist_Tables_column'));
const fetchTableList = () => (tableListP ||= g().docApi.listTables());
export function invalidateMeta() { metaTablesP = metaColumnsP = tableListP = null; }

export async function listTables() {
  if (!connected) return [];
  try { return (await fetchTableList()).filter((t) => !/^_grist_/.test(t)); } catch { return []; }
}

/** Colonnes réelles d'une table : id, libellé, type, formule, options, cible des références. */
export async function getColumns(tableId) {
  if (!connected) return [];
  const [mt, mc] = await Promise.all([fetchMetaTables(), fetchMetaColumns()]);
  const tRowToId = {};
  for (let i = 0; i < mt.id.length; i++) tRowToId[mt.id[i]] = mt.tableId[i];
  const cRowToColId = {};
  for (let i = 0; i < mc.id.length; i++) cRowToColId[mc.id[i]] = mc.colId[i];
  const cols = [];
  for (let i = 0; i < mc.id.length; i++) {
    if (tRowToId[mc.parentId[i]] !== tableId) continue;
    const id = mc.colId[i];
    if (!id || id === 'manualSort' || /^gristHelper_/.test(id)) continue;
    let widgetOptions = null;
    try { const raw = mc.widgetOptions?.[i]; if (raw) widgetOptions = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
    const type = String(mc.type[i] || 'Text');
    const ref = /^(Ref|RefList):(.+)$/.exec(type);
    const vis = mc.visibleCol?.[i];
    cols.push({
      id, label: mc.label[i] || id, type, widgetOptions,
      refTable: ref ? ref[2] : null,
      refVisibleCol: ref && vis ? (cRowToColId[vis] || null) : null,
    });
  }
  return cols;
}

/** Lignes brutes d'une table, en objets {id, COL: valeur}. */
export async function fetchRows(tableId) {
  const tbl = await g().docApi.fetchTable(tableId);
  const keys = Object.keys(tbl || {});
  const n = tbl?.id?.length || 0;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) { const r = {}; for (const k of keys) r[k] = tbl[k][i]; rows[i] = r; }
  return rows;
}

// ---- Dates ----
// Date : minuit UTC du jour, en secondes. DateTime:Zone : un instant, lu dans le fuseau de la colonne.
export function zoneOfType(type) {
  const t = String(type || '');
  const dt = /^DateTime(?::(.+))?$/i.exec(t);
  if (dt) return dt[1] || 'UTC';
  return /^Date$/i.test(t) ? null : undefined;
}
const fmts = new Map();
function dayIn(ms, zone) {
  let f = fmts.get(zone);
  if (f === undefined) {
    try { f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { f = null; }
    fmts.set(zone, f);
  }
  return f ? f.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
}
export function toDayString(value, zone) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!isFinite(ms)) return null;
  return zone ? dayIn(ms, zone) : new Date(ms).toISOString().slice(0, 10);
}

// ---- Options du widget (stockées dans la section de la page, pas dans les tables) ----
export async function getOption(key) {
  if (!connected) return null;
  try { return await g().getOption(key); } catch { return null; }
}
export async function setOption(key, value) {
  if (!connected) return false;
  try { await g().setOption(key, value); return true; } catch { return false; }
}
