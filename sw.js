/* Service Worker de Lana: offline (precache del app shell), notificaciones, periodicsync y push.
 * Clásico (no módulo) para máxima compatibilidad. Sube VERSION al publicar cambios. */
const VERSION = 'lana-v1.0.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/badge-96.png',
  'src/app.js',
  'src/core/alerts.js', 'src/core/backup.js', 'src/core/cards.js', 'src/core/categories.js', 'src/core/csv.js', 'src/core/dates.js',
  'src/core/debt.js', 'src/core/ics.js', 'src/core/ids.js', 'src/core/ledger.js', 'src/core/money.js', 'src/core/recurring.js', 'src/core/seed.js',
  'src/data/db.js', 'src/data/store.js',
  'src/platform/lock.js', 'src/platform/notify.js',
  'src/ui/charts.js', 'src/ui/h.js', 'src/ui/quickadd.js', 'src/ui/sheet.js',
  'src/ui/views/accounts.js', 'src/ui/views/common.js', 'src/ui/views/dashboard.js', 'src/ui/views/debts.js',
  'src/ui/views/recurring.js', 'src/ui/views/reports.js', 'src/ui/views/settings.js', 'src/ui/views/transactions.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
  if (event.data?.type === 'check-schedule') event.waitUntil(checkSchedule());
});

// Cache-first para el app shell (mismo origen); la red actualiza la caché en segundo plano.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nada de terceros
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put('index.html', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('index.html')) || (await cache.match('./')) || new Response('Sin conexión', { status: 503 });
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { event.waitUntil(net); return hit; }
    return (await net) || new Response('', { status: 504 });
  })());
});

// ---------- Recordatorios ----------
function idb() {
  return new Promise((resolve) => {
    const r = indexedDB.open('lana-db');
    r.onupgradeneeded = () => { r.transaction.abort(); resolve(null); }; // no crear una BD vacía desde el SW
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}
function kvGet(db, key) {
  return new Promise((resolve) => {
    try {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => resolve(q.result ? q.result.value : undefined);
      q.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
function kvSet(db, key, value) {
  return new Promise((resolve) => {
    try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ key, value }); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); }
    catch { resolve(); }
  });
}

/** Muestra los avisos del calendario que ya vencieron (máx. 3 días de antigüedad) y no se han mostrado. */
async function checkSchedule() {
  if (self.Notification && Notification.permission !== 'granted') return;
  const db = await idb();
  if (!db) return;
  const schedule = (await kvGet(db, 'schedule')) || [];
  const shown = new Set((await kvGet(db, 'shown')) || []);
  const now = Date.now();
  const due = schedule.filter((e) => e.at <= now && e.at > now - 3 * 864e5 && !shown.has(e.id));
  for (const e of due.slice(0, 5)) {
    await self.registration.showNotification(e.title, {
      body: e.body, tag: e.tag || e.id, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', lang: 'es-MX',
      data: { url: e.url || '#/alertas' },
      actions: e.kind === 'card' ? [{ action: 'pay', title: 'Registrar pago' }] : [],
    });
    shown.add(e.id);
  }
  await kvSet(db, 'shown', [...shown].slice(-400));
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'lana-reminders') event.waitUntil(checkSchedule());
});

// Push real (requiere el servidor opcional push-server/). Payload: {title, body, tag, url}
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = null;
    try { data = event.data ? event.data.json() : null; } catch { data = null; }
    if (data && data.title) {
      await self.registration.showNotification(data.title, { body: data.body, tag: data.tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: data.url || '#/alertas' } });
    } else {
      await checkSchedule();
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = event.notification.data?.url || '#/alertas';
  if (event.action === 'pay') url = '#/cuentas?pay=1';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); c.postMessage({ type: 'navigate', url }); return; }
    }
    await self.clients.openWindow('./' + url);
  })());
});
