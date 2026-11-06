import { h, frag, raw, icon } from '../h.js';
import * as store from '../../data/store.js';
import { fmt, toCents, pct } from '../../core/money.js';
import { balances, accountSnapshot, accountKind, accountType, totals, accountHistory, isActual } from '../../core/ledger.js';
import { cardCycle, STATUS_LABEL } from '../../core/cards.js';
import { dateLabel, relativeDays, lastMonths, monthShort, monthLabel, cutOnOrBefore } from '../../core/dates.js';
import { ACCOUNT_COLORS, ACCOUNT_KINDS } from '../../core/categories.js';
import { lineChart, barChart, sparkline, ringChart, legend, utilLabel } from '../charts.js';
import { card, txRow, emptyState, accById } from './common.js';
import { openSheet, toast, confirmSheet, promptSheet } from '../sheet.js';
import { openTxSheet, selectEl } from '../quickadd.js';
import { uid } from '../../core/ids.js';

const S = store.state;

export function accountsView(params, fresh) {
  if (fresh && params.nueva) setTimeout(() => openAccountForm(), 50);
  if (fresh && params.pay) setTimeout(() => openTxSheet({ kind: 'card_payment' }), 50);
  const today = store.today();
  const bals = balances(S);
  const t = totals(S, bals);
  const root = h('div');
  root.append(h('div', { class: 'tiles' },
    tile('💵 Disponible', fmt(t.liquid), 'Efectivo, débito, ahorro'),
    tile('🛒 Vales', fmt(t.vouchers), 'Saldo propio, sin deuda'),
    tile('💳 Deuda TC', fmt(t.debt), `Utilización ${pct(t.utilization)}`),
    tile('📈 Patrimonio', fmt(t.net), 'Disponible + vales − deuda')));

  const active = S.accounts.filter((a) => !a.archived);
  const groups = [
    ['credit', 'Tarjetas de crédito'], ['asset', 'Efectivo, débito y ahorro'], ['voucher', 'Vales y monederos'],
  ];
  if (!active.length) root.append(emptyState('💳', 'Agrega tus cuentas: efectivo, débito, tarjetas de crédito y vales.'));
  for (const [k, title] of groups) {
    const list = active.filter((a) => accountKind(S, a) === k);
    if (!list.length) continue;
    root.append(h('div', { class: 'section-title' }, title));
    if (k === 'credit') list.forEach((a) => root.append(creditCard(a, bals.get(a.id) || 0, today)));
    else {
      const keys = lastMonths(store.ui.month, 6);
      root.append(h('div', { class: 'list' }, list.map((a) => {
        const hist = accountHistory(S, a.id, keys);
        return h('a', { class: 'acc-row', href: `#/cuentas/${a.id}`, style: { '--cc': a.color } },
          h('span', { class: 'ic' }, a.icon || accountType(S, a).icon),
          h('span', { class: 'grow' }, h('div', { class: 'bold ellipsis' }, a.name), h('div', { class: 'small muted' }, accountType(S, a).name)),
          raw(sparkline(hist, { color: a.color })),
          h('b', { class: 'num' }, fmt(bals.get(a.id) || 0)));
      })));
    }
  }
  root.append(h('div', { class: 'btn-row', style: { marginTop: '16px' } },
    h('button', { class: 'btn primary', onclick: () => openAccountForm() }, icon('plus', 'sm'), 'Agregar cuenta'),
    h('a', { class: 'btn', href: '#/tipos' }, 'Tipos de cuenta')));
  const archived = S.accounts.filter((a) => a.archived);
  if (archived.length) root.append(h('details', { class: 'more' }, h('summary', null, `Archivadas (${archived.length})`),
    h('div', { class: 'list' }, archived.map((a) => h('a', { class: 'acc-row', href: `#/cuentas/${a.id}`, style: { '--cc': a.color } }, h('span', { class: 'ic' }, a.icon || '🏦'), h('span', { class: 'grow' }, a.name), h('b', { class: 'num' }, fmt(bals.get(a.id) || 0)))))));
  return root;
}
const tile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 't-label' }, label), h('div', { class: 't-value' }, value), h('div', { class: 't-sub' }, sub));

export function creditCard(a, bal, today, { detail = false } = {}) {
  const snap = accountSnapshot(S, a, bal);
  const c = cardCycle(S, a, today);
  const due = c.status === 'overdue' ? c.dueDate : c.upcomingDue;
  const payBy = c.status === 'overdue' ? c.payBy : c.upcomingPayBy;
  const el = h(detail ? 'div' : 'a', { class: 'cc', href: detail ? undefined : `#/cuentas/${a.id}`, style: { '--cc': a.color || '#1e3a8a' }, 'data-testid': 'credit-card' },
    h('div', { class: 'cc-top' }, h('span', null, `${a.icon || '💳'} ${a.name}`), h('span', { class: `chipw` }, STATUS_LABEL[c.status])),
    h('div', { class: 'cc-amt' }, fmt(snap.debt)),
    h('div', { class: 'cc-sub' }, bal > 0 ? `Saldo a favor ${fmt(bal)} · Disponible ${fmt(snap.available)} de ${fmt(snap.limit)}` : `Deuda actual · Disponible ${fmt(snap.available)} de ${fmt(snap.limit)}`),
    h('div', { class: 'util', title: `Utilización ${pct(snap.utilization)}` }, h('i', { style: { width: `${Math.min(100, snap.utilization * 100)}%` } })),
    h('div', { class: 'cc-dates' },
      h('div', null, 'Corte', h('b', null, dateLabel(c.nextCut)), relativeDays(c.daysToNextCut)),
      h('div', null, 'Fecha límite', h('b', null, dateLabel(due)), relativeDays(c.status === 'overdue' ? c.daysToDue : c.daysToUpcomingDue)),
      h('div', null, `Pagar el (−${c.remind}d)`, h('b', null, dateLabel(payBy)), relativeDays(c.status === 'overdue' ? c.daysToPayBy : c.daysToUpcomingPayBy))),
    c.statementBalance > 0 && c.status !== 'paid' ? h('div', { class: 'cc-sub', style: { marginTop: '8px' } },
      `Para no generar intereses: ${fmt(c.toAvoidInterest)} · Mínimo${c.minEstimated ? ' (est.)' : ''}: ${fmt(c.minRemaining)}`) : null,
    h('div', { class: 'cc-actions' },
      h('button', { type: 'button', 'data-testid': 'register-payment', onclick: (e) => { e.preventDefault(); openTxSheet({ kind: 'card_payment', preset: { toAccountId: a.id, amount: c.toAvoidInterest || 0 } }); } }, 'Registrar pago'),
      h('button', { type: 'button', class: 'alt', onclick: (e) => { e.preventDefault(); openReconcile(a); } }, 'Conciliar')));
  return el;
}

export function accountDetailView(id) {
  const a = accById(id);
  if (!a) return emptyState('🤷', 'Esta cuenta ya no existe.', h('a', { class: 'btn', href: '#/cuentas' }, 'Volver a cuentas'));
  const today = store.today();
  const bals = balances(S);
  const bal = bals.get(a.id) || 0;
  const kind = accountKind(S, a);
  const root = h('div');
  const keys = lastMonths(store.ui.month, 12);
  const hist = accountHistory(S, a.id, keys);

  if (kind === 'credit') {
    root.append(creditCard(a, bal, today, { detail: true }));
    const c = cardCycle(S, a, today);
    const snap = accountSnapshot(S, a, bal);
    root.append(card(h('h2', null, '🧾 Estado de cuenta actual', h('span', { class: 'spacer' }), h('small', null, `corte ${dateLabel(c.lastCut)}`)),
      h('div', { class: 'grid2' },
        kv('Saldo al corte', fmt(c.statementBalance)), kv('Pagado desde el corte', fmt(c.paidSinceCut)),
        kv('Para no generar intereses', fmt(c.toAvoidInterest), c.toAvoidInterest ? 'neg' : 'pos'),
        kv(`Pago mínimo${c.minEstimated ? ' (estimado)' : ''}`, fmt(c.minPayment)),
        kv('Fecha límite', `${dateLabel(c.dueDate)} · ${relativeDays(c.daysToDue)}`), kv('Pago sugerido', `${dateLabel(c.payBy)} · ${relativeDays(c.daysToPayBy)}`),
        kv('Próximo corte', `${dateLabel(c.nextCut)} · ${relativeDays(c.daysToNextCut)}`), kv('Tasa anual', a.credit?.apr ? pct(a.credit.apr, 1) : '—')),
      h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => captureMin(a, c) }, '✍️ Capturar pago mínimo del estado de cuenta'),
      h('p', { class: 'small muted' }, 'Las cifras se calculan con lo que registras. Usa “Conciliar” para igualar con el saldo de la app de tu banco (intereses, comisiones, compras olvidadas).')));
    root.append(card(h('h2', null, '📉 Evolución de deuda y utilización'),
      h('div', { class: 'ring-wrap', style: { marginBottom: '8px' } }, raw(ringChart(snap.utilization, { size: 72 })), h('div', null, h('b', null, `Utilización ${utilLabel(snap.utilization).toLowerCase()}`), h('div', { class: 'small muted' }, 'Recomendado: < 30% del límite.'))),
      raw(lineChart({ labels: keys.map(monthShort), xEvery: 2, tipTitles: keys.map((k) => monthLabel(k, true)), series: [{ name: 'Deuda', color: 'var(--c-debt)', values: hist.map((b) => Math.max(0, -b)), area: true }] })),
      raw(lineChart({ labels: keys.map(monthShort), xEvery: 2, height: 130, fmtY: (v) => `${Math.round(v)}%`, fmtV: (v) => `${v.toFixed(1)}%`, tipTitles: keys.map((k) => monthLabel(k, true)),
        series: [{ name: 'Utilización', color: 'var(--primary)', values: hist.map((b) => (a.credit?.limit ? (Math.max(0, -b) / a.credit.limit) * 100 : 0)) }] })),
      raw(legend([{ label: 'Deuda al cierre de mes', color: 'var(--c-debt)' }, { label: 'Utilización %', color: 'var(--primary)' }]))));
    const pays = S.transactions.filter((t) => (t.kind === 'card_payment' || t.kind === 'transfer') && t.toAccountId === a.id).sort((x, y) => y.date.localeCompare(x.date));
    root.append(card(h('h2', null, '✅ Pagos registrados', h('span', { class: 'spacer' }), h('small', null, `${pays.length}`)),
      pays.length ? h('div', { class: 'list', style: { boxShadow: 'none' } }, pays.slice(0, 12).map((t) => txRow(t, { showDate: true })))
        : h('div', { class: 'small muted' }, 'Aún no registras pagos. Cuando pagues en la app de tu banco, toca “Registrar pago”.')));
  } else {
    root.append(h('div', { class: 'cc', style: { '--cc': a.color || '#334155' } },
      h('div', { class: 'cc-top' }, h('span', null, `${a.icon || accountType(S, a).icon} ${a.name}`), h('span', { class: 'chipw' }, accountType(S, a).name)),
      h('div', { class: 'cc-amt' }, fmt(bal)), h('div', { class: 'cc-sub' }, kind === 'voucher' ? 'Saldo de vales (propio, sin deuda)' : 'Saldo actual'),
      h('div', { class: 'cc-actions' },
        h('button', { type: 'button', onclick: () => openTxSheet({ kind: 'expense', preset: { accountId: a.id } }) }, 'Gasto'),
        h('button', { type: 'button', class: 'alt', onclick: () => openTxSheet({ kind: 'income', preset: { accountId: a.id, incomeType: kind === 'voucher' ? 'other' : 'salary', incomeLabel: kind === 'voucher' ? accountType(S, a).name : '' } }) }, 'Depósito'),
        h('button', { type: 'button', class: 'alt', onclick: () => openReconcile(a) }, 'Conciliar'))));
    if (kind === 'voucher') {
      const k6 = lastMonths(store.ui.month, 6);
      const inc = k6.map((k) => S.transactions.filter((t) => isActual(t) && t.date.startsWith(k) && t.accountId === a.id && t.kind === 'income').reduce((x, t) => x + t.amount, 0));
      const out = k6.map((k) => S.transactions.filter((t) => isActual(t) && t.date.startsWith(k) && t.accountId === a.id && t.kind === 'expense').reduce((x, t) => x + t.amount, 0));
      root.append(card('🛒 Depósitos vs consumo de vales',
        raw(barChart({ labels: k6.map(monthShort), series: [{ name: 'Depósitos', color: 'var(--c-income)', values: inc }, { name: 'Consumo', color: 'var(--c-expense)', values: out }], tipTitles: k6.map((k) => monthLabel(k, true)) })),
        raw(legend([{ label: 'Depósitos', color: 'var(--c-income)' }, { label: 'Consumo', color: 'var(--c-expense)' }]))));
    }
    root.append(card('📈 Saldo al cierre de cada mes', raw(lineChart({ labels: keys.map(monthShort), xEvery: 2, tipTitles: keys.map((k) => monthLabel(k, true)), series: [{ name: 'Saldo', color: a.color || 'var(--primary)', values: hist, area: true }] }))));
  }

  const recs = S.reconciliations.filter((r) => r.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date));
  if (recs.length) root.append(card('⚖️ Conciliaciones', recs.slice(0, 8).map((r) => h('div', { class: 'row', style: { padding: '6px 0', borderBottom: '1px solid var(--border)' } },
    h('span', { class: 'grow' }, h('div', { class: 'bold' }, dateLabel(r.date, { year: true })), h('div', { class: 'small muted' }, `Banco ${fmt(r.bankBalance)} · App ${fmt(r.appBalance)}`)),
    h('span', { class: `badge ${r.diff ? 'warn' : 'reconciled'}` }, r.diff ? `Dif. ${fmt(r.diff, { sign: true })}` : 'Cuadró')))));

  const recent = S.transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 10);
  root.append(card(h('h2', null, '🧾 Movimientos recientes', h('span', { class: 'spacer' }), h('a', { class: 'small', href: `#/movimientos?cuenta=${a.id}` }, 'Ver todos')),
    recent.length ? h('div', { class: 'list', style: { boxShadow: 'none' } }, recent.map((t) => txRow(t, { showDate: true }))) : h('div', { class: 'small muted' }, 'Sin movimientos.')));

  root.append(h('div', { class: 'btn-row', style: { marginTop: '12px' } },
    h('button', { class: 'btn', onclick: () => openAccountForm(a) }, icon('edit', 'sm'), 'Editar'),
    a.archived ? h('button', { class: 'btn', onclick: () => store.saveAccount({ ...a, archived: false }) }, 'Restaurar')
      : h('button', { class: 'btn danger', onclick: async () => {
        const used = S.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id);
        if (!(await confirmSheet({ title: used ? 'Archivar cuenta' : 'Eliminar cuenta', message: used ? 'Tiene movimientos: se archivará (se conserva el historial y deja de aparecer en el registro rápido).' : 'La cuenta no tiene movimientos y se eliminará.', confirm: used ? 'Archivar cuenta' : 'Eliminar cuenta' }))) return;
        await store.deleteAccount(a.id); location.hash = '#/cuentas';
      } }, icon('trash', 'sm'), 'Archivar / eliminar')));
  return root;
}
const kv = (k, v, cls = '') => h('div', { style: { padding: '6px 0' } }, h('div', { class: 'small muted' }, k), h('div', { class: `bold num ${cls}` }, v));

async function captureMin(a, c) {
  const v = await promptSheet({ title: 'Pago mínimo del estado de cuenta', label: `Pago mínimo del corte ${dateLabel(c.lastCut)}`, type: 'text', value: c.minEstimated ? '' : (c.minPayment / 100).toFixed(2), hint: 'Lo ves en tu estado de cuenta o en la app del banco. Aplica solo a este corte.' });
  if (v === null) return;
  const cents = toCents(v);
  if (!Number.isFinite(cents) || cents < 0) { toast('Monto inválido'); return; }
  await store.saveAccount({ ...a, credit: { ...a.credit, minPaymentOverride: cents, minPaymentCut: c.lastCut } });
  toast('Pago mínimo guardado');
}

// ---------- Formulario de cuenta ----------
export function openAccountForm(existing) {
  const a = existing ? structuredClone(existing) : { name: '', typeId: 't_debit', color: ACCOUNT_COLORS[S.accounts.length % ACCOUNT_COLORS.length], openingBalance: 0, openingDate: store.today(), archived: false };
  const isCredit = () => (S.accountTypes.find((t) => t.id === a.typeId)?.kind === 'credit');
  let errors = [];
  openSheet(existing ? 'Editar cuenta' : 'Nueva cuenta', ({ body, close }) => {
    const root = h('div');
    const cr = a.credit || { limit: 0, cutDay: 1, dueDay: 20, apr: 0, minPct: 0.015, reminderDaysBefore: S.settings.defaultReminderDays ?? 6 };
    let dateTouched = !!existing;
    let openStr = isCredit() ? ((Math.max(0, -(a.openingBalance || 0))) / 100).toString() : ((a.openingBalance || 0) / 100).toString();
    const draw = () => {
      root.replaceChildren(frag(
        field('Nombre', h('input', { class: 'input', value: a.name, placeholder: 'Ej. Nómina, Tarjeta Oro, Vales', oninput: (e) => { a.name = e.target.value; }, 'data-testid': 'acc-name' })),
        field('Tipo', selectEl([...S.accountTypes.map((t) => [t.id, `${t.icon} ${t.name} · ${ACCOUNT_KINDS[t.kind]}`]), ['__new', '➕ Nuevo tipo…']], a.typeId, async (v) => {
          if (v === '__new') { const t = await newAccountType(); if (t) a.typeId = t.id; draw(); return; }
          a.typeId = v; const t = S.accountTypes.find((x) => x.id === v); if (t && !existing) a.icon = t.icon; draw();
        }, { 'data-testid': 'acc-type' })),
        h('div', { class: 'qa-label' }, 'Color'),
        h('div', { class: 'chips' }, ACCOUNT_COLORS.map((c) => h('button', { type: 'button', class: 'chip', 'aria-label': `Color ${c}`, 'aria-pressed': String(a.color === c), style: { width: '40px', padding: 0, justifyContent: 'center', background: c, borderColor: a.color === c ? 'var(--text)' : 'transparent', borderWidth: '3px' }, onclick: () => { a.color = c; draw(); } }))),
        h('div', { class: 'grid2', style: { marginTop: '10px' } },
          field(isCredit() ? 'Deuda actual' : 'Saldo actual', h('input', { class: 'input', inputmode: 'decimal', value: openStr === '0' ? '' : openStr, placeholder: '0.00', oninput: (e) => { openStr = e.target.value; }, 'data-testid': 'acc-opening' })),
          field(isCredit() ? 'Fecha del saldo' : 'Al día', h('input', { class: 'input', type: 'date', value: a.openingDate || store.today(), onchange: (e) => { a.openingDate = e.target.value; dateTouched = true; } }), isCredit() && !existing ? 'Si no la cambias, la deuda se toma como saldo de tu último corte.' : null)),
        isCredit() ? h('div', null,
          h('div', { class: 'grid2' },
            field('Límite de crédito', h('input', { class: 'input', inputmode: 'decimal', value: cr.limit ? cr.limit / 100 : '', placeholder: '50,000', oninput: (e) => { cr.limit = toCents(e.target.value); }, 'data-testid': 'acc-limit' })),
            field('Tasa anual (%)', h('input', { class: 'input', inputmode: 'decimal', value: cr.apr ? +(cr.apr * 100).toFixed(2) : '', placeholder: 'Ej. 62', oninput: (e) => { cr.apr = (parseFloat(e.target.value.replace(',', '.')) || 0) / 100; } })),
            field('Día de corte', h('input', { class: 'input', type: 'number', min: 1, max: 31, value: cr.cutDay, oninput: (e) => { cr.cutDay = parseInt(e.target.value, 10); }, 'data-testid': 'acc-cut' })),
            field('Día límite de pago', h('input', { class: 'input', type: 'number', min: 1, max: 31, value: cr.dueDay, oninput: (e) => { cr.dueDay = parseInt(e.target.value, 10); }, 'data-testid': 'acc-due' })),
            field('Avisarme (días antes)', h('input', { class: 'input', type: 'number', min: 0, max: 25, value: cr.reminderDaysBefore ?? 6, oninput: (e) => { cr.reminderDaysBefore = parseInt(e.target.value, 10); } }), 'Tú pagas 6 días antes del límite.'),
            field('Pago mínimo (% saldo)', h('input', { class: 'input', inputmode: 'decimal', value: +((cr.minPct ?? 0.015) * 100).toFixed(2), oninput: (e) => { cr.minPct = (parseFloat(e.target.value.replace(',', '.')) || 1.5) / 100; } }), 'Para estimar el mínimo si no lo capturas.')),
          h('div', { class: 'qa-note' }, 'Si el día no existe en un mes (p. ej. 31), se usa el último día de ese mes.')) : null,
        errors.length ? h('div', { class: 'form-error', role: 'alert' }, errors.join(' ')) : null,
        h('button', { class: 'btn primary block', 'data-testid': 'acc-save', onclick: async () => {
          errors = [];
          if (!a.name.trim()) errors.push('Escribe un nombre.');
          const open = toCents(openStr || '0');
          if (!Number.isFinite(open)) errors.push('Saldo inválido.');
          if (isCredit()) {
            if (!(cr.limit > 0)) errors.push('Escribe el límite de crédito.');
            if (!(cr.cutDay >= 1 && cr.cutDay <= 31) || !(cr.dueDay >= 1 && cr.dueDay <= 31)) errors.push('Los días de corte y límite van de 1 a 31.');
            if (cr.cutDay === cr.dueDay) errors.push('El día de corte y el límite no pueden ser iguales.');
          }
          if (errors.length) { draw(); return; }
          const rec = { ...a, name: a.name.trim(), icon: a.icon || S.accountTypes.find((t) => t.id === a.typeId)?.icon, openingBalance: isCredit() ? -Math.abs(open) : open };
          if (isCredit() && !dateTouched) rec.openingDate = cutOnOrBefore(store.today(), cr.cutDay);
          if (isCredit()) rec.credit = { ...cr, reminderDaysBefore: Number.isInteger(cr.reminderDaysBefore) ? cr.reminderDaysBefore : 6 }; else delete rec.credit;
          const saved = await store.saveAccount(rec);
          close();
          toast(existing ? 'Cuenta actualizada' : `Cuenta “${saved.name}” creada`);
          if (!existing && location.hash.startsWith('#/inicio')) location.hash = '#/cuentas';
        } }, existing ? 'Guardar cambios' : 'Crear cuenta')));
      body.scrollTop = 0;
    };
    a.credit = a.credit || undefined;
    draw();
    return root;
  });
}
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null);

export async function newAccountType() {
  return new Promise((resolve) => {
    const t = { name: '', kind: 'voucher', icon: '🎫' };
    openSheet('Nuevo tipo de cuenta', ({ close }) => h('div', null,
      field('Nombre', h('input', { class: 'input', placeholder: 'Ej. Monedero electrónico, Vales de restaurante', oninput: (e) => { t.name = e.target.value; } })),
      field('Se comporta como', selectEl(Object.entries(ACCOUNT_KINDS), t.kind, (v) => { t.kind = v; })),
      field('Ícono (emoji)', h('input', { class: 'input', value: t.icon, maxlength: 4, oninput: (e) => { t.icon = e.target.value || '🎫'; } })),
      h('button', { class: 'btn primary block', onclick: async () => { if (!t.name.trim()) return; const rec = await store.saveAccountType({ ...t, id: uid('t_'), name: t.name.trim() }); close(rec); } }, 'Crear tipo')),
    { onClose: (r) => resolve(r || null) });
  });
}

// ---------- Conciliación ----------
export function openReconcile(a) {
  const kind = accountKind(S, a);
  const bal = balances(S).get(a.id) || 0;
  const appShown = kind === 'credit' ? Math.max(0, -bal) : bal;
  openSheet(`Conciliar ${a.name}`, ({ close }) => {
    const root = h('div');
    let bankStr = '';
    const out = h('div');
    const input = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', 'data-testid': 'rec-bank', oninput: (e) => { bankStr = e.target.value; draw(); } });
    const draw = () => {
      out.replaceChildren();
      if (!bankStr) return;
      const bank = toCents(bankStr);
      if (!Number.isFinite(bank)) { out.append(h('div', { class: 'form-error' }, 'Monto inválido.')); return; }
      // diff en términos de saldo con signo
      const bankSigned = kind === 'credit' ? -Math.abs(bank) : bank;
      const diff = bankSigned - bal; // > 0: la app debe subir saldo; < 0: bajar
      const today = store.today();
      const finish = async (resolution, tx) => {
        if (tx) await store.saveTx(tx);
        const toMark = S.transactions.filter((t) => (t.accountId === a.id || t.toAccountId === a.id) && t.status === 'confirmed' && t.date <= today);
        await store.saveTxs(toMark.map((t) => ({ ...t, status: 'reconciled' })));
        await store.saveReconciliation({ id: uid('rc_'), accountId: a.id, date: today, bankBalance: bank, appBalance: appShown, diff: kind === 'credit' ? -diff : diff, resolution });
        close(); toast('Conciliación guardada ✓');
      };
      if (diff === 0) {
        out.append(h('div', { class: 'qa-note' }, '✅ ¡Cuadra perfecto con tu banco!'), h('button', { class: 'btn primary block', onclick: () => finish('match') }, 'Marcar como conciliado'));
        return;
      }
      const human = kind === 'credit' ? (diff < 0 ? `Tu banco muestra ${fmt(-diff)} más de deuda` : `Tu banco muestra ${fmt(diff)} menos de deuda`) : (diff > 0 ? `Tu banco tiene ${fmt(diff)} más` : `Tu banco tiene ${fmt(-diff)} menos`);
      out.append(h('div', { class: 'qa-note' }, `⚖️ ${human}. ¿Cómo registras la diferencia?`));
      const opts = h('div', { class: 'stack' });
      if (diff < 0) opts.append(h('button', { class: 'btn block', 'data-testid': 'rec-interest', onclick: () => finish('interest', { kind: 'expense', amount: -diff, date: today, accountId: a.id, categoryId: 'c_comisiones', note: 'Diferencia de conciliación (intereses/comisiones)', tags: ['conciliación'], status: 'reconciled' }) }, '🏦 Intereses / comisiones (cuenta como gasto)'));
      opts.append(h('button', { class: 'btn block', 'data-testid': 'rec-adjust', onclick: () => finish('adjustment', { kind: 'adjustment', amount: diff, date: today, accountId: a.id, note: 'Ajuste de conciliación', tags: ['conciliación'], status: 'reconciled' }) }, '⚖️ Ajuste de saldo (no es gasto ni ingreso)'));
      opts.append(h('button', { class: 'btn ghost block', onclick: () => { close(); openTxSheet({ kind: diff < 0 ? 'expense' : 'income', preset: { accountId: a.id, amount: Math.abs(diff) } }); } }, '➕ Me faltó registrar un movimiento'));
      out.append(opts);
    };
    root.append(h('p', { class: 'text-2 small' }, 'Abre la app de tu banco y escribe el saldo que muestra. Lana compara y te ayuda a cuadrar.'),
      h('div', { class: 'tile', style: { margin: '8px 0 12px' } }, h('div', { class: 't-label' }, kind === 'credit' ? 'Deuda según Lana' : 'Saldo según Lana'), h('div', { class: 't-value' }, fmt(appShown))),
      field(kind === 'credit' ? 'Deuda que muestra tu banco' : 'Saldo que muestra tu banco', input), out);
    setTimeout(() => input.focus(), 60);
    return root;
  });
}
