// Bloqueo local con biometría del dispositivo (WebAuthn, autenticador de plataforma) y/o PIN.
// LIMITACIÓN: sin servidor, esto es una barrera de acceso a la interfaz; no cifra IndexedDB.
// Para proteger datos fuera de la app usa respaldos cifrados con contraseña.
import { h } from '../ui/h.js';
import * as store from '../data/store.js';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function biometricAvailable() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function enrollBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Lana · Finanzas', id: location.hostname },
      user: { id: rand(16), name: 'lana-local', displayName: 'Lana (este dispositivo)' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    },
  });
  const security = { ...(store.state.settings.security || {}), credId: b64(cred.rawId), biometric: true };
  await store.setSettings({ security });
}

export async function verifyBiometric() {
  const sec = store.state.settings.security || {};
  if (!sec.credId) return false;
  const assertion = await navigator.credentials.get({
    publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(sec.credId), transports: ['internal'] }], userVerification: 'required', timeout: 60000, rpId: location.hostname },
  });
  const flags = new Uint8Array(assertion.response.authenticatorData)[32];
  return (flags & 0x04) === 0x04; // UV: el usuario se verificó con biometría/PIN del dispositivo
}

async function hashPin(pin, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : rand(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return { salt: b64(salt), hash: b64(bits) };
}
export async function setPin(pin) {
  const { salt, hash } = await hashPin(pin);
  await store.setSettings({ security: { ...(store.state.settings.security || {}), pinSalt: salt, pinHash: hash } });
}
export async function checkPin(pin) {
  const sec = store.state.settings.security || {};
  if (!sec.pinHash) return false;
  return (await hashPin(pin, sec.pinSalt)).hash === sec.pinHash;
}
export async function disableLock() {
  await store.setSettings({ security: {} });
}
export const lockEnabled = () => { const s = store.state.settings.security || {}; return !!(s.pinHash || (s.biometric && s.credId)); };

let hiddenAt = 0, lockedEl = null;
export function watchAutoLock() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (lockEnabled() && hiddenAt && Date.now() - hiddenAt > (store.state.settings.security?.autoLockMin ?? 1) * 60000) showLock();
  });
}

/** Pantalla de bloqueo. Resuelve cuando se desbloquea. */
export function showLock() {
  if (lockedEl) return Promise.resolve();
  const sec = store.state.settings.security || {};
  return new Promise((resolve) => {
    let pin = '';
    const dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
    const err = h('div', { class: 'err', role: 'alert' });
    const drawDots = () => dots.replaceChildren(...Array.from({ length: 6 }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' })));
    const unlock = () => { lockedEl.remove(); lockedEl = null; resolve(); };
    const tryBio = async () => {
      err.textContent = '';
      try { if (await verifyBiometric()) unlock(); else err.textContent = 'No se pudo verificar.'; }
      catch { err.textContent = sec.pinHash ? 'Biometría cancelada. Usa tu PIN.' : 'Biometría cancelada. Intenta de nuevo.'; }
    };
    const press = async (k) => {
      if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 6) pin += k;
      drawDots();
      if (pin.length >= 4 && await checkPin(pin)) unlock();
      else if (pin.length === 6) { err.textContent = 'PIN incorrecto'; dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); pin = ''; drawDots(); }
    };
    lockedEl = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'App bloqueada' },
      h('img', { src: 'icons/icon-192.png', width: 72, height: 72, alt: '', style: { borderRadius: '22px' } }),
      h('h2', { style: { margin: 0 } }, 'Lana está bloqueada'),
      sec.pinHash ? h('div', null, dots, err) : err,
      sec.pinHash ? h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k ? h('button', { type: 'button', 'aria-label': k === '⌫' ? 'Borrar' : k, onclick: () => press(k) }, k) : h('span'))) : null,
      sec.biometric ? h('button', { class: 'btn', onclick: tryBio }, '🔓 Desbloquear con biometría') : null,
    );
    drawDots();
    document.body.append(lockedEl);
    if (sec.biometric) setTimeout(tryBio, 300);
  });
}
