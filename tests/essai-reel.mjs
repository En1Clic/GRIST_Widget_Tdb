// Essai du pont sur un VRAI document Grist, hors navigateur : les appels docApi du widget sont
// relayés vers l'API REST du document. Lecture seule (GET uniquement).
// Lancer : GRIST_API_KEY=… node tests/essai-reel.mjs <url-instance> <docId> [table]
// La clé n'est lue que dans l'environnement ; ne jamais l'écrire dans un fichier.
const [base, doc, table = 'Actions'] = process.argv.slice(2);
const key = process.env.GRIST_API_KEY;
if (!base || !doc || !key) { console.error('usage : GRIST_API_KEY=… node tests/essai-reel.mjs <url-instance> <docId> [table]'); process.exit(1); }

const rest = async (path) => {
  const r = await fetch(`${base.replace(/\/$/, '')}/api/docs/${doc}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};
let onMessage = null;
globalThis.location = { search: '' };
globalThis.window = {
  self: 1, top: 2, location: globalThis.location,
  grist: {
    ready: () => setTimeout(() => onMessage?.({ settings: { accessLevel: 'full' } }), 5),
    on: (ev, cb) => { if (ev === 'message') onMessage = cb; },
    onRecords: () => {}, getOption: async () => null, setOption: async () => {},
    docApi: {
      listTables: async () => (await rest('/tables')).tables.map((t) => t.id),
      fetchTable: async (t) => rest(`/tables/${encodeURIComponent(t)}/data`),
    },
  },
};

const bridge = await import('../src/grist-bridge.js');
const { loadGrist } = await import('../src/source.js');
const M = await import('../src/model.js');
await bridge.connect(1000);
const d = await loadGrist(table);
const map = M.resolveMapping(null, d.columns);

console.log('Table :', d.table, '|', d.rows.length, 'lignes |', d.columns.length, 'colonnes');
console.log('Rôles détectés :', map);
console.log('Couleurs/ordre lus :', Object.fromEntries(Object.entries(d.meta).map(([k, m]) => [k, `${Object.keys(m.colors).length} couleurs, ${Object.keys(m.order).length} rangs`])));
const show = Object.values(map).filter(Boolean);
console.log('Exemples de lignes normalisées (colonnes des rôles) :');
for (const r of d.rows.slice(0, 3)) console.log(' ', JSON.stringify(Object.fromEntries(show.map((c) => [c, r[c]]))));
console.log('Indicateurs (sans filtre) :', M.kpis(d.rows, map));
if (map.categorie) console.log('Lignes par catégorie :', Object.fromEntries(M.groupBy(d.rows, map.categorie)));
