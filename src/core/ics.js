// Exporta recordatorios a iCalendar (.ics) con alarmas. Es el método MÁS CONFIABLE para
// recibir avisos a una hora exacta en el teléfono (iOS Calendario, Google Calendar, Outlook).
import { parse } from './dates.js';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const pad = (n) => String(n).padStart(2, '0');

function fold(line) { // RFC 5545: máximo 75 octetos por línea (aprox. por caracteres)
  const out = [];
  let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
  out.push(s);
  return out.join('\r\n');
}

/** entries: [{id, date:'YYYY-MM-DD', title, body}] → texto .ics (hora local "flotante"). */
export function buildICS(entries, { hour = 9, calName = 'Lana · Recordatorios', stamp = new Date() } = {}) {
  const dtstamp = `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lana//Finanzas por capas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calName)}`];
  for (const e of entries) {
    const { y, m, d } = parse(e.date);
    const start = `${y}${pad(m)}${pad(d)}T${pad(hour)}0000`;
    const end = `${y}${pad(m)}${pad(d)}T${pad(hour)}1500`;
    lines.push('BEGIN:VEVENT', `UID:${esc(e.id)}@lana.local`, `DTSTAMP:${dtstamp}`, `DTSTART:${start}`, `DTEND:${end}`,
      `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.body || '')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
