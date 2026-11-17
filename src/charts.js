// Graphiques ECharts (bibliothèque embarquée dans vendor/, aucune ressource réseau).

// Palette douce : bleus, verts, sauge, avec un sable et un ardoise pour
// séparer les voisins. Ordre choisi pour que deux catégories consécutives restent distinctes.
export const ECO = ['#2f7f6f', '#5b9bc4', '#8cbf8a', '#2c5f7c', '#6fb3a8', '#a9c7de', '#4f8a4b', '#c9b98a',
  '#3e7c99', '#9dd0c0', '#6b8f71', '#7da7c9', '#b5d3a7', '#5c7f8f', '#d8cfa9', '#41706a'];

/**
 * Couleur de chaque valeur d'une dimension, stable dans tout l'écran (graphiques, Gantt, légendes).
 * mode 'douce' : palette ECO dans l'ordre du référentiel ; mode 'referentiel' : couleurs du document.
 */
export function paletteFor(values, meta, mode = 'douce') {
  const map = new Map();
  values.forEach((v, i) => {
    const ref = meta?.colors?.[v];
    map.set(v, mode === 'referentiel' && ref ? ref : ECO[i % ECO.length]);
  });
  return map;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtNum = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const fmtEuro = (v) => (v == null ? '—' : v >= 1e6 ? (v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' M€'
  : v >= 1e4 ? (v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' k€' : fmtNum.format(v) + ' €');
export const fmtInt = (v) => (v == null ? '—' : fmtNum.format(v));

function base() {
  const text = css('--text-2') || '#555';
  return {
    animationDuration: 300,
    textStyle: { fontFamily: 'inherit', color: text },
    tooltip: { confine: true, backgroundColor: css('--surface') || '#fff', borderColor: css('--border') || '#ddd', textStyle: { color: css('--text') || '#111' } },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
  };
}
const axisCommon = () => ({
  axisLine: { lineStyle: { color: css('--border') || '#ccc' } },
  axisLabel: { color: css('--text-2') || '#555' },
  splitLine: { lineStyle: { color: css('--grid') || '#eee' } },
});
// Légende sur une ligne en bas, paginée (◀ 1/9 ▶) quand elle déborde.
const legendBottom = () => ({
  type: 'scroll', orient: 'horizontal', bottom: 0, left: 8, right: 8, itemWidth: 12, itemHeight: 12, itemGap: 14,
  icon: 'roundRect', pageButtonPosition: 'end', pageFormatter: '{current}/{total}', pageIconSize: 11,
  pageIconColor: css('--text') || '#333', pageIconInactiveColor: css('--grid') || '#ccc', pageTextStyle: { color: css('--text-2') },
  textStyle: { color: css('--text') || '#333', fontSize: 12, width: 190, overflow: 'truncate' }, tooltip: { show: true },
});
const trunc = (s, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Barres horizontales triées, une couleur par catégorie. */
export function barH(cats, values, colors, { money = false, selected = null } = {}) {
  return {
    ...base(),
    tooltip: { ...base().tooltip, trigger: 'item', formatter: (p) => `${p.name}<br><b>${money ? fmtEuro(p.value) : fmtInt(p.value)}</b>` },
    xAxis: { type: 'value', minInterval: money ? 0 : 1, ...axisCommon(), axisLabel: { ...axisCommon().axisLabel, formatter: money ? fmtEuro : fmtInt } },
    yAxis: { type: 'category', inverse: true, data: cats, ...axisCommon(), axisLabel: { ...axisCommon().axisLabel, formatter: (s) => trunc(s) } },
    series: [{
      type: 'bar', barMaxWidth: 22,
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], opacity: selected && selected.size && !selected.has(cats[i]) ? 0.3 : 1, borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', color: css('--text-2'), formatter: (p) => (money ? fmtEuro(p.value) : fmtInt(p.value)) },
    }],
  };
}

/** Colonnes empilées : catégories en abscisse, une série par valeur de `series`. */
export function stacked(cats, series, data, colors, { money = false, rotate = 0 } = {}) {
  return {
    ...base(),
    grid: { ...base().grid, top: 16, bottom: 34 },
    legend: legendBottom(),
    tooltip: { ...base().tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: money ? fmtEuro : fmtInt },
    xAxis: { type: 'category', data: cats, ...axisCommon(), axisLabel: { ...axisCommon().axisLabel, rotate, formatter: (s) => trunc(s, 18), hideOverlap: true } },
    yAxis: { type: 'value', minInterval: money ? 0 : 1, ...axisCommon(), axisLabel: { ...axisCommon().axisLabel, formatter: money ? fmtEuro : fmtInt } },
    series: series.map((s, i) => ({ name: s, type: 'bar', stack: 'total', barMaxWidth: 36, emphasis: { focus: 'series' }, itemStyle: { color: colors[i] }, data: data[i] })),
  };
}

/** Anneau, une part par catégorie. */
export function doughnut(cats, values, colors, { selected = null } = {}) {
  return {
    ...base(),
    tooltip: { ...base().tooltip, trigger: 'item', formatter: (p) => `${p.name}<br><b>${fmtInt(p.value)}</b> (${p.percent} %)` },
    legend: legendBottom(),
    series: [{
      type: 'pie', radius: ['40%', '62%'], center: ['50%', '45%'], avoidLabelOverlap: true, minShowLabelAngle: 4,
      label: { show: true, position: 'outside', color: css('--text') || '#333', fontSize: 11, formatter: (p) => trunc(p.name, 18) },
      labelLine: { show: true, length: 8, length2: 10, smooth: true, lineStyle: { color: css('--text-2') || '#999' } },
      labelLayout: { hideOverlap: true },
      itemStyle: { borderColor: css('--surface-solid') || '#fff', borderWidth: 2, borderRadius: 3 },
      data: cats.map((c, i) => ({ name: c, value: values[i], itemStyle: { color: colors[i], opacity: selected && selected.size && !selected.has(c) ? 0.3 : 1 } })),
    }],
  };
}
