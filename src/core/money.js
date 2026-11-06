// Dinero en CENTAVOS enteros. Nunca se hace aritmética con flotantes de pesos.

const fmtFull = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Convierte "1,234.50", "1234,5" (si no hay punto), 1234.5 o "$ 99" a centavos. */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  let s = String(value).trim().replace(/[$\s]/g, '').replace(/MXN/i, '');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');          // 1,234.50
  else if (s.includes(',') && !s.includes('.')) {
    // "1,234" (miles) vs "12,5" (decimal europeo)
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  const c = Math.round(n * 100);
  return negative ? -c : c;
}

export const fromCents = (c) => c / 100;

/** Pesos con decimales: $1,234.50 */
export function fmt(cents, { sign = false, decimals = true } = {}) {
  cents = cents || 0;
  const abs = Math.abs(cents) / 100;
  const out = (decimals && cents % 100 !== 0 ? fmtFull : fmtInt).format(abs);
  if (cents < 0) return '−' + out;
  if (sign && cents > 0) return '+' + out;
  return out;
}

/** Compacto para ejes: $12.5k, $1.2M */
export function fmtCompact(cents) {
  const v = Math.abs(cents / 100);
  const neg = cents < 0 ? '−' : '';
  if (v >= 1e6) return `${neg}$${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${neg}$${trim(v / 1e3)}k`;
  return `${neg}$${Math.round(v)}`;
}
const trim = (n) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

/** Decimal plano para CSV: 1234.50 */
export const toDecimalString = (cents) => (cents < 0 ? '-' : '') + (Math.abs(cents) / 100).toFixed(2);

export const pct = (x, digits = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '—');

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
