// Onglet Planning : diagramme de Gantt en HTML/CSS (pas de bibliothèque).
// Une ligne par action, de la date de début à la date de fin (effective), regroupées et repliables.
// Respecte tous les filtres de la page ; lecture seule.

import { h, monthName, fmtDate } from './dom.js';
import { fmtEuro } from './charts.js';
import { valuesOf, EMPTY } from './model.js';

const DAY = 86400000;
const LEFT = 300;                       // largeur de la colonne des intitulés (px)
const ZOOMS = [['tout', 'Tout'], ['12', '12 mois'], ['6', '6 mois'], ['3', '3 mois']];
const parse = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) : null);

// Texte clair ou foncé selon la luminance de la couleur de fond.
function textOn(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#173430' : '#fff';
}

let tip = null;
function tooltip() {
  if (!tip) { tip = h('div', { class: 'gtip', role: 'tooltip', hidden: true }); document.body.append(tip); }
  return tip;
}
function showTip(e, lines) {
  const t = tooltip();
  t.replaceChildren(...lines.map(([k, v], i) => (i === 0 ? h('strong', {}, v) : h('div', {}, h('span', { class: 'gk' }, k), ' ', v))));
  t.hidden = false;
  moveTip(e);
}
function moveTip(e) {
  if (!tip || tip.hidden) return;
  const pad = 14, w = tip.offsetWidth, hh = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + hh > innerHeight - 8) y = e.clientY - hh - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { if (tip) tip.hidden = true; };

/**
 * ctx = { rows, mapping, gantt:{groupBy, zoom, collapsed:Set}, colLabel(id), colorOf(dim, v),
 *         orderValues(dim, values), onChange(), onFilter(dim, value) }
 */
export function renderGantt(ctx) {
  hideTip();
  const { rows, mapping: m, gantt: g, colLabel, colorOf } = ctx;
  const colorKey = m.categorie || m.entite;
  const groupKey = g.groupBy;

  // Actions datées ; fin = fin effective, sinon début. Fin avant début : signalée, ramenée au début.
  const items = [];
  let sansDate = 0;
  for (const r of rows) {
    const s = parse(r[m.dateDebut]);
    if (s == null) { sansDate++; continue; }
    let e = parse(m.dateFin ? r[m.dateFin] : null) ?? s;
    const alerte = e < s;
    if (alerte) e = s;
    items.push({ r, s, e, alerte });
  }

  const toolbar = h('div', { class: 'gbar' },
    h('label', { class: 'gctl' }, 'Regrouper par ',
      h('select', { onchange: (ev) => { g.groupBy = ev.target.value; g.collapsed.clear(); ctx.onChange(); } },
        [m.entite, m.categorie, m.axe1, m.axe2].filter(Boolean).map((c) => h('option', { value: c, selected: c === groupKey }, colLabel(c))),
        h('option', { value: '', selected: !groupKey }, 'Aucun regroupement'))),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Échelle' },
      ZOOMS.map(([k, l]) => h('button', { class: g.zoom === k ? 'on' : '', 'aria-pressed': g.zoom === k ? 'true' : 'false',
        onclick: () => { g.zoom = k; g.jumpToday = k !== 'tout'; ctx.onChange(); } }, l))),
    h('button', { class: 'gtoday', onclick: () => { g.jumpToday = true; if (g.zoom === 'tout') g.zoom = '6'; ctx.onChange(); } }, 'Aujourd\'hui'),
    groupKey ? h('button', { class: 'linkbtn', onclick: () => {
      const all = new Set(items.map((it) => valuesOf(it.r, groupKey)[0]));
      if (g.collapsed.size >= all.size) g.collapsed.clear(); else g.collapsed = new Set(all);
      ctx.onChange();
    } }, 'Tout replier / déplier') : '');

  if (!items.length) {
    return h('section', { class: 'card span12 gcard' }, h('h3', {}, 'Planning des actions'), toolbar,
      h('div', { class: 'empty' }, 'Aucune action datée pour ces filtres.'));
  }

  // Bornes : du premier jour du mois de la première action au dernier jour du mois de la dernière.
  const minS = Math.min(...items.map((i) => i.s));
  const maxE = Math.max(...items.map((i) => i.e));
  const d0 = new Date(minS), d1 = new Date(maxE);
  const t0 = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1);
  const t1 = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 1);
  const days = (t1 - t0) / DAY;
  const visible = Math.max(400, (document.querySelector('main')?.clientWidth || 1000) - LEFT - 48);
  const ppd = g.zoom === 'tout' ? visible / days : visible / (+g.zoom * 30.44);
  const width = Math.round(days * ppd);
  const x = (t) => ((t - t0) / DAY) * ppd;

  // Graduations : mois (et années)
  const months = [];
  for (let t = t0; t < t1;) {
    const d = new Date(t);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    months.push({ t, next, y: d.getUTCFullYear(), m: d.getUTCMonth() });
    t = next;
  }
  const narrow = (months.length ? width / months.length : 0) < 46;
  const years = [];
  for (const mo of months) {
    const last = years[years.length - 1];
    if (last && last.y === mo.y) last.next = mo.next; else years.push({ y: mo.y, t: mo.t, next: mo.next });
  }
  const now = Date.now();
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());

  const head = h('div', { class: 'grow ghead' },
    h('div', { class: 'gleft gcorner' }, `${items.length} action${items.length > 1 ? 's' : ''}`),
    h('div', { class: 'gtime', style: { width: width + 'px' } },
      h('div', { class: 'gyears' }, years.map((y) => h('div', { class: 'gy', style: { left: x(y.t) + 'px', width: (x(y.next) - x(y.t)) + 'px' } }, y.y))),
      h('div', { class: 'gmonths' }, months.map((mo) => h('div', { class: 'gm', style: { left: x(mo.t) + 'px', width: (x(mo.next) - x(mo.t)) + 'px' } },
        narrow ? monthName(mo.m).slice(0, 1).toUpperCase() : monthName(mo.m))))));

  // Groupes
  const groups = new Map();
  for (const it of items) {
    const k = groupKey ? valuesOf(it.r, groupKey)[0] : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const keys = groupKey ? ctx.orderValues(groupKey, [...groups.keys()]) : [''];
  const body = h('div', { class: 'gbody' });
  // Fond : traits des mois, de l'année, d'aujourd'hui
  body.append(h('div', { class: 'ggrid', style: { left: LEFT + 'px', width: width + 'px' } },
    months.map((mo) => h('div', { class: 'gline' + (mo.m === 0 ? ' gyear' : ''), style: { left: x(mo.t) + 'px' } })),
    today >= t0 && today < t1 ? h('div', { class: 'gnow', style: { left: x(today) + 'px' } }, h('span', {}, 'Aujourd\'hui')) : ''));

  for (const k of keys) {
    const list = groups.get(k).sort((a, b) => a.s - b.s || a.e - b.e);
    if (groupKey) {
      const closed = g.collapsed.has(k);
      const gs = Math.min(...list.map((i) => i.s)), ge = Math.max(...list.map((i) => i.e));
      const budget = m.montant ? list.reduce((s, i) => s + (Number(i.r[m.montant]) || 0), 0) : null;
      const color = colorOf(groupKey, k);
      body.append(h('div', { class: 'grow ggroup' + (closed ? ' closed' : '') },
        h('div', { class: 'gleft' },
          h('button', { class: 'gcaret', 'aria-expanded': closed ? 'false' : 'true', title: closed ? 'Déplier' : 'Replier',
            onclick: () => { closed ? g.collapsed.delete(k) : g.collapsed.add(k); ctx.onChange(); } }, '▸'),
          h('span', { class: 'gdot', style: { background: color } }),
          h('button', { class: 'gname', title: `Filtrer sur « ${k} »`, onclick: () => ctx.onFilter(groupKey, k) }, k),
          h('span', { class: 'gcount' }, `${list.length}${budget != null ? ' · ' + fmtEuro(budget) : ''}`)),
        h('div', { class: 'gtime', style: { width: width + 'px' } },
          h('div', { class: 'gspan', style: { left: x(gs) + 'px', width: Math.max(4, x(ge + DAY) - x(gs)) + 'px', background: color } }))));
      if (closed) continue;
    }
    for (const it of list) body.append(actionRow(it, { m, x, width, colorKey, colorOf, colLabel, groupKey }));
  }

  const scroller = h('div', { class: 'gscroll' }, h('div', { class: 'ginner', style: { width: (LEFT + width) + 'px' } }, head, body));
  scroller.addEventListener('scroll', () => { g.scrollLeft = scroller.scrollLeft; g.scrollTop = scroller.scrollTop; hideTip(); }, { passive: true });
  requestAnimationFrame(() => {
    if (g.jumpToday && today >= t0 && today < t1) { scroller.scrollLeft = Math.max(0, x(today) - visible * 0.25); g.jumpToday = false; }
    else { scroller.scrollLeft = g.scrollLeft || 0; scroller.scrollTop = g.scrollTop || 0; }
  });

  const legendVals = colorKey ? ctx.orderValues(colorKey, [...new Set(items.map((i) => valuesOf(i.r, colorKey)[0]))]) : [];
  return h('section', { class: 'card span12 gcard' },
    h('div', { class: 'thead' }, h('h3', {}, 'Planning des actions'),
      colorKey ? h('div', { class: 'glegend' }, h('span', { class: 'gk' }, colLabel(colorKey) + ' :'),
        legendVals.map((v) => h('button', { class: 'glg', title: `Filtrer sur « ${v} »`, onclick: () => ctx.onFilter(colorKey, v) },
          h('span', { class: 'gdot', style: { background: colorOf(colorKey, v) } }), v))) : ''),
    toolbar, scroller,
    sansDate ? h('p', { class: 'muted' }, `${sansDate} action${sansDate > 1 ? 's' : ''} sans date de début, non affichée${sansDate > 1 ? 's' : ''}.`) : '');
}

function actionRow(it, { m, x, colorKey, colorOf, colLabel, groupKey }) {
  const r = it.r;
  const title = (m.titre && r[m.titre]) || '(sans intitulé)';
  const sub = [m.entite, m.categorie].filter((c) => c && c !== groupKey).map((c) => valuesOf(r, c)[0]).filter((v) => v !== EMPTY).join(' · ');
  const cval = colorKey ? valuesOf(r, colorKey)[0] : '';
  const bg = colorKey ? colorOf(colorKey, cval) : '#2f7f6f';
  const left = x(it.s);
  const w = Math.max(6, x(it.e + DAY) - left);
  const jours = Math.round((it.e - it.s) / DAY) + 1;
  const lines = [
    ['', title],
    m.entite && [colLabel(m.entite), valuesOf(r, m.entite)[0]],
    m.categorie && [colLabel(m.categorie), valuesOf(r, m.categorie)[0]],
    ['Période', `${fmtDate(r[m.dateDebut])} → ${fmtDate(m.dateFin && r[m.dateFin] ? r[m.dateFin] : r[m.dateDebut])} (${jours} j)`],
    m.montant && r[m.montant] ? [colLabel(m.montant), fmtEuro(Number(r[m.montant]))] : null,
    it.alerte ? ['⚠', 'Date de fin antérieure au début'] : null,
    m.manquants && r[m.manquants] ? ['À compléter', r[m.manquants]] : null,
  ].filter(Boolean);
  const inside = w > 140;
  const bar = h('div', {
    class: 'gbarre' + (it.alerte ? ' alerte' : '') + (inside ? '' : ' court'),
    style: { left: left + 'px', width: w + 'px', background: bg, color: textOn(bg) },
    onmouseenter: (e) => showTip(e, lines), onmousemove: moveTip, onmouseleave: hideTip,
  }, inside ? h('span', {}, title) : '');
  return h('div', { class: 'grow gaction' },
    h('div', { class: 'gleft', title },
      h('div', { class: 'gtitle' }, title), sub ? h('div', { class: 'gsub' }, sub) : ''),
    h('div', { class: 'gtime' }, bar, inside ? '' : h('span', { class: 'gout', style: { left: (left + w + 6) + 'px' } }, title)));
}
