// Fechas de calendario como cadenas 'YYYY-MM-DD' (sin horas ni zonas horarias),
// lo que hace exactos los cálculos de días restantes, cortes y límites.

const pad = (n) => String(n).padStart(2, '0');

export function parse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
export const make = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Normaliza año/mes desbordados (mes 13 → enero siguiente). */
function norm(y, m) {
  const t = y * 12 + (m - 1);
  return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const clampDay = (y, m, d) => Math.min(d, daysInMonth(y, m));

/** Fecha en el mes (y,m) con el día dado ajustado al fin de mes (31 → 30/28/29). */
export function dayIn(y, m, day) {
  const n = norm(y, m);
  return make(n.y, n.m, clampDay(n.y, n.m, day));
}

export function todayISO(now = new Date()) {
  return make(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const toUTC = (iso) => { const { y, m, d } = parse(iso); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => { const x = new Date(t); return make(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);
/** b − a en días (positivo si b es posterior). */
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export const weekday = (iso) => new Date(toUTC(iso)).getUTCDay(); // 0=domingo

/** Suma meses conservando el día ancla (31 ene + 1 mes = 28/29 feb; +2 = 31 mar). */
export function addMonths(iso, n, anchorDay) {
  const { y, m, d } = parse(iso);
  return dayIn(y, m + n, anchorDay ?? d);
}

export const monthKey = (iso) => iso.slice(0, 7);
export function monthStart(key) { return `${key}-01`; }
export function monthEnd(key) { const [y, m] = key.split('-').map(Number); return make(y, m, daysInMonth(y, m)); }
export function shiftMonth(key, n) { const [y, m] = key.split('-').map(Number); const r = norm(y, m + n); return `${r.y}-${pad(r.m)}`; }
/** Últimos n meses terminando en key (inclusive), del más antiguo al más reciente. */
export function lastMonths(key, n) {
  return Array.from({ length: n }, (_, i) => shiftMonth(key, i - n + 1));
}
export const inMonth = (iso, key) => iso.startsWith(key);

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}
export const monthShort = (key) => MONTHS[Number(key.slice(5, 7)) - 1];
export function dateLabel(iso, { weekday: wd = false, year = false } = {}) {
  const { y, m, d } = parse(iso);
  return `${wd ? DAYS[weekday(iso)] + ' ' : ''}${d} ${MONTHS[m - 1]}${year ? ' ' + y : ''}`;
}

/** "hoy", "mañana", "en 5 días", "hace 2 días" */
export function relativeDays(n) {
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}

// ---------- Ciclo de tarjeta de crédito ----------

/** Último día de corte <= fecha. */
export function cutOnOrBefore(iso, cutDay) {
  const { y, m } = parse(iso);
  const here = dayIn(y, m, cutDay);
  return here <= iso ? here : dayIn(y, m - 1, cutDay);
}
/** Siguiente día de corte > fecha. */
export function cutAfter(iso, cutDay) {
  const { y, m } = parse(iso);
  const here = dayIn(y, m, cutDay);
  return here > iso ? here : dayIn(y, m + 1, cutDay);
}
/** Fecha límite de pago del estado de cuenta que corta en `cutIso`: primer díaLímite posterior al corte. */
export function dueForCut(cutIso, dueDay) {
  const { y, m } = parse(cutIso);
  const same = dayIn(y, m, dueDay);
  return same > cutIso ? same : dayIn(y, m + 1, dueDay);
}
