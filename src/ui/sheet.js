// Hojas inferiores (con <dialog> nativo: trampa de foco y Esc gratis), toasts y confirmaciones.
import { h, icon } from './h.js';

let openCount = 0;
export function openSheet(title, buildBody, { onClose, wide } = {}) {
  const body = h('div', { class: 'sheet-body' });
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => close() }, icon('x', 'sm'));
  const titleEl = h('h3', null, title);
  dlg.append(h('div', { class: 'sheet-head' }, titleEl, closeBtn), body);
  document.body.append(dlg);
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    dlg.classList.add('closing');
    const done = () => { dlg.close(); dlg.remove(); openCount--; onClose?.(result); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 180);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // tocar el fondo
  const api = { el: dlg, body, close, setTitle: (t) => (titleEl.textContent = t) };
  const content = buildBody(api);
  if (content) body.append(content);
  openCount++;
  dlg.showModal();
  return api;
}
export const sheetsOpen = () => openCount > 0;

let toastsEl;
export function toast(message, { action, onAction, timeout = 4000 } = {}) {
  if (!toastsEl) { toastsEl = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastsEl); }
  const t = h('div', { class: 'toast' }, h('span', null, message));
  if (action) t.append(h('button', { onclick: () => { onAction?.(); t.remove(); } }, action));
  toastsEl.append(t);
  setTimeout(() => t.remove(), timeout);
}

/** Confirmación con verbo explícito en el botón ("Eliminar regla"). */
export function confirmSheet({ title, message, confirm, danger = true, options }) {
  return new Promise((resolve) => {
    openSheet(title, ({ close }) => h('div', null,
      h('p', { class: 'text-2' }, message),
      options || null,
      h('div', { class: 'btn-row', style: { marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirm)),
    ), { onClose: (r) => resolve(!!r) });
  });
}

export function promptSheet({ title, label, value = '', type = 'text', confirm = 'Guardar', hint }) {
  return new Promise((resolve) => {
    openSheet(title, ({ close }) => {
      const input = h('input', { class: 'input', type, value, autocomplete: 'off' });
      setTimeout(() => input.focus(), 50);
      return h('form', { onsubmit: (e) => { e.preventDefault(); close(input.value); } },
        h('label', { class: 'field' }, h('span', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null),
        h('button', { class: 'btn primary block', type: 'submit' }, confirm));
    }, { onClose: (r) => resolve(typeof r === 'string' ? r : null) });
  });
}
