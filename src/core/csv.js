// CSV de movimientos (compatible con Excel: BOM UTF-8, coma, comillas dobles).
import { toCents, toDecimalString } from './money.js';
import { layerById, TX_KINDS, STATUSES } from './categories.js';
import { uid } from './ids.js';

export const CSV_HEADERS = ['id', 'fecha', 'tipo', 'monto', 'cuenta', 'cuenta_destino', 'capa', 'categoria', 'tipo_ingreso', 'concepto_ingreso', 'nota', 'etiquetas', 'estado'];

const KIND_FROM = Object.fromEntries(Object.entries(TX_KINDS).map(([k, v]) => [v.toLowerCase(), k]));
const STATUS_FROM = Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [v.toLowerCase(), k]));
const INCOME_FROM = { salario: 'salary', bono: 'bonus', 'fondo de ahorro': 'savings_fund', otro: 'other' };
const INCOME_TO = { salary: 'Salario', bonus: 'Bono', savings_fund: 'Fondo de ahorro', other: 'Otro' };

function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutraliza fórmulas al abrir en Excel (inyección CSV)
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(state, txs = state.transactions) {
  const acc = new Map(state.accounts.map((a) => [a.id, a.name]));
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const rows = [CSV_HEADERS.join(',')];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = cats.get(t.categoryId);
    rows.push([
      t.id, t.date, TX_KINDS[t.kind], toDecimalString(t.amount), acc.get(t.accountId) || '', acc.get(t.toAccountId) || '',
      t.kind === 'expense' ? layerById(c?.layer).name : '', c?.name || '',
      t.kind === 'income' ? INCOME_TO[t.incomeType] || 'Otro' : '', t.incomeLabel || '', t.note || '', (t.tags || []).join('|'), STATUSES[t.status] || '',
    ].map(cell).join(','));
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

/** Parser CSV RFC 4180 (comillas, saltos de línea dentro de comillas). */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else f += ch;
  }
  row.push(f); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Importa CSV. Cuentas/categorías se emparejan por nombre; las cuentas desconocidas se crean como Débito.
 * @returns {{transactions, newAccounts, newCategories, errors:string[], skipped:number}}
 */
export function fromCSV(text, state, now = Date.now()) {
  const rows = parseCSV(text);
  if (!rows.length) return { transactions: [], newAccounts: [], newCategories: [], errors: ['El archivo está vacío.'], skipped: 0 };
  const head = rows[0].map(norm);
  const idx = (n) => head.indexOf(n);
  for (const req of ['fecha', 'tipo', 'monto', 'cuenta']) if (idx(req) < 0) return { transactions: [], newAccounts: [], newCategories: [], errors: [`Falta la columna "${req}".`], skipped: 0 };

  const accByName = new Map(state.accounts.map((a) => [norm(a.name), a]));
  const catByName = new Map(state.categories.map((c) => [norm(c.name), c]));
  const existingIds = new Set(state.transactions.map((t) => t.id));
  const newAccounts = [], newCategories = [], transactions = [], errors = [];
  let skipped = 0;

  const getAcc = (name) => {
    if (!name?.trim()) return null;
    let a = accByName.get(norm(name));
    if (!a) {
      a = { id: uid('a_'), name: name.trim(), typeId: 't_debit', color: '#334155', icon: '🏦', openingBalance: 0, openingDate: null, archived: false, createdAt: now };
      accByName.set(norm(name), a); newAccounts.push(a);
    }
    return a.id;
  };
  const LAYER_FROM = { esenciales: 'essentials', 'estilo de vida': 'lifestyle', 'ahorro, inversion y deuda': 'savings' };

  rows.slice(1).forEach((r, i) => {
    const g = (n) => (idx(n) >= 0 ? (r[idx(n)] || '').trim() : '');
    const line = i + 2;
    const kind = KIND_FROM[norm(g('tipo'))] || (['income', 'expense', 'transfer', 'card_payment', 'adjustment'].includes(g('tipo')) ? g('tipo') : null);
    const date = g('fecha');
    let amount = toCents(g('monto'));
    if (!kind) { errors.push(`Línea ${line}: tipo "${g('tipo')}" desconocido.`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Línea ${line}: fecha inválida (usa AAAA-MM-DD).`); return; }
    if (!Number.isFinite(amount)) { errors.push(`Línea ${line}: monto inválido.`); return; }
    if (kind !== 'adjustment') amount = Math.abs(amount);
    const id = g('id') || uid('t_');
    if (existingIds.has(id)) { skipped++; return; }
    existingIds.add(id);
    let categoryId = null;
    if (kind === 'expense' && g('categoria')) {
      let c = catByName.get(norm(g('categoria')));
      if (!c) {
        c = { id: uid('c_'), layer: LAYER_FROM[norm(g('capa'))] || 'lifestyle', name: g('categoria'), icon: '🏷️' };
        catByName.set(norm(c.name), c); newCategories.push(c);
      }
      categoryId = c.id;
    }
    transactions.push({
      id, kind, amount, date,
      accountId: getAcc(g('cuenta')),
      toAccountId: (kind === 'transfer' || kind === 'card_payment') ? getAcc(g('cuenta_destino')) : null,
      categoryId,
      incomeType: kind === 'income' ? INCOME_FROM[norm(g('tipo_ingreso'))] || 'other' : null,
      incomeLabel: g('concepto_ingreso'),
      note: g('nota'),
      tags: g('etiquetas') ? g('etiquetas').split('|').map((x) => x.trim()).filter(Boolean) : [],
      status: STATUS_FROM[norm(g('estado'))] || 'confirmed',
      createdAt: now, updatedAt: now,
    });
  });
  return { transactions, newAccounts, newCategories, errors, skipped };
}
