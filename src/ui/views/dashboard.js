import { h, raw, icon } from '../h.js';
import * as store from '../../data/store.js';
import { fmt, pct, fmtCompact } from '../../core/money.js';
import { monthSummary, monthSeries, balances, totals, accountKind, cumulative } from '../../core/ledger.js';
import { LAYERS, OTHER_LAYER, INCOME_TYPES, layerById } from '../../core/categories.js';
import { shiftMonth, monthShort, monthLabel, dateLabel, relativeDays, diffDays, monthKey, daysInMonth } from '../../core/dates.js';
import { cardCycle, STATUS_LABEL } from '../../core/cards.js';
import { upcoming } from '../../core/recurring.js';
import { barChart, stackedChart, lineChart, donutChart, ringChart, heatmap, legend } from '../charts.js';
import { card, deltaChip, catById, accById, emptyState } from './common.js';
import { openTxSheet } from '../quickadd.js';
import { toast } from '../sheet.js';

const S = store.state;
let selectedLayer = null;

export function dashboardView() {
  if (!S.accounts.length) return welcome();
  const key = store.ui.month;
  const today = store.today();
  const isCurrent = key === monthKey(today);
  const series = monthSeries(S, key, 6);
  const cur = series.at(-1), prev = series.at(-2);
  const root = h('div');

  // Pendientes por confirmar
  const pend = S.transactions.filter((t) => t.status === 'pending' && t.date <= today);
  if (pend.length) root.append(h('div', { class: 'banner' }, '🔁',
    h('span', { class: 'grow' }, `${pend.length} movimiento${pend.length > 1 ? 's' : ''} pendiente${pend.length > 1 ? 's' : ''} por confirmar`),
    h('button', { class: 'btn sm', onclick: async () => { await store.saveTxs(pend.map((t) => ({ ...t, status: 'confirmed' }))); toast(`${pend.length} confirmados`); } }, 'Confirmar'),
    h('a', { class: 'btn sm ghost', href: '#/movimientos?status=pending' }, 'Ver')));

  // Hero
  const dNet = prev.net ? (cur.net - prev.net) / Math.abs(prev.net) : null;
  root.append(h('section', { class: 'hero', 'aria-label': 'Resumen del mes' },
    h('div', { class: 'row' }, h('div', { class: 'label grow' }, `Balance de ${monthLabel(key, true)}`),
      dNet !== null ? h('span', { class: 'delta' }, `${dNet >= 0 ? '▲' : '▼'} ${Math.abs(dNet * 100).toFixed(0)}% vs ${monthShort(prev.key)}`) : null),
    h('div', { class: 'big' }, fmt(cur.net, { sign: true })),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', null, 'Ingresos'), h('b', null, fmt(cur.income))),
      h('div', { class: 'kpi' }, h('span', null, 'Egresos'), h('b', null, fmt(cur.expenses))),
      h('div', { class: 'kpi' }, h('span', null, `Ahorro ${cur.savingsRate === null ? '' : pct(cur.savingsRate)}`), h('b', null, fmt(cur.savings))))));

  // Tiles
  const t = totals(S, balances(S));
  const ratePts = cur.savingsRate !== null && prev.savingsRate !== null ? Math.round((cur.savingsRate - prev.savingsRate) * 100) : null;
  root.append(h('div', { class: 'tiles' },
    tile('🛒', 'Gasto de consumo', fmt(cur.consumption), deltaChip(cur.consumption, prev.consumption, false), 'Esenciales + estilo de vida'),
    tile('🌱', 'Tasa de ahorro', cur.savingsRate === null ? '—' : pct(cur.savingsRate),
      ratePts === null ? null : h('span', { class: `chg ${ratePts > 0 ? 'good' : ratePts < 0 ? 'bad' : ''}` }, `${ratePts > 0 ? '▲' : ratePts < 0 ? '▼' : '='} ${Math.abs(ratePts)} pts`), 'Ahorro ÷ ingresos'),
    tile('💳', 'Deuda en tarjetas', fmt(cur.debtEnd), deltaChip(cur.debtEnd, prev.debtEnd, false), `Utilización ${pct(t.utilization)}`),
    tile('💵', 'Dinero disponible', fmt(t.liquid), null, `Vales ${fmt(t.vouchers)}`)));

  root.append(upcomingCard(today));
  root.append(layersCard(cur, prev));
  root.append(monthOverMonthCard(series, key));
  root.append(incomeCard(series, cur));
  root.append(paceCard(cur, prev, today, isCurrent));
  root.append(card(h('h2', null, '🗓️ Gasto por día', h('span', { class: 'spacer' }), h('small', null, 'consumo')), raw(heatmap(key, cur.daily, today)),
    h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Más oscuro = más gasto. Toca un día para ver el monto.')));
  root.append(debtCard(series, t));
  root.append(topCategoriesCard(cur));
  return root;
}

function tile(em, label, value, chip, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 't-label' }, em, label), h('div', { class: 't-value' }, value), h('div', { class: 'row', style: { gap: '6px', marginTop: '2px' } }, chip, h('span', { class: 't-sub ellipsis' }, sub)));
}

function upcomingCard(today) {
  const items = [];
  for (const a of S.accounts) {
    if (a.archived || accountKind(S, a) !== 'credit') continue;
    const c = cardCycle(S, a, today);
    const relevant = c.status === 'overdue' ? { date: c.dueDate, payBy: c.payBy } : { date: c.upcomingDue, payBy: c.upcomingPayBy };
    items.push({ date: relevant.payBy, title: `Pagar ${a.name}`, sub: `Límite ${dateLabel(relevant.date)} · ${STATUS_LABEL[c.status]}`,
      amount: c.status === 'paid' || c.status === 'no_balance' ? null : c.toAvoidInterest, status: c.status, acc: a, c });
  }
  for (const o of upcoming(S, today, 21)) items.push({ date: o.date, title: o.rule.name, sub: o.rule.kind === 'income' ? 'Ingreso fijo' : 'Gasto fijo', amount: o.amount, income: o.rule.kind === 'income' });
  items.sort((a, b) => a.date.localeCompare(b.date));
  const list = items.slice(0, 6);
  return card(h('h2', null, '⏰ Próximos pagos', h('span', { class: 'spacer' }), h('a', { href: '#/alertas', class: 'small' }, 'Alertas')),
    list.length ? list.map((it) => {
      const d = diffDays(today, it.date);
      const badge = it.status === 'overdue' ? h('span', { class: 'badge danger' }, 'Vencida') : it.status === 'pay_now' ? h('span', { class: 'badge warn' }, 'Paga ya')
        : it.status === 'paid' ? h('span', { class: 'badge reconciled' }, '✓ Pagada') : h('span', { class: 'badge' }, relativeDays(d));
      return h('div', { class: 'tl' },
        h('div', { class: 'date' }, h('b', null, it.date.slice(8, 10)), h('span', null, monthShort(it.date.slice(0, 7)))),
        h('div', { class: 'grow' }, h('div', { class: 'bold ellipsis' }, it.title), h('div', { class: 'small muted ellipsis' }, it.sub)),
        h('div', { class: 'right' }, it.amount ? h('div', { class: `bold num ${it.income ? 'pos' : ''}` }, fmt(it.amount)) : null, badge,
          it.acc && (it.status === 'pay_now' || it.status === 'overdue' || it.status === 'upcoming')
            ? h('div', null, h('button', { class: 'btn sm ghost', style: { minHeight: '28px', padding: '0 4px' }, onclick: () => openTxSheet({ kind: 'card_payment', preset: { toAccountId: it.acc.id, amount: it.c.toAvoidInterest } }) }, 'Registrar pago')) : null));
    }) : emptyState('🎉', 'Sin pagos próximos.'));
}

function layersCard(cur, prev) {
  const layers = [...LAYERS, OTHER_LAYER].filter((l) => l.id !== 'other' || cur.byLayer.other > 0);
  const segs = layers.map((l) => ({ label: l.name, value: cur.byLayer[l.id] || 0, color: l.color }));
  const activeIndex = layers.findIndex((l) => l.id === selectedLayer);
  const wrap = h('div');
  const draw = () => {
    wrap.replaceChildren();
    const total = cur.expenses;
    const ai = layers.findIndex((l) => l.id === selectedLayer);
    wrap.append(h('div', { class: 'donut-wrap' },
      raw(donutChart({ segments: segs, centerTitle: ai >= 0 ? layers[ai].name.split(' ')[0] : 'Egresos', centerValue: fmtCompact(ai >= 0 ? segs[ai].value : total), activeIndex: ai })),
      h('div', { class: 'donut-legend' }, layers.map((l, i) => h('button', { class: 'lg', 'aria-pressed': String(selectedLayer === l.id), onclick: () => { selectedLayer = selectedLayer === l.id ? null : l.id; draw(); } },
        h('i', { class: 'swatch', style: { background: l.color } }),
        h('span', null, l.name, h('small', null, `${total ? Math.round((segs[i].value / total) * 100) : 0}% · ${deltaTxt(cur.byLayer[l.id], prev.byLayer[l.id])}`)),
        h('b', null, fmt(segs[i].value)))))));
    // Presupuestos por capa
    const b = S.settings.budgets?.layer || {};
    const withBudget = LAYERS.filter((l) => b[l.id]);
    if (withBudget.length && !selectedLayer) {
      wrap.append(h('hr', { class: 'sep' }));
      for (const l of withBudget) wrap.append(budgetBar(l.name, cur.byLayer[l.id] || 0, b[l.id], l.color));
    }
    // Drill-down a micro-categorías
    if (selectedLayer) {
      const l = layerById(selectedLayer);
      const rows = Object.entries(cur.byCategory).map(([id, v]) => ({ c: catById(id), v })).filter((r) => (r.c ? r.c.layer : 'other') === selectedLayer).sort((a, b2) => b2.v - a.v);
      wrap.append(h('hr', { class: 'sep' }), h('div', { class: 'small bold text-2', style: { marginBottom: '4px' } }, `${l.icon} ${l.name}: micro-categorías`));
      const max = rows[0]?.v || 1;
      if (!rows.length) wrap.append(h('div', { class: 'small muted' }, 'Sin gastos en esta capa.'));
      for (const r of rows) wrap.append(hbar(r.c?.icon || '❔', r.c?.name || 'Sin categoría', r.v, max, l.color, `#/movimientos?cat=${r.c?.id || ''}`));
    }
  };
  draw();
  return card(h('h2', null, '🧅 Gasto por capa', h('span', { class: 'spacer' }), h('small', null, 'toca una capa')), wrap);
}
const deltaTxt = (a = 0, b = 0) => (!b ? (a ? 'nuevo' : '—') : `${a >= b ? '▲' : '▼'}${Math.abs(Math.round(((a - b) / b) * 100))}%`);

export function budgetBar(name, spent, limit, color) {
  const r = spent / limit;
  return h('div', { class: 'budget' },
    h('div', { class: 'row' }, h('span', { class: 'grow bold' }, name), h('span', { class: 'num small' }, `${fmt(spent)} / ${fmt(limit)}`),
      h('span', { class: `badge ${r >= 1 ? 'danger' : r >= 0.8 ? 'warn' : ''}` }, `${Math.round(r * 100)}%`)),
    h('div', { class: `progress ${r >= 1 ? 'over' : ''}`, role: 'progressbar', 'aria-valuenow': Math.round(r * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('i', { style: { width: `${Math.min(100, r * 100)}%`, background: color } })));
}

export function hbar(em, label, value, max, color, href) {
  const el = h(href ? 'a' : 'div', { class: 'hbar', href, style: { textDecoration: 'none', color: 'inherit' } },
    h('span', { class: 'em' }, em), h('span', { class: 'lbl ellipsis' }, label), h('span', { class: 'val' }, fmt(value)),
    h('span', { class: 'track' }, h('i', { style: { width: `${Math.max(2, (value / max) * 100)}%`, background: color } })));
  return el;
}

function monthOverMonthCard(series, key) {
  const labels = series.map((s) => monthShort(s.key));
  const hi = series.length - 1;
  const cur = series.at(-1), prev = series.at(-2);
  const row = (label, a, b, goodUp, f = fmt) => h('tr', null, h('td', null, label), h('td', null, f(b)), h('td', { class: 'bold' }, f(a)), h('td', null, deltaChip(a, b, goodUp)));
  return card(h('h2', null, '📊 Mes con mes', h('span', { class: 'spacer' }), h('a', { class: 'small', href: '#/reportes' }, '12 meses')),
    raw(barChart({ labels, highlightIndex: hi, tipTitles: series.map((s) => monthLabel(s.key, true)),
      series: [{ name: 'Ingresos', color: 'var(--c-income)', values: series.map((s) => s.income) }, { name: 'Egresos', color: 'var(--c-expense)', values: series.map((s) => s.expenses) }],
      line: { name: 'Ahorro', color: 'var(--c-savings)', values: series.map((s) => s.savings), dashed: true } })),
    raw(legend([{ label: 'Ingresos', color: 'var(--c-income)' }, { label: 'Egresos', color: 'var(--c-expense)' }, { label: 'Ahorro (ingresos − consumo)', color: 'var(--c-savings)', dashed: true }])),
    h('div', { class: 'table-scroll', style: { marginTop: '10px' } }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, monthShort(prev.key)), h('th', null, monthShort(cur.key)), h('th', null, 'Var.'))),
      h('tbody', null,
        row('Ingresos', cur.income, prev.income, true),
        row('Egresos', cur.expenses, prev.expenses, false),
        row('Ahorro', cur.savings, prev.savings, true),
        row('Deuda TC', cur.debtEnd, prev.debtEnd, false),
        h('tr', null, h('td', null, 'Tasa de ahorro'), h('td', null, pct(prev.savingsRate)), h('td', { class: 'bold' }, pct(cur.savingsRate)),
          h('td', null, cur.savingsRate !== null && prev.savingsRate !== null ? `${Math.round((cur.savingsRate - prev.savingsRate) * 100)} pts` : '—'))))));
}

function incomeCard(series, cur) {
  const labels = series.map((s) => monthShort(s.key));
  const named = Object.entries(cur.incomeLabels).map(([k, v]) => { const [type, label] = k.split('|'); return { type, label, v }; }).sort((a, b) => b.v - a.v);
  return card(h('h2', null, '💰 Composición de ingresos'),
    raw(stackedChart({ labels, highlightIndex: series.length - 1, tipTitles: series.map((s) => monthLabel(s.key, true)),
      series: INCOME_TYPES.map((t) => ({ name: t.name, color: t.color, values: series.map((s) => s.incomeByType[t.id]) })) })),
    raw(legend(INCOME_TYPES.map((t) => ({ label: t.name, color: t.color })))),
    named.length ? h('div', { style: { marginTop: '10px' } }, named.map((n) => {
      const t = INCOME_TYPES.find((x) => x.id === n.type);
      return h('div', { class: 'row', style: { padding: '5px 0' } }, h('i', { class: 'swatch', style: { background: t.color } }), h('span', { class: 'grow ellipsis' }, `${t.icon} ${n.label}`),
        h('b', { class: 'num' }, fmt(n.v)), h('span', { class: 'small muted', style: { width: '38px', textAlign: 'right' } }, cur.income ? pct(n.v / cur.income) : ''));
    })) : h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Sin ingresos registrados este mes.'));
}

function paceCard(cur, prev, today, isCurrent) {
  const dim = cur.daily.length;
  const curCum = cumulative(cur.daily);
  const upto = isCurrent ? Number(today.slice(8, 10)) : dim;
  const prevCum = cumulative(prev.daily);
  const labels = Array.from({ length: dim }, (_, i) => String(i + 1));
  const b = S.settings.budgets?.layer || {};
  const budget = (b.essentials || 0) + (b.lifestyle || 0);
  const proj = isCurrent && upto > 0 ? Math.round((curCum[upto - 1] / upto) * dim) : null;
  const seriesL = [
    { name: monthShort(prev.key), color: 'var(--c-prev)', values: labels.map((_, i) => (i < prevCum.length ? prevCum[i] : null)), dashed: true },
    { name: monthShort(cur.key), color: 'var(--c-expense)', values: labels.map((_, i) => (i < upto ? curCum[i] : null)), area: true },
  ];
  if (budget) seriesL.push({ name: 'Presupuesto', color: 'var(--axis)', values: labels.map((_, i) => Math.round((budget / dim) * (i + 1))), dashed: true });
  return card(h('h2', null, '🏃 Ritmo de gasto', h('span', { class: 'spacer' }), h('small', null, 'acumulado de consumo')),
    raw(lineChart({ labels, series: seriesL, xEvery: 5, tipTitles: labels.map((l) => `Día ${l}`) })),
    raw(legend([{ label: `${monthShort(cur.key)} (este mes)`, color: 'var(--c-expense)' }, { label: monthShort(prev.key), color: 'var(--c-prev)', dashed: true }, ...(budget ? [{ label: 'Presupuesto lineal', color: 'var(--axis)', dashed: true }] : [])])),
    proj !== null ? h('div', { class: 'qa-note', style: { marginTop: '10px' } }, `A este ritmo cerrarás el mes con ~${fmt(proj)} de consumo${budget ? ` (${proj > budget ? 'por encima' : 'dentro'} del presupuesto de ${fmt(budget)})` : ''}.`) : null);
}

function debtCard(series, t) {
  const labels = series.map((s) => monthShort(s.key));
  return card(h('h2', null, '💳 Deuda y utilización', h('span', { class: 'spacer' }), h('a', { class: 'small', href: '#/deudas' }, 'Simular')),
    h('div', { class: 'ring-wrap' }, raw(ringChart(t.utilization, { label: 'utilización' })),
      h('div', null, h('div', { class: 'bold' }, `${fmt(t.debt)} de ${fmt(t.creditLimit)}`), h('div', { class: 'small muted' }, `Utilización total · ${t.utilization < 0.3 ? 'saludable (<30%)' : t.utilization < 0.7 ? 'moderada' : 'alta'}`))),
    raw(lineChart({ labels, height: 150, series: [{ name: 'Deuda al cierre', color: 'var(--c-debt)', values: series.map((s) => s.debtEnd), area: true }], tipTitles: series.map((s) => monthLabel(s.key, true)) })));
}

function topCategoriesCard(cur) {
  const rows = Object.entries(cur.byCategory).map(([id, v]) => ({ c: catById(id), v })).sort((a, b) => b.v - a.v).slice(0, 7);
  const max = rows[0]?.v || 1;
  return card(h('h2', null, '🏆 Top categorías'), rows.length ? rows.map((r) => hbar(r.c?.icon || '❔', r.c?.name || 'Sin categoría', r.v, max, layerById(r.c?.layer).color, `#/movimientos?cat=${r.c?.id || ''}`)) : emptyState('🧾', 'Aún no hay gastos este mes.'));
}

function welcome() {
  return h('div', { class: 'welcome' },
    h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
    h('h2', null, 'Tus finanzas, por capas'),
    h('p', null, 'Controla tarjetas, vales, gastos fijos e ingresos. Todo se guarda solo en este dispositivo.'),
    h('div', { class: 'layers' },
      ...LAYERS.map((l) => h('div', null, h('span', { style: { fontSize: '24px' } }, l.icon), h('div', null, h('b', null, l.name), h('div', { class: 'small muted' }, l.sub)), h('i', { class: 'swatch', style: { background: l.color, marginLeft: 'auto', width: '14px', height: '14px' } })))),
    h('div', { class: 'stack' },
      h('a', { class: 'btn primary block', href: '#/cuentas?nueva=1' }, '➕ Agregar mi primera cuenta'),
      h('button', { class: 'btn block', onclick: async () => { await store.loadDemo(); toast('Datos de ejemplo cargados. Puedes borrarlos en Ajustes.'); } }, '✨ Explorar con datos de ejemplo')),
    h('p', { class: 'small muted', style: { marginTop: '18px' } }, '🔒 Sin bancos, sin nube, sin telemetría. Lana no realiza pagos: tú pagas en la app de tu banco y aquí lo registras.'));
}
