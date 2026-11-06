// Registro rápido y editor de movimientos.
// Gasto pequeño en 3 toques: (+) → categoría → Guardar (el monto se teclea en el teclado propio).
// Atajo en 2 toques: (+) → chip de atajo (guarda directo, con Deshacer).
import { h, icon } from './h.js';
import { openSheet, toast, confirmSheet } from './sheet.js';
import * as store from '../data/store.js';
import { fmt, toCents } from '../core/money.js';
import { addDays, dateLabel } from '../core/dates.js';
import { LAYERS, INCOME_TYPES, TX_KINDS, STATUSES } from '../core/categories.js';
import { validateTx, accountKind, balances } from '../core/ledger.js';
import { cardCycle } from '../core/cards.js';
import { uid } from '../core/ids.js';

const S = store.state;
const KIND_ORDER = ['expense', 'income', 'transfer', 'card_payment'];
const FALLBACK_CATS = ['c_despensa', 'c_comer', 'c_cafe', 'c_transporte', 'c_gasolina', 'c_antojos', 'c_delivery', 'c_compras', 'c_salud', 'c_entretenimiento'];

const activeAccounts = () => S.accounts.filter((a) => !a.archived);
const kindOf = (a) => accountKind(S, a);

function topCategories(n = 9) {
  const since = addDays(store.today(), -120);
  const count = new Map();
  for (const t of S.transactions) if (t.kind === 'expense' && t.categoryId && t.date >= since) count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1);
  const ids = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of FALLBACK_CATS) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => S.categories.find((c) => c.id === id)).filter(Boolean).slice(0, n);
}

function defaultAccount(kind) {
  const last = S.settings.lastAccount?.[kind];
  const acc = activeAccounts();
  if (last && acc.some((a) => a.id === last)) return last;
  const pref = kind === 'expense' ? ['credit', 'asset', 'voucher'] : ['asset', 'voucher', 'credit'];
  for (const k of pref) { const a = acc.find((x) => kindOf(x) === k); if (a) return a.id; }
  return acc[0]?.id || null;
}
function defaultTo(kind, from) {
  const acc = activeAccounts().filter((a) => a.id !== from);
  if (kind === 'card_payment') {
    const bals = balances(S);
    const credits = acc.filter((a) => kindOf(a) === 'credit').sort((a, b) => (bals.get(a.id) || 0) - (bals.get(b.id) || 0));
    return credits[0]?.id || null;
  }
  return (acc.find((a) => kindOf(a) === 'asset') || acc[0])?.id || null;
}

/**
 * Abre el registro rápido / editor.
 * @param {object} opts { tx?: existente, kind?, preset?: campos iniciales }
 */
export function openTxSheet(opts = {}) {
  const editing = !!opts.tx;
  const f = editing ? { ...opts.tx, tags: [...(opts.tx.tags || [])] } : {
    kind: opts.kind || 'expense', amount: 0, categoryId: null, incomeType: 'salary', incomeLabel: '',
    date: store.today(), note: '', tags: [], status: 'confirmed', ...opts.preset,
  };
  if (!f.accountId) f.accountId = opts.preset?.accountId || defaultAccount(f.kind);
  if ((f.kind === 'transfer' || f.kind === 'card_payment') && !f.toAccountId) f.toAccountId = defaultTo(f.kind, f.accountId);
  let amountStr = f.amount ? (f.amount / 100).toFixed(2).replace(/\.00$/, '') : '';
  let replaceOnType = !!amountStr; // un monto prellenado se reemplaza al teclear (como texto seleccionado)
  let showAllCats = false;
  let errors = [];

  if (!activeAccounts().length) {
    toast('Primero agrega una cuenta (efectivo, débito o tarjeta).');
    location.hash = '#/cuentas';
    return;
  }

  const title = editing ? `Editar ${TX_KINDS[f.kind].toLowerCase()}` : 'Registro rápido';
  const sheet = openSheet(title, ({ body, el: dlgEl }) => {
    const root = h('div');
    const amountEl = h('div', { class: 'v' });
    const updateAmount = () => {
      const c = toCents(amountStr || '0');
      amountEl.textContent = fmt(Number.isFinite(c) ? c : 0, { decimals: true }).replace(/\.00$/, '') + (amountStr.endsWith('.') ? '.' : '');
      amountEl.classList.toggle('zero', !amountStr);
      saveBtn && (saveBtn.disabled = !amountStr || toCents(amountStr) <= 0);
    };
    let saveBtn;

    function press(k) {
      if (replaceOnType && k !== '⌫') amountStr = '';
      replaceOnType = false;
      if (k === '⌫') amountStr = amountStr.slice(0, -1);
      else if (k === '.') { if (!amountStr.includes('.')) amountStr = (amountStr || '0') + '.'; }
      else {
        const [i, d] = amountStr.split('.');
        if (d !== undefined && d.length >= 2) return;
        if (d === undefined && (i || '').length >= 9) return;
        amountStr = amountStr === '0' ? k : amountStr + k;
      }
      updateAmount();
    }

    function render() {
      const top = body.scrollTop;
      root.replaceChildren();
      // Tipo
      if (!editing || f.kind !== 'adjustment') root.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de movimiento' },
        KIND_ORDER.map((k) => h('button', { type: 'button', 'aria-pressed': String(f.kind === k), onclick: () => switchKind(k) },
          { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferir', card_payment: 'Pago TC' }[k]))));

      // Monto
      root.append(h('div', { class: 'qa-amount' }, amountEl, h('div', { class: 'k' }, f.kind === 'card_payment' ? 'Monto que pagaste en la app de tu banco' : 'Monto')));

      if (f.kind === 'expense') renderExpense();
      else if (f.kind === 'income') renderIncome();
      else if (f.kind === 'transfer' || f.kind === 'card_payment') renderMove();

      // Detalles
      const det = h('details', { class: 'more', open: editing || undefined },
        h('summary', null, `Más detalles · ${dateLabel(f.date, { weekday: true })}${f.status === 'pending' ? ' · pendiente' : ''}`),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', null, 'Fecha'), h('input', { class: 'input', type: 'date', value: f.date, onchange: (e) => { f.date = e.target.value || store.today(); } })),
          h('label', { class: 'field' }, h('span', null, 'Estado'), selectEl(Object.entries(STATUSES), f.status, (v) => { f.status = v; }))),
        h('label', { class: 'field' }, h('span', null, 'Nota'), h('input', { class: 'input', value: f.note || '', placeholder: 'Opcional', oninput: (e) => { f.note = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, 'Etiquetas'), h('input', { class: 'input', value: (f.tags || []).join(', '), placeholder: 'Ej. oficina, viaje', oninput: (e) => { f.tags = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } }),
          h('div', { class: 'hint' }, 'Separa con comas.')),
        f.kind === 'expense' && !editing ? h('button', { type: 'button', class: 'btn sm ghost', onclick: saveShortcut }, icon('star', 'sm'), 'Guardar como atajo') : null,
      );
      root.append(det);

      if (editing) {
        const rule = f.recurringId && S.recurring.find((r) => r.id === f.recurringId);
        if (rule) root.append(h('div', { class: 'qa-note', style: { marginTop: '10px' } }, `🔁 Parte de la serie “${rule.name}”. Los cambios aquí aplican solo a esta ocurrencia. `,
          h('a', { href: `#/fijos?regla=${rule.id}`, onclick: () => sheet.close() }, 'Editar toda la serie')));
        root.append(h('button', { class: 'btn danger block', style: { margin: '6px 0 10px' }, type: 'button', onclick: remove }, icon('trash', 'sm'), rule ? 'Eliminar solo esta ocurrencia' : 'Eliminar movimiento'));
      }

      // Pie fijo: teclado + guardar siempre visibles (registro en ≤ 3 toques sin desplazarse)
      saveBtn = h('button', { class: 'btn primary block', type: 'button', onclick: save, 'data-testid': 'save-tx' },
        icon('check', 'sm'), editing ? 'Guardar cambios' : ({ expense: 'Guardar gasto', income: 'Guardar ingreso', transfer: 'Guardar transferencia', card_payment: 'Registrar pago' }[f.kind]));
      root.append(h('div', { class: 'qa-foot' },
        errors.length ? h('div', { class: 'form-error', role: 'alert' }, errors.join(' ')) : null,
        h('div', { class: 'keypad', role: 'group', 'aria-label': 'Teclado numérico' },
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) =>
            h('button', { type: 'button', 'aria-label': k === '⌫' ? 'Borrar' : k, onclick: () => press(k) }, k))),
        saveBtn));
      updateAmount();
      body.scrollTop = top;
    }

    function renderExpense() {
      if (!editing) {
        const sc = S.settings.shortcuts || [];
        if (sc.length) {
          root.append(h('div', { class: 'qa-label' }, 'Atajos · 1 toque'));
          root.append(h('div', { class: 'chips' }, sc.map((s) => {
            const c = S.categories.find((x) => x.id === s.categoryId);
            return h('button', { class: 'chip preset', type: 'button', 'data-testid': 'shortcut', onclick: () => quickSave(s) }, h('span', { class: 'em' }, c?.icon || '⚡'), s.label, h('b', null, fmt(s.amount)));
          })));
        }
      }
      root.append(h('div', { class: 'qa-label' }, 'Categoría'));
      const cats = showAllCats ? null : topCategories();
      if (cats) {
        const list = [...cats];
        if (f.categoryId && !list.some((c) => c.id === f.categoryId)) { const c = S.categories.find((x) => x.id === f.categoryId); if (c) list.unshift(c); }
        root.append(h('div', { class: 'chips rows2' }, list.map(catChip), h('button', { class: 'chip', type: 'button', onclick: () => { showAllCats = true; render(); } }, 'Todas…')));
      } else {
        for (const l of LAYERS) {
          root.append(h('div', { class: 'tiny muted', style: { margin: '6px 2px 4px', fontWeight: 700 } }, `${l.icon} ${l.name}`));
          root.append(h('div', { class: 'chips wrap' }, S.categories.filter((c) => c.layer === l.id).map(catChip)));
        }
      }
      accountChips('Cuenta', f.accountId, (id) => { f.accountId = id; });
    }
    const catChip = (c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f.categoryId === c.id), 'data-cat': c.id,
      style: f.categoryId === c.id ? null : { borderColor: `color-mix(in srgb, ${LAYERS.find((l) => l.id === c.layer)?.color} 45%, var(--border))` },
      onclick: () => { f.categoryId = f.categoryId === c.id ? null : c.id; render(); } }, h('span', { class: 'em' }, c.icon), c.name);

    function renderIncome() {
      root.append(h('div', { class: 'qa-label' }, 'Tipo de ingreso'));
      root.append(h('div', { class: 'chips wrap' }, INCOME_TYPES.map((t) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f.incomeType === t.id),
        onclick: () => { f.incomeType = t.id; render(); } }, h('span', { class: 'em' }, t.icon), t.name))));
      if (f.incomeType !== 'salary') {
        const labels = [...new Set(S.transactions.filter((t) => t.kind === 'income' && t.incomeType === f.incomeType && t.incomeLabel).map((t) => t.incomeLabel))].slice(0, 6);
        root.append(h('label', { class: 'field', style: { marginTop: '8px' } }, h('span', null, f.incomeType === 'other' ? 'Nombre del ingreso' : 'Concepto (opcional)'),
          h('input', { class: 'input', value: f.incomeLabel || '', placeholder: f.incomeType === 'other' ? 'Ej. Aguinaldo, PTU, venta, freelance' : f.incomeType === 'bonus' ? 'Ej. Bono anual, bono de productividad' : 'Ej. Fondo de ahorro 2026', oninput: (e) => { f.incomeLabel = e.target.value; } })));
        if (labels.length) root.append(h('div', { class: 'chips' }, labels.map((l) => h('button', { class: 'chip small', type: 'button', onclick: () => { f.incomeLabel = l; render(); } }, l))));
      }
      accountChips('Entra a', f.accountId, (id) => { f.accountId = id; });
    }

    function renderMove() {
      if (f.kind === 'card_payment') {
        root.append(h('div', { class: 'qa-note' }, '🏦 Registra aquí el pago que ya hiciste en la app de tu banco. Lana no realiza pagos ni se conecta a tu banco. No cuenta como gasto.'));
        accountChips('Pagué desde', f.accountId, (id) => { f.accountId = id; }, (a) => kindOf(a) !== 'credit');
        accountChips('Tarjeta pagada', f.toAccountId, (id) => { f.toAccountId = id; }, (a) => kindOf(a) === 'credit');
        const card = S.accounts.find((a) => a.id === f.toAccountId);
        if (card && kindOf(card) === 'credit' && !editing) {
          const c = cardCycle(S, card, store.today());
          const debt = Math.max(0, -(balances(S).get(card.id) || 0));
          const opts = [['Para no generar intereses', c.toAvoidInterest], [`Mínimo${c.minEstimated ? ' (est.)' : ''}`, c.minRemaining], ['Saldo total', debt]].filter(([, v]) => v > 0);
          if (opts.length) {
            root.append(h('div', { class: 'qa-label' }, 'Sugerencias'));
            root.append(h('div', { class: 'chips' }, opts.map(([l, v]) => h('button', { class: 'chip small', type: 'button', onclick: () => { amountStr = (v / 100).toFixed(2); replaceOnType = true; updateAmount(); } }, `${l}: ${fmt(v)}`))));
          }
        }
      } else {
        root.append(h('div', { class: 'qa-note' }, '⇄ Entre tus propias cuentas. No cuenta como ingreso ni como gasto.'));
        accountChips('De', f.accountId, (id) => { f.accountId = id; });
        accountChips('A', f.toAccountId, (id) => { f.toAccountId = id; }, (a) => a.id !== f.accountId);
      }
    }

    function accountChips(label, value, set, filter = () => true) {
      const list = activeAccounts().filter(filter);
      root.append(h('div', { class: 'qa-label' }, label));
      if (!list.length) { root.append(h('div', { class: 'small muted' }, 'No hay cuentas de este tipo. Agrégalas en Cuentas.')); return; }
      root.append(h('div', { class: 'chips' }, list.map((a) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(value === a.id), onclick: () => { set(a.id); render(); } },
        h('span', { class: 'swatch', style: { background: a.color || '#334155' } }), a.name))));
    }

    function switchKind(k) {
      f.kind = k;
      if (!editing) f.accountId = defaultAccount(k);
      const cur = S.accounts.find((a) => a.id === f.accountId);
      if (k === 'card_payment' && cur && kindOf(cur) === 'credit') f.accountId = activeAccounts().find((a) => kindOf(a) !== 'credit')?.id || f.accountId;
      if (k === 'transfer' || k === 'card_payment') f.toAccountId = defaultTo(k, f.accountId);
      errors = [];
      render();
    }

    function build() {
      const tx = {
        ...(editing ? opts.tx : {}),
        id: editing ? opts.tx.id : uid('t_'),
        kind: f.kind, amount: toCents(amountStr || '0'), date: f.date, accountId: f.accountId,
        toAccountId: f.kind === 'transfer' || f.kind === 'card_payment' ? f.toAccountId : null,
        categoryId: f.kind === 'expense' ? f.categoryId : null,
        incomeType: f.kind === 'income' ? f.incomeType : null,
        incomeLabel: f.kind === 'income' ? (f.incomeLabel || '').trim() : '',
        note: (f.note || '').trim(), tags: f.tags || [], status: f.status,
      };
      if (editing && tx.recurringId) tx.detached = true;
      return tx;
    }

    async function save() {
      const tx = build();
      errors = validateTx(tx, S);
      if (errors.length) { render(); return; }
      const { prev } = await store.saveTx(tx);
      await store.setSettings({ lastAccount: { ...(S.settings.lastAccount || {}), [tx.kind]: tx.accountId } });
      sheet.close();
      const msg = `${TX_KINDS[tx.kind]} de ${fmt(tx.amount)} ${editing ? 'actualizado' : 'guardado'}`;
      toast(msg, { action: 'Deshacer', onAction: () => (prev ? store.saveTx(prev) : store.deleteTxs([tx.id])) });
    }

    async function quickSave(s) {
      const tx = { id: uid('t_'), kind: 'expense', amount: s.amount, categoryId: s.categoryId, accountId: s.accountId && S.accounts.some((a) => a.id === s.accountId) ? s.accountId : f.accountId,
        date: store.today(), note: '', tags: [], status: 'confirmed' };
      await store.saveTx(tx);
      sheet.close();
      toast(`${s.label} · ${fmt(s.amount)} guardado`, { action: 'Deshacer', onAction: () => store.deleteTxs([tx.id]) });
    }

    async function saveShortcut() {
      const amount = toCents(amountStr || '0');
      const c = S.categories.find((x) => x.id === f.categoryId);
      if (!c || !(amount > 0)) { errors = ['Para crear un atajo elige categoría y monto.']; render(); return; }
      const list = [...(S.settings.shortcuts || []), { id: uid('s_'), label: c.name, categoryId: c.id, amount, accountId: f.accountId }];
      await store.setSettings({ shortcuts: list.slice(-10) });
      toast(`Atajo “${c.name} ${fmt(amount)}” creado`);
      render();
    }

    async function remove() {
      const rule = f.recurringId && S.recurring.find((r) => r.id === f.recurringId);
      const ok = await confirmSheet({ title: rule ? 'Eliminar ocurrencia' : 'Eliminar movimiento', message: rule ? 'Se omitirá solo esta ocurrencia; la serie sigue igual.' : 'Se ajustarán tus saldos y gráficas.', confirm: rule ? 'Eliminar ocurrencia' : 'Eliminar movimiento' });
      if (!ok) return;
      const old = await store.deleteTx(opts.tx.id);
      sheet.close();
      toast('Movimiento eliminado', { action: 'Deshacer', onAction: () => store.restoreTx(old) });
    }

    // Teclado físico
    dlgEl.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
      else if (e.key === '.' || e.key === ',') { press('.'); e.preventDefault(); }
      else if (e.key === 'Backspace') { press('⌫'); e.preventDefault(); }
      else if (e.key === 'Enter') { save(); e.preventDefault(); }
    });
    render();
    return root;
  });
  return sheet;
}

export function selectEl(entries, value, onChange, attrs = {}) {
  const s = h('select', { class: 'input', onchange: (e) => onChange(e.target.value), ...attrs });
  for (const [v, label] of entries) {
    const o = h('option', { value: v }, label);
    if (String(v) === String(value)) o.selected = true;
    s.append(o);
  }
  return s;
}
