// Estado en memoria + persistencia write-through en IndexedDB.
import * as db from './db.js';
import { emptyState, demoState } from '../core/seed.js';
import { todayISO, monthKey } from '../core/dates.js';
import { materialize } from '../core/recurring.js';
import { DEFAULT_SETTINGS } from '../core/alerts.js';
import { uid } from '../core/ids.js';

const listeners = new Set();
export const state = emptyState();
export const ui = { month: monthKey(todayISO()), filters: {}, demo: false };

/** Permite fijar "hoy" para pruebas: ?hoy=2026-11-20 */
const forcedToday = new URLSearchParams(location.search).get('hoy');
export const today = () => (forcedToday && /^\d{4}-\d{2}-\d{2}$/.test(forcedToday) ? forcedToday : todayISO());

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) fn(reason); }

export async function init() {
  const loaded = {};
  for (const s of db.STORES) loaded[s] = await db.getAll(s);
  const settings = await db.kvGet('settings');
  const fresh = emptyState();
  Object.assign(state, fresh);
  if (loaded.accountTypes.length) state.accountTypes = loaded.accountTypes; else await db.putMany('accountTypes', state.accountTypes);
  if (loaded.categories.length) state.categories = loaded.categories; else await db.putMany('categories', state.categories);
  state.accounts = loaded.accounts;
  state.transactions = loaded.transactions;
  state.recurring = loaded.recurring;
  state.reconciliations = loaded.reconciliations;
  state.settings = { ...fresh.settings, ...(settings || {}), notify: { ...DEFAULT_SETTINGS.notify, ...(settings?.notify || {}) } };
  if (!settings) await db.kvSet('settings', state.settings);
  await runRecurring(false);
  emit('init');
}

/** Autogenera ocurrencias recurrentes vencidas (idempotente). */
export async function runRecurring(notify = true) {
  const created = materialize(state, today());
  if (created.length) {
    state.transactions.push(...created);
    await db.putMany('transactions', created);
    if (notify) emit('recurring');
  }
  return created.length;
}

// ---------- Movimientos ----------
export async function saveTx(tx) {
  const now = Date.now();
  const rec = { tags: [], note: '', status: 'confirmed', ...tx, id: tx.id || uid('t_'), updatedAt: now, createdAt: tx.createdAt || now };
  const i = state.transactions.findIndex((t) => t.id === rec.id);
  const prev = i >= 0 ? state.transactions[i] : null;
  if (i >= 0) state.transactions[i] = rec; else state.transactions.push(rec);
  await db.put('transactions', rec);
  emit('tx');
  return { rec, prev };
}
export async function saveTxs(list) {
  const now = Date.now();
  for (const tx of list) {
    tx.updatedAt = now;
    const i = state.transactions.findIndex((t) => t.id === tx.id);
    if (i >= 0) state.transactions[i] = tx; else state.transactions.push(tx);
  }
  await db.putMany('transactions', list);
  emit('tx');
}
export async function deleteTxs(ids, { silent } = {}) {
  const set = new Set(ids);
  state.transactions = state.transactions.filter((t) => !set.has(t.id));
  await db.delMany('transactions', ids);
  if (!silent) emit('tx');
}
/** Borra un movimiento. Si viene de una regla, guarda excepción para que no se regenere. */
export async function deleteTx(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return null;
  if (tx.recurringId) {
    const rule = state.recurring.find((r) => r.id === tx.recurringId);
    if (rule) await saveRule({ ...rule, exceptions: { ...(rule.exceptions || {}), [tx.occurrenceDate]: { skip: true } } }, { silent: true });
  }
  await deleteTxs([id]);
  return tx;
}
export async function restoreTx(tx) {
  if (tx.recurringId) {
    const rule = state.recurring.find((r) => r.id === tx.recurringId);
    if (rule?.exceptions?.[tx.occurrenceDate]?.skip) {
      const exceptions = { ...rule.exceptions }; delete exceptions[tx.occurrenceDate];
      await saveRule({ ...rule, exceptions }, { silent: true });
    }
  }
  state.transactions.push(tx);
  await db.put('transactions', tx);
  emit('tx');
}

// ---------- Cuentas, tipos, categorías ----------
async function upsert(store, item, { silent } = {}) {
  const now = Date.now();
  const rec = { ...item, id: item.id || uid(store.slice(0, 2) + '_'), updatedAt: now, createdAt: item.createdAt || now };
  const arr = state[store];
  const i = arr.findIndex((x) => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  await db.put(store, rec);
  if (!silent) emit(store);
  return rec;
}
async function remove(store, id) {
  state[store] = state[store].filter((x) => x.id !== id);
  await db.del(store, id);
  emit(store);
}
export const saveAccount = (a) => upsert('accounts', a);
export const saveAccountType = (t) => upsert('accountTypes', t);
export const saveCategory = (c) => upsert('categories', c);
export const deleteAccountType = (id) => remove('accountTypes', id);
export const deleteCategory = (id) => remove('categories', id);
export async function deleteAccount(id) {
  const used = state.transactions.some((t) => t.accountId === id || t.toAccountId === id);
  if (used) { const a = state.accounts.find((x) => x.id === id); return upsert('accounts', { ...a, archived: true }); }
  return remove('accounts', id);
}
export const saveReconciliation = (r) => upsert('reconciliations', r);

// ---------- Recurrentes ----------
export async function saveRule(rule, { silent } = {}) {
  const rec = await upsert('recurring', rule, { silent: true });
  if (!silent) { await runRecurring(false); emit('recurring'); }
  return rec;
}
export async function deleteRule(id) { await remove('recurring', id); }

// ---------- Ajustes ----------
export async function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.kvSet('settings', state.settings);
  emit('settings');
}

// ---------- Todo ----------
export async function replaceState(next) {
  const merged = { ...emptyState(), ...next };
  merged.settings = { ...emptyState().settings, ...(next.settings || {}) };
  await db.replaceAll(merged);
  Object.assign(state, merged);
  await runRecurring(false);
  emit('replace');
}
export async function loadDemo() {
  const d = demoState(today());
  d.settings.security = state.settings.security;
  await replaceState(d);
}
export async function wipe() {
  const e = emptyState();
  e.settings.security = state.settings.security;
  await replaceState(e);
}
export const kv = { get: db.kvGet, set: db.kvSet };
