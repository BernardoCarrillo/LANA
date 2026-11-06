// Ciclo de tarjetas de crédito: corte, fecha límite, fecha sugerida de pago, días restantes,
// saldo al corte, pago para no generar intereses y pago mínimo (capturado o estimado).
import { cutOnOrBefore, cutAfter, dueForCut, addDays, diffDays } from './dates.js';
import { balances, isActual } from './ledger.js';

export const DEFAULT_REMINDER_DAYS = 6;
const IVA = 0.16;

export function reminderDays(acc, settings = {}) {
  const v = acc.credit?.reminderDaysBefore;
  return Number.isInteger(v) ? v : (settings.defaultReminderDays ?? DEFAULT_REMINDER_DAYS);
}

/** Pago mínimo estimado (aprox. regla Banxico): max(%saldo + intereses c/IVA, 1.25% del límite), tope = saldo. */
export function estimateMinPayment(statement, { limit = 0, apr = 0, minPct = 0.015 } = {}) {
  if (statement <= 0) return 0;
  const interest = statement * (apr / 12) * (1 + IVA);
  const v = Math.max(statement * minPct + interest, limit * 0.0125);
  return Math.min(statement, Math.round(v));
}

/**
 * @returns {{lastCut,nextCut,dueDate,payBy,daysToDue,daysToPayBy,statementBalance,paidSinceCut,
 *   toAvoidInterest,minPayment,minEstimated,status,upcomingDue,upcomingPayBy,daysToUpcomingDue,nextDueDate}}
 * status: 'no_balance' | 'paid' | 'upcoming' | 'pay_now' | 'overdue'
 */
export function cardCycle(state, acc, today, settings = state.settings || {}) {
  const cr = acc.credit || {};
  const cutDay = cr.cutDay || 1;
  const dueDay = cr.dueDay || 20;
  const remind = reminderDays(acc, settings);

  const lastCut = cutOnOrBefore(today, cutDay);
  const nextCut = cutAfter(today, cutDay);
  const dueDate = dueForCut(lastCut, dueDay);
  const nextDueDate = dueForCut(nextCut, dueDay);
  const payBy = addDays(dueDate, -remind);

  const balAtCut = balances(state, { upto: lastCut }).get(acc.id) || 0;
  const statementBalance = Math.max(0, -balAtCut);
  let paidSinceCut = 0;
  for (const tx of state.transactions) {
    if (!isActual(tx) || tx.date <= lastCut || tx.date > today) continue;
    if ((tx.kind === 'card_payment' || tx.kind === 'transfer') && tx.toAccountId === acc.id) paidSinceCut += tx.amount;
  }
  const toAvoidInterest = Math.max(0, statementBalance - paidSinceCut);

  const capturedFor = cr.minPaymentCut === lastCut && Number.isInteger(cr.minPaymentOverride);
  const minPayment = capturedFor
    ? Math.min(cr.minPaymentOverride, statementBalance)
    : estimateMinPayment(statementBalance, { limit: cr.limit || 0, apr: cr.apr || 0, minPct: cr.minPct ?? 0.015 });
  const minRemaining = Math.max(0, minPayment - paidSinceCut);

  let status;
  if (statementBalance === 0) status = 'no_balance';
  else if (toAvoidInterest === 0) status = 'paid';
  else if (today > dueDate) status = 'overdue';
  else if (today >= payBy) status = 'pay_now';
  else status = 'upcoming';

  // La "próxima fecha límite" que importa al usuario: la del estado actual si aún no pasa
  // (o si está pendiente de pago); si ya pagó o ya pasó, la del siguiente corte.
  const currentRelevant = today <= dueDate && status !== 'paid' && status !== 'no_balance';
  const upcomingDue = currentRelevant ? dueDate : nextDueDate;
  const upcomingPayBy = addDays(upcomingDue, -remind);

  return {
    lastCut, nextCut, dueDate, nextDueDate, payBy, remind,
    daysToDue: diffDays(today, dueDate),
    daysToPayBy: diffDays(today, payBy),
    daysToNextCut: diffDays(today, nextCut),
    statementBalance, paidSinceCut, toAvoidInterest,
    minPayment, minRemaining, minEstimated: !capturedFor,
    status, upcomingDue, upcomingPayBy,
    daysToUpcomingDue: diffDays(today, upcomingDue),
    daysToUpcomingPayBy: diffDays(today, upcomingPayBy),
  };
}

export const STATUS_LABEL = {
  no_balance: 'Sin saldo al corte',
  paid: 'Pagada',
  upcoming: 'Por pagar',
  pay_now: 'Paga ya',
  overdue: 'Vencida',
};

/** Fechas límite y sugeridas de los próximos n ciclos (para calendario/notificaciones). */
export function futureCycles(acc, today, n = 12, settings = {}) {
  const cr = acc.credit || {};
  const out = [];
  let cut = cutOnOrBefore(today, cr.cutDay || 1);
  for (let i = 0; i < n + 1; i++) {
    const due = dueForCut(cut, cr.dueDay || 20);
    if (due >= today) out.push({ cut, due, payBy: addDays(due, -reminderDays(acc, settings)) });
    cut = cutAfter(cut, cr.cutDay || 1);
    if (out.length >= n) break;
  }
  return out;
}
