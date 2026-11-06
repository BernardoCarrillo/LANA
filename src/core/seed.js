// Datos de ejemplo deterministas (6 meses) para probar la app. Nombres genéricos, sin marcas reales.
import { addDays, monthKey, shiftMonth, parse, cutAfter, dueForCut } from './dates.js';
import { balances } from './ledger.js';
import { DEFAULT_ACCOUNT_TYPES, DEFAULT_CATEGORIES, DEFAULT_SHORTCUTS } from './categories.js';
import { DEFAULT_SETTINGS } from './alerts.js';
import { materialize } from './recurring.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function emptyState() {
  return {
    accounts: [], accountTypes: structuredClone(DEFAULT_ACCOUNT_TYPES), categories: structuredClone(DEFAULT_CATEGORIES),
    transactions: [], recurring: [], reconciliations: [],
    settings: { ...structuredClone(DEFAULT_SETTINGS), shortcuts: structuredClone(DEFAULT_SHORTCUTS), onboarded: false },
  };
}

export function demoState(today) {
  const st = emptyState();
  const r = rng(42);
  const cur = monthKey(today);
  const first = shiftMonth(cur, -5);
  const open = `${first}-01`;
  const now = Date.now();
  st.accounts = [
    { id: 'a_nomina', name: 'Nómina', typeId: 't_debit', color: '#2a78d6', icon: '🏧', openingBalance: 1850000, openingDate: open, archived: false },
    { id: 'a_efectivo', name: 'Efectivo', typeId: 't_cash', color: '#15803d', icon: '💵', openingBalance: 150000, openingDate: open, archived: false },
    { id: 'a_azul', name: 'Crédito Azul', typeId: 't_credit', color: '#1e3a8a', icon: '💳', openingBalance: -820000, openingDate: open, archived: false,
      credit: { limit: 6500000, cutDay: 3, dueDay: 23, apr: 0.62, minPct: 0.015, reminderDaysBefore: 6 } },
    { id: 'a_morada', name: 'Crédito Morada', typeId: 't_credit', color: '#6d28d9', icon: '💳', openingBalance: -310000, openingDate: open, archived: false,
      credit: { limit: 3500000, cutDay: 18, dueDay: 7, apr: 0.55, minPct: 0.015, reminderDaysBefore: 6 } },
    { id: 'a_vales', name: 'Vales despensa', typeId: 't_food', color: '#b45309', icon: '🛒', openingBalance: 120000, openingDate: open, archived: false },
    { id: 'a_gas', name: 'Vales gasolina', typeId: 't_fuel', color: '#c2410c', icon: '⛽', openingBalance: 50000, openingDate: open, archived: false },
    { id: 'a_ahorro', name: 'Ahorro', typeId: 't_savings', color: '#0f766e', icon: '🐷', openingBalance: 4500000, openingDate: open, archived: false },
  ];
  st.recurring = [
    { id: 'r_salario', name: 'Salario', kind: 'income', amount: 2150000, accountId: 'a_nomina', incomeType: 'salary', incomeLabel: 'Salario', freq: 'semimonthly', interval: 1, startDate: open, noticeDays: 0, autoConfirm: true, active: true, exceptions: {}, tags: ['nómina'] },
    { id: 'r_renta', name: 'Renta', kind: 'expense', amount: 1150000, accountId: 'a_nomina', categoryId: 'c_renta', freq: 'months', interval: 1, startDate: `${first}-05`, noticeDays: 3, autoConfirm: true, active: true, exceptions: {}, tags: ['fijo'] },
    { id: 'r_luz', name: 'Luz (bimestral)', kind: 'expense', amount: 68000, accountId: 'a_nomina', categoryId: 'c_luz', freq: 'months', interval: 2, startDate: `${first}-12`, noticeDays: 3, autoConfirm: true, active: true, exceptions: {}, tags: ['fijo'] },
    { id: 'r_internet', name: 'Internet + celular', kind: 'expense', amount: 79900, accountId: 'a_azul', categoryId: 'c_internet', freq: 'months', interval: 1, startDate: `${first}-10`, noticeDays: 2, autoConfirm: true, active: true, exceptions: {}, tags: ['fijo'] },
    { id: 'r_stream', name: 'Streaming', kind: 'expense', amount: 21900, accountId: 'a_morada', categoryId: 'c_suscripciones', freq: 'months', interval: 1, startDate: `${first}-15`, noticeDays: 1, autoConfirm: true, active: true, exceptions: {}, tags: ['suscripción'] },
    { id: 'r_musica', name: 'Música', kind: 'expense', amount: 12900, accountId: 'a_morada', categoryId: 'c_suscripciones', freq: 'months', interval: 1, startDate: `${first}-20`, noticeDays: 1, autoConfirm: true, active: true, exceptions: {}, tags: ['suscripción'] },
    { id: 'r_seguro', name: 'Seguro de gastos médicos', kind: 'expense', amount: 185000, accountId: 'a_azul', categoryId: 'c_seguros', freq: 'months', interval: 1, startDate: `${first}-25`, noticeDays: 3, autoConfirm: false, active: true, exceptions: {}, tags: ['seguro'] },
    { id: 'r_ahorro', name: 'Apartar a ahorro', kind: 'transfer', amount: 300000, accountId: 'a_nomina', toAccountId: 'a_ahorro', freq: 'months', interval: 1, startDate: `${first}-16`, noticeDays: 0, autoConfirm: true, active: true, exceptions: {}, tags: ['ahorro'] },
    { id: 'r_vales', name: 'Depósito vales despensa', kind: 'income', amount: 320000, accountId: 'a_vales', incomeType: 'other', incomeLabel: 'Vales de despensa', freq: 'months', interval: 1, startDate: `${first}-01`, noticeDays: 0, autoConfirm: true, active: true, exceptions: {}, tags: ['prestación'] },
    { id: 'r_valesgas', name: 'Depósito vales gasolina', kind: 'income', amount: 150000, accountId: 'a_gas', incomeType: 'other', incomeLabel: 'Vales de gasolina', freq: 'months', interval: 1, startDate: `${first}-01`, noticeDays: 0, autoConfirm: true, active: true, exceptions: {}, tags: ['prestación'] },
  ];
  // Gastos variables
  const small = [
    ['c_cafe', 4500, 9000, ['a_azul', 'a_efectivo']], ['c_comer', 12000, 45000, ['a_azul', 'a_morada']], ['c_antojos', 2500, 8000, ['a_efectivo']],
    ['c_transporte', 6000, 18000, ['a_azul', 'a_nomina']], ['c_delivery', 18000, 42000, ['a_morada']], ['c_salidas', 35000, 90000, ['a_azul']],
    ['c_entretenimiento', 15000, 40000, ['a_morada']], ['c_ropa', 50000, 180000, ['a_azul']]
  ];
  let d = open;
  const txs = [];
  let n = 0;
  while (d <= today) {
    const dow = new Date(d + 'T12:00:00').getDay();
    const k = 1 + Math.floor(r() * 2.4);
    for (let i = 0; i < k; i++) {
      const [cat, lo, hi, accs] = small[Math.floor(r() * 8)];
      if (cat === 'c_ropa' && r() > 0.25) continue;
      if (cat === 'c_salidas' && dow !== 5 && dow !== 6) continue;
      txs.push({ id: `demo${n++}`, kind: 'expense', amount: Math.round((lo + r() * (hi - lo)) / 100) * 100, date: d, accountId: accs[Math.floor(r() * accs.length)], categoryId: cat, note: '', tags: [], status: 'confirmed', createdAt: now, updatedAt: now });
    }
    const { d: day } = parse(d);
    if (dow === 6) txs.push({ id: `demo${n++}`, kind: 'expense', amount: Math.round((50000 + r() * 35000) / 100) * 100, date: d, accountId: 'a_vales', categoryId: 'c_despensa', note: 'Súper', tags: ['súper'], status: 'confirmed', createdAt: now, updatedAt: now });
    if (dow === 1 && r() > 0.45) txs.push({ id: `demo${n++}`, kind: 'expense', amount: 50000, date: d, accountId: 'a_gas', categoryId: 'c_gasolina', note: '', tags: [], status: 'confirmed', createdAt: now, updatedAt: now });
    if (day === 9 && r() > 0.5) txs.push({ id: `demo${n++}`, kind: 'expense', amount: 38000, date: d, accountId: 'a_azul', categoryId: 'c_salud', note: 'Farmacia', tags: [], status: 'confirmed', createdAt: now, updatedAt: now });
    d = addDays(d, 1);
  }
  // Ingresos extraordinarios
  const m2 = shiftMonth(cur, -3), m4 = shiftMonth(cur, -1);
  txs.push({ id: 'demo-bono1', kind: 'income', amount: 1500000, date: `${m2}-20`, accountId: 'a_nomina', incomeType: 'bonus', incomeLabel: 'Bono de desempeño', note: '', tags: ['bono'], status: 'confirmed', createdAt: now, updatedAt: now });
  txs.push({ id: 'demo-fondo', kind: 'income', amount: 3480000, date: `${m4}-10`, accountId: 'a_nomina', incomeType: 'savings_fund', incomeLabel: 'Fondo de ahorro anual', note: '', tags: ['fondo'], status: 'confirmed', createdAt: now, updatedAt: now });
  txs.push({ id: 'demo-otro', kind: 'income', amount: 420000, date: `${shiftMonth(cur, -4)}-14`, accountId: 'a_nomina', incomeType: 'other', incomeLabel: 'Venta de bicicleta', note: '', tags: [], status: 'confirmed', createdAt: now, updatedAt: now });
  txs.push({ id: 'demo-ahorro-extra', kind: 'transfer', amount: 2000000, date: `${m4}-11`, accountId: 'a_nomina', toAccountId: 'a_ahorro', note: 'Guardar fondo de ahorro', tags: ['ahorro'], status: 'confirmed', createdAt: now, updatedAt: now });
  txs.push({ id: 'demo-inv', kind: 'expense', amount: 500000, date: `${shiftMonth(cur, -2)}-18`, accountId: 'a_nomina', categoryId: 'c_retiro', note: 'Aportación voluntaria', tags: [], status: 'confirmed', createdAt: now, updatedAt: now });
  st.transactions = txs.filter((t) => t.date <= today);
  st.transactions.push(...materialize(st, today));
  // Fijos "por confirmar": solo los del mes actual quedan pendientes (los anteriores ya se confirmaron)
  for (const t of st.transactions) if (t.status === 'pending' && t.date < `${cur}-01`) t.status = 'confirmed';
  // Pagos de tarjeta (hechos en la app del banco y registrados aquí) 6 días antes del límite.
  // Azul: paga el total del estado de cuenta. Morada: paga ~70% (para mostrar deuda revolvente).
  const cuts = [];
  for (const a of st.accounts.filter((x) => x.credit)) {
    let c = cutAfter(open, a.credit.cutDay);
    while (c <= today) { cuts.push({ a, cut: c }); c = cutAfter(c, a.credit.cutDay); }
  }
  cuts.sort((x, y) => x.cut.localeCompare(y.cut));
  for (const { a, cut } of cuts) {
    const debt = Math.max(0, -(balances(st, { upto: cut }).get(a.id) || 0));
    const date = addDays(dueForCut(cut, a.credit.dueDay), -6);
    if (!debt || date > today) continue;
    const amount = a.id === 'a_morada' ? Math.round(debt * 0.7 / 100) * 100 : debt;
    st.transactions.push({ id: `pay-${a.id}-${cut}`, kind: 'card_payment', amount, date, accountId: 'a_nomina', toAccountId: a.id, note: 'Pago desde app del banco', tags: [], status: 'reconciled', createdAt: now, updatedAt: now });
  }
  st.settings.onboarded = true;
  st.settings.budgets = { layer: { essentials: 2400000, lifestyle: 900000, savings: 600000 }, category: { c_comer: 250000, c_cafe: 80000 } };
  return st;
}
