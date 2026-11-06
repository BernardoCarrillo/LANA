// Envoltorio mínimo de IndexedDB. Base 'lana-db'. El Service Worker lee 'kv' (calendario de avisos).
export const DB_NAME = 'lana-db';
export const DB_VERSION = 1;
export const STORES = ['accounts', 'accountTypes', 'categories', 'transactions', 'recurring', 'reconciliations'];

let dbp;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) {
        const os = db.createObjectStore(s, { keyPath: 'id' });
        if (s === 'transactions') { os.createIndex('date', 'date'); os.createIndex('recurringId', 'recurringId'); }
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
  return dbp;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transacción abortada')); });
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}
export async function putMany(store, items) {
  if (!items.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const it of items) os.put(it);
  return done(tx);
}
export const put = (store, item) => putMany(store, [item]);
export async function delMany(store, ids) {
  if (!ids.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  for (const id of ids) tx.objectStore(store).delete(id);
  return done(tx);
}
export const del = (store, id) => delMany(store, [id]);
export async function kvGet(key) {
  const db = await openDB();
  const r = await reqP(db.transaction('kv').objectStore('kv').get(key));
  return r ? r.value : undefined;
}
export async function kvSet(key, value) {
  const db = await openDB();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put({ key, value });
  return done(tx);
}
/** Reemplaza TODO el contenido (restaurar respaldo) en una sola transacción atómica. */
export async function replaceAll(state) {
  const db = await openDB();
  const tx = db.transaction([...STORES, 'kv'], 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    for (const it of state[s] || []) os.put(it);
  }
  tx.objectStore('kv').put({ key: 'settings', value: state.settings || {} });
  return done(tx);
}
