import { h, raw } from '../h.js';
import * as store from '../../data/store.js';
import { fmt } from '../../core/money.js';
import { layerById, incomeTypeById, STATUSES } from '../../core/categories.js';
import { openTxSheet } from '../quickadd.js';
import { delta } from '../../core/ledger.js';

const S = store.state;
export const accById = (id) => S.accounts.find((a) => a.id === id);
export const catById = (id) => S.categories.find((c) => c.id === id);

export function txTitle(tx) {
  if (tx.kind === 'expense') return catById(tx.categoryId)?.name || 'Gasto sin categoría';
  if (tx.kind === 'income') return tx.incomeLabel || incomeTypeById(tx.incomeType).name;
  if (tx.kind === 'card_payment') return `Pago a ${accById(tx.toAccountId)?.name || 'tarjeta'}`;
  if (tx.kind === 'transfer') return `${accById(tx.accountId)?.name || '?'} → ${accById(tx.toAccountId)?.name || '?'}`;
  return 'Ajuste de saldo';
}
export function txIcon(tx) {
  if (tx.kind === 'expense') return catById(tx.categoryId)?.icon || '🏷️';
  if (tx.kind === 'income') return incomeTypeById(tx.incomeType).icon;
  if (tx.kind === 'card_payment') return '💳';
  if (tx.kind === 'transfer') return '⇄';
  return '⚖️';
}
export function txRow(tx, { showDate = false, onConfirm } = {}) {
  const sub = [];
  if (showDate) sub.push(tx.date.slice(8, 10) + '/' + tx.date.slice(5, 7));
  if (tx.kind === 'expense' || tx.kind === 'income' || tx.kind === 'adjustment') sub.push(accById(tx.accountId)?.name || 'Cuenta eliminada');
  else if (tx.kind === 'card_payment') sub.push(`desde ${accById(tx.accountId)?.name || '?'}`);
  if (tx.note && tx.note !== txTitle(tx)) sub.push(tx.note);
  if (tx.recurringId) sub.push('🔁');
  const cls = tx.kind === 'income' ? 'in' : tx.kind === 'expense' ? '' : 'move';
  const sign = tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '−' : tx.kind === 'adjustment' ? (tx.amount >= 0 ? '+' : '−') : '';
  const layer = tx.kind === 'expense' ? layerById(catById(tx.categoryId)?.layer) : null;
  return h('button', { class: 'item', type: 'button', onclick: () => openTxSheet({ tx }), 'data-txid': tx.id },
    h('span', { class: 'ic', style: layer ? { background: `color-mix(in srgb, ${layer.color} 16%, var(--surface))` } : null }, txIcon(tx)),
    h('span', { class: 'grow' },
      h('div', { class: 't ellipsis' }, txTitle(tx)),
      h('div', { class: 's ellipsis' }, sub.join(' · '), (tx.tags || []).length ? ' · #' + tx.tags.join(' #') : '')),
    h('span', { class: 'right' },
      h('div', { class: `amt ${cls}` }, sign + fmt(Math.abs(tx.amount))),
      tx.status !== 'confirmed' ? h('span', { class: `badge ${tx.status}` }, STATUSES[tx.status]) : null,
      tx.status === 'pending' && onConfirm ? h('span', { role: 'button', tabindex: 0, class: 'badge info', style: { marginLeft: '4px', cursor: 'pointer' }, 'aria-label': 'Confirmar',
        onclick: (e) => { e.stopPropagation(); onConfirm(tx); } }, '✓ Confirmar') : null));
}

export async function confirmTx(tx) { await store.saveTx({ ...tx, status: 'confirmed' }); }

/** Chip de variación vs mes anterior. goodWhenUp define el color. */
export function deltaChip(cur, prev, goodWhenUp = true) {
  const d = delta(cur, prev);
  if (d === null || !Number.isFinite(d)) return h('span', { class: 'chg' }, '—');
  const up = d > 0, good = up === goodWhenUp;
  return h('span', { class: `chg ${Math.abs(d) < 0.005 ? '' : good ? 'good' : 'bad'}`, title: 'vs mes anterior' }, `${up ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d * 100).toFixed(0)}%`);
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, typeof title === 'string' ? h('h2', null, title) : title, ...children);
}
export const chartNode = (html) => raw(html);

export function emptyState(emoji, text, action) {
  return h('div', { class: 'empty' }, h('span', { class: 'em' }, emoji), h('div', null, text), action || null);
}
