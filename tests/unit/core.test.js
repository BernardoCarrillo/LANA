// Pruebas de aceptación del núcleo financiero. Ejecutar: npm test  (node --test)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { toCents, fmt, fmtCompact } from '../../src/core/money.js';
import * as D from '../../src/core/dates.js';
import { emptyState, demoState } from '../../src/core/seed.js';
import { monthSummary, balances, accountSnapshot, validateTx, filterTransactions, totals } from '../../src/core/ledger.js';
import { cardCycle, estimateMinPayment, futureCycles } from '../../src/core/cards.js';
import * as R from '../../src/core/recurring.js';
import { simulatePayoff, simulateMinimum, paymentForMonths } from '../../src/core/debt.js';
import { computeAlerts, buildSchedule } from '../../src/core/alerts.js';
import { toCSV, fromCSV, parseCSV } from '../../src/core/csv.js';
import { makeBackup, validateBackup, mergeBackup, encryptBackup, decryptBackup } from '../../src/core/backup.js';
import { buildICS } from '../../src/core/ics.js';

function base() {
  const s = emptyState();
  s.accounts = [
    { id: 'deb', name: 'Débito', typeId: 't_debit', openingBalance: 1000000, openingDate: '2026-01-01' },
    { id: 'tc', name: 'TC', typeId: 't_credit', openingBalance: 0, openingDate: '2026-01-01', credit: { limit: 2000000, cutDay: 5, dueDay: 25, apr: 0.6 } },
    { id: 'ah', name: 'Ahorro', typeId: 't_savings', openingBalance: 0, openingDate: '2026-01-01' },
    { id: 'vale', name: 'Vales', typeId: 't_food', openingBalance: 0, openingDate: '2026-01-01' },
  ];
  return s;
}
let n = 0;
const tx = (o) => ({ id: `t${n++}`, status: 'confirmed', tags: [], note: '', createdAt: n, ...o });

describe('Dinero', () => {
  test('toCents sin errores de flotante', () => {
    assert.equal(toCents('1,234.56'), 123456);
    assert.equal(toCents('0.1') + toCents('0.2'), 30);
    assert.equal(toCents('12,5'), 1250);
    assert.equal(toCents('$ 99'), 9900);
    assert.equal(toCents('-15.5'), -1550);
  });
  test('formato MXN', () => {
    assert.match(fmt(123456), /\$1,234\.56/);
    assert.match(fmt(500000), /\$5,000$/);
    assert.equal(fmtCompact(1250000), '$12.5k');
  });
});

describe('Fechas de corte y pago', () => {
  test('corte <= hoy y siguiente corte', () => {
    assert.equal(D.cutOnOrBefore('2026-11-06', 5), '2026-11-05');
    assert.equal(D.cutOnOrBefore('2026-11-04', 5), '2026-10-05');
    assert.equal(D.cutAfter('2026-11-05', 5), '2026-12-05');
    assert.equal(D.cutOnOrBefore('2026-01-02', 5), '2025-12-05');
  });
  test('fecha límite mismo mes y mes siguiente', () => {
    assert.equal(D.dueForCut('2026-11-05', 25), '2026-11-25');
    assert.equal(D.dueForCut('2026-11-18', 7), '2026-12-07');
    assert.equal(D.dueForCut('2026-12-18', 7), '2027-01-07');
  });
  test('días 29–31 se ajustan a fin de mes', () => {
    assert.equal(D.cutOnOrBefore('2027-02-28', 31), '2027-02-28');
    assert.equal(D.cutOnOrBefore('2027-02-27', 31), '2027-01-31');
    assert.equal(D.dueForCut('2028-01-31', 30), '2028-02-29'); // bisiesto
    assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(D.addMonths('2026-01-31', 2), '2026-03-31');
  });
  test('días restantes exactos (sin horas)', () => {
    assert.equal(D.diffDays('2026-11-06', '2026-11-25'), 19);
    assert.equal(D.diffDays('2026-12-31', '2027-01-01'), 1);
    assert.equal(D.diffDays('2026-03-07', '2026-03-09'), 2); // cruza cambio de horario en otros países
  });
  test('ciclo de tarjeta: sugerido = límite − 6 días, estados', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 300000, date: '2026-11-01', accountId: 'tc', categoryId: 'c_comer' }));
    let c = cardCycle(s, s.accounts[1], '2026-11-06');
    assert.equal(c.lastCut, '2026-11-05');
    assert.equal(c.dueDate, '2026-11-25');
    assert.equal(c.payBy, '2026-11-19');
    assert.equal(c.daysToDue, 19);
    assert.equal(c.daysToPayBy, 13);
    assert.equal(c.statementBalance, 300000);
    assert.equal(c.status, 'upcoming');
    assert.equal(cardCycle(s, s.accounts[1], '2026-11-20').status, 'pay_now');
    assert.equal(cardCycle(s, s.accounts[1], '2026-11-26').status, 'overdue');
    // compra después del corte no cambia el saldo al corte
    s.transactions.push(tx({ kind: 'expense', amount: 50000, date: '2026-11-07', accountId: 'tc', categoryId: 'c_cafe' }));
    assert.equal(cardCycle(s, s.accounts[1], '2026-11-10').statementBalance, 300000);
    // pago registrado
    s.transactions.push(tx({ kind: 'card_payment', amount: 300000, date: '2026-11-19', accountId: 'deb', toAccountId: 'tc' }));
    c = cardCycle(s, s.accounts[1], '2026-11-20');
    assert.equal(c.status, 'paid');
    assert.equal(c.toAvoidInterest, 0);
    assert.equal(c.upcomingDue, '2026-12-25');
  });
  test('recordatorio configurable por tarjeta', () => {
    const s = base(); s.accounts[1].credit.reminderDaysBefore = 3;
    assert.equal(cardCycle(s, s.accounts[1], '2026-11-06').payBy, '2026-11-22');
    assert.equal(futureCycles(s.accounts[1], '2026-11-06', 3).length, 3);
  });
  test('pago mínimo estimado o capturado', () => {
    assert.equal(estimateMinPayment(0, { limit: 1000000 }), 0);
    assert.ok(estimateMinPayment(1000000, { limit: 2000000, apr: 0.6 }) > 25000);
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 800000, date: '2026-11-02', accountId: 'tc' }));
    s.accounts[1].credit.minPaymentOverride = 45000; s.accounts[1].credit.minPaymentCut = '2026-11-05';
    const c = cardCycle(s, s.accounts[1], '2026-11-06');
    assert.equal(c.minPayment, 45000); assert.equal(c.minEstimated, false);
  });
});

describe('Ledger: criterios de aceptación', () => {
  test('pago de tarjeta NO aumenta gastos ni egresos', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 100000, date: '2026-11-02', accountId: 'tc', categoryId: 'c_comer' }));
    const before = monthSummary(s, '2026-11');
    s.transactions.push(tx({ kind: 'card_payment', amount: 100000, date: '2026-11-03', accountId: 'deb', toAccountId: 'tc' }));
    const after = monthSummary(s, '2026-11');
    assert.equal(after.expenses, before.expenses);
    assert.equal(after.consumption, before.consumption);
    assert.equal(after.income, before.income);
    assert.equal(after.cardPayments, 100000);
    const b = balances(s);
    assert.equal(b.get('tc'), 0);
    assert.equal(b.get('deb'), 900000);
  });
  test('transferencia entre cuentas no altera gastos', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'transfer', amount: 250000, date: '2026-11-04', accountId: 'deb', toAccountId: 'ah' }));
    const m = monthSummary(s, '2026-11');
    assert.equal(m.expenses, 0); assert.equal(m.consumption, 0); assert.equal(m.income, 0);
    assert.equal(m.transfers, 250000);
    assert.equal(balances(s).get('ah'), 250000);
    assert.equal(totals(s, balances(s)).liquid, 1000000);
  });
  test('salario, bono y fondo de ahorro se reflejan en ingresos', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'income', amount: 2000000, date: '2026-11-15', accountId: 'deb', incomeType: 'salary' }));
    s.transactions.push(tx({ kind: 'income', amount: 500000, date: '2026-11-20', accountId: 'deb', incomeType: 'bonus', incomeLabel: 'Bono anual' }));
    s.transactions.push(tx({ kind: 'income', amount: 3000000, date: '2026-11-30', accountId: 'deb', incomeType: 'savings_fund' }));
    s.transactions.push(tx({ kind: 'income', amount: 100000, date: '2026-11-30', accountId: 'deb', incomeType: 'other', incomeLabel: 'Aguinaldo' }));
    const m = monthSummary(s, '2026-11');
    assert.equal(m.income, 5600000);
    assert.deepEqual(m.incomeByType, { salary: 2000000, bonus: 500000, savings_fund: 3000000, other: 100000 });
    assert.equal(m.incomeLabels['other|Aguinaldo'], 100000);
    assert.equal(m.incomeLabels['bonus|Bono anual'], 500000);
  });
  test('capas, ahorro y tasa de ahorro', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'income', amount: 1000000, date: '2026-11-01', accountId: 'deb', incomeType: 'salary' }));
    s.transactions.push(tx({ kind: 'expense', amount: 400000, date: '2026-11-02', accountId: 'deb', categoryId: 'c_renta' }));
    s.transactions.push(tx({ kind: 'expense', amount: 100000, date: '2026-11-02', accountId: 'tc', categoryId: 'c_cafe' }));
    s.transactions.push(tx({ kind: 'expense', amount: 200000, date: '2026-11-03', accountId: 'deb', categoryId: 'c_inversion' }));
    const m = monthSummary(s, '2026-11');
    assert.deepEqual([m.byLayer.essentials, m.byLayer.lifestyle, m.byLayer.savings], [400000, 100000, 200000]);
    assert.equal(m.consumption, 500000);
    assert.equal(m.expenses, 700000);
    assert.equal(m.savings, 500000);
    assert.equal(m.savingsRate, 0.5);
    assert.equal(m.net, 300000);
    assert.equal(m.debtEnd, 100000);
  });
  test('pendientes no cuentan hasta confirmarse', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 99900, date: '2026-11-02', accountId: 'deb', categoryId: 'c_luz', status: 'pending' }));
    const m = monthSummary(s, '2026-11');
    assert.equal(m.expenses, 0); assert.equal(m.pending.count, 1);
    assert.equal(balances(s).get('deb'), 1000000);
  });
  test('vales: saldo propio, sin deuda, reporte separado', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'income', amount: 300000, date: '2026-11-01', accountId: 'vale', incomeType: 'other', incomeLabel: 'Vales' }));
    s.transactions.push(tx({ kind: 'expense', amount: 120000, date: '2026-11-02', accountId: 'vale', categoryId: 'c_despensa' }));
    const m = monthSummary(s, '2026-11');
    assert.equal(m.voucherSpend, 120000);
    assert.equal(m.vouchersEnd, 180000);
    assert.equal(m.debtEnd, 0);
  });
  test('utilización y disponible de crédito', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 500000, date: '2026-11-02', accountId: 'tc' }));
    const snap = accountSnapshot(s, s.accounts[1], balances(s).get('tc'));
    assert.equal(snap.debt, 500000); assert.equal(snap.available, 1500000); assert.equal(snap.utilization, 0.25);
  });
  test('validación: pago de tarjeta solo hacia crédito; origen ≠ destino', () => {
    const s = base();
    assert.ok(validateTx({ kind: 'card_payment', amount: 100, date: '2026-11-01', accountId: 'deb', toAccountId: 'ah' }, s).length);
    assert.ok(validateTx({ kind: 'transfer', amount: 100, date: '2026-11-01', accountId: 'deb', toAccountId: 'deb' }, s).length);
    assert.equal(validateTx({ kind: 'card_payment', amount: 100, date: '2026-11-01', accountId: 'deb', toAccountId: 'tc' }, s).length, 0);
    assert.ok(validateTx({ kind: 'expense', amount: 0, date: '2026-11-01', accountId: 'deb' }, s).length);
  });
  test('búsqueda y filtros', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 5500, date: '2026-11-02', accountId: 'deb', categoryId: 'c_cafe', tags: ['oficina'], note: 'latte' }));
    s.transactions.push(tx({ kind: 'expense', amount: 9900, date: '2026-10-02', accountId: 'tc', categoryId: 'c_comer' }));
    assert.equal(filterTransactions(s, { q: 'latte' }).length, 1);
    assert.equal(filterTransactions(s, { q: 'café' }).length, 1);
    assert.equal(filterTransactions(s, { tag: 'oficina' }).length, 1);
    assert.equal(filterTransactions(s, { month: '2026-10' }).length, 1);
    assert.equal(filterTransactions(s, { layer: 'lifestyle' }).length, 2);
    assert.equal(filterTransactions(s, { accountId: 'tc' }).length, 1);
  });
});

describe('Recurrentes', () => {
  const rule = (o = {}) => ({ id: 'renta', name: 'Renta', kind: 'expense', amount: 1000000, accountId: 'deb', categoryId: 'c_renta', freq: 'months', interval: 1, startDate: '2026-08-31', noticeDays: 3, autoConfirm: false, active: true, exceptions: {}, ...o });
  test('fechas mensuales con fin de mes', () => {
    assert.deepEqual(R.occurrenceDates(rule(), '2026-08-01', '2026-12-31'), ['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31']);
  });
  test('quincenal, semanal, bimestral, anual', () => {
    assert.deepEqual(R.occurrenceDates(rule({ freq: 'semimonthly', startDate: '2027-02-01' }), '2027-02-01', '2027-03-20'), ['2027-02-15', '2027-02-28', '2027-03-15']);
    assert.equal(R.occurrenceDates(rule({ freq: 'weeks', startDate: '2026-11-02' }), '2026-11-01', '2026-11-30').length, 5);
    assert.deepEqual(R.occurrenceDates(rule({ interval: 2, startDate: '2026-01-12' }), '2026-01-01', '2026-07-01'), ['2026-01-12', '2026-03-12', '2026-05-12']);
    assert.deepEqual(R.occurrenceDates(rule({ interval: 12, startDate: '2025-12-15' }), '2025-01-01', '2027-12-31'), ['2025-12-15', '2026-12-15', '2027-12-15']);
  });
  test('autogenera SIN duplicados aunque se ejecute varias veces', () => {
    const s = base(); s.recurring = [rule()];
    const a = R.materialize(s, '2026-11-06');
    assert.equal(a.length, 3); // ago 31, sep 30, oct 31
    s.transactions.push(...a);
    assert.equal(R.materialize(s, '2026-11-06').length, 0);
    assert.equal(R.materialize(s, '2026-11-30').length, 1);
    assert.equal(new Set(s.transactions.map((t) => t.id)).size, s.transactions.length);
    assert.ok(a.every((t) => t.status === 'pending'));
  });
  test('omitir solo una ocurrencia (generada o futura) y no se regenera', () => {
    const s = base(); s.recurring = [rule()];
    s.transactions.push(...R.materialize(s, '2026-11-06'));
    const { rule: r2, deleteTxId } = R.skipOccurrence(s.recurring[0], '2026-09-30');
    s.recurring = [r2]; s.transactions = s.transactions.filter((t) => t.id !== deleteTxId);
    assert.equal(R.materialize(s, '2026-11-06').length, 0);
    const r3 = R.skipOccurrence(s.recurring[0], '2026-11-30').rule; s.recurring = [r3];
    assert.equal(R.materialize(s, '2026-12-01').length, 0);
    assert.ok(!R.upcoming(s, '2026-11-06', 30).some((o) => o.origDate === '2026-11-30'));
  });
  test('editar solo una ocurrencia futura', () => {
    const s = base(); s.recurring = [R.editOccurrence(rule(), '2026-11-30', { amount: 1100000, date: '2026-11-28' })];
    s.transactions.push(...R.materialize(s, '2026-11-06'));
    const up = R.upcoming(s, '2026-11-06', 30);
    assert.equal(up[0].amount, 1100000); assert.equal(up[0].date, '2026-11-28');
    const gen = R.materialize(s, '2026-11-28');
    assert.equal(gen.length, 1); assert.equal(gen[0].amount, 1100000);
  });
  test('editar toda la serie actualiza pendientes y conserva confirmados', () => {
    const s = base(); s.recurring = [rule()];
    s.transactions.push(...R.materialize(s, '2026-11-06'));
    s.transactions[0].status = 'confirmed';
    const { rule: r2, updates, deletes } = R.editSeries(s, s.recurring[0], { amount: 1200000 });
    assert.equal(updates.length, 2); assert.equal(deletes.length, 0);
    assert.ok(updates.every((u) => u.amount === 1200000));
    assert.equal(r2.amount, 1200000);
    const sch = R.editSeries(s, s.recurring[0], { startDate: '2026-09-15' });
    assert.equal(sch.deletes.length, 2);
  });
  test('eliminar regla borra pendientes y conserva confirmados', () => {
    const s = base(); s.recurring = [rule()];
    s.transactions.push(...R.materialize(s, '2026-11-06'));
    s.transactions[0].status = 'confirmed';
    assert.equal(R.deleteRule(s, 'renta').deletes.length, 2);
    assert.equal(R.deleteRule(s, 'renta', { deletePending: false }).deletes.length, 0);
  });
  test('fecha fin y regla inactiva', () => {
    const s = base(); s.recurring = [rule({ endDate: '2026-09-30' })];
    assert.equal(R.materialize(s, '2026-11-06').length, 2);
    s.recurring = [rule({ active: false })];
    assert.equal(R.materialize(s, '2026-11-06').length, 0);
  });
  test('equivalente mensual', () => {
    assert.equal(R.monthlyEquivalent(rule({ interval: 2, amount: 60000 })), 30000);
    assert.equal(R.monthlyEquivalent(rule({ freq: 'semimonthly', amount: 100 })), 200);
  });
});

describe('Deuda', () => {
  test('simulación termina y pagar más reduce intereses', () => {
    const a = simulatePayoff(2000000, 0.6, 200000);
    const b = simulatePayoff(2000000, 0.6, 400000);
    assert.ok(a.paysOff && b.paysOff);
    assert.ok(b.months < a.months && b.totalInterest < a.totalInterest);
    assert.equal(simulatePayoff(2000000, 0.6, 10000).paysOff, false);
    assert.ok(simulateMinimum(2000000, 0.6, { limit: 4000000 }).months > a.months);
    const p = paymentForMonths(2000000, 0.6, 12);
    const s = simulatePayoff(2000000, 0.6, p);
    assert.ok(s.months <= 12);
  });
});

describe('Alertas y calendario', () => {
  test('alerta de pago y recordatorio de registrar pago', () => {
    const s = base();
    s.transactions.push(tx({ kind: 'expense', amount: 300000, date: '2026-11-01', accountId: 'tc', categoryId: 'c_comer' }));
    const al = computeAlerts(s, '2026-11-20');
    const a = al.find((x) => x.type === 'card');
    assert.ok(a && a.action === 'register-payment');
    const sched = buildSchedule(s, '2026-11-06');
    assert.ok(sched.some((e) => e.id === 'n-pay-tc-2026-11-25' && e.date === '2026-11-19'));
    // al registrar el pago desaparecen los recordatorios del ciclo
    s.transactions.push(tx({ kind: 'card_payment', amount: 300000, date: '2026-11-10', accountId: 'deb', toAccountId: 'tc' }));
    assert.ok(!buildSchedule(s, '2026-11-10').some((e) => e.id === 'n-pay-tc-2026-11-25'));
    assert.ok(!computeAlerts(s, '2026-11-20').some((x) => x.type === 'card'));
  });
  test('alerta de presupuesto 80% y 100%', () => {
    const s = base(); s.settings.budgets = { layer: { lifestyle: 100000 }, category: {} };
    s.transactions.push(tx({ kind: 'expense', amount: 85000, date: '2026-11-02', accountId: 'deb', categoryId: 'c_cafe' }));
    assert.equal(computeAlerts(s, '2026-11-06').find((x) => x.type === 'budget').severity, 'warn');
    s.transactions.push(tx({ kind: 'expense', amount: 20000, date: '2026-11-03', accountId: 'deb', categoryId: 'c_cafe' }));
    assert.equal(computeAlerts(s, '2026-11-06').find((x) => x.type === 'budget').severity, 'danger');
  });
  test('ICS válido con alarmas', () => {
    const ics = buildICS([{ id: 'x1', date: '2026-11-19', title: 'Pagar TC, ya', body: 'Línea 1\nLínea 2' }], { hour: 9 });
    assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /DTSTART:20261119T090000/); assert.match(ics, /BEGIN:VALARM/);
    assert.match(ics, /SUMMARY:Pagar TC\\, ya/);
  });
});

describe('Respaldos', () => {
  test('CSV ida y vuelta', () => {
    const s = demoState('2026-11-06');
    const csv = toCSV(s);
    const rows = parseCSV(csv);
    assert.equal(rows.length - 1, s.transactions.length);
    const fresh = { ...s, transactions: [] };
    const res = fromCSV(csv, fresh);
    assert.equal(res.errors.length, 0);
    assert.equal(res.transactions.length, s.transactions.length);
    assert.equal(res.newAccounts.length, 0);
    const sum = (a) => a.reduce((x, t) => x + t.amount, 0);
    assert.equal(sum(res.transactions), sum(s.transactions));
    // reimportar no duplica
    assert.equal(fromCSV(csv, s).skipped, s.transactions.length);
  });
  test('CSV con comillas, comas y cuenta nueva', () => {
    const s = base();
    const csv = 'fecha,tipo,monto,cuenta,categoria,nota\n2026-11-01,Egreso,"1,250.00",Cartera,Café,"dijo ""hola"", ok"\n2026-11-02,Raro,1,Cartera,,\n';
    const r = fromCSV(csv, s);
    assert.equal(r.transactions.length, 1); assert.equal(r.transactions[0].amount, 125000);
    assert.equal(r.transactions[0].note, 'dijo "hola", ok');
    assert.equal(r.newAccounts[0].name, 'Cartera'); assert.equal(r.errors.length, 1);
  });
  test('CSV neutraliza fórmulas', () => {
    const s = base(); s.transactions.push(tx({ kind: 'expense', amount: 100, date: '2026-11-01', accountId: 'deb', note: '=HYPERLINK("x")' }));
    assert.match(toCSV(s), /'=HYPERLINK/);
  });
  test('JSON: exporta, valida, fusiona y reemplaza', () => {
    const s = demoState('2026-11-06');
    s.settings.security = { pinHash: 'secreto' };
    const b = makeBackup(s);
    assert.equal(b.data.settings.security, undefined);
    assert.ok(validateBackup(JSON.parse(JSON.stringify(b))).ok);
    assert.equal(validateBackup({ app: 'otra' }).ok, false);
    const empty = emptyState();
    const merged = mergeBackup(empty, b, 'merge');
    assert.equal(merged.transactions.length, s.transactions.length);
    const replaced = mergeBackup(s, { data: { transactions: [] } }, 'replace');
    assert.equal(replaced.transactions.length, 0);
  });
  test('respaldo cifrado', async () => {
    const b = makeBackup(demoState('2026-11-06'));
    const e = await encryptBackup(b, 'clave-larga');
    assert.ok(e.encrypted && !JSON.stringify(e).includes('Nómina'));
    const d = await decryptBackup(e, 'clave-larga');
    assert.equal(d.data.transactions.length, b.data.transactions.length);
    await assert.rejects(() => decryptBackup(e, 'otra'));
  });
});

describe('Datos de ejemplo', () => {
  test('demo consistente: sin duplicados, 6 meses', () => {
    const s = demoState('2026-11-06');
    assert.equal(new Set(s.transactions.map((t) => t.id)).size, s.transactions.length);
    const m = monthSummary(s, '2026-10');
    assert.ok(m.income > 0 && m.expenses > 0);
    assert.ok(m.incomeByType.savings_fund > 0);
  });
});
