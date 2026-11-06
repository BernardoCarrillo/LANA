// Reglas recurrentes (gastos fijos, salario, suscripciones, seguros...).
// Idempotencia: cada ocurrencia tiene id determinista r:<regla>:<fechaOriginal>,
// por lo que generar N veces nunca duplica. Omitir/borrar una ocurrencia guarda una excepción `skip`.
import { addDays, addMonths, diffDays, parse, dayIn, make, daysInMonth } from './dates.js';
import { occurrenceId } from './ids.js';

export const FREQS = [
  { id: 'm1', freq: 'months', interval: 1, label: 'Mensual' },
  { id: 'm2', freq: 'months', interval: 2, label: 'Bimestral' },
  { id: 'm3', freq: 'months', interval: 3, label: 'Trimestral' },
  { id: 'm6', freq: 'months', interval: 6, label: 'Semestral' },
  { id: 'm12', freq: 'months', interval: 12, label: 'Anual' },
  { id: 'sm', freq: 'semimonthly', interval: 1, label: 'Quincenal (15 y fin de mes)' },
  { id: 'w1', freq: 'weeks', interval: 1, label: 'Semanal' },
  { id: 'w2', freq: 'weeks', interval: 2, label: 'Catorcenal (cada 2 semanas)' },
];
export function freqLabel(rule) {
  const f = FREQS.find((x) => x.freq === rule.freq && x.interval === (rule.interval || 1));
  if (f) return f.label;
  return rule.freq === 'weeks' ? `Cada ${rule.interval} semanas` : `Cada ${rule.interval} meses`;
}
export const freqId = (rule) => (FREQS.find((x) => x.freq === rule.freq && x.interval === (rule.interval || 1)) || FREQS[0]).id;

const MAX_ITER = 2000;

/** Fechas ORIGINALES programadas dentro de [from, to] (inclusive). */
export function occurrenceDates(rule, from, to) {
  const start = rule.startDate;
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const lo = from > start ? from : start;
  if (lo > end) return [];
  const out = [];
  const interval = Math.max(1, rule.interval || 1);

  if (rule.freq === 'weeks') {
    const step = 7 * interval;
    let k = Math.max(0, Math.floor(diffDays(start, lo) / step));
    for (let i = 0; i < MAX_ITER; i++, k++) {
      const d = addDays(start, k * step);
      if (d > end) break;
      if (d >= lo) out.push(d);
    }
  } else if (rule.freq === 'semimonthly') {
    const days = rule.days?.length ? rule.days : [15, 31];
    let { y, m } = parse(lo);
    for (let i = 0; i < MAX_ITER; i++) {
      for (const day of days) {
        const d = make(y, m, Math.min(day, daysInMonth(y, m)));
        if (d >= lo && d <= end) out.push(d);
      }
      m++; if (m > 12) { m = 1; y++; }
      if (make(y, m, 1) > end) break;
    }
    out.sort();
  } else { // months
    const anchor = rule.dayOfMonth || parse(start).d;
    const s = parse(start), l = parse(lo);
    const monthsBetween = (l.y - s.y) * 12 + (l.m - s.m);
    let k = Math.max(0, Math.floor(monthsBetween / interval) - 1);
    for (let i = 0; i < MAX_ITER; i++, k++) {
      const d = k === 0 ? dayIn(s.y, s.m, anchor) : addMonths(start, k * interval, anchor);
      if (d > end) break;
      if (d >= lo && d >= start) out.push(d);
    }
  }
  return out;
}

/** Aplica excepciones: null si se omitió; si no, fecha y monto efectivos. */
export function effective(rule, origDate) {
  const exc = rule.exceptions?.[origDate];
  if (exc?.skip) return null;
  return { origDate, date: exc?.date || origDate, amount: Number.isInteger(exc?.amount) ? exc.amount : rule.amount, edited: !!exc };
}

export function buildTx(rule, occ, now = Date.now()) {
  return {
    id: occurrenceId(rule.id, occ.origDate),
    kind: rule.kind,
    amount: occ.amount,
    date: occ.date,
    accountId: rule.accountId,
    toAccountId: rule.toAccountId || null,
    categoryId: rule.kind === 'expense' ? rule.categoryId || null : null,
    incomeType: rule.kind === 'income' ? rule.incomeType || 'salary' : null,
    incomeLabel: rule.kind === 'income' ? rule.incomeLabel || '' : '',
    note: rule.name,
    tags: rule.tags ? [...rule.tags] : ['fijo'],
    status: rule.autoConfirm ? 'confirmed' : 'pending',
    recurringId: rule.id,
    occurrenceDate: occ.origDate,
    detached: false,
    createdAt: now, updatedAt: now,
  };
}

/**
 * Genera los movimientos vencidos (fecha efectiva <= hoy) que aún no existen.
 * Seguro de llamar cuantas veces se quiera: nunca duplica.
 */
export function materialize(state, today, now = Date.now()) {
  const existing = new Set(state.transactions.map((t) => t.id));
  const out = [];
  for (const rule of state.recurring) {
    if (!rule.active) continue;
    // Mira 62 días hacia adelante por si una excepción adelantó la fecha efectiva.
    for (const orig of occurrenceDates(rule, rule.startDate, addDays(today, 62))) {
      const occ = effective(rule, orig);
      if (!occ || occ.date > today) continue;
      const id = occurrenceId(rule.id, orig);
      if (existing.has(id)) continue;
      existing.add(id);
      out.push(buildTx(rule, occ, now));
    }
  }
  return out;
}

/** Próximas ocurrencias (aún no generadas) en (hoy, hoy+días]. */
export function upcoming(state, today, days = 45) {
  const existing = new Set(state.transactions.map((t) => t.id));
  const out = [];
  for (const rule of state.recurring) {
    if (!rule.active) continue;
    for (const orig of occurrenceDates(rule, addDays(today, -31), addDays(today, days + 31))) {
      if (existing.has(occurrenceId(rule.id, orig))) continue;
      const occ = effective(rule, orig);
      if (!occ || occ.date <= today || occ.date > addDays(today, days)) continue;
      out.push({ rule, ...occ, daysLeft: diffDays(today, occ.date) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Monto mensual equivalente de una regla (para "costo fijo mensual"). */
export function monthlyEquivalent(rule) {
  const i = Math.max(1, rule.interval || 1);
  if (rule.freq === 'weeks') return Math.round(rule.amount * (52 / 12) / i);
  if (rule.freq === 'semimonthly') return rule.amount * (rule.days?.length || 2);
  return Math.round(rule.amount / i);
}

// ---------- Edición ----------

/** Omitir SOLO esta ocurrencia. Devuelve { rule, deleteTxId? }. */
export function skipOccurrence(rule, origDate) {
  const exceptions = { ...(rule.exceptions || {}), [origDate]: { skip: true } };
  return { rule: { ...rule, exceptions }, deleteTxId: occurrenceId(rule.id, origDate) };
}

/** Editar SOLO una ocurrencia futura (aún no generada). */
export function editOccurrence(rule, origDate, { amount, date }) {
  const prev = rule.exceptions?.[origDate] || {};
  const exc = { ...prev };
  if (Number.isInteger(amount)) exc.amount = amount;
  if (date) exc.date = date;
  delete exc.skip;
  return { ...rule, exceptions: { ...(rule.exceptions || {}), [origDate]: exc } };
}

/** Restaura una ocurrencia omitida/editada. */
export function restoreOccurrence(rule, origDate) {
  const exceptions = { ...(rule.exceptions || {}) };
  delete exceptions[origDate];
  return { ...rule, exceptions };
}

const SCHEDULE_FIELDS = ['freq', 'interval', 'startDate', 'endDate', 'dayOfMonth', 'days'];

/**
 * Editar TODA la serie. Los movimientos confirmados/conciliados se conservan como historia.
 * Los pendientes no "desprendidos" se actualizan; si cambió el calendario se borran y se regeneran.
 * @returns {{ rule, updates: object[], deletes: string[] }}
 */
export function editSeries(state, rule, patch, now = Date.now()) {
  const next = { ...rule, ...patch, updatedAt: now };
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => JSON.stringify(rule[f] ?? null) !== JSON.stringify(next[f] ?? null));
  const updates = [], deletes = [];
  for (const tx of state.transactions) {
    if (tx.recurringId !== rule.id || tx.status !== 'pending' || tx.detached) continue;
    if (scheduleChanged) { deletes.push(tx.id); continue; }
    const exc = next.exceptions?.[tx.occurrenceDate];
    updates.push({
      ...tx,
      kind: next.kind,
      amount: Number.isInteger(exc?.amount) ? exc.amount : next.amount,
      accountId: next.accountId, toAccountId: next.toAccountId || null,
      categoryId: next.kind === 'expense' ? next.categoryId : null,
      incomeType: next.kind === 'income' ? next.incomeType : null,
      incomeLabel: next.kind === 'income' ? next.incomeLabel || '' : '',
      note: next.name, updatedAt: now,
    });
  }
  return { rule: next, updates, deletes };
}

/** Terminar la serie antes de una fecha (las ocurrencias desde esa fecha dejan de existir). */
export function endSeriesBefore(state, rule, date) {
  const next = { ...rule, endDate: addDays(date, -1) };
  const deletes = state.transactions
    .filter((t) => t.recurringId === rule.id && t.status === 'pending' && t.occurrenceDate >= date)
    .map((t) => t.id);
  return { rule: next, deletes };
}

/** Eliminar regla. Por defecto también borra sus ocurrencias PENDIENTES; las confirmadas se conservan. */
export function deleteRule(state, ruleId, { deletePending = true } = {}) {
  const deletes = deletePending
    ? state.transactions.filter((t) => t.recurringId === ruleId && t.status === 'pending').map((t) => t.id)
    : [];
  return { deletes };
}

export function validateRule(rule, state) {
  const e = [];
  if (!rule.name?.trim()) e.push('Ponle nombre a la regla.');
  if (!Number.isInteger(rule.amount) || rule.amount <= 0) e.push('Escribe un monto mayor a cero.');
  if (!state.accounts.some((a) => a.id === rule.accountId)) e.push('Elige una cuenta.');
  if ((rule.kind === 'transfer' || rule.kind === 'card_payment') && !state.accounts.some((a) => a.id === rule.toAccountId)) e.push('Elige la cuenta destino.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate || '')) e.push('Fecha de inicio inválida.');
  if (rule.endDate && rule.endDate < rule.startDate) e.push('La fecha fin es anterior al inicio.');
  return e;
}

