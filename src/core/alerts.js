// Alertas in-app y calendario de notificaciones (para SW, push opcional y .ics).
import { cardCycle, futureCycles } from './cards.js';
import { upcoming } from './recurring.js';
import { monthSummary, accountKind } from './ledger.js';
import { addDays, monthKey, dateLabel, relativeDays, parse } from './dates.js';
import { fmt } from './money.js';
import { LAYERS } from './categories.js';

export const DEFAULT_SETTINGS = {
  defaultReminderDays: 6,
  notifyHour: 9,
  showAmountsInNotifications: true,
  notify: { cards: true, recurring: true, budget: true, registerPayment: true },
  budgets: { layer: {}, category: {} },
};

const SEV = { danger: 0, warn: 1, info: 2 };

export function computeAlerts(state, today) {
  const st = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const n = { ...DEFAULT_SETTINGS.notify, ...(st.notify || {}) };
  const out = [];

  if (n.cards) for (const acc of state.accounts) {
    if (acc.archived || accountKind(state, acc) !== 'credit') continue;
    const c = cardCycle(state, acc, today, st);
    const base = { accountId: acc.id, route: `#/cuentas/${acc.id}` };
    if (c.status === 'overdue') {
      out.push({ ...base, id: `card-overdue-${acc.id}-${c.dueDate}`, type: 'card', severity: 'danger', date: c.dueDate,
        title: `${acc.name}: la fecha límite fue ${relativeDays(c.daysToDue)}`,
        body: `Faltan ${fmt(c.toAvoidInterest)} para no generar intereses. Si ya pagaste en la app del banco, regístralo aquí.`,
        action: 'register-payment' });
    } else if (c.status === 'pay_now') {
      out.push({ ...base, id: `card-paynow-${acc.id}-${c.dueDate}`, type: 'card', severity: c.daysToDue <= 2 ? 'danger' : 'warn', date: c.payBy,
        title: `Paga ${acc.name}: vence ${relativeDays(c.daysToDue)} (${dateLabel(c.dueDate)})`,
        body: `Para no generar intereses: ${fmt(c.toAvoidInterest)} · mínimo ${fmt(c.minRemaining)}${c.minEstimated ? ' (estimado)' : ''}. Págalo en la app de tu banco y luego regístralo.`,
        action: 'register-payment' });
    } else if (c.status === 'upcoming' && c.daysToPayBy <= 3) {
      out.push({ ...base, id: `card-soon-${acc.id}-${c.dueDate}`, type: 'card', severity: 'info', date: c.payBy,
        title: `${acc.name}: paga ${relativeDays(c.daysToPayBy)} (sugerido)`,
        body: `Límite ${dateLabel(c.dueDate)} · ${fmt(c.toAvoidInterest)} para no generar intereses.` });
    }
    if (c.daysToNextCut <= 1) {
      out.push({ ...base, id: `card-cut-${acc.id}-${c.nextCut}`, type: 'cut', severity: 'info', date: c.nextCut,
        title: `${acc.name} corta ${relativeDays(c.daysToNextCut)}`,
        body: 'Las compras después del corte pasan al siguiente estado de cuenta.' });
    }
  }

  if (n.recurring) {
    for (const o of upcoming(state, today, 31)) {
      const notice = o.rule.noticeDays ?? 2;
      if (o.daysLeft > notice) continue;
      out.push({ id: `rec-${o.rule.id}-${o.origDate}`, type: 'recurring', severity: 'info', date: o.date, route: '#/fijos',
        title: `${o.rule.name}: ${fmt(o.amount)} ${relativeDays(o.daysLeft)}`,
        body: `${o.rule.kind === 'income' ? 'Ingreso' : 'Gasto'} fijo programado para el ${dateLabel(o.date)}.` });
    }
    const pend = state.transactions.filter((t) => t.status === 'pending' && t.recurringId && t.date <= today);
    if (pend.length) {
      out.push({ id: `rec-pending-${today}-${pend.length}`, type: 'pending', severity: 'warn', date: today, route: '#/movimientos?status=pending',
        title: `${pend.length} movimiento${pend.length > 1 ? 's' : ''} fijo${pend.length > 1 ? 's' : ''} por confirmar`,
        body: 'Confírmalos para que cuenten en tus saldos y gráficas.', action: 'confirm-pending' });
    }
  }

  if (n.budget) {
    const key = monthKey(today);
    const s = monthSummary(state, key);
    const b = st.budgets || {};
    for (const l of LAYERS) {
      const lim = b.layer?.[l.id];
      if (!lim) continue;
      pushBudget(out, `layer-${l.id}`, l.name, s.byLayer[l.id] || 0, lim, key, today);
    }
    for (const [cid, lim] of Object.entries(b.category || {})) {
      if (!lim) continue;
      const cat = state.categories.find((c) => c.id === cid);
      if (cat) pushBudget(out, `cat-${cid}`, cat.name, s.byCategory[cid] || 0, lim, key, today);
    }
  }

  return out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.date.localeCompare(b.date));
}

function pushBudget(out, id, name, spent, limit, key, today) {
  const r = spent / limit;
  if (r < 0.8) return;
  const over = r >= 1;
  out.push({ id: `budget-${id}-${key}-${over ? 'over' : 'near'}`, type: 'budget', severity: over ? 'danger' : 'warn', date: today, route: '#/presupuestos',
    title: over ? `Presupuesto de ${name} rebasado` : `${name}: ${Math.round(r * 100)}% del presupuesto`,
    body: `${fmt(spent)} de ${fmt(limit)} este mes${over ? ` (+${fmt(spent - limit)})` : ''}.` });
}

/** Epoch ms en hora local del dispositivo. */
export function atLocal(iso, hour = 9, minute = 0) {
  const { y, m, d } = parse(iso);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

/**
 * Calendario de notificaciones para los próximos `days` días.
 * Lo consume el Service Worker (periodicsync / al abrir), el servidor push opcional y el export .ics.
 */
export function buildSchedule(state, today, { days = 60 } = {}) {
  const st = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const n = { ...DEFAULT_SETTINGS.notify, ...(st.notify || {}) };
  const hour = st.notifyHour ?? 9;
  const show = st.showAmountsInNotifications !== false;
  const horizon = addDays(today, days);
  const out = [];
  const add = (e) => { if (e.date >= today && e.date <= horizon) out.push({ ...e, at: atLocal(e.date, hour) }); };

  if (n.cards) for (const acc of state.accounts) {
    if (acc.archived || accountKind(state, acc) !== 'credit') continue;
    const cur = cardCycle(state, acc, today, st);
    for (const cy of futureCycles(acc, today, 3, st)) {
      const isCurrent = cy.due === cur.dueDate;
      if (isCurrent && (cur.status === 'paid' || cur.status === 'no_balance')) continue;
      const amt = isCurrent && show ? ` · ${fmt(cur.toAvoidInterest)}` : '';
      add({ id: `n-pay-${acc.id}-${cy.due}`, date: cy.payBy, tag: `card-${acc.id}`, url: `#/cuentas/${acc.id}`, kind: 'card',
        title: `💳 Hoy toca pagar ${acc.name}`,
        body: `Fecha límite ${dateLabel(cy.due)}${amt}. Paga en la app de tu banco y regístralo en Lana.` });
      add({ id: `n-due1-${acc.id}-${cy.due}`, date: addDays(cy.due, -1), tag: `card-${acc.id}`, url: `#/cuentas/${acc.id}`, kind: 'card',
        title: `⚠️ Mañana vence ${acc.name}`,
        body: `Si ya pagaste, registra el pago para conciliar tu saldo${amt}.` });
      if (n.registerPayment) add({ id: `n-due-${acc.id}-${cy.due}`, date: cy.due, tag: `card-${acc.id}`, url: `#/cuentas/${acc.id}`, kind: 'card',
        title: `📌 Hoy vence ${acc.name}`,
        body: '¿Ya pagaste en la app del banco? Registra el pago aquí para mantener tus saldos al día.' });
    }
  }
  if (n.recurring) for (const o of upcoming(state, today, days)) {
    const notice = o.rule.noticeDays ?? 2;
    add({ id: `n-rec-${o.rule.id}-${o.origDate}`, date: addDays(o.date, -notice), tag: `rec-${o.rule.id}`, url: '#/fijos', kind: 'recurring',
      title: `🔁 ${o.rule.name} ${relativeDays(notice)}`,
      body: `${show ? fmt(o.amount) + ' · ' : ''}${dateLabel(o.date, { weekday: true })}` });
  }
  return out.sort((a, b) => a.at - b.at);
}
