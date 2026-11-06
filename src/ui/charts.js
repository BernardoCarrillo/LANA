// Gráficas SVG propias (sin dependencias, offline). Todas regresan HTML; el tooltip se maneja por delegación
// (ver bindChartTips). Reglas de diseño: un solo eje Y, marcas delgadas, extremos redondeados de 4px,
// separación de 2px entre segmentos, leyenda siempre que haya >= 2 series, tooltip en cada marca.
import { esc } from './h.js';
import { fmt, fmtCompact } from '../core/money.js';

const W = 340;

function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}
function scaleY(values, ticks = 4) {
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (max === min) max = min + 100;
  const step = niceStep(max - min, ticks);
  min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step;
  const out = []; for (let v = min; v <= max + step / 2; v += step) out.push(v);
  return { min, max, ticks: out };
}
const roundTop = (x, y, w, h, r = 4) => {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
const polyLen = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const tipAttr = (s) => esc(s).replace(/\n/g, '&#10;');

function frame({ height, labels, yScale, fmtY, padL = 42, highlightIndex = -1 }) {
  const top = 8, bottom = 22, plotH = height - top - bottom, plotW = W - padL - 4;
  const y = (v) => top + plotH - ((v - yScale.min) / (yScale.max - yScale.min)) * plotH;
  const step = plotW / labels.length;
  const x = (i) => padL + step * i + step / 2;
  let g = '';
  for (const t of yScale.ticks) {
    g += `<line class="${t === 0 ? 'zero' : 'gridline'}" x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}"/>`;
    g += `<text x="${padL - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(fmtY(t))}</text>`;
  }
  labels.forEach((l, i) => {
    g += `<text x="${x(i)}" y="${height - 6}" text-anchor="middle" style="${i === highlightIndex ? 'font-weight:800;fill:var(--text)' : ''}">${esc(l)}</text>`;
  });
  return { g, y, x, step, top, plotH, plotW, padL };
}

/**
 * Barras agrupadas + línea opcional (misma escala: pesos).
 * series: [{name, color, values}], line: {name, color, values, dashed}
 */
export function barChart({ labels, series, line, height = 190, fmtY = fmtCompact, highlightIndex = -1, tipTitles }) {
  const all = series.flatMap((s) => s.values).concat(line ? line.values : []);
  const ys = scaleY(all);
  const f = frame({ height, labels, yScale: ys, fmtY, highlightIndex });
  const k = series.length;
  const gap = 2;
  const bw = Math.max(4, Math.min(14, (f.step * 0.72 - gap * (k - 1)) / k));
  let hl = '', bars = '', hits = '', lineSvg = '';
  labels.forEach((lab, i) => {
    hl += `<rect class="hl" data-i="${i}" x="${f.x(i) - f.step / 2 + 2}" y="${f.top}" width="${f.step - 4}" height="${f.plotH}" rx="8" style="fill:var(--text);fill-opacity:.06"/>`;
    const groupW = k * bw + (k - 1) * gap;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      const x0 = f.x(i) - groupW / 2 + j * (bw + gap);
      const y0 = f.y(Math.max(0, v)), y1 = f.y(Math.min(0, v));
      bars += `<path class="bar grow-y" style="fill:${s.color};animation-delay:${i * 40}ms" d="${roundTop(x0, y0, bw, y1 - y0)}"/>`;
    });
    const tip = [(tipTitles?.[i] || lab), ...series.map((s) => `${s.name}: ${fmt(s.values[i] || 0)}`), ...(line ? [`${line.name}: ${fmt(line.values[i] || 0)}`] : [])].join('\n');
    hits += `<rect class="hit" data-i="${i}" data-tip="${tipAttr(tip)}" x="${f.x(i) - f.step / 2}" y="0" width="${f.step}" height="${height}"/>`;
  });
  if (line) {
    const pts = line.values.map((v, i) => [f.x(i), f.y(v)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    lineSvg = `<path class="draw" d="${d}" style="fill:none;stroke:${line.color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round;${line.dashed ? 'stroke-dasharray:5 4;animation:none;' : ''}--len:${polyLen(pts)}"/>`;
    lineSvg += pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="fade" style="fill:${line.color};stroke:var(--surface);stroke-width:2"/>`).join('');
  }
  return `<div class="chart" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))}"><svg viewBox="0 0 ${W} ${height}">${f.g}${hl}${bars}${lineSvg}${hits}</svg></div>`;
}

/** Barras apiladas (composición). series: [{name,color,values}] */
export function stackedChart({ labels, series, height = 190, fmtY = fmtCompact, highlightIndex = -1, tipTitles }) {
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
  const ys = scaleY(totals);
  const f = frame({ height, labels, yScale: ys, fmtY, highlightIndex });
  const bw = Math.max(8, Math.min(26, f.step * 0.56));
  let hl = '', bars = '', hits = '';
  labels.forEach((lab, i) => {
    hl += `<rect class="hl" data-i="${i}" x="${f.x(i) - f.step / 2 + 2}" y="${f.top}" width="${f.step - 4}" height="${f.plotH}" rx="8" style="fill:var(--text);fill-opacity:.06"/>`;
    let acc = 0;
    const visible = series.map((s) => Math.max(0, s.values[i] || 0));
    const lastIdx = visible.reduce((li, v, j) => (v > 0 ? j : li), -1);
    series.forEach((s, j) => {
      const v = visible[j];
      if (v <= 0) return;
      const yTop = f.y(acc + v), yBot = f.y(acc);
      const hgt = Math.max(0, yBot - yTop - (acc > 0 ? 2 : 0)); // 2px de separación
      const x0 = f.x(i) - bw / 2;
      const d = j === lastIdx ? roundTop(x0, yTop, bw, hgt) : `M${x0},${yTop}h${bw}v${hgt}h${-bw}Z`;
      bars += `<path class="bar grow-y" style="fill:${s.color};animation-delay:${i * 40}ms" d="${d}"/>`;
      acc += v;
    });
    const tip = [`${tipTitles?.[i] || lab} · ${fmt(totals[i])}`, ...series.filter((s) => s.values[i]).map((s) => `${s.name}: ${fmt(s.values[i])}`)].join('\n');
    hits += `<rect class="hit" data-i="${i}" data-tip="${tipAttr(tip)}" x="${f.x(i) - f.step / 2}" y="0" width="${f.step}" height="${height}"/>`;
  });
  return `<div class="chart" role="img" aria-label="Composición"><svg viewBox="0 0 ${W} ${height}">${f.g}${hl}${bars}${hits}</svg></div>`;
}

/** Líneas (con área opcional). series: [{name,color,values,area,dashed}] */
export function lineChart({ labels, series, height = 180, fmtY = fmtCompact, fmtV = fmt, highlightIndex = -1, tipTitles, xEvery = 1 }) {
  const all = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  const ys = scaleY(all.length ? all : [0]);
  const shown = labels.map((l, i) => (i % xEvery === 0 || i === labels.length - 1 ? l : ''));
  const f = frame({ height, labels: shown, yScale: ys, fmtY, highlightIndex });
  let paths = '', hl = '', hits = '';
  series.forEach((s) => {
    const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [f.x(i), f.y(v)])).filter(Boolean);
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    if (s.area) {
      paths += `<path class="fade" d="${d}L${pts.at(-1)[0]},${f.y(Math.max(ys.min, 0))}L${pts[0][0]},${f.y(Math.max(ys.min, 0))}Z" style="fill:${s.color};fill-opacity:.14"/>`;
    }
    paths += `<path class="${s.dashed ? 'fade' : 'draw'}" d="${d}" style="fill:none;stroke:${s.color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round;${s.dashed ? 'stroke-dasharray:5 4;' : ''}--len:${polyLen(pts)}"/>`;
    const last = pts.at(-1);
    paths += `<circle class="fade" cx="${last[0]}" cy="${last[1]}" r="4" style="fill:${s.color};stroke:var(--surface);stroke-width:2"/>`;
  });
  labels.forEach((lab, i) => {
    const dots = series.map((s) => (s.values[i] === null || s.values[i] === undefined ? '' : `<circle cx="${f.x(i)}" cy="${f.y(s.values[i])}" r="4.5" style="fill:${s.color};stroke:var(--surface);stroke-width:2"/>`)).join('');
    hl += `<g class="hl" data-i="${i}"><line x1="${f.x(i)}" x2="${f.x(i)}" y1="${f.top}" y2="${f.top + f.plotH}" style="stroke:var(--axis);stroke-width:1;stroke-dasharray:3 3"/>${dots}</g>`;
    const vals = series.filter((s) => s.values[i] !== null && s.values[i] !== undefined).map((s) => `${s.name}: ${fmtV(s.values[i])}`);
    hits += `<rect class="hit" data-i="${i}" data-tip="${tipAttr([tipTitles?.[i] || lab, ...vals].join('\n'))}" x="${f.x(i) - f.step / 2}" y="0" width="${f.step}" height="${height}"/>`;
  });
  return `<div class="chart" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))}"><svg viewBox="0 0 ${W} ${height}">${f.g}${paths}${hl}${hits}</svg></div>`;
}

/** Dona. segments: [{label,value,color,sub}] */
export function donutChart({ segments, size = 150, thickness = 22, centerTitle = '', centerValue = '', activeIndex = -1 }) {
  const r = (size - 34) / 2, c = 2 * Math.PI * r, cx = size / 2;
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  let off = 0, arcs = '';
  if (total <= 0) {
    arcs = `<circle cx="${cx}" cy="${cx}" r="${r}" style="fill:none;stroke:var(--surface-2);stroke-width:${thickness}"/>`;
  } else segments.forEach((s, i) => {
    if (s.value <= 0) return;
    const len = (s.value / total) * c;
    const gap = segments.filter((x) => x.value > 0).length > 1 ? Math.min(2, len / 2) : 0;
    arcs += `<circle class="seg-arc ${i === activeIndex ? 'on' : ''}" data-seg="${i}" data-tip="${tipAttr(`${s.label}\n${fmt(s.value)} · ${Math.round((s.value / total) * 100)}%`)}" cx="${cx}" cy="${cx}" r="${r}"
      style="fill:none;stroke:${s.color};stroke-width:${thickness};stroke-dasharray:${Math.max(0, len - gap)} ${c};stroke-dashoffset:${-off};animation-delay:${i * 90}ms" transform="rotate(-90 ${cx} ${cx})"/>`;
    off += len;
  });
  return `<div class="chart" role="img" aria-label="${esc(centerTitle)}"><svg viewBox="0 0 ${size} ${size}">
    ${arcs}
    <text x="${cx}" y="${cx - 4}" text-anchor="middle" style="font-size:10.5px;fill:var(--muted);font-weight:700">${esc(centerTitle)}</text>
    <text x="${cx}" y="${cx + 14}" text-anchor="middle" style="font-size:16px;fill:var(--text);font-weight:800">${esc(centerValue)}</text>
  </svg></div>`;
}

/** Anillo de porcentaje (utilización). Color por umbral de estado + etiqueta textual. */
export function ringChart(pctValue, { size = 84, label = '', thickness = 9 } = {}) {
  const p = Math.max(0, Math.min(1, pctValue || 0));
  const r = (size - thickness - 4) / 2, c = 2 * Math.PI * r, cx = size / 2;
  const color = p < 0.3 ? 'var(--good)' : p < 0.7 ? 'var(--warning)' : 'var(--critical)';
  return `<div class="chart" style="width:${size}px" role="img" aria-label="${Math.round(p * 100)}% ${esc(label)}"><svg viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}" style="fill:none;stroke:var(--surface-2);stroke-width:${thickness}"/>
    <circle class="seg-arc" cx="${cx}" cy="${cx}" r="${r}" transform="rotate(-90 ${cx} ${cx})" data-tip="${tipAttr(`Utilización ${Math.round(p * 100)}%`)}"
      style="fill:none;stroke:${color};stroke-width:${thickness};stroke-linecap:round;stroke-dasharray:${Math.max(0.01, p * c)} ${c}"/>
    <text x="${cx}" y="${cx + 5}" text-anchor="middle" style="font-size:${size / 5.2}px;font-weight:800;fill:var(--text)">${Math.round(p * 100)}%</text>
  </svg></div>`;
}

export const utilLabel = (p) => (p < 0.3 ? 'Saludable' : p < 0.7 ? 'Moderada' : 'Alta');

/** Sparkline (sin ejes). */
export function sparkline(values, { color = 'currentColor', width = 80, height = 26 } = {}) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), rng = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / rng) * (height - 6)]);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}" style="fill:none;stroke:${color};stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/></svg>`;
}

/** Mapa de calor del mes (lunes primero). Rampa secuencial de un solo tono. */
export function heatmap(monthKey, daily, today) {
  const [y, m] = monthKey.split('-').map(Number);
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const max = Math.max(...daily, 1);
  let html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < firstDow; i++) html += '<div class="cell blank"></div>';
  daily.forEach((v, i) => {
    const lvl = v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
    const iso = `${monthKey}-${String(i + 1).padStart(2, '0')}`;
    html += `<button class="cell ${lvl ? 'l' + lvl : ''} ${iso === today ? 'today' : ''}" data-tip="${tipAttr(`${i + 1} · ${fmt(v)}`)}" data-day="${iso}" aria-label="Día ${i + 1}: ${esc(fmt(v))}">${i + 1}</button>`;
  });
  return `<div class="heat chart">${html}</div>`;
}

export function legend(items) {
  return `<div class="legend">${items.map((it) => `<span>${it.dashed ? `<i class="dash" style="color:${it.color}"></i>` : `<i class="swatch" style="background:${it.color}"></i>`}${esc(it.label)}${it.value ? ` <b>${esc(it.value)}</b>` : ''}</span>`).join('')}</div>`;
}

/** Tooltip por delegación para cualquier [data-tip] dentro de .chart. Funciona con dedo y mouse. */
export function bindChartTips(root = document) {
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let current = null;
  const hide = () => { tip.classList.remove('show'); current?.closest('svg')?.querySelectorAll('.hl.on').forEach((e) => e.classList.remove('on')); current = null; };
  const show = (el, x, y) => {
    if (current && current !== el) hide();
    current = el;
    tip.textContent = el.dataset.tip;
    const pad = 12, w = tip.offsetWidth || 160;
    tip.style.left = `${Math.max(w / 2 + pad, Math.min(innerWidth - w / 2 - pad, x))}px`;
    tip.style.top = `${Math.max(60, y)}px`;
    tip.classList.add('show');
    const i = el.dataset.i;
    if (i !== undefined) el.closest('svg')?.querySelectorAll(`.hl[data-i="${i}"]`).forEach((e) => e.classList.add('on'));
  };
  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('.chart [data-tip]');
    if (el) show(el, e.clientX, e.clientY); else if (current) hide();
  });
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.chart [data-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  });
  root.addEventListener('scroll', hide, { passive: true, capture: true });
}
