// Notificaciones: lo que una PWA SÍ puede garantizar y lo que no (ver docs/02-NOTIFICACIONES.md).
//  1) Centro de alertas in-app (siempre).
//  2) Notificación del sistema al abrir / volver a la app (Service Worker showNotification).
//  3) Periodic Background Sync (Chromium + PWA instalada): el SW revisa el calendario ~1 vez al día.
//  4) Push API real con servidor propio opcional (VAPID).
//  5) Exportar .ics con alarmas (lo más confiable para hora exacta).
import { buildSchedule, computeAlerts } from '../core/alerts.js';
import { buildICS } from '../core/ics.js';
import * as store from '../data/store.js';

export const support = () => ({
  notifications: 'Notification' in window,
  serviceWorker: 'serviceWorker' in navigator,
  push: 'PushManager' in window,
  periodicSync: 'serviceWorker' in navigator && 'periodicSync' in (ServiceWorkerRegistration.prototype || {}),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
});
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const p = await Notification.requestPermission();
  if (p === 'granted') await sync();
  return p;
}

async function reg() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]); } catch { return null; }
}

export async function showNow(title, body, { tag, url = '#/alertas' } = {}) {
  if (permission() !== 'granted') return false;
  const r = await reg();
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url }, lang: 'es-MX' };
  if (r) await r.showNotification(title, opts); else new Notification(title, opts);
  return true;
}

let timers = [];
let syncTimer;
/** Recalcula el calendario de avisos, lo guarda para el SW y muestra lo vencido. Debounced. */
export function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 600); }

export async function sync() {
  const S = store.state;
  const today = store.today();
  const schedule = buildSchedule(S, today);
  await store.kv.set('schedule', schedule);

  // Presupuesto: avisos inmediatos una sola vez por id.
  const shown = new Set((await store.kv.get('shown')) || []);
  if (S.settings.notify?.budget !== false && permission() === 'granted') {
    for (const a of computeAlerts(S, today).filter((x) => x.type === 'budget')) {
      if (shown.has(a.id)) continue;
      await showNow(a.title, a.body, { tag: a.id, url: a.route });
      shown.add(a.id);
    }
    await store.kv.set('shown', [...shown].slice(-400));
  }

  const r = await reg();
  // Pide al SW mostrar lo que ya venció (misma lógica que periodicsync).
  r?.active?.postMessage({ type: 'check-schedule' });
  // Mientras la app está abierta: temporizadores para lo que vence en las próximas 24 h (mejor esfuerzo).
  timers.forEach(clearTimeout); timers = [];
  const now = Date.now();
  for (const e of schedule) {
    const ms = e.at - now;
    if (ms > 0 && ms < 864e5) timers.push(setTimeout(() => r?.active?.postMessage({ type: 'check-schedule' }), ms + 500));
  }
  // Periodic Background Sync (solo Chromium con PWA instalada y permiso).
  if (r && 'periodicSync' in r && permission() === 'granted') {
    try {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state === 'granted') await r.periodicSync.register('lana-reminders', { minInterval: 12 * 60 * 60 * 1000 });
    } catch { /* no soportado */ }
  }
  // Push opcional: reenvía el calendario al servidor propio del usuario.
  const pushUrl = S.settings.pushServer;
  if (pushUrl && r?.pushManager) {
    try {
      const sub = await r.pushManager.getSubscription();
      if (sub) await fetch(`${pushUrl.replace(/\/$/, '')}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, schedule }) });
    } catch { /* servidor no disponible: se reintenta en el siguiente cambio */ }
  }
  return schedule;
}

export async function periodicSyncState() {
  try {
    const r = await reg();
    if (!r || !('periodicSync' in r)) return 'no soportado';
    const tags = await r.periodicSync.getTags();
    return tags.includes('lana-reminders') ? 'activo' : 'inactivo (instala la app y concede permiso)';
  } catch { return 'no soportado'; }
}

// ---------- Push con servidor propio (opcional) ----------
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export async function subscribePush(serverUrl) {
  const base = serverUrl.replace(/\/$/, '');
  if (permission() !== 'granted' && (await requestPermission()) !== 'granted') throw new Error('Necesitas permitir notificaciones.');
  const r = await reg();
  if (!r?.pushManager) throw new Error('Este navegador no soporta Push API (en iPhone: instala la app en la pantalla de inicio, iOS 16.4+).');
  const res = await fetch(`${base}/vapidPublicKey`);
  if (!res.ok) throw new Error('No se pudo contactar al servidor push.');
  const key = (await res.text()).trim();
  const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
  const schedule = buildSchedule(store.state, store.today());
  const ok = await fetch(`${base}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, schedule }) });
  if (!ok.ok) throw new Error('El servidor rechazó la suscripción.');
  await store.setSettings({ pushServer: base });
  return true;
}
export async function unsubscribePush() {
  const r = await reg();
  const sub = await r?.pushManager?.getSubscription();
  const base = store.state.settings.pushServer;
  if (sub) {
    try { if (base) await fetch(`${base}/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* sin red */ }
    await sub.unsubscribe();
  }
  await store.setSettings({ pushServer: '' });
}

// ---------- Calendario .ics ----------
export function exportICS() {
  const S = store.state;
  const entries = buildSchedule(S, store.today(), { days: 370 });
  const ics = buildICS(entries, { hour: S.settings.notifyHour ?? 9 });
  return { ics, count: entries.length };
}
