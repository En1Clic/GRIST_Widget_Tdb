// Petits utilitaires DOM partagés par l'écran et le Gantt.

export const $ = (sel, el = document) => el.querySelector(sel);

/** Crée un élément : h('div', {class:'x', onclick: fn}, enfants…). Le texte est toujours inséré comme texte. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const monthName = (i) => MOIS[i];
export const fmtMonth = (k) => (/^\d{4}-\d{2}$/.test(k) ? `${MOIS[+k.slice(5) - 1]} ${k.slice(2, 4)}` : k);
export const fmtDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d ?? '');
