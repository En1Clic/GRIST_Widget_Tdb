// Widget de saisie : page d'accueil animée (animation centrale qui glisse à gauche, bulles
// d'explication à droite), puis fiche HTML générée à partir des colonnes de la table liée.
// « Valider » crée la ligne dans la table, avec les droits de l'utilisateur connecté.
//
// La fiche n'a aucun champ codé en dur : libellés, types, listes et ordre viennent du document.
// Hors de Grist (ou avec ?demo), elle fonctionne sur le jeu de démonstration, sans rien écrire.

import * as bridge from '../src/grist-bridge.js?v=20261118-1029';
import { $, h } from '../src/dom.js?v=20261118-1029';

const state = { view: 'accueil', table: null, fields: [], values: {}, live: false, saving: false, error: null, lastId: null, demoRows: [] };
const LONG_TEXT = /desc|objectif|message|comment|detail|détail|note|contexte|résumé|resume/i;
const TITLE = /intitul|titre|title|libell|nom|name/i;

// ---------- chargement du schéma ----------
async function boot() {
  state.live = await bridge.connect();
  try {
    if (state.live) await loadGrist(); else await loadDemo();
  } catch (e) {
    console.error(e);
    state.error = 'Lecture impossible : ' + (e.message || e) + (state.live && bridge.accessLevel() !== 'full'
      ? ' — donnez au widget l\'accès « complet » dans le panneau de droite.' : '');
  }
  render();
}

async function loadGrist() {
  const tables = await bridge.listTables();
  // Table liée au widget si Grist la communique, sinon « Actions », sinon la première.
  let table = null;
  try { table = await window.grist.selectedTable.getTableId(); } catch { /* ancienne API */ }
  state.table = table && tables.includes(table) ? table : (tables.includes('Actions') ? 'Actions' : tables[0]);
  const cols = (await bridge.getColumns(state.table)).filter(editable);
  const targets = [...new Set(cols.map((c) => c.refTable).filter((t) => t && tables.includes(t)))];
  const refs = {};
  await Promise.all(targets.map(async (t) => {
    try { refs[t] = { rows: await bridge.fetchRows(t), cols: await bridge.getColumns(t) }; } catch { /* référentiel illisible pour ce profil */ }
  }));
  state.fields = cols.map((c) => toField(c, refs));
  linkDependencies(state.fields, refs);
}

async function loadDemo() {
  const data = await (await fetch('../demo/actions-demo.json?v=20261118-1029')).json();
  state.table = data.table;
  state.demoRows = data.rows;
  state.fields = data.columns.filter((c) => !/_EFF$|MANQUANTS/i.test(c.id)).map((c) => {
    const f = { id: c.id, label: c.label, type: c.type, kind: kindOf(c.type), options: [], wo: {} };
    if (f.kind === 'ref' || f.kind === 'choice' || f.kind === 'multi') {
      const vals = [...new Set(data.rows.flatMap((r) => (Array.isArray(r[c.id]) ? r[c.id] : [r[c.id]])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
      f.options = vals.map((v) => ({ value: v, label: v }));
    }
    return f;
  });
  markTitle(state.fields);
}

const editable = (c) => !c.isFormula && c.id !== 'manualSort' && !/^gristHelper_/.test(c.id) && !/^Attachments/.test(c.type);

function kindOf(type) {
  if (/^Ref:/.test(type)) return 'ref';
  if (/^RefList:/.test(type) || type === 'ChoiceList') return 'multi';
  if (type === 'Choice') return 'choice';
  if (type === 'Date') return 'date';
  if (/^DateTime/.test(type)) return 'datetime';
  if (type === 'Numeric' || type === 'Int') return 'number';
  if (type === 'Bool') return 'bool';
  return 'text';
}

function toField(c, refs) {
  const f = { id: c.id, label: c.label, type: c.type, kind: kindOf(c.type), refTable: c.refTable, options: [], wo: c.widgetOptions || {} };
  if (c.refTable && refs[c.refTable]) {
    const { rows, cols } = refs[c.refTable];
    const vis = c.refVisibleCol;
    const actif = cols.find((x) => /^actif|^active$/i.test(x.id) && x.type === 'Bool')?.id;
    const ordre = cols.find((x) => /^(ordre|order|rang|position)$/i.test(x.id))?.id;
    f.refCols = cols;
    f.options = rows.filter((r) => !actif || r[actif] !== false)
      .map((r) => ({ value: r.id, label: String(vis ? r[vis] ?? '' : r.id), row: r, rank: ordre ? r[ordre] : null }))
      .filter((o) => o.label)
      .sort((a, b) => (a.rank != null && b.rank != null ? a.rank - b.rank : a.label.localeCompare(b.label, 'fr')));
  } else if (f.kind === 'choice' || (f.kind === 'multi' && c.type === 'ChoiceList')) {
    f.options = (f.wo.choices || []).map((v) => ({ value: v, label: v }));
  }
  return f;
}

// Liste dépendante générique : si le référentiel d'un champ A porte une référence vers le
// référentiel d'un autre champ B de la fiche, les choix de A sont filtrés par la valeur de B.
// (ex. une ville rattachée à une région, quand la fiche a aussi un champ région)
function linkDependencies(fields) {
  for (const a of fields) {
    if (a.kind !== 'ref' || !a.refCols) continue;
    for (const b of fields) {
      if (b === a || b.kind !== 'ref') continue;
      const link = a.refCols.find((rc) => rc.refTable === b.refTable && /^Ref:/.test(rc.type));
      if (link) { a.dependsOn = { field: b.id, col: link.id }; break; }
    }
  }
  markTitle(fields);
}

function markTitle(fields) {
  const t = fields.find((f) => f.kind === 'text' && (TITLE.test(f.id) || TITLE.test(f.label))) || fields.find((f) => f.kind === 'text');
  if (t) t.required = true;
}

// ---------- accueil ----------
const TIPS = [
  { icon: '1', title: 'Une action, une fiche', text: 'Chaque action est saisie une seule fois, dans une fiche. Elle alimente aussitôt le tableau de bord, le planning et les tableaux de synthèse.' },
  { icon: '2', title: 'Comment saisir', text: 'Cliquez sur « Saisir une action », complétez la fiche : les listes reprennent les référentiels du document, les champs marqués d\'un astérisque sont obligatoires. Validez pour enregistrer.' },
  { icon: '3', title: 'Ce qui s\'affiche ensuite', text: 'Votre action apparaît dans les indicateurs, le Gantt et les tableaux. Chacun ne voit que les actions de son périmètre, selon les droits du document.' },
  { icon: '4', title: 'Bonnes pratiques', text: 'Un intitulé explicite, des dates de début et de fin renseignées, un montant chiffré : ce sont ces informations qui rendent les indicateurs fiables.' },
];

function illustration() {
  const s = h('div', { class: 'illu', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 220 200">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
    <circle class="halo" cx="110" cy="100" r="86"/>
    <g class="sheet"><rect x="52" y="34" width="116" height="140" rx="12" fill="var(--surface-solid)" stroke="var(--border-strong)"/>
      <rect class="ln l1" x="68" y="54" width="70" height="8" rx="4"/><rect class="ln l2" x="68" y="72" width="84" height="6" rx="3"/>
      <rect class="ln l3" x="68" y="86" width="60" height="6" rx="3"/>
      <rect class="bar b1" x="70" y="148" width="14" height="0" rx="3"/><rect class="bar b2" x="92" y="148" width="14" height="0" rx="3"/>
      <rect class="bar b3" x="114" y="148" width="14" height="0" rx="3"/><rect class="bar b4" x="136" y="148" width="14" height="0" rx="3"/></g>
    <g class="pen"><rect x="-4" y="-34" width="10" height="40" rx="3" fill="url(#g1)" transform="rotate(35)"/><path d="M-1 6 L5 6 L2 13 Z" transform="rotate(35)" fill="var(--accent-2)"/></g>
    <g class="check"><circle cx="168" cy="44" r="17" fill="url(#g1)"/><path d="M160 44 l6 6 l11 -12" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></g>
  </svg>`;
  return s;
}

function viewAccueil() {
  const stage = h('section', { class: 'stage' },
    h('div', { class: 'hero' }, illustration(),
      h('h1', {}, 'Bienvenue'),
      h('p', { class: 'lede' }, 'Saisissez vos actions en quelques minutes ; le tableau de bord se met à jour tout seul.'),
      h('button', { class: 'cta', onclick: () => go('fiche') }, 'Saisir une action', h('span', { class: 'arr' }, '→'))),
    h('div', { class: 'bubbles' }, TIPS.map((t, i) => h('article', { class: 'bubble', style: { '--i': i } },
      h('span', { class: 'bnum' }, t.icon), h('div', {}, h('h2', {}, t.title), h('p', {}, t.text))))));
  // Animation : l'illustration apparaît au centre, puis glisse à gauche et laisse entrer les bulles.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => stage.classList.add('docked'), reduce ? 0 : 1700);
  return stage;
}

// ---------- fiche ----------
function input(f) {
  const v = state.values[f.id];
  const set = (val) => { state.values[f.id] = val; state.error = null; refreshDependents(f.id); };
  const id = 'f-' + f.id;
  switch (f.kind) {
    case 'ref': case 'choice': {
      let opts = f.options;
      if (f.dependsOn) {
        const parent = state.values[f.dependsOn.field];
        if (parent) opts = opts.filter((o) => !o.row || o.row[f.dependsOn.col] === parent);
      }
      return h('select', { id, onchange: (e) => set(e.target.value === '' ? null : (f.kind === 'ref' && state.live ? Number(e.target.value) : e.target.value)) },
        h('option', { value: '' }, f.dependsOn && !state.values[f.dependsOn.field] ? '— choisir d\'abord « ' + labelOf(f.dependsOn.field) + ' » ou toute valeur —' : '— choisir —'),
        opts.map((o) => h('option', { value: o.value, selected: v != null && String(v) === String(o.value) }, o.label)));
    }
    case 'multi': {
      const sel = new Set(v || []);
      return h('div', { class: 'chips', id }, f.options.map((o) => h('button', {
        type: 'button', class: 'chip' + (sel.has(o.value) ? ' on' : ''), 'aria-pressed': sel.has(o.value) ? 'true' : 'false',
        onclick: (e) => { sel.has(o.value) ? sel.delete(o.value) : sel.add(o.value); set([...sel]); e.currentTarget.classList.toggle('on'); },
      }, o.label)), f.options.length ? '' : h('span', { class: 'muted' }, 'Aucune valeur proposée'));
    }
    case 'date': return h('input', { id, type: 'date', value: v || '', oninput: (e) => { set(e.target.value || null); checkDates(); } });
    case 'datetime': return h('input', { id, type: 'datetime-local', value: v || '', oninput: (e) => set(e.target.value || null) });
    case 'number': return h('input', { id, type: 'number', step: f.type === 'Int' ? '1' : 'any', value: v ?? '', oninput: (e) => set(e.target.value === '' ? null : Number(e.target.value)) });
    case 'bool': return h('label', { class: 'switch' }, h('input', { id, type: 'checkbox', checked: !!v, onchange: (e) => set(e.target.checked) }), h('span', {}, v ? 'Oui' : 'Non'));
    default: {
      const long = LONG_TEXT.test(f.id) || LONG_TEXT.test(f.label) || f.wo.wrap;
      return long ? h('textarea', { id, rows: 3, oninput: (e) => set(e.target.value) }, v || '')
        : h('input', { id, type: 'text', value: v || '', oninput: (e) => set(e.target.value) });
    }
  }
}
const labelOf = (id) => state.fields.find((f) => f.id === id)?.label || id;

function refreshDependents(changedId) {
  for (const f of state.fields) {
    if (f.dependsOn?.field !== changedId) continue;
    const box = document.querySelector(`[data-field="${CSS.escape(f.id)}"] .ctl`);
    if (!box) continue;
    const cur = state.values[f.id];
    const opt = f.options.find((o) => String(o.value) === String(cur));
    if (cur != null && opt?.row && opt.row[f.dependsOn.col] !== state.values[changedId]) delete state.values[f.id];
    box.replaceChildren(input(f));
  }
}

// Paire de dates début / fin repérée par son identifiant : on signale une fin antérieure au début.
function datePair() {
  const ds = state.fields.filter((f) => f.kind === 'date');
  const debut = ds.find((f) => /debut|début|start|from/i.test(f.id + f.label));
  const fin = ds.find((f) => f !== debut && /fin|end|to\b/i.test(f.id + f.label));
  return debut && fin ? [debut, fin] : null;
}
function checkDates() {
  const p = datePair(); const w = $('#datewarn');
  if (!p || !w) return true;
  const [a, b] = p.map((f) => state.values[f.id]);
  const bad = a && b && b < a;
  w.hidden = !bad;
  return !bad;
}

function viewFiche() {
  const pair = datePair();
  const form = h('form', { class: 'sheetform', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    h('div', { class: 'fgrid' }, state.fields.map((f) => {
      const wide = f.kind === 'multi' || (f.kind === 'text' && (LONG_TEXT.test(f.id) || LONG_TEXT.test(f.label) || f.wo?.wrap));
      return h('div', { class: 'fld' + (wide ? ' wide' : ''), 'data-field': f.id },
        h('label', { for: 'f-' + f.id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : ''),
        h('div', { class: 'ctl' }, input(f)));
    })),
    pair ? h('p', { id: 'datewarn', class: 'warn', hidden: true }, `« ${pair[1].label} » est antérieure à « ${pair[0].label} ».`) : '',
    state.error ? h('p', { class: 'err' }, state.error) : '',
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'ghost', onclick: () => go('accueil') }, 'Annuler'),
      h('button', { type: 'submit', class: 'cta', disabled: state.saving }, state.saving ? 'Enregistrement…' : 'Valider la fiche')));
  return h('section', { class: 'fiche' },
    h('div', { class: 'fhead' }, h('button', { class: 'back', onclick: () => go('accueil') }, '← Accueil'),
      h('div', {}, h('h1', {}, 'Nouvelle action'), h('p', { class: 'lede' }, `Table « ${state.table} » · les champs marqués * sont obligatoires.`))),
    form);
}

function toGrist(f, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return undefined;
  switch (f.kind) {
    case 'ref': return state.live ? Number(v) : v;               // démo : libellés, pas d'identifiants
    case 'multi': return ['L', ...(f.type.startsWith('RefList') && state.live ? v.map(Number) : v)];
    case 'date': return Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / 1000;
    case 'datetime': return Date.parse(v + 'Z') / 1000;
    default: return v;
  }
}

async function submit() {
  const missing = state.fields.filter((f) => f.required && !String(state.values[f.id] ?? '').trim());
  if (missing.length) { state.error = 'À compléter : ' + missing.map((f) => f.label).join(', ') + '.'; render(); return; }
  if (!checkDates()) { state.error = 'Vérifiez les dates avant de valider.'; render(); return; }
  const fields = {};
  for (const f of state.fields) { const g = toGrist(f, state.values[f.id]); if (g !== undefined) fields[f.id] = g; }
  if (!state.live) { state.lastId = null; state.lastFields = fields; go('merci'); return; }
  state.saving = true; render();
  try {
    state.lastId = await bridge.addRecord(state.table, fields);
    state.lastFields = fields;
    go('merci');
  } catch (e) {
    state.error = 'Enregistrement refusé : ' + (e.message || e) + ' (droits insuffisants ou valeur non conforme).';
  } finally { state.saving = false; render(); }
}

function viewMerci() {
  return h('section', { class: 'merci' }, illustration(),
    h('h1', {}, state.live ? 'Action enregistrée' : 'Fiche valide (démonstration)'),
    h('p', { class: 'lede' }, state.live
      ? `La ligne n° ${state.lastId ?? '?'} a été créée dans « ${state.table} ». Elle apparaît déjà dans le tableau de bord.`
      : 'En mode démonstration, rien n\'est enregistré. Voici les valeurs qui seraient envoyées à Grist :'),
    state.live ? '' : h('pre', { class: 'payload' }, JSON.stringify(state.lastFields, null, 2)),
    h('div', { class: 'actions center' },
      h('button', { class: 'ghost', onclick: () => go('accueil') }, 'Retour à l\'accueil'),
      h('button', { class: 'cta', onclick: () => { state.values = {}; go('fiche'); } }, 'Saisir une autre action')));
}

// ---------- navigation ----------
function go(view) { state.view = view; if (view !== 'fiche') state.error = null; render(); window.scrollTo(0, 0); }

function render() {
  const top = h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('strong', {}, 'Saisie des actions'),
      h('span', { class: 'badge ' + (state.live ? 'live' : 'demo') }, state.live ? `Grist · ${state.table || '—'}` : 'Démonstration · rien n\'est enregistré')),
    h('nav', { class: 'tabs' },
      h('button', { class: 'tab' + (state.view === 'accueil' ? ' on' : ''), onclick: () => go('accueil') }, 'Accueil'),
      h('button', { class: 'tab' + (state.view !== 'accueil' ? ' on' : ''), onclick: () => go('fiche') }, 'Saisir une action')));
  let body;
  if (state.error && !state.fields.length) body = h('div', { class: 'empty' }, state.error);
  else body = { accueil: viewAccueil, fiche: viewFiche, merci: viewMerci }[state.view]();
  $('#app').replaceChildren(top, h('main', {}, body));
  if (state.view === 'fiche') checkDates();
}

boot();
