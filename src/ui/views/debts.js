import { h, raw } from '../h.js';
import * as store from '../../data/store.js';
import { fmt, toCents, pct } from '../../core/money.js';
import { balances, accountSnapshot, accountKind, totals, accountHistory } from '../../core/ledger.js';
import { cardCycle } from '../../core/cards.js';
import { simulatePayoff, simulateMinimum, paymentForMonths } from '../../core/debt.js';
import { lastMonths, monthShort, monthLabel, dateLabel } from '../../core/dates.js';
import { lineChart, ringChart, legend, utilLabel } from '../charts.js';
import { card, txRow, emptyState } from './common.js';
import { openReconcile } from './accounts.js';
import { selectEl } from '../quickadd.js';

const S = store.state;
let simAcc = null, simPayStr = '';
const CARD_SERIES = ['var(--layer-essentials)', 'var(--layer-lifestyle)', 'var(--layer-savings)', 'var(--inc-fund)', 'var(--inc-bonus)', 'var(--inc-other)', 'var(--inc-salary)', 'var(--c-expense)'];

export function debtsView() {
  const today = store.today();
  const bals = balances(S);
  const cards = S.accounts.filter((a) => !a.archived && accountKind(S, a) === 'credit');
  const root = h('div');
  if (!cards.length) return emptyState('💳', 'Agrega tus tarjetas de crédito para ver deuda, utilización y simulaciones.', h('a', { class: 'btn primary', href: '#/cuentas?nueva=1' }, 'Agregar tarjeta'));
  const t = totals(S, bals);
  root.append(h('section', { class: 'hero' }, h('div', { class: 'label' }, 'Deuda total en tarjetas'), h('div', { class: 'big' }, fmt(t.debt)),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', null, 'Límite total'), h('b', null, fmt(t.creditLimit))),
      h('div', { class: 'kpi' }, h('span', null, 'Utilización'), h('b', null, `${pct(t.utilization)} · ${utilLabel(t.utilization)}`)),
      h('div', { class: 'kpi' }, h('span', null, 'Disponible'), h('b', null, fmt(t.creditLimit - t.debt))))));

  // Por tarjeta
  root.append(card('🔎 Por tarjeta', cards.map((a) => {
    const s = accountSnapshot(S, a, bals.get(a.id) || 0);
    const c = cardCycle(S, a, today);
    return h('a', { href: `#/cuentas/${a.id}`, class: 'row', style: { padding: '10px 0', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' } },
      raw(ringChart(s.utilization, { size: 58, thickness: 7 })),
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, a.name), h('div', { class: 'small muted' }, `Tasa ${a.credit?.apr ? pct(a.credit.apr, 1) : '—'} · límite ${dateLabel(c.dueDate)}`),
        h('div', { class: 'small' }, `No intereses: ${fmt(c.toAvoidInterest)} · Mín: ${fmt(c.minRemaining)}${c.minEstimated ? '*' : ''}`)),
      h('div', { class: 'right' }, h('div', { class: 'bold num' }, fmt(s.debt)), h('div', { class: 'small muted' }, `de ${fmt(s.limit)}`)));
  }), h('p', { class: 'tiny muted' }, '* mínimo estimado; captúralo desde el detalle de la tarjeta para usar el del estado de cuenta.')));

  // Evolución
  const keys = lastMonths(store.ui.month, 12);
  const hist = cards.map((a) => accountHistory(S, a.id, keys).map((b) => Math.max(0, -b)));
  root.append(card('📉 Evolución de saldo por tarjeta',
    raw(lineChart({ labels: keys.map(monthShort), xEvery: 2, tipTitles: keys.map((k) => monthLabel(k, true)), series: cards.map((a, i) => ({ name: a.name, color: CARD_SERIES[i % CARD_SERIES.length], values: hist[i] })) })),
    raw(legend(cards.map((a, i) => ({ label: a.name, color: CARD_SERIES[i % CARD_SERIES.length] })))),
    raw(lineChart({ labels: keys.map(monthShort), xEvery: 2, height: 130, fmtY: (v) => `${Math.round(v)}%`, fmtV: (v) => `${v.toFixed(1)}%`, tipTitles: keys.map((k) => monthLabel(k, true)),
      series: cards.map((a, i) => ({ name: a.name, color: CARD_SERIES[i % CARD_SERIES.length], values: hist[i].map((d) => (a.credit?.limit ? (d / a.credit.limit) * 100 : 0)) })) })),
    h('div', { class: 'small muted' }, 'Arriba: deuda al cierre de cada mes. Abajo: utilización (%).')));

  // Simulador
  if (!simAcc || !cards.some((a) => a.id === simAcc)) simAcc = [...cards].sort((a, b) => (bals.get(a.id) || 0) - (bals.get(b.id) || 0))[0].id;
  const simEl = h('div');
  const drawSim = () => {
    const a = cards.find((x) => x.id === simAcc);
    const debt = Math.max(0, -(bals.get(a.id) || 0));
    const apr = a.credit?.apr || 0;
    simEl.replaceChildren();
    simEl.append(h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Tarjeta'), selectEl(cards.map((x) => [x.id, x.name]), simAcc, (v) => { simAcc = v; simPayStr = ''; drawSim(); })),
      h('label', { class: 'field' }, h('span', null, 'Pago mensual'), h('input', { class: 'input', inputmode: 'decimal', value: simPayStr, placeholder: (paymentForMonths(debt, apr, 6) / 100).toFixed(0), onchange: (e) => { simPayStr = e.target.value; drawSim(); }, 'data-testid': 'sim-pay' }))));
    if (!debt) { simEl.append(h('div', { class: 'qa-note' }, '🎉 Esta tarjeta no tiene deuda.')); return; }
    const pay = simPayStr ? toCents(simPayStr) : paymentForMonths(debt, apr, 6);
    const mine = simulatePayoff(debt, apr, pay);
    const min = simulateMinimum(debt, apr, { limit: a.credit?.limit || 0, minPct: a.credit?.minPct ?? 0.015 });
    const n = Math.min(Math.max(mine.paysOff ? mine.months : 24, 6), 60);
    const labels = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 'hoy' : `${i}`));
    simEl.append(
      h('div', { class: 'grid2' },
        h('div', { class: 'tile' }, h('div', { class: 't-label' }, `Pagando ${fmt(pay)}/mes`), h('div', { class: 't-value' }, mine.paysOff ? `${mine.months} meses` : 'Nunca'), h('div', { class: 't-sub' }, mine.paysOff ? `Intereses ≈ ${fmt(mine.totalInterest)}` : 'El pago no cubre los intereses')),
        h('div', { class: 'tile' }, h('div', { class: 't-label' }, 'Solo el mínimo'), h('div', { class: 't-value neg' }, min.paysOff ? `${min.months} meses` : '+50 años'), h('div', { class: 't-sub' }, min.paysOff ? `Intereses ≈ ${fmt(min.totalInterest)}` : 'Interés acumulado enorme'))),
      raw(lineChart({ labels, xEvery: Math.ceil(n / 6), tipTitles: labels.map((l) => (l === 'hoy' ? 'Hoy' : `Mes ${l}`)), series: [
        { name: 'Tu pago', color: 'var(--c-savings)', values: labels.map((_, i) => mine.schedule[i] ?? (mine.paysOff ? 0 : null)) },
        { name: 'Solo mínimo', color: 'var(--c-debt)', values: labels.map((_, i) => min.schedule[i] ?? null), dashed: true },
      ] })),
      raw(legend([{ label: 'Tu pago', color: 'var(--c-savings)' }, { label: 'Solo mínimo', color: 'var(--c-debt)', dashed: true }])),
      h('div', { class: 'chips', style: { marginTop: '10px' } }, [3, 6, 12].map((m) => h('button', { class: 'chip small', onclick: () => { simPayStr = (paymentForMonths(debt, apr, m) / 100).toFixed(2); drawSim(); } }, `Liquidar en ${m} meses: ${fmt(paymentForMonths(debt, apr, m))}`))),
      h('p', { class: 'tiny muted' }, `Aproximación: tasa anual ${pct(apr, 1)} ÷ 12 + IVA 16% sobre intereses, sin compras nuevas. El banco calcula con saldo promedio diario; usa esto como guía.`));
  };
  drawSim();
  root.append(card('🧮 Simulador de pago', simEl));

  // Historial de pagos
  const pays = S.transactions.filter((tx) => tx.kind === 'card_payment').sort((a, b) => b.date.localeCompare(a.date));
  root.append(card(h('h2', null, '✅ Historial de pagos registrados', h('span', { class: 'spacer' }), h('small', null, 'hechos en la app del banco')),
    pays.length ? h('div', { class: 'list', style: { boxShadow: 'none' } }, pays.slice(0, 15).map((tx) => txRow(tx, { showDate: true }))) : h('div', { class: 'small muted' }, 'Sin pagos registrados.')));

  root.append(card('⚖️ Conciliar contra tu banco', h('p', { class: 'small text-2' }, 'Captura el saldo que muestra la app de tu banco; Lana calcula la diferencia y te deja registrarla como intereses/comisiones o ajuste.'),
    h('div', { class: 'chips wrap' }, cards.map((a) => h('button', { class: 'chip', onclick: () => openReconcile(a) }, `⚖️ ${a.name}`)))));
  return root;
}
