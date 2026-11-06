// Libro mayor: saldos por cuenta y resúmenes mensuales.
// REGLA DE ORO: solo `income` es ingreso y solo `expense` es egreso.
// `transfer` y `card_payment` mueven dinero entre cuentas propias y NUNCA cuentan como gasto.
import { monthEnd, daysInMonth, lastMonths } from './dates.js';
import { layerById } from './categories.js';

export const isActual = (tx) => tx.status !== 'pending';

export function accountType(state, acc) {
  return state.accountTypes.find((t) => t.id === acc.typeId) || { kind: 'asset', name: 'Cuenta', icon: '💰' };
}
export const accountKind = (state, acc) => accountType(state, acc).kind;

export function categoryMap(state) {
  const m = new Map();
  for (const c of state.categories) m.set(c.id, c);
  return m;
}

/** Efecto de un movimiento sobre los saldos: [[cuentaId, delta], ...] (centavos con signo). */
export function txEffects(tx) {
  switch (tx.kind) {
    case 'income': return [[tx.accountId, tx.amount]];
    case 'expense': return [[tx.accountId, -tx.amount]];
    case 'transfer':
    case 'card_payment': return [[tx.accountId, -tx.amount], [tx.toAccountId, tx.amount]];
    case 'adjustment': return [[tx.accountId, tx.amount]]; // con signo
    default: return [];
  }
}

/**
 * Saldos con signo por cuenta (activo > 0, deuda < 0).
 * @param {object} opts upto: 'YYYY-MM-DD' inclusive; includePending: sumar pendientes.
 */
export function balances(state, { upto = null, includePending = false } = {}) {
  const map = new Map();
  for (const a of state.accounts) {
    map.set(a.id, !upto || !a.openingDate || a.openingDate <= upto ? (a.openingBalance || 0) : 0);
  }
  for (const tx of state.transactions) {
    if (!includePending && !isActual(tx)) continue;
    if (upto && tx.date > upto) continue;
    for (const [id, d] of txEffects(tx)) if (map.has(id)) map.set(id, map.get(id) + d);
  }
  return map;
}

export function accountSnapshot(state, acc, bal) {
  const kind = accountKind(state, acc);
  const out = { kind, balance: bal };
  if (kind === 'credit') {
    const limit = acc.credit?.limit || 0;
    out.debt = Math.max(0, -bal);
    out.limit = limit;
    out.available = limit + bal;
    out.utilization = limit > 0 ? out.debt / limit : 0;
  }
  return out;
}

/** Totales de patrimonio: líquido (efectivo/débito/ahorro), vales y deuda. */
export function totals(state, bals) {
  let liquid = 0, vouchers = 0, debt = 0, creditLimit = 0;
  for (const a of state.accounts) {
    if (a.archived) continue;
    const b = bals.get(a.id) || 0;
    const k = accountKind(state, a);
    if (k === 'credit') { debt += Math.max(0, -b); creditLimit += a.credit?.limit || 0; }
    else if (k === 'voucher') vouchers += b;
    else liquid += b;
  }
  return { liquid, vouchers, debt, creditLimit, net: liquid + vouchers - debt, utilization: creditLimit ? debt / creditLimit : 0 };
}

const emptyIncome = () => ({ salary: 0, bonus: 0, savings_fund: 0, other: 0 });

/** Resumen de un mes 'YYYY-MM'. */
export function monthSummary(state, key) {
  const cats = categoryMap(state);
  const kinds = new Map(state.accounts.map((a) => [a.id, accountKind(state, a)]));
  const dim = daysInMonth(+key.slice(0, 4), +key.slice(5, 7));
  const s = {
    key, income: 0, incomeByType: emptyIncome(), incomeLabels: {},
    expenses: 0, consumption: 0,
    byLayer: { essentials: 0, lifestyle: 0, savings: 0, other: 0 },
    byCategory: {}, byAccount: {}, byTag: {},
    transfers: 0, cardPayments: 0, voucherSpend: 0,
    pending: { count: 0, amount: 0 },
    daily: new Array(dim).fill(0), count: 0,
  };
  for (const tx of state.transactions) {
    if (!tx.date.startsWith(key)) continue;
    if (!isActual(tx)) { s.pending.count++; s.pending.amount += tx.kind === 'adjustment' ? 0 : tx.amount; continue; }
    s.count++;
    if (tx.kind === 'income') {
      s.income += tx.amount;
      const t = s.incomeByType[tx.incomeType] !== undefined ? tx.incomeType : 'other';
      s.incomeByType[t] += tx.amount;
      const label = (tx.incomeLabel || '').trim() || ({ salary: 'Salario', bonus: 'Bono', savings_fund: 'Fondo de ahorro', other: 'Otro' })[t];
      const k = `${t}|${label}`;
      s.incomeLabels[k] = (s.incomeLabels[k] || 0) + tx.amount;
    } else if (tx.kind === 'expense') {
      const cat = cats.get(tx.categoryId);
      const layer = cat ? layerById(cat.layer) : layerById('other');
      s.expenses += tx.amount;
      s.byLayer[layer.id] += tx.amount;
      if (layer.consumption) {
        s.consumption += tx.amount;
        s.daily[+tx.date.slice(8, 10) - 1] += tx.amount;
      }
      const ck = tx.categoryId || '_none';
      s.byCategory[ck] = (s.byCategory[ck] || 0) + tx.amount;
      s.byAccount[tx.accountId] = (s.byAccount[tx.accountId] || 0) + tx.amount;
      for (const tag of tx.tags || []) s.byTag[tag] = (s.byTag[tag] || 0) + tx.amount;
      if (kinds.get(tx.accountId) === 'voucher') s.voucherSpend += tx.amount;
    } else if (tx.kind === 'transfer') s.transfers += tx.amount;
    else if (tx.kind === 'card_payment') s.cardPayments += tx.amount;
  }
  s.savings = s.income - s.consumption;            // lo que no se consumió
  s.savingsRate = s.income > 0 ? s.savings / s.income : null;
  s.net = s.income - s.expenses;                   // flujo neto (balance del mes)
  const t = totals(state, balances(state, { upto: monthEnd(key) }));
  s.debtEnd = t.debt; s.liquidEnd = t.liquid; s.vouchersEnd = t.vouchers; s.netWorthEnd = t.net;
  return s;
}

export function monthSeries(state, key, n = 6) {
  return lastMonths(key, n).map((k) => monthSummary(state, k));
}

/** Variación relativa a vs b (null si b = 0). */
export const delta = (a, b) => (b ? (a - b) / Math.abs(b) : null);

/** Saldo de una cuenta al cierre de cada mes. */
export function accountHistory(state, accId, keys) {
  return keys.map((k) => balances(state, { upto: monthEnd(k) }).get(accId) || 0);
}

/** Gasto acumulado por día (para la curva de ritmo). */
export function cumulative(daily) {
  let acc = 0;
  return daily.map((v) => (acc += v));
}

/** Filtro de movimientos para la vista de lista. */
export function filterTransactions(state, f = {}) {
  const cats = categoryMap(state);
  const q = (f.q || '').trim().toLowerCase();
  const accName = new Map(state.accounts.map((a) => [a.id, a.name.toLowerCase()]));
  return state.transactions.filter((tx) => {
    if (f.month && !tx.date.startsWith(f.month)) return false;
    if (f.kind && tx.kind !== f.kind) return false;
    if (f.status && tx.status !== f.status) return false;
    if (f.accountId && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId) return false;
    if (f.layer) { const c = cats.get(tx.categoryId); if (tx.kind !== 'expense' || (c ? c.layer : 'other') !== f.layer) return false; }
    if (f.categoryId && tx.categoryId !== f.categoryId) return false;
    if (f.tag && !(tx.tags || []).includes(f.tag)) return false;
    if (q) {
      const c = cats.get(tx.categoryId);
      const hay = [tx.note, tx.incomeLabel, c?.name, accName.get(tx.accountId), accName.get(tx.toAccountId), ...(tx.tags || []), (tx.amount / 100).toFixed(2)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.date.localeCompare(a.date)) || ((b.createdAt || 0) - (a.createdAt || 0)));
}

export function allTags(state) {
  const set = new Set();
  for (const tx of state.transactions) for (const t of tx.tags || []) set.add(t);
  return [...set].sort();
}

/** Validación mínima de un movimiento antes de guardarlo. Devuelve lista de errores en español. */
export function validateTx(tx, state) {
  const e = [];
  const ids = new Set(state.accounts.map((a) => a.id));
  if (!['income', 'expense', 'transfer', 'card_payment', 'adjustment'].includes(tx.kind)) e.push('Tipo de movimiento inválido.');
  if (!Number.isInteger(tx.amount) || (tx.kind !== 'adjustment' && tx.amount <= 0)) e.push('Escribe un monto mayor a cero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date || '')) e.push('Fecha inválida.');
  if (!ids.has(tx.accountId)) e.push('Elige una cuenta.');
  if (tx.kind === 'transfer' || tx.kind === 'card_payment') {
    if (!ids.has(tx.toAccountId)) e.push('Elige la cuenta destino.');
    if (tx.toAccountId === tx.accountId) e.push('El origen y el destino deben ser distintos.');
  }
  if (tx.kind === 'card_payment') {
    const to = state.accounts.find((a) => a.id === tx.toAccountId);
    if (to && accountKind(state, to) !== 'credit') e.push('El pago de tarjeta debe ir a una tarjeta de crédito.');
  }
  return e;
}
