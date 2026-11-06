import { h, frag, icon } from '../h.js';
import * as store from '../../data/store.js';
import { fmt } from '../../core/money.js';
import { filterTransactions, allTags, isActual } from '../../core/ledger.js';
import { LAYERS, TX_KINDS, STATUSES } from '../../core/categories.js';
import { dateLabel } from '../../core/dates.js';
import { txRow, confirmTx, emptyState } from './common.js';
import { selectEl, openTxSheet } from '../quickadd.js';
import { toast, confirmSheet } from '../sheet.js';

const S = store.state;
let q = '';
let allMonths = false;

export function transactionsView(params, fresh) {
  const f = store.ui.filters;
  if (fresh && (params.status || params.cat || params.cuenta || params.tag)) {
    Object.keys(f).forEach((k) => delete f[k]);
    if (params.status) f.status = params.status;
    if (params.cat) f.categoryId = params.cat;
    if (params.cuenta) { f.accountId = params.cuenta; allMonths = true; }
    if (params.tag) f.tag = params.tag;
  }
  const root = h('div');
  const listEl = h('div');

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Buscar nota, categoría, cuenta, monto…', value: q, 'aria-label': 'Buscar movimientos',
    oninput: (e) => { q = e.target.value; drawList(); } });
  root.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('div', { class: 'grow', style: { position: 'relative' } }, search)));

  const set = (k) => (v) => { if (v) f[k] = v; else delete f[k]; store.ui.filters = f; drawFilters(); drawList(); };
  const filtersEl = h('div');
  function drawFilters() {
    filtersEl.replaceChildren(frag(
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        selectEl([['', 'Tipo: todos'], ...Object.entries(TX_KINDS)], f.kind || '', set('kind'), { 'aria-label': 'Tipo' }),
        selectEl([['', 'Cuenta: todas'], ...S.accounts.map((a) => [a.id, a.name + (a.archived ? ' (archivada)' : '')])], f.accountId || '', set('accountId'), { 'aria-label': 'Cuenta' }),
        selectEl([['', 'Capa: todas'], ...LAYERS.map((l) => [l.id, l.name]), ['other', 'Sin categoría']], f.layer || '', set('layer'), { 'aria-label': 'Capa' }),
        selectEl([['', 'Estado: todos'], ...Object.entries(STATUSES)], f.status || '', set('status'), { 'aria-label': 'Estado' }),
      ),
      h('div', { class: 'chips', style: { marginTop: '8px' } },
        h('button', { class: 'chip small', 'aria-pressed': String(allMonths), onclick: () => { allMonths = !allMonths; drawFilters(); drawList(); } }, allMonths ? 'Todos los meses' : 'Solo este mes'),
        f.categoryId ? h('button', { class: 'chip small on', onclick: () => set('categoryId')('') }, `${S.categories.find((c) => c.id === f.categoryId)?.name || 'Categoría'} ✕`) : null,
        ...allTags(S).map((t) => h('button', { class: 'chip small', 'aria-pressed': String(f.tag === t), onclick: () => set('tag')(f.tag === t ? '' : t) }, '#' + t)),
      )));
  }

  function drawList() {
    const txs = filterTransactions(S, { ...f, q, month: allMonths ? null : store.ui.month });
    listEl.replaceChildren();
    const actual = txs.filter(isActual);
    const out = actual.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.amount, 0);
    const inc = actual.filter((t) => t.kind === 'income').reduce((a, t) => a + t.amount, 0);
    const pend = txs.filter((t) => t.status === 'pending');
    listEl.append(h('div', { class: 'tiles', style: { gridTemplateColumns: '1fr 1fr' } },
      h('div', { class: 'tile' }, h('div', { class: 't-label' }, 'Ingresos'), h('div', { class: 't-value pos' }, fmt(inc))),
      h('div', { class: 'tile' }, h('div', { class: 't-label' }, 'Egresos'), h('div', { class: 't-value' }, fmt(out)))));
    if (pend.length) listEl.append(h('div', { class: 'banner' }, `${pend.length} pendiente${pend.length > 1 ? 's' : ''}`, h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: async () => { await store.saveTxs(pend.map((t) => ({ ...t, status: 'confirmed' }))); toast('Confirmados'); } }, 'Confirmar todos')));
    const confirmedOnes = txs.filter((t) => t.status === 'confirmed');
    if (f.accountId && confirmedOnes.length) listEl.append(h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn sm ghost', onclick: async () => {
        if (!(await confirmSheet({ title: 'Marcar como conciliados', message: `Se marcarán ${confirmedOnes.length} movimientos de esta cuenta como conciliados (coinciden con tu banco).`, confirm: 'Marcar conciliados', danger: false }))) return;
        await store.saveTxs(confirmedOnes.map((t) => ({ ...t, status: 'reconciled' })));
      } }, '✓ Marcar filtrados como conciliados')));

    if (!txs.length) {
      listEl.append(emptyState('🔎', q || Object.keys(f).length ? 'Sin resultados con estos filtros.' : 'Aún no hay movimientos este mes.',
        Object.keys(f).length || q ? h('button', { class: 'btn', onclick: () => { store.ui.filters = {}; q = ''; search.value = ''; Object.keys(f).forEach((k) => delete f[k]); drawFilters(); drawList(); } }, 'Quitar filtros')
          : h('button', { class: 'btn primary', onclick: () => openTxSheet() }, 'Registrar movimiento')));
      return;
    }
    const groups = new Map();
    for (const t of txs.slice(0, 600)) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
    for (const [date, items] of groups) {
      const dayOut = items.filter((t) => t.kind === 'expense' && isActual(t)).reduce((a, t) => a + t.amount, 0);
      listEl.append(h('div', { class: 'list-head' }, h('span', null, dateLabel(date, { weekday: true, year: allMonths })), dayOut ? h('span', { class: 'num' }, '−' + fmt(dayOut)) : null));
      listEl.append(h('div', { class: 'list' }, items.map((t) => txRow(t, { onConfirm: confirmTx }))));
    }
    if (txs.length > 600) listEl.append(h('p', { class: 'small muted', style: { textAlign: 'center' } }, `Mostrando 600 de ${txs.length}. Afina la búsqueda.`));
  }
  drawFilters(); drawList();
  root.append(filtersEl, listEl);
  return root;
}
