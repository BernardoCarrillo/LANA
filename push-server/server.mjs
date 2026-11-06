// Servidor Web Push OPCIONAL para Lana. Corre en tu computadora/VPS/Raspberry Pi.
// Solo recibe el calendario de recordatorios (fecha/hora, título y texto). Nunca movimientos ni saldos.
// Uso: npm install && PORT=8787 ALLOWED_ORIGIN=https://tu-dominio npm start  (ponlo detrás de HTTPS)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import webpush from 'web-push';

const PORT = Number(process.env.PORT || 8787);
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const CONTACT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
const DB = new URL('./subscriptions.json', import.meta.url);
const KEYS = new URL('./vapid.json', import.meta.url);

if (!existsSync(KEYS)) await writeFile(KEYS, JSON.stringify(webpush.generateVAPIDKeys(), null, 2));
const vapid = JSON.parse(await readFile(KEYS, 'utf8'));
webpush.setVapidDetails(CONTACT, vapid.publicKey, vapid.privateKey);

let subs = existsSync(DB) ? JSON.parse(await readFile(DB, 'utf8')) : {};
const save = () => writeFile(DB, JSON.stringify(subs));
const clean = (schedule) => (Array.isArray(schedule) ? schedule : []).slice(0, 500)
  .filter((e) => e && typeof e.at === 'number' && typeof e.title === 'string')
  .map((e) => ({ id: String(e.id).slice(0, 120), at: e.at, title: e.title.slice(0, 120), body: String(e.body || '').slice(0, 300), tag: String(e.tag || '').slice(0, 80), url: String(e.url || '#/alertas').slice(0, 80) }));

async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 256 * 1024) throw new Error('payload demasiado grande'); }
  return JSON.parse(raw || '{}');
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  try {
    if (req.method === 'GET' && req.url === '/vapidPublicKey') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end(vapid.publicKey);
    if (req.method === 'GET' && req.url === '/health') return res.writeHead(200).end(JSON.stringify({ ok: true, subscriptions: Object.keys(subs).length }));
    if (req.method === 'POST' && req.url === '/subscribe') {
      const { subscription, schedule } = await body(req);
      if (!subscription?.endpoint?.startsWith('https://')) return res.writeHead(400).end('suscripción inválida');
      subs[subscription.endpoint] = { subscription, schedule: clean(schedule), sent: subs[subscription.endpoint]?.sent || [] };
      await save(); return res.writeHead(201).end('ok');
    }
    if (req.method === 'POST' && req.url === '/schedule') {
      const { endpoint, schedule } = await body(req);
      if (!subs[endpoint]) return res.writeHead(404).end('no suscrito');
      subs[endpoint].schedule = clean(schedule); await save(); return res.writeHead(200).end('ok');
    }
    if (req.method === 'POST' && req.url === '/unsubscribe') {
      const { endpoint } = await body(req); delete subs[endpoint]; await save(); return res.writeHead(200).end('ok');
    }
    res.writeHead(404).end('no encontrado');
  } catch (e) { res.writeHead(400).end(String(e.message || e)); }
}).listen(PORT, () => console.log(`Lana push server en :${PORT} · clave pública: ${vapid.publicKey}`));

// Cada minuto envía lo que ya venció (ventana de 6 h para no mandar avisos viejos).
setInterval(async () => {
  const now = Date.now();
  let dirty = false;
  for (const [endpoint, s] of Object.entries(subs)) {
    const sent = new Set(s.sent);
    for (const e of s.schedule) {
      if (e.at > now || e.at < now - 6 * 3600e3 || sent.has(e.id)) continue;
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: e.title, body: e.body, tag: e.tag, url: e.url }), { TTL: 6 * 3600 });
        sent.add(e.id); dirty = true;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) { delete subs[endpoint]; dirty = true; break; }
        console.error('push error', err.statusCode, err.body);
      }
    }
    if (subs[endpoint]) s.sent = [...sent].slice(-500);
  }
  if (dirty) await save();
}, 60_000);
