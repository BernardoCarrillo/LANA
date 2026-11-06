// Respaldo completo en JSON (opcionalmente cifrado con contraseña: PBKDF2 + AES-GCM, WebCrypto).
export const BACKUP_VERSION = 1;
export const COLLECTIONS = ['accounts', 'accountTypes', 'categories', 'transactions', 'recurring', 'reconciliations'];

export function makeBackup(state, now = new Date()) {
  const data = {};
  for (const c of COLLECTIONS) data[c] = state[c] || [];
  const { security, ...settings } = state.settings || {}; // nunca exporta el hash del PIN ni credenciales
  data.settings = settings;
  return { app: 'lana', version: BACKUP_VERSION, exportedAt: now.toISOString(), counts: Object.fromEntries(COLLECTIONS.map((c) => [c, data[c].length])), data };
}

export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['El archivo no es JSON válido.'] };
  if (obj.app !== 'lana') errors.push('El archivo no es un respaldo de Lana.');
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) errors.push('Versión de respaldo no compatible.');
  const d = obj.data || {};
  for (const c of COLLECTIONS) if (d[c] !== undefined && !Array.isArray(d[c])) errors.push(`"${c}" debe ser una lista.`);
  for (const t of d.transactions || []) {
    if (!t.id || !t.kind || !Number.isInteger(t.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) { errors.push(`Movimiento inválido: ${t.id || '(sin id)'}`); break; }
  }
  for (const a of d.accounts || []) if (!a.id || !a.name) { errors.push('Cuenta inválida en el respaldo.'); break; }
  return { ok: errors.length === 0, errors };
}

/**
 * Combina un respaldo con el estado actual.
 * mode 'replace': el respaldo sustituye todo. mode 'merge': une por id; gana el registro con updatedAt más reciente.
 */
export function mergeBackup(state, backup, mode = 'merge') {
  const d = backup.data;
  const out = {};
  for (const c of COLLECTIONS) {
    const incoming = d[c] || [];
    if (mode === 'replace') { out[c] = incoming; continue; }
    const map = new Map((state[c] || []).map((x) => [x.id, x]));
    for (const x of incoming) {
      const cur = map.get(x.id);
      if (!cur || (x.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(x.id, x);
    }
    out[c] = [...map.values()];
  }
  out.settings = mode === 'replace'
    ? { ...(d.settings || {}), security: state.settings?.security }
    : { ...(d.settings || {}), ...(state.settings || {}) };
  return out;
}

// ---------- Cifrado opcional ----------
const enc = new TextEncoder(), dec = new TextDecoder();
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 250000;

async function deriveKey(password, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(backup, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(backup)));
  return { app: 'lana', encrypted: true, version: BACKUP_VERSION, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

export async function decryptBackup(obj, password) {
  const key = await deriveKey(password, unb64(obj.salt), obj.iter || ITER);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado.');
  }
}
