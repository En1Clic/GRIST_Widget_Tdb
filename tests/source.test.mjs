// Test du branchement Grist sans Grist : un faux hôte imite les réponses de l'API plugin
// (tables méta, table Actions, référentiels) et l'on vérifie la normalisation produite.
// Lancer : node tests/source.test.mjs
import assert from 'node:assert/strict';

const day = (s) => Date.parse(s + 'T00:00:00Z') / 1000;
const tables = {
  _grist_Tables: { id: [1, 2, 3], tableId: ['Actions', 'Categories', 'Entites'] },
  _grist_Tables_column: {
    id:          [10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 30, 31],
    parentId:    [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3],
    colId:       ['INTITULE', 'CATEGORIE', 'ENTITE', 'DATE_DEBUT', 'MONTANT', 'STATUT', 'CANAUX', 'Libelle', 'Couleur', 'Ordre', 'Nom', 'Couleur'],
    label:       ['Intitulé', 'Catégorie', 'Entité', 'Date de début', 'Montant', 'Statut', 'Canaux', 'Libellé', 'Couleur', 'Ordre', 'Nom', 'Couleur'],
    type:        ['Text', 'Ref:Categories', 'Ref:Entites', 'Date', 'Numeric', 'Choice', 'ChoiceList', 'Text', 'Text', 'Int', 'Text', 'Text'],
    visibleCol:  [0, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    widgetOptions: ['', '', '', '', '', JSON.stringify({ choices: ['Confirmé', 'Prévu'], choiceOptions: { 'Confirmé': { fillColor: '#2f7f6f' } } }), '', '', '', '', '', ''],
  },
  Actions: {
    id: [1, 2, 3],
    INTITULE: ['A', 'B', 'C'],
    CATEGORIE: [2, 1, 0],
    ENTITE: [1, 1, 2],
    DATE_DEBUT: [day('2026-03-15'), null, day('2027-01-01')],
    MONTANT: [1000, ['E', 'TypeError'], 50],
    STATUT: ['Confirmé', 'Prévu', ''],
    CANAUX: [['L', 'Radio', 'Presse'], null, ['L']],
  },
  Categories: { id: [1, 2], Libelle: ['Campagne', 'Presse'], Couleur: ['#5b9bc4', 'pas une couleur'], Ordre: [1, 4] },
  Entites: { id: [1, 2], Nom: ['Agence Nord', 'Agence Sud'], Couleur: ['#2f7f6f', '#8cbf8a'] },
};

let onMessage = null;
const options = {};
globalThis.location = { search: '' };
globalThis.window = {
  self: 1, top: 2, location: globalThis.location,
  grist: {
    ready: () => setTimeout(() => onMessage?.({ settings: { accessLevel: 'full' } }), 5),
    on: (ev, cb) => { if (ev === 'message') onMessage = cb; },
    onRecords: () => {},
    getOption: async (k) => options[k],
    setOption: async (k, v) => { options[k] = v; },
    docApi: {
      listTables: async () => ['Actions', 'Categories', 'Entites'],
      fetchTable: async (t) => structuredClone(tables[t]),
    },
  },
};

// Même suffixe de version que celui posé par outils/versionner.py, pour partager les modules.
const { readFileSync } = await import('node:fs');
const V = (readFileSync(new URL('../src/source.js', import.meta.url), 'utf8').match(/grist-bridge\.js(\?v=[\w.-]+)?'/) || [])[1] || '';
const bridge = await import('../src/grist-bridge.js' + V);
const { loadGrist } = await import('../src/source.js' + V);
const M = await import('../src/model.js' + V);

assert.equal(await bridge.connect(500), true, 'poignée de main');
assert.equal(bridge.accessLevel(), 'full');

const d = await loadGrist();
assert.equal(d.table, 'Actions', 'table Actions choisie par défaut');
const [a, b, c] = d.rows;
assert.equal(a.CATEGORIE, 'Presse', 'référence traduite en libellé');
assert.equal(c.CATEGORIE, '', 'référence vide');
assert.equal(a.ENTITE, 'Agence Nord');
assert.equal(a.DATE_DEBUT, '2026-03-15', 'date Grist -> AAAA-MM-JJ');
assert.equal(b.DATE_DEBUT, null);
assert.equal(b.MONTANT, null, 'cellule en erreur neutralisée');
assert.deepEqual(a.CANAUX, ['Radio', 'Presse'], 'ChoiceList décodée');
assert.deepEqual(c.CANAUX, []);
assert.equal(d.meta.CATEGORIE.colors.Campagne, '#5b9bc4', 'couleur du référentiel');
assert.equal(d.meta.CATEGORIE.colors.Presse, undefined, 'couleur invalide ignorée');
assert.equal(d.meta.CATEGORIE.order.Presse, 4, 'ordre du référentiel');
assert.equal(d.meta.STATUT.colors['Confirmé'], '#2f7f6f', 'couleur de Choice');
assert.equal(d.columns.find((x) => x.id === 'CATEGORIE').kind, 'category');

const map = M.autoMapping(d.columns);
assert.equal(map.entite, 'ENTITE');
assert.equal(map.categorie, 'CATEGORIE');
assert.equal(map.dateDebut, 'DATE_DEBUT');
assert.equal(map.montant, 'MONTANT');
assert.equal(map.axe3, 'STATUT');

const f = M.applyFilters(d.rows, { annee: new Set(['2026']), ENTITE: new Set(['Agence Nord']) }, map);
assert.deepEqual(f.map((r) => r.id), [1], 'filtres combinés');
assert.deepEqual(M.monthRange(['2026-11', '2027-02']), ['2026-11', '2026-12', '2027-01', '2027-02']);
assert.equal(M.kpis(d.rows, map).budget, 1050);

assert.equal(await bridge.setOption('kpiConfig', { table: 'Actions' }), true);
assert.deepEqual(await bridge.getOption('kpiConfig'), { table: 'Actions' }, 'option persistée');

console.log('OK — branchement, normalisation, filtres et options vérifiés');
