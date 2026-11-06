import { h, icon } from '../h.js';
import * as store from '../../data/store.js';
import { fmt, toCents } from '../../core/money.js';
import { computeAlerts } from '../../core/alerts.js';
import { LAYERS, ACCOUNT_KINDS } from '../../core/categories.js';
import { monthSummary } from '../../core/ledger.js';
import { makeBackup, validateBackup, mergeBackup, encryptBackup, decryptBackup } from '../../core/backup.js';
import { toCSV, fromCSV } from '../../core/csv.js';
import { card, emptyState, catById } from './common.js';
import { budgetBar } from './dashboard.js';
import { openSheet, toast, confirmSheet, promptSheet } from '../sheet.js';
import { openTxSheet, selectEl } from '../quickadd.js';
import { groupedCategorySelect } from './recurring.js';
import { newAccountType } from './accounts.js';
import * as notify from '../../platform/notify.js';
import * as lock from '../../platform/lock.js';
import { uid } from '../../core/ids.js';
import { monthKey } from '../../core/dates.js';

const S = store.state;

export function moreView() {
  const al = computeAlerts(S, store.today());
  const tiles = [
    ['#/fijos', '🔁', 'Gastos fijos', 'Renta, servicios, suscripciones, salario'],
    ['#/deudas', '💳', 'Deudas y tarjetas', 'Simulador, utilización, pagos'],
    ['#/reportes', '📊', 'Reportes', 'Mes a mes, ingresos, vales'],
    ['#/alertas', '🔔', `Alertas${al.length ? ` (${al.length})` : ''}`, 'Pagos, fijos, presupuesto'],
    ['#/presupuestos', '🎯', 'Presupuestos', 'Por capa y categoría'],
    ['#/categorias', '🏷️', 'Categorías', 'Micro-categorías por capa'],
    ['#/respaldos', '💾', 'Respaldos', 'JSON, CSV, restaurar'],
    ['#/ajustes', '⚙️', 'Ajustes', 'Notificaciones, seguridad, tema'],
  ];
  return h('div', null, h('div', { class: 'tiles-menu' }, tiles.map(([href, em, t, s]) => h('a', { href }, h('span', { class: 'em' }, em), h('b', null, t), h('small', null, s)))),
    h('p', { class: 'small muted', style: { textAlign: 'center', marginTop: '20px' } }, '🔒 Local-first · sin bancos · sin telemetría · Lana v1.0'));
}

// ---------- Alertas ----------
export function alertsView() {
  const al = computeAlerts(S, store.today());
  const root = h('div');
  root.append(notifStatusCard());
  if (!al.length) root.append(emptyState('✅', 'Todo en orden. No hay alertas por ahora.'));
  for (const a of al) {
    const em = { card: '💳', cut: '✂️', recurring: '🔁', pending: '⏳', budget: '🎯' }[a.type] || '🔔';
    const actions = [];
    if (a.action === 'register-payment') actions.push(h('button', { class: 'btn sm primary', onclick: () => openTxSheet({ kind: 'card_payment', preset: { toAccountId: a.accountId } }) }, 'Registrar pago'));
    if (a.action === 'confirm-pending') actions.push(h('button', { class: 'btn sm primary', onclick: async () => { const p = S.transactions.filter((t) => t.status === 'pending' && t.date <= store.today()); await store.saveTxs(p.map((t) => ({ ...t, status: 'confirmed' }))); toast('Confirmados'); } }, 'Confirmar todos'));
    if (a.route) actions.push(h('a', { class: 'btn sm', href: a.route }, 'Ver'));
    root.append(h('div', { class: `alert ${a.severity}`, role: a.severity === 'danger' ? 'alert' : null },
      h('span', { class: 'ai' }, em), h('div', { class: 'grow' }, h('div', { class: 'at' }, a.title), h('div', { class: 'ab' }, a.body), actions.length ? h('div', { class: 'btn-row', style: { marginTop: '8px' } }, actions) : null)));
  }
  return root;
}

function notifStatusCard() {
  const perm = notify.permission();
  const sup = notify.support();
  const el = card('📲 Recordatorios en tu teléfono');
  const status = { granted: '✅ Permitidas', denied: '⛔ Bloqueadas en el navegador', default: '⚪ Aún no permitidas', unsupported: '— No soportadas en este navegador' }[perm];
  el.append(h('div', { class: 'small text-2' }, `Notificaciones: ${status}`));
  if (sup.ios && !sup.standalone) el.append(h('div', { class: 'qa-note' }, '📱 En iPhone: toca Compartir → “Agregar a inicio” y abre Lana desde el ícono para poder recibir notificaciones (iOS 16.4+).'));
  const row = h('div', { class: 'btn-row', style: { marginTop: '10px' } });
  if (perm === 'default') row.append(h('button', { class: 'btn primary', onclick: async () => { const p = await notify.requestPermission(); toast(p === 'granted' ? 'Notificaciones activadas' : 'Permiso no concedido'); store.setSettings({}); } }, '🔔 Activar notificaciones'));
  if (perm === 'granted') row.append(h('button', { class: 'btn', onclick: () => notify.showNow('🔔 Prueba de Lana', 'Así se verán tus recordatorios de pago.', { tag: 'test' }) }, 'Enviar prueba'));
  row.append(h('button', { class: 'btn', onclick: downloadICS }, icon('calendar', 'sm'), 'Agregar a mi calendario'));
  el.append(row, h('p', { class: 'tiny muted' }, 'Una PWA no puede garantizar alarmas a hora exacta con la app cerrada. Para máxima confiabilidad, exporta tus fechas al calendario del teléfono (.ics con alarmas). Detalles en Ajustes → Notificaciones.'));
  return el;
}

export function downloadICS() {
  const { ics, count } = notify.exportICS();
  download(`lana-recordatorios-${store.today()}.ics`, ics, 'text/calendar');
  toast(`${count} recordatorios exportados. Ábrelo para agregarlos a tu calendario.`);
}

export function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Presupuestos ----------
export function budgetsView() {
  const s = monthSummary(S, store.ui.month);
  const b = structuredClone(S.settings.budgets || { layer: {}, category: {} });
  b.layer ||= {}; b.category ||= {};
  const root = h('div');
  const save = async () => { await store.setSettings({ budgets: b }); toast('Presupuesto guardado'); };
  root.append(card('🧅 Por capa (mensual)', LAYERS.map((l) => h('div', { style: { marginBottom: '12px' } },
    b.layer[l.id] ? budgetBar(`${l.icon} ${l.name}`, s.byLayer[l.id] || 0, b.layer[l.id], l.color) : h('div', { class: 'bold', style: { marginBottom: '6px' } }, `${l.icon} ${l.name} · gastado ${fmt(s.byLayer[l.id] || 0)}`),
    h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Sin presupuesto', value: b.layer[l.id] ? b.layer[l.id] / 100 : '', 'aria-label': `Presupuesto ${l.name}`,
      onchange: (e) => { const v = toCents(e.target.value); if (v > 0) b.layer[l.id] = v; else delete b.layer[l.id]; save(); } })))));
  const catCard = card('🏷️ Por micro-categoría');
  for (const [cid, lim] of Object.entries(b.category)) {
    const c = catById(cid); if (!c) continue;
    catCard.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, budgetBar(`${c.icon} ${c.name}`, s.byCategory[cid] || 0, lim, LAYERS.find((l) => l.id === c.layer)?.color)),
      h('button', { class: 'icon-btn', 'aria-label': `Quitar presupuesto ${c.name}`, onclick: () => { delete b.category[cid]; save(); } }, icon('x', 'sm'))));
  }
  let newCat = S.categories[0]?.id, newAmt = '';
  catCard.append(h('div', { class: 'grid2', style: { marginTop: '10px' } }, groupedCategorySelect(newCat, (v) => { newCat = v; }),
    h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Monto mensual', oninput: (e) => { newAmt = e.target.value; } })),
    h('button', { class: 'btn block', style: { marginTop: '8px' }, onclick: () => { const v = toCents(newAmt); if (!(v > 0)) { toast('Escribe un monto'); return; } b.category[newCat] = v; save(); } }, 'Agregar presupuesto'));
  root.append(catCard, h('p', { class: 'small muted' }, 'Recibes alerta al llegar al 80% y al rebasar el 100%.'));
  return root;
}

// ---------- Categorías ----------
export function categoriesView() {
  const root = h('div');
  root.append(h('p', { class: 'small text-2' }, 'Tres capas fijas; dentro, las micro-categorías que necesites. Mantén pocas: entre más simples, más rápido registras.'));
  for (const l of LAYERS) {
    const list = S.categories.filter((c) => c.layer === l.id);
    root.append(card(h('h2', null, h('i', { class: 'swatch', style: { background: l.color } }), `${l.icon} ${l.name}`, h('span', { class: 'spacer' }), h('small', null, `${list.length}`)),
      h('div', { class: 'chips wrap' }, list.map((c) => h('button', { class: 'chip', onclick: () => editCategory(c) }, h('span', { class: 'em' }, c.icon), c.name)),
        h('button', { class: 'chip', style: { borderStyle: 'dashed' }, onclick: () => editCategory({ layer: l.id, name: '', icon: '🏷️' }) }, '➕ Agregar'))));
  }
  return root;
}
function editCategory(c) {
  const x = { ...c };
  openSheet(c.id ? 'Editar categoría' : 'Nueva categoría', ({ close }) => h('div', null,
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Ícono'), h('input', { class: 'input', value: x.icon, maxlength: 4, oninput: (e) => { x.icon = e.target.value || '🏷️'; } })),
      h('label', { class: 'field' }, h('span', null, 'Capa'), selectEl(LAYERS.map((l) => [l.id, l.name]), x.layer, (v) => { x.layer = v; }))),
    h('label', { class: 'field' }, h('span', null, 'Nombre'), h('input', { class: 'input', value: x.name, oninput: (e) => { x.name = e.target.value; } })),
    h('button', { class: 'btn primary block', onclick: async () => { if (!x.name.trim()) return; await store.saveCategory({ ...x, id: x.id || uid('c_'), name: x.name.trim() }); close(); } }, 'Guardar categoría'),
    c.id ? h('button', { class: 'btn danger block', style: { marginTop: '8px' }, onclick: async () => {
      const used = S.transactions.filter((t) => t.categoryId === c.id).length;
      if (used) { toast(`Tiene ${used} movimientos. Cámbiale nombre o capa en lugar de borrarla.`); return; }
      if (await confirmSheet({ title: 'Eliminar categoría', message: `“${c.name}” no tiene movimientos.`, confirm: 'Eliminar categoría' })) { await store.deleteCategory(c.id); close(); }
    } }, 'Eliminar categoría') : null));
}

// ---------- Tipos de cuenta ----------
export function typesView() {
  return h('div', null, card('🏦 Tipos de cuenta', h('p', { class: 'small text-2' }, 'Crea los tipos que uses (monedero electrónico, vales de restaurante, caja de ahorro…). El comportamiento define cómo cuenta su saldo.'),
    h('div', { class: 'list', style: { boxShadow: 'none' } }, S.accountTypes.map((t) => h('div', { class: 'item' }, h('span', { class: 'ic' }, t.icon), h('span', { class: 'grow' }, h('div', { class: 't' }, t.name), h('div', { class: 's' }, ACCOUNT_KINDS[t.kind])),
      !t.builtin ? h('button', { class: 'icon-btn', 'aria-label': `Eliminar ${t.name}`, onclick: async () => {
        if (S.accounts.some((a) => a.typeId === t.id)) { toast('Hay cuentas con este tipo.'); return; }
        if (await confirmSheet({ title: 'Eliminar tipo', message: t.name, confirm: 'Eliminar tipo' })) await store.deleteAccountType(t.id);
      } }, icon('trash', 'sm')) : h('span', { class: 'badge' }, 'base')))),
    h('button', { class: 'btn primary block', style: { marginTop: '12px' }, onclick: () => newAccountType() }, '➕ Nuevo tipo de cuenta')));
}

// ---------- Respaldos ----------
export function backupView() {
  const last = S.settings.lastBackup;
  const root = h('div');
  root.append(card('💾 Respaldo completo (JSON)',
    h('p', { class: 'small text-2' }, `Incluye cuentas, movimientos, reglas, categorías y ajustes. ${last ? `Último respaldo: ${new Date(last).toLocaleString('es-MX')}.` : 'Aún no has hecho respaldo.'}`),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: exportJSON, 'data-testid': 'export-json' }, icon('download', 'sm'), 'Exportar JSON'),
      h('button', { class: 'btn', onclick: exportEncrypted }, icon('lock', 'sm'), 'Exportar cifrado')),
    h('div', { class: 'btn-row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => pickFile('.json,application/json', importJSON), 'data-testid': 'import-json' }, icon('upload', 'sm'), 'Importar / restaurar JSON'))));
  root.append(card('📄 Movimientos (CSV)',
    h('p', { class: 'small text-2' }, 'Para Excel o Google Sheets. Columnas: fecha (AAAA-MM-DD), tipo, monto, cuenta, cuenta_destino, capa, categoria, tipo_ingreso, concepto_ingreso, nota, etiquetas (separadas por |), estado.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => { download(`lana-movimientos-${store.today()}.csv`, toCSV(S), 'text/csv;charset=utf-8'); toast('CSV exportado'); }, 'data-testid': 'export-csv' }, icon('download', 'sm'), 'Exportar CSV'),
      h('button', { class: 'btn', onclick: () => pickFile('.csv,text/csv', importCSV), 'data-testid': 'import-csv' }, icon('upload', 'sm'), 'Importar CSV'))));
  root.append(card('🧪 Datos', h('div', { class: 'btn-row' },
    h('button', { class: 'btn', onclick: async () => { if (await confirmSheet({ title: 'Cargar datos de ejemplo', message: 'Reemplaza TODOS tus datos actuales por 6 meses de ejemplo. Haz un respaldo antes si tienes datos reales.', confirm: 'Reemplazar con ejemplo' })) { await store.loadDemo(); toast('Datos de ejemplo cargados'); } } }, 'Cargar ejemplo'),
    h('button', { class: 'btn danger', onclick: async () => { if (await confirmSheet({ title: 'Borrar todos los datos', message: 'Se eliminan cuentas, movimientos y reglas de este dispositivo. No se puede deshacer.', confirm: 'Borrar todo' })) { await store.wipe(); toast('Datos borrados'); location.hash = '#/inicio'; } } }, 'Borrar todo'))));
  return root;
}
function pickFile(accept, cb) {
  const input = h('input', { type: 'file', accept, style: { display: 'none' }, onchange: async () => { const f = input.files[0]; input.remove(); if (f) cb(await f.text(), f.name); } });
  document.body.append(input); input.click();
}
async function exportJSON() {
  download(`lana-respaldo-${store.today()}.json`, JSON.stringify(makeBackup(S), null, 1), 'application/json');
  await store.setSettings({ lastBackup: Date.now() });
  toast('Respaldo exportado');
}
async function exportEncrypted() {
  const pw = await promptSheet({ title: 'Respaldo cifrado', label: 'Contraseña (mínimo 8 caracteres)', type: 'password', confirm: 'Cifrar y exportar', hint: 'Si la olvidas no hay forma de recuperar el respaldo.' });
  if (!pw) return;
  if (pw.length < 8) { toast('La contraseña debe tener al menos 8 caracteres.'); return; }
  const enc = await encryptBackup(makeBackup(S), pw);
  download(`lana-respaldo-cifrado-${store.today()}.json`, JSON.stringify(enc), 'application/json');
  await store.setSettings({ lastBackup: Date.now() });
  toast('Respaldo cifrado exportado');
}
async function importJSON(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { toast('El archivo no es JSON válido.'); return; }
  if (obj.encrypted) {
    const pw = await promptSheet({ title: 'Respaldo cifrado', label: 'Contraseña del respaldo', type: 'password', confirm: 'Descifrar' });
    if (!pw) return;
    try { obj = await decryptBackup(obj, pw); } catch (e) { toast(e.message); return; }
  }
  const v = validateBackup(obj);
  if (!v.ok) { toast(v.errors.join(' ')); return; }
  let mode = 'merge';
  const ok = await confirmSheet({ title: 'Restaurar respaldo', danger: false, confirm: 'Restaurar',
    message: `Respaldo del ${new Date(obj.exportedAt).toLocaleString('es-MX')}: ${obj.counts?.transactions ?? obj.data.transactions?.length ?? 0} movimientos, ${obj.data.accounts?.length ?? 0} cuentas.`,
    options: h('div', { class: 'seg', style: { marginTop: '10px' } },
      ...[['merge', 'Combinar con lo actual'], ['replace', 'Reemplazar todo']].map(([m, l]) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: () => { mode = m; b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); } }, l);
        return b;
      })) });
  if (!ok) return;
  await store.replaceState(mergeBackup(S, obj, mode));
  toast(mode === 'replace' ? 'Datos restaurados' : 'Respaldo combinado');
}
async function importCSV(text) {
  const r = fromCSV(text, S);
  if (!r.transactions.length) { toast(r.errors[0] || (r.skipped ? 'Todos los movimientos ya existían.' : 'No se encontraron movimientos.')); return; }
  const ok = await confirmSheet({ title: 'Importar CSV', danger: false, confirm: `Importar ${r.transactions.length}`,
    message: `${r.transactions.length} movimientos nuevos${r.skipped ? `, ${r.skipped} ya existían` : ''}${r.newAccounts.length ? `, ${r.newAccounts.length} cuenta(s) nueva(s): ${r.newAccounts.map((a) => a.name).join(', ')}` : ''}${r.errors.length ? `. ${r.errors.length} línea(s) con error: ${r.errors.slice(0, 3).join(' ')}` : ''}.` });
  if (!ok) return;
  for (const a of r.newAccounts) await store.saveAccount(a);
  for (const c of r.newCategories) await store.saveCategory(c);
  await store.saveTxs(r.transactions);
  toast(`${r.transactions.length} movimientos importados`);
}

// ---------- Ajustes ----------
export function settingsView() {
  const st = S.settings;
  const n = st.notify || {};
  const root = h('div');
  const sw = (label, sub, checked, on) => h('label', { class: 'switch' }, h('span', null, h('b', null, label), sub ? h('div', { class: 'small muted' }, sub) : null), h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => on(e.target.checked) }));
  const setNotify = (k) => (v) => store.setSettings({ notify: { ...n, [k]: v } });

  // Notificaciones
  const notifCard = card('🔔 Notificaciones y recordatorios');
  notifCard.append(h('div', { class: 'small text-2', style: { marginBottom: '6px' } }, `Permiso: ${{ granted: '✅ concedido', denied: '⛔ bloqueado (cámbialo en los ajustes del navegador)', default: '⚪ pendiente', unsupported: '— no soportado' }[notify.permission()]}`));
  notifCard.append(
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Hora de aviso'), selectEl(Array.from({ length: 16 }, (_, i) => [i + 6, `${i + 6}:00`]), st.notifyHour ?? 9, (v) => store.setSettings({ notifyHour: +v }))),
      h('label', { class: 'field' }, h('span', null, 'Pagar TC (días antes)'), h('input', { class: 'input', type: 'number', min: 0, max: 25, value: st.defaultReminderDays ?? 6, onchange: (e) => store.setSettings({ defaultReminderDays: parseInt(e.target.value, 10) || 0 }) }), h('div', { class: 'hint' }, 'Para tarjetas sin valor propio.'))),
    sw('Fechas de pago de tarjetas', 'Sugerido, día anterior y día límite', n.cards !== false, setNotify('cards')),
    sw('Recordar registrar el pago', 'El día límite, si no lo has registrado', n.registerPayment !== false, setNotify('registerPayment')),
    sw('Gastos fijos próximos', 'Según los días de aviso de cada regla', n.recurring !== false, setNotify('recurring')),
    sw('Presupuesto 80% / 100%', null, n.budget !== false, setNotify('budget')),
    sw('Mostrar montos en notificaciones', 'Apágalo si no quieres cifras en la pantalla bloqueada', st.showAmountsInNotifications !== false, (v) => store.setSettings({ showAmountsInNotifications: v })),
    h('div', { class: 'btn-row' },
      notify.permission() === 'granted' ? h('button', { class: 'btn', onclick: () => notify.showNow('🔔 Prueba de Lana', 'Así se verán tus recordatorios.', { tag: 'test' }) }, 'Enviar prueba')
        : h('button', { class: 'btn primary', onclick: async () => { const p = await notify.requestPermission(); toast(p === 'granted' ? 'Notificaciones activadas' : 'Permiso no concedido'); store.setSettings({}); } }, 'Activar notificaciones'),
      h('button', { class: 'btn', onclick: downloadICS }, icon('calendar', 'sm'), 'Exportar .ics')),
    pushBlock(),
    limitsBlock());
  root.append(notifCard);

  // Seguridad
  root.append(securityCard());

  // Atajos
  const sc = st.shortcuts || [];
  root.append(card('⚡ Atajos de registro rápido', h('p', { class: 'small text-2' }, 'Aparecen arriba en el registro rápido: un toque y listo. Crea nuevos desde “Más detalles → Guardar como atajo”.'),
    sc.length ? h('div', { class: 'chips wrap' }, sc.map((s) => h('button', { class: 'chip preset', 'aria-label': `Eliminar atajo ${s.label}`, onclick: async () => {
      if (await confirmSheet({ title: 'Eliminar atajo', message: `${s.label} · ${fmt(s.amount)}`, confirm: 'Eliminar atajo' })) store.setSettings({ shortcuts: sc.filter((x) => x.id !== s.id) });
    } }, `${catById(s.categoryId)?.icon || '⚡'} ${s.label} ${fmt(s.amount)} ✕`))) : h('div', { class: 'small muted' }, 'Sin atajos.')));

  // Apariencia
  root.append(card('🎨 Apariencia', h('div', { class: 'seg' }, [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) =>
    h('button', { 'aria-pressed': String((st.theme || 'auto') === v), onclick: () => { store.setSettings({ theme: v }); applyTheme(v); } }, l)))));

  // Privacidad
  const priv = card('🛡️ Privacidad y almacenamiento',
    h('ul', { class: 'small text-2', style: { paddingLeft: '18px', margin: 0 } },
      h('li', null, 'Tus datos viven solo en este dispositivo (IndexedDB). No hay cuentas, nube ni servidores.'),
      h('li', null, 'Sin telemetría ni analíticas. La app no hace peticiones a terceros (CSP restrictiva).'),
      h('li', null, 'Lana no se conecta a bancos ni realiza pagos.'),
      h('li', null, 'Haz respaldos periódicos: si borras datos del navegador, se pierden.')));
  const storageEl = h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Calculando almacenamiento…');
  priv.append(storageEl);
  (async () => {
    try {
      const persisted = await navigator.storage?.persisted?.();
      const est = await navigator.storage?.estimate?.();
      storageEl.textContent = `Almacenamiento persistente: ${persisted ? 'sí ✅' : 'no (el navegador podría liberar espacio)'} · Usado: ${est ? (est.usage / 1024).toFixed(0) + ' KB' : '—'}`;
      if (!persisted) priv.append(h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Almacenamiento persistente activado' : 'El navegador no lo concedió (instala la app para mejorar la probabilidad).'); } }, 'Pedir almacenamiento persistente'));
    } catch { storageEl.textContent = ''; }
  })();
  root.append(priv);
  root.append(h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/respaldos' }, '💾 Respaldos'), h('a', { class: 'btn', href: '#/categorias' }, '🏷️ Categorías'), h('a', { class: 'btn', href: '#/tipos' }, '🏦 Tipos de cuenta')));
  return root;
}

function pushBlock() {
  const st = S.settings;
  let url = st.pushServer || '';
  return h('details', { class: 'more' }, h('summary', null, `Push con servidor propio (avanzado)${st.pushServer ? ' · activo' : ''}`),
    h('p', { class: 'small text-2' }, 'Push real con la app cerrada requiere un servidor. Puedes correr el servidor incluido (carpeta push-server/) en tu computadora o un VPS. Solo recibe fechas y textos de recordatorio, nunca tus movimientos.'),
    h('label', { class: 'field' }, h('span', null, 'URL del servidor (https)'), h('input', { class: 'input', value: url, placeholder: 'https://mi-servidor.ejemplo:8787', oninput: (e) => { url = e.target.value.trim(); } })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: async () => { try { await notify.subscribePush(url); toast('Suscrito a push ✓'); } catch (e) { toast(e.message); } } }, 'Suscribir'),
      st.pushServer ? h('button', { class: 'btn danger', onclick: async () => { await notify.unsubscribePush(); toast('Push desactivado'); } }, 'Desactivar') : null));
}

function limitsBlock() {
  const sup = notify.support();
  const box = h('details', { class: 'more' }, h('summary', null, 'Qué puede y qué no puede hacer una PWA'),
    h('ul', { class: 'small text-2', style: { paddingLeft: '18px' } },
      h('li', null, '✅ Alertas dentro de la app: siempre, offline.'),
      h('li', null, '✅ Notificación al abrir o volver a la app si hay avisos vencidos.'),
      h('li', null, `${sup.periodicSync ? '✅' : '⚠️'} Revisión en segundo plano (Periodic Background Sync): solo Chrome/Edge en Android con la app instalada; el sistema decide cuándo (≈1 vez al día). `, h('span', { 'data-ps': '' }, '')),
      h('li', null, '⚠️ Push con app cerrada: requiere servidor (opcional, incluido).'),
      h('li', null, '⛔ Alarma a hora exacta sin servidor: no garantizable. Usa el calendario (.ics).'),
      h('li', null, sup.ios ? '📱 iPhone: notificaciones solo con la app agregada a inicio (iOS 16.4+); sin sincronización periódica.' : '📱 iPhone: notificaciones solo con la app agregada a inicio (iOS 16.4+).')));
  notify.periodicSyncState().then((s) => { const el = box.querySelector('[data-ps]'); if (el) el.textContent = `Estado: ${s}.`; });
  return box;
}

function securityCard() {
  const sec = S.settings.security || {};
  const el = card('🔐 Seguridad');
  el.append(h('p', { class: 'small text-2' }, 'Bloquea la app con la biometría de tu dispositivo (Face ID / huella) o un PIN. Es una barrera local: para proteger archivos de respaldo, usa “Exportar cifrado”.'));
  const row = h('div', { class: 'stack' });
  lock.biometricAvailable().then((ok) => {
    row.prepend(sec.biometric
      ? h('div', { class: 'row' }, h('span', { class: 'grow' }, '✅ Biometría activa'), h('button', { class: 'btn sm', onclick: () => store.setSettings({ security: { ...sec, biometric: false, credId: null } }) }, 'Desactivar'))
      : h('button', { class: 'btn block', disabled: !ok, onclick: async () => { try { await lock.enrollBiometric(); toast('Biometría activada'); } catch (e) { toast('No se pudo activar: ' + (e.message || e.name)); } } }, icon('finger', 'sm'), ok ? 'Activar biometría' : 'Biometría no disponible en este dispositivo'));
  });
  row.append(sec.pinHash
    ? h('div', { class: 'row' }, h('span', { class: 'grow' }, '✅ PIN activo'), h('button', { class: 'btn sm', onclick: async () => { const p = await askPin(); if (p) { await lock.setPin(p); toast('PIN actualizado'); } } }, 'Cambiar'),
      h('button', { class: 'btn sm danger', onclick: () => store.setSettings({ security: { ...sec, pinHash: null, pinSalt: null } }) }, 'Quitar'))
    : h('button', { class: 'btn block', onclick: async () => { const p = await askPin(); if (p) { await lock.setPin(p); toast('PIN activado'); } } }, icon('lock', 'sm'), 'Crear PIN (4–6 dígitos)'));
  row.append(h('label', { class: 'field' }, h('span', null, 'Bloquear al salir después de'), selectEl([[0, 'Inmediatamente'], [1, '1 minuto'], [5, '5 minutos'], [15, '15 minutos']], sec.autoLockMin ?? 1, (v) => store.setSettings({ security: { ...sec, autoLockMin: +v } }))));
  el.append(row);
  return el;
}
async function askPin() {
  const p1 = await promptSheet({ title: 'Nuevo PIN', label: 'PIN de 4 a 6 dígitos', type: 'password', confirm: 'Continuar' });
  if (!p1) return null;
  if (!/^\d{4,6}$/.test(p1)) { toast('El PIN debe tener de 4 a 6 dígitos.'); return null; }
  const p2 = await promptSheet({ title: 'Confirma tu PIN', label: 'Escríbelo de nuevo', type: 'password', confirm: 'Guardar PIN' });
  if (p1 !== p2) { toast('Los PIN no coinciden.'); return null; }
  return p1;
}

export function applyTheme(v = S.settings.theme || 'auto') {
  if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = v;
  const dark = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0f0e' : '#f3f3f1');
}
void monthKey;
