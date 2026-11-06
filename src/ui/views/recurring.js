import { h, frag, icon } from '../h.js';
import * as store from '../../data/store.js';
import { fmt, toCents } from '../../core/money.js';
import { FREQS, freqLabel, freqId, upcoming, monthlyEquivalent, editSeries, deleteRule, skipOccurrence, editOccurrence, restoreOccurrence, endSeriesBefore, validateRule, occurrenceDates } from '../../core/recurring.js';
import { LAYERS, INCOME_TYPES, TX_KINDS } from '../../core/categories.js';
import { accountKind } from '../../core/ledger.js';
import { dateLabel, relativeDays, monthShort, addDays } from '../../core/dates.js';
import { card, emptyState, accById, catById } from './common.js';
import { openSheet, toast, confirmSheet } from '../sheet.js';
import { selectEl } from '../quickadd.js';
import { uid } from '../../core/ids.js';

const S = store.state;

export function recurringView(params, fresh) {
  if (fresh && params.regla) { const r = S.recurring.find((x) => x.id === params.regla); if (r) setTimeout(() => openRuleForm(r), 50); }
  const today = store.today();
  const root = h('div');
  const rules = [...S.recurring].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const exp = rules.filter((r) => r.active && r.kind === 'expense').reduce((a, r) => a + monthlyEquivalent(r), 0);
  const inc = rules.filter((r) => r.active && r.kind === 'income').reduce((a, r) => a + monthlyEquivalent(r), 0);
  root.append(h('div', { class: 'tiles' },
    h('div', { class: 'tile' }, h('div', { class: 't-label' }, '🔁 Gasto fijo / mes'), h('div', { class: 't-value' }, fmt(exp)), h('div', { class: 't-sub' }, 'Equivalente mensual')),
    h('div', { class: 'tile' }, h('div', { class: 't-label' }, '💼 Ingreso fijo / mes'), h('div', { class: 't-value pos' }, fmt(inc)), h('div', { class: 't-sub' }, inc ? `${Math.round((exp / inc) * 100)}% se va en fijos` : '—'))));

  const up = upcoming(S, today, 45);
  root.append(card(h('h2', null, '📅 Próximas ocurrencias', h('span', { class: 'spacer' }), h('small', null, '45 días')),
    up.length ? up.map((o) => h('div', { class: 'tl' },
      h('div', { class: 'date' }, h('b', null, o.date.slice(8, 10)), h('span', null, monthShort(o.date.slice(0, 7)))),
      h('div', { class: 'grow' }, h('div', { class: 'bold ellipsis' }, o.rule.name, o.edited ? ' ✏️' : ''), h('div', { class: 'small muted' }, `${relativeDays(o.daysLeft)} · ${accById(o.rule.accountId)?.name || ''}`)),
      h('div', { class: 'right' }, h('div', { class: `bold num ${o.rule.kind === 'income' ? 'pos' : ''}` }, fmt(o.amount)),
        h('button', { class: 'btn sm ghost', style: { minHeight: '30px', padding: '0 4px' }, onclick: () => openOccurrence(o.rule, o.origDate) }, 'Editar / omitir'))))
      : emptyState('🗓️', 'Sin ocurrencias próximas.')));

  root.append(h('div', { class: 'section-title' }, 'Reglas'));
  if (!rules.length) root.append(emptyState('🔁', 'Automatiza renta, servicios, suscripciones, seguros y tu salario.', h('button', { class: 'btn primary', onclick: () => openRuleForm() }, 'Crear regla')));
  else root.append(h('div', { class: 'list' }, rules.map((r) => {
    const next = upcoming(S, today, 400).find((o) => o.rule.id === r.id);
    const c = catById(r.categoryId);
    return h('button', { class: 'item', onclick: () => openRuleForm(r), style: { opacity: r.active ? 1 : 0.55 }, 'data-rule': r.id },
      h('span', { class: 'ic' }, r.kind === 'income' ? '💼' : r.kind === 'transfer' ? '⇄' : r.kind === 'card_payment' ? '💳' : c?.icon || '🔁'),
      h('span', { class: 'grow' }, h('div', { class: 't ellipsis' }, r.name), h('div', { class: 's ellipsis' }, `${freqLabel(r)} · ${next ? 'próx. ' + dateLabel(next.date) : r.active ? 'sin próximas' : 'pausada'}`)),
      h('span', { class: 'right' }, h('div', { class: `amt ${r.kind === 'income' ? 'in' : ''}` }, fmt(r.amount)), h('span', { class: `badge ${r.autoConfirm ? '' : 'pending'}` }, r.autoConfirm ? 'automático' : 'por confirmar')));
  })));
  root.append(h('button', { class: 'btn primary block', style: { marginTop: '14px' }, onclick: () => openRuleForm(), 'data-testid': 'new-rule' }, icon('plus', 'sm'), 'Nueva regla recurrente'));
  root.append(h('p', { class: 'small muted' }, 'Las ocurrencias se generan solas al llegar su fecha, sin duplicados. Las marcadas “por confirmar” quedan pendientes hasta que confirmes que se cobraron.'));
  return root;
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null);

export function openRuleForm(existing) {
  const r = existing ? structuredClone(existing) : {
    name: '', kind: 'expense', amount: 0, accountId: S.accounts.find((a) => !a.archived)?.id, categoryId: 'c_renta', incomeType: 'salary', incomeLabel: '',
    freq: 'months', interval: 1, startDate: store.today(), endDate: '', noticeDays: 3, autoConfirm: false, active: true, exceptions: {}, tags: ['fijo'],
  };
  let amountStr = r.amount ? (r.amount / 100).toString() : '';
  let errors = [];
  openSheet(existing ? 'Editar serie' : 'Nueva regla recurrente', ({ close }) => {
    const root = h('div');
    const draw = () => {
      const accs = S.accounts.filter((a) => !a.archived || a.id === r.accountId || a.id === r.toAccountId);
      root.replaceChildren(frag(
        h('div', { class: 'seg' }, ['expense', 'income', 'transfer', 'card_payment'].map((k) => h('button', { type: 'button', 'aria-pressed': String(r.kind === k), onclick: () => { r.kind = k; if (k === 'income') r.noticeDays = 0; draw(); } }, { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferir', card_payment: 'Pago TC' }[k]))),
        h('div', { style: { height: '10px' } }),
        field('Nombre', h('input', { class: 'input', value: r.name, placeholder: r.kind === 'income' ? 'Ej. Salario' : 'Ej. Renta, Luz, Streaming, Seguro auto', oninput: (e) => { r.name = e.target.value; }, 'data-testid': 'rule-name' })),
        h('div', { class: 'grid2' },
          field('Monto', h('input', { class: 'input', inputmode: 'decimal', value: amountStr, placeholder: '0.00', oninput: (e) => { amountStr = e.target.value; }, 'data-testid': 'rule-amount' })),
          field('Frecuencia', selectEl(FREQS.map((f) => [f.id, f.label]), freqId(r), (v) => { const f = FREQS.find((x) => x.id === v); r.freq = f.freq; r.interval = f.interval; }))),
        field(r.kind === 'income' ? 'Entra a' : r.kind === 'expense' ? 'Se paga con' : 'Desde', selectEl(accs.filter((a) => r.kind !== 'card_payment' || accountKind(S, a) !== 'credit').map((a) => [a.id, a.name]), r.accountId, (v) => { r.accountId = v; })),
        r.kind === 'transfer' || r.kind === 'card_payment' ? field(r.kind === 'card_payment' ? 'Tarjeta' : 'Hacia', selectEl([['', 'Elige…'], ...accs.filter((a) => a.id !== r.accountId && (r.kind !== 'card_payment' || accountKind(S, a) === 'credit')).map((a) => [a.id, a.name])], r.toAccountId || '', (v) => { r.toAccountId = v; })) : null,
        r.kind === 'expense' ? field('Categoría', groupedCategorySelect(r.categoryId, (v) => { r.categoryId = v; })) : null,
        r.kind === 'income' ? h('div', { class: 'grid2' },
          field('Tipo de ingreso', selectEl(INCOME_TYPES.map((t) => [t.id, `${t.icon} ${t.name}`]), r.incomeType, (v) => { r.incomeType = v; })),
          field('Concepto', h('input', { class: 'input', value: r.incomeLabel || '', placeholder: 'Ej. Salario quincenal', oninput: (e) => { r.incomeLabel = e.target.value; } }))) : null,
        h('div', { class: 'grid2' },
          field('Primera fecha', h('input', { class: 'input', type: 'date', value: r.startDate, onchange: (e) => { r.startDate = e.target.value; } }), r.freq === 'semimonthly' ? 'Se cobra el 15 y el último día.' : 'Define el día de cada mes.'),
          field('Fecha fin (opcional)', h('input', { class: 'input', type: 'date', value: r.endDate || '', onchange: (e) => { r.endDate = e.target.value || ''; } }))),
        field('Avisarme (días antes)', h('input', { class: 'input', type: 'number', min: 0, max: 30, value: r.noticeDays ?? 3, oninput: (e) => { r.noticeDays = parseInt(e.target.value, 10) || 0; } })),
        h('label', { class: 'switch' }, h('span', null, h('b', null, 'Confirmar automáticamente'), h('div', { class: 'small muted' }, 'Si está apagado, se crea como pendiente y lo confirmas con un toque.')),
          h('input', { type: 'checkbox', checked: !!r.autoConfirm, onchange: (e) => { r.autoConfirm = e.target.checked; } })),
        h('label', { class: 'switch' }, h('span', null, h('b', null, 'Regla activa'), h('div', { class: 'small muted' }, 'Pausa sin borrar el historial.')),
          h('input', { type: 'checkbox', checked: !!r.active, onchange: (e) => { r.active = e.target.checked; } })),
        existing && Object.keys(r.exceptions || {}).length ? h('div', { class: 'small muted' }, `Excepciones: ${Object.entries(r.exceptions).map(([d, e]) => `${dateLabel(d)} ${e.skip ? 'omitida' : 'editada'}`).join(', ')}`) : null,
        errors.length ? h('div', { class: 'form-error', role: 'alert' }, errors.join(' ')) : null,
        h('button', { class: 'btn primary block', 'data-testid': 'rule-save', onclick: save }, existing ? 'Guardar cambios en toda la serie' : 'Crear regla'),
        existing ? h('div', { class: 'btn-row', style: { marginTop: '10px' } },
          h('button', { class: 'btn', onclick: () => { close(); endHere(existing); } }, 'Terminar serie…'),
          h('button', { class: 'btn danger', 'data-testid': 'rule-delete', onclick: () => remove(existing, close) }, icon('trash', 'sm'), 'Eliminar regla')) : null));
    };
    async function save() {
      r.amount = toCents(amountStr || '0');
      if (r.kind !== 'expense') r.categoryId = null;
      if (r.kind !== 'transfer' && r.kind !== 'card_payment') r.toAccountId = null;
      if (!r.endDate) delete r.endDate;
      errors = validateRule(r, S);
      if (errors.length) { draw(); return; }
      if (existing) {
        const { rule, updates, deletes } = editSeries(S, existing, r);
        await store.deleteTxs(deletes, { silent: true });
        if (updates.length) await store.saveTxs(updates);
        await store.saveRule(rule);
        toast(`Serie actualizada${updates.length ? ` · ${updates.length} pendiente(s) ajustada(s)` : ''}`);
      } else {
        await store.saveRule({ ...r, id: uid('r_') });
        toast('Regla creada. Se generará sola en cada fecha.');
      }
      close();
    }
    draw();
    return root;
  });
}

function groupedCategorySelect(value, onChange) {
  const s = h('select', { class: 'input', onchange: (e) => onChange(e.target.value) });
  for (const l of LAYERS) {
    const g = h('optgroup', { label: `${l.icon} ${l.name}` });
    for (const c of S.categories.filter((x) => x.layer === l.id)) { const o = h('option', { value: c.id }, `${c.icon} ${c.name}`); if (c.id === value) o.selected = true; g.append(o); }
    s.append(g);
  }
  return s;
}
export { groupedCategorySelect };

async function remove(rule, close) {
  const pending = S.transactions.filter((t) => t.recurringId === rule.id && t.status === 'pending').length;
  let delPending = true;
  const ok = await confirmSheet({
    title: `Eliminar “${rule.name}”`, confirm: 'Eliminar regla',
    message: 'La regla dejará de generar movimientos. Los movimientos ya confirmados se conservan en tu historial.',
    options: pending ? h('label', { class: 'switch' }, h('span', null, `También borrar ${pending} pendiente(s)`), h('input', { type: 'checkbox', checked: true, onchange: (e) => { delPending = e.target.checked; } })) : null,
  });
  if (!ok) return;
  const { deletes } = deleteRule(S, rule.id, { deletePending: delPending });
  await store.deleteTxs(deletes, { silent: true });
  await store.deleteRule(rule.id);
  close();
  toast('Regla eliminada');
}

async function endHere(rule) {
  const next = upcoming(S, store.today(), 400).find((o) => o.rule.id === rule.id);
  openSheet('Terminar serie', ({ close }) => {
    let date = next?.origDate || store.today();
    return h('div', null,
      h('p', { class: 'text-2' }, 'La serie deja de existir a partir de esta fecha (inclusive). Lo anterior se conserva.'),
      field('Última fecha que NO se genera', h('input', { class: 'input', type: 'date', value: date, onchange: (e) => { date = e.target.value; } })),
      h('button', { class: 'btn danger block', onclick: async () => {
        const { rule: r2, deletes } = endSeriesBefore(S, rule, date);
        await store.deleteTxs(deletes, { silent: true });
        await store.saveRule(r2); close(); toast(`Serie terminada el ${dateLabel(addDays(date, -1))}`);
      } }, 'Terminar serie'));
  });
}

export function openOccurrence(rule, origDate) {
  const exc = rule.exceptions?.[origDate] || {};
  let amountStr = ((Number.isInteger(exc.amount) ? exc.amount : rule.amount) / 100).toString();
  let date = exc.date || origDate;
  openSheet(`${rule.name} · ${dateLabel(origDate)}`, ({ close }) => h('div', null,
    h('div', { class: 'qa-note' }, `Serie: ${freqLabel(rule)} · ${fmt(rule.amount)}. Aquí cambias SOLO esta ocurrencia.`),
    h('div', { class: 'grid2' },
      field('Monto (solo esta)', h('input', { class: 'input', inputmode: 'decimal', value: amountStr, oninput: (e) => { amountStr = e.target.value; } })),
      field('Fecha (solo esta)', h('input', { class: 'input', type: 'date', value: date, onchange: (e) => { date = e.target.value || origDate; } }))),
    h('button', { class: 'btn primary block', onclick: async () => {
      const amount = toCents(amountStr);
      if (!(amount > 0)) { toast('Monto inválido'); return; }
      await store.saveRule(editOccurrence(rule, origDate, { amount, date }));
      close(); toast('Ocurrencia actualizada');
    } }, 'Guardar solo esta'),
    h('div', { class: 'btn-row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', 'data-testid': 'skip-occ', onclick: async () => { await store.saveRule(skipOccurrence(rule, origDate).rule); close(); toast('Ocurrencia omitida', { action: 'Deshacer', onAction: () => store.saveRule(restoreOccurrence(store.state.recurring.find((x) => x.id === rule.id), origDate)) }); } }, 'Omitir solo esta'),
      Object.keys(exc).length ? h('button', { class: 'btn', onclick: async () => { await store.saveRule(restoreOccurrence(rule, origDate)); close(); } }, 'Restaurar') : null),
    h('button', { class: 'btn ghost block', style: { marginTop: '8px' }, onclick: () => { close(); openRuleForm(rule); } }, 'Editar toda la serie')));
}
void occurrenceDates; void TX_KINDS;
