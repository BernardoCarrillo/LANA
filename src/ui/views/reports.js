import { h, raw } from '../h.js';
import * as store from '../../data/store.js';
import { fmt, pct, fmtCompact } from '../../core/money.js';
import { monthSeries, accountKind, balances, isActual } from '../../core/ledger.js';
import { INCOME_TYPES, LAYERS } from '../../core/categories.js';
import { monthShort, monthLabel, lastMonths } from '../../core/dates.js';
import { barChart, stackedChart, lineChart, legend } from '../charts.js';
import { card } from './common.js';

const S = store.state;

export function reportsView() {
  const key = store.ui.month;
  const series = monthSeries(S, key, 12);
  const labels = series.map((s) => monthShort(s.key));
  const titles = series.map((s) => monthLabel(s.key, true));
  const root = h('div');

  root.append(card('📋 Comparativo mes a mes',
    h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Mes', 'Ingresos', 'Egresos', 'Ahorro', 'Tasa', 'Deuda'].map((t) => h('th', null, t)))),
      h('tbody', null, [...series].reverse().filter((s) => s.count || s.pending.count || s.key === key).map((s) => h('tr', { class: s.key === key ? 'cur' : '' },
        h('td', null, monthLabel(s.key)), h('td', null, fmtCompact(s.income)), h('td', null, fmtCompact(s.expenses)),
        h('td', { class: s.savings < 0 ? 'neg' : '' }, fmtCompact(s.savings)), h('td', null, pct(s.savingsRate)), h('td', null, fmtCompact(s.debtEnd))))),
      h('tfoot', null, (() => {
        const withInc = series.filter((s) => s.income > 0);
        const used = series.filter((s) => s.count) ; const n = used.length || 1;
        const avg = (f) => Math.round(used.reduce((a, s) => a + f(s), 0) / n);
        return h('tr', null, h('td', { class: 'bold' }, 'Promedio'), h('td', null, fmtCompact(avg((s) => s.income))), h('td', null, fmtCompact(avg((s) => s.expenses))),
          h('td', null, fmtCompact(avg((s) => s.savings))),
          h('td', null, withInc.length ? pct(withInc.reduce((a, s) => a + s.savings, 0) / withInc.reduce((a, s) => a + s.income, 0)) : '—'), h('td', null, fmtCompact(avg((s) => s.debtEnd))));
      })())))));

  root.append(card('📊 Ingresos vs egresos (12 meses)',
    raw(barChart({ labels, tipTitles: titles, highlightIndex: 11, series: [{ name: 'Ingresos', color: 'var(--c-income)', values: series.map((s) => s.income) }, { name: 'Egresos', color: 'var(--c-expense)', values: series.map((s) => s.expenses) }] })),
    raw(legend([{ label: 'Ingresos', color: 'var(--c-income)' }, { label: 'Egresos', color: 'var(--c-expense)' }]))));

  root.append(card('🌱 Tasa de ahorro',
    raw(lineChart({ labels, tipTitles: titles, fmtY: (v) => `${Math.round(v)}%`, fmtV: (v) => `${v.toFixed(1)}%`, series: [{ name: 'Tasa de ahorro', color: 'var(--c-savings)', values: series.map((s) => (s.savingsRate === null ? null : s.savingsRate * 100)), area: true }] })),
    h('div', { class: 'small muted' }, 'Tasa = (ingresos − gasto de consumo) ÷ ingresos. Meses sin ingresos no se grafican.')));

  root.append(card('🧅 Capas por mes',
    raw(stackedChart({ labels, tipTitles: titles, highlightIndex: 11, series: LAYERS.map((l) => ({ name: l.name, color: l.color, values: series.map((s) => s.byLayer[l.id]) })) })),
    raw(legend(LAYERS.map((l) => ({ label: l.name, color: l.color }))))));

  // Composición de ingresos y conceptos nombrados
  const labelsMap = new Map();
  series.forEach((s, i) => { for (const [k, v] of Object.entries(s.incomeLabels)) { if (!labelsMap.has(k)) labelsMap.set(k, new Array(12).fill(0)); labelsMap.get(k)[i] = v; } });
  const rows = [...labelsMap.entries()].map(([k, vals]) => ({ type: k.split('|')[0], label: k.split('|')[1], vals, total: vals.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  root.append(card('💰 Composición de ingresos (12 meses)',
    raw(stackedChart({ labels, tipTitles: titles, highlightIndex: 11, series: INCOME_TYPES.map((t) => ({ name: t.name, color: t.color, values: series.map((s) => s.incomeByType[t.id]) })) })),
    raw(legend(INCOME_TYPES.map((t) => ({ label: t.name, color: t.color })))),
    h('div', { class: 'table-scroll', style: { marginTop: '10px' } }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Concepto'), h('th', null, 'Total 12m'), h('th', null, 'Meses'), h('th', null, 'Último'))),
      h('tbody', null, rows.map((r) => {
        const t = INCOME_TYPES.find((x) => x.id === r.type);
        const lastI = r.vals.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).at(-1);
        return h('tr', null, h('td', { style: { textTransform: 'none' } }, h('i', { class: 'swatch', style: { background: t.color, marginRight: '6px' } }), `${r.label}`),
          h('td', null, fmt(r.total, { decimals: false })), h('td', null, r.vals.filter(Boolean).length), h('td', null, lastI >= 0 ? monthShort(series[lastI].key) : '—'));
      }))))));

  // Vales
  const vouchers = S.accounts.filter((a) => !a.archived && accountKind(S, a) === 'voucher');
  if (vouchers.length) {
    const keys6 = lastMonths(key, 6);
    const bals = balances(S);
    const dep = keys6.map((k) => S.transactions.filter((t) => isActual(t) && t.kind === 'income' && t.date.startsWith(k) && vouchers.some((v) => v.id === t.accountId)).reduce((a, t) => a + t.amount, 0));
    const use = keys6.map((k) => S.transactions.filter((t) => isActual(t) && t.kind === 'expense' && t.date.startsWith(k) && vouchers.some((v) => v.id === t.accountId)).reduce((a, t) => a + t.amount, 0));
    root.append(card('🛒 Reporte de vales (separado)',
      h('div', { class: 'grid2' }, vouchers.map((v) => h('a', { class: 'tile', href: `#/cuentas/${v.id}`, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 't-label' }, `${v.icon || '🎫'} ${v.name}`), h('div', { class: 't-value' }, fmt(bals.get(v.id) || 0)), h('div', { class: 't-sub' }, 'Saldo disponible')))),
      raw(barChart({ labels: keys6.map(monthShort), tipTitles: keys6.map((k) => monthLabel(k, true)), series: [{ name: 'Depósitos', color: 'var(--c-income)', values: dep }, { name: 'Consumo', color: 'var(--c-expense)', values: use }] })),
      raw(legend([{ label: 'Depósitos de vales', color: 'var(--c-income)' }, { label: 'Consumo con vales', color: 'var(--c-expense)' }])),
      h('p', { class: 'small muted' }, 'Los vales son saldo propio: no generan deuda y no suman a tu “dinero disponible”. Su consumo sí cuenta en tus capas.')));
  }

  // Etiquetas
  const cur = series.at(-1);
  const tags = Object.entries(cur.byTag).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (tags.length) root.append(card(`🏷️ Gasto por etiqueta · ${monthLabel(key)}`, tags.map(([t, v]) => h('a', { class: 'row', href: `#/movimientos?tag=${encodeURIComponent(t)}`, style: { padding: '6px 0', textDecoration: 'none', color: 'inherit' } }, h('span', { class: 'grow' }, `#${t}`), h('b', { class: 'num' }, fmt(v))))));
  return root;
}
