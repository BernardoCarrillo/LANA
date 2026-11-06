// Arranque, router por hash y shell (barra superior, navegación inferior, botón +).
import * as store from './data/store.js';
import { h, frag, icon } from './ui/h.js';
import { bindChartTips } from './ui/charts.js';
import { openTxSheet } from './ui/quickadd.js';
import { toast, sheetsOpen } from './ui/sheet.js';
import { monthLabel, shiftMonth, monthKey } from './core/dates.js';
import { computeAlerts } from './core/alerts.js';
import { dashboardView } from './ui/views/dashboard.js';
import { transactionsView } from './ui/views/transactions.js';
import { accountsView, accountDetailView } from './ui/views/accounts.js';
import { recurringView, openRuleForm } from './ui/views/recurring.js';
import { debtsView } from './ui/views/debts.js';
import { reportsView } from './ui/views/reports.js';
import { moreView, alertsView, budgetsView, categoriesView, typesView, backupView, settingsView, applyTheme } from './ui/views/settings.js';
import * as notify from './platform/notify.js';
import * as lock from './platform/lock.js';

const ROUTES = {
  inicio: { title: 'Lana', view: dashboardView, month: true, tab: 'inicio' },
  movimientos: { title: 'Movimientos', view: transactionsView, month: true, tab: 'movimientos' },
  cuentas: { title: 'Cuentas', view: accountsView, tab: 'cuentas' },
  cuenta: { title: 'Cuenta', view: (p) => accountDetailView(p.id), back: '#/cuentas', tab: 'cuentas' },
  mas: { title: 'Más', view: moreView, tab: 'mas' },
  fijos: { title: 'Gastos fijos', view: recurringView, back: '#/mas', tab: 'mas', action: () => openRuleForm() },
  deudas: { title: 'Deudas y tarjetas', view: debtsView, back: '#/mas', tab: 'mas' },
  reportes: { title: 'Reportes', view: reportsView, month: true, back: '#/mas', tab: 'mas' },
  alertas: { title: 'Alertas', view: alertsView, back: '#/inicio', tab: 'inicio' },
  presupuestos: { title: 'Presupuestos', view: budgetsView, month: true, back: '#/mas', tab: 'mas' },
  categorias: { title: 'Categorías', view: categoriesView, back: '#/mas', tab: 'mas' },
  tipos: { title: 'Tipos de cuenta', view: typesView, back: '#/cuentas', tab: 'cuentas' },
  respaldos: { title: 'Respaldos', view: backupView, back: '#/mas', tab: 'mas' },
  ajustes: { title: 'Ajustes', view: settingsView, back: '#/mas', tab: 'mas' },
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [path, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const parts = path.split('/');
  if (parts[0] === 'cuentas' && parts[1]) return { name: 'cuenta', params: { ...params, id: decodeURIComponent(parts[1]) } };
  return { name: ROUTES[parts[0]] ? parts[0] : 'inicio', params };
}

const appEl = document.getElementById('app');
const topbar = h('header', { class: 'topbar' });
const main = h('main', { id: 'view', tabindex: '-1' });
const nav = h('nav', { class: 'bottomnav', 'aria-label': 'Navegación principal' });
let lastKey = null;
let installPrompt = null;

function navLink(tab, href, ico, label, current) {
  return h('a', { href, 'aria-current': current === tab ? 'page' : null }, icon(ico), label);
}
function drawNav(current) {
  nav.replaceChildren(frag(
    navLink('inicio', '#/inicio', 'home', 'Inicio', current),
    navLink('movimientos', '#/movimientos', 'list', 'Movimientos', current),
    h('button', { class: 'fab', 'aria-label': 'Registrar movimiento (N)', 'data-testid': 'fab', onclick: () => openTxSheet() }, icon('plus')),
    navLink('cuentas', '#/cuentas', 'wallet', 'Cuentas', current),
    navLink('mas', '#/mas', 'grid', 'Más', current)));
}

function drawTopbar(route) {
  const alerts = store.state.accounts.length ? computeAlerts(store.state, store.today()) : [];
  const urgent = alerts.filter((a) => a.severity !== 'info').length;
  const title = route.name === 'cuenta' ? (store.state.accounts.find((a) => a.id === route.params.id)?.name || 'Cuenta') : ROUTES[route.name].title;
  const r = ROUTES[route.name];
  topbar.replaceChildren(frag(
    r.back ? h('a', { class: 'icon-btn', href: r.back, 'aria-label': 'Atrás' }, icon('back', 'sm')) : null,
    h('h1', null, title),
    r.month ? h('div', { class: 'month-picker', role: 'group', 'aria-label': 'Mes' },
      h('button', { 'aria-label': 'Mes anterior', onclick: () => setMonth(-1) }, icon('left', 'sm')),
      h('span', { 'aria-live': 'polite', onclick: () => { store.ui.month = monthKey(store.today()); render(false); } }, monthLabel(store.ui.month)),
      h('button', { 'aria-label': 'Mes siguiente', onclick: () => setMonth(1) }, icon('right', 'sm'))) : null,
    r.action ? h('button', { class: 'icon-btn', 'aria-label': 'Nuevo', onclick: r.action }, icon('plus', 'sm')) : null,
    installPrompt && !r.month ? h('button', { class: 'btn sm primary', onclick: install }, 'Instalar') : null,
    h('a', { class: 'icon-btn', href: '#/alertas', 'aria-label': `Alertas${urgent ? `: ${urgent} importantes` : ''}` }, icon('bell', 'sm'), urgent ? h('span', { class: 'dot' }, String(urgent)) : null)));
}
function setMonth(d) { store.ui.month = shiftMonth(store.ui.month, d); render(false); }

function render(fresh = true) {
  const route = parseHash();
  const key = location.hash;
  const isNew = fresh && key !== lastKey;
  const y = window.scrollY;
  drawTopbar(route);
  drawNav(ROUTES[route.name].tab);
  let content;
  try { content = ROUTES[route.name].view(route.params, isNew); }
  catch (e) { console.error(e); content = h('div', { class: 'empty' }, h('span', { class: 'em' }, '😵'), 'Algo salió mal al mostrar esta vista. Tus datos están a salvo.', h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, String(e.message))); }
  main.replaceChildren(content);
  if (isNew) { main.classList.remove('view-enter'); void main.offsetWidth; main.classList.add('view-enter'); window.scrollTo(0, 0); lastKey = key; }
  else window.scrollTo(0, y);
  if (isNew && route.params.quick) { history.replaceState(null, '', location.pathname + location.search + '#/' + route.name); setTimeout(() => openTxSheet({ kind: route.params.quick === 'income' ? 'income' : 'expense' }), 80); }
}

async function install() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === 'accepted') toast('¡Lana instalada! Ábrela desde tu pantalla de inicio.');
  render(false);
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const offerUpdate = (w) => toast('Hay una nueva versión de Lana', { action: 'Actualizar', timeout: 15000, onAction: () => w.postMessage({ type: 'skip-waiting' }) });
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
    });
    // Solo recarga cuando una versión NUEVA toma el control (no en la primera instalación).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'navigate' && e.data.url) location.hash = e.data.url; });
  } catch (e) { console.warn('Service Worker no registrado:', e); }
}

async function boot() {
  appEl.replaceChildren(topbar, main, nav);
  try { await store.init(); }
  catch (e) {
    main.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'em' }, '🗄️'), 'No se pudo abrir el almacenamiento local. ¿Estás en modo privado o sin espacio?', h('pre', { class: 'small' }, String(e.message || e))));
    return;
  }
  applyTheme();
  if (lock.lockEnabled()) await lock.showLock();
  lock.watchAutoLock();
  bindChartTips(document);
  render();
  window.addEventListener('hashchange', () => render(true));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  let dayChecked = store.today();
  store.subscribe((reason) => { if (reason === 'settings') applyTheme(); render(false); notify.scheduleSync(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (store.today() !== dayChecked) { dayChecked = store.today(); store.ui.month = monthKey(dayChecked); }
    await store.runRecurring();
    render(false);
    notify.sync();
  });
  document.addEventListener('keydown', (e) => {
    if (sheetsOpen() || e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === '+') { e.preventDefault(); openTxSheet(); }
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; render(false); });
  await registerSW();
  notify.sync();
  if (store.state.accounts.length) navigator.storage?.persist?.().catch(() => {});
}
boot();
