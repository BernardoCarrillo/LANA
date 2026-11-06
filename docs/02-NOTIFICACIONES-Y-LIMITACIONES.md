# Notificaciones, alertas y limitaciones reales

Lana **no promete alarmas exactas que una PWA no puede garantizar**. Este documento dice qué funciona,
dónde y con qué condiciones.

## Qué se avisa

| Aviso | Cuándo | Configurable |
|---|---|---|
| 💳 "Hoy toca pagar {tarjeta}" | Fecha límite − N días (6 por defecto; por tarjeta y global) | Sí |
| ⚠️ "Mañana vence {tarjeta}" | Día anterior a la fecha límite | Sí (tipo "Fechas de pago") |
| 📌 "Hoy vence… ¿ya registraste tu pago?" | Día límite, si no se registró pago del estado de cuenta | Sí ("Recordar registrar el pago") |
| 🔁 Gasto/ingreso fijo próximo | Fecha − días de aviso de cada regla | Sí, por regla |
| ⏳ Fijos por confirmar | Al abrir la app, si hay pendientes | Sí |
| 🎯 Presupuesto al 80% / 100% | En cuanto ocurre (una vez por mes y umbral) | Sí |
| ✂️ "Mañana corta {tarjeta}" | Solo en el centro de alertas | — |

En cuanto registras el pago de una tarjeta, los recordatorios de ese ciclo desaparecen (el calendario
se recalcula con cada cambio).

Hora de aviso configurable (6:00–21:00). Opción para **ocultar montos** en la pantalla bloqueada.

## Cómo se entregan (de más a menos confiable)

| Mecanismo | Funciona con la app cerrada | Plataformas | Implementación |
|---|---|---|---|
| **Calendario `.ics` con alarmas** (Ajustes → Exportar .ics / Alertas → Agregar a mi calendario) | ✅ Sí, a la hora exacta | iOS Calendario, Google Calendar, Outlook | `src/core/ics.js`, eventos con `VALARM`. Reexporta cuando cambies tarjetas o reglas. *Google Calendar ignora las alarmas de archivos importados: usa la notificación predeterminada del calendario.* |
| **Push con servidor propio** (`push-server/`) | ✅ Sí (minuto a minuto) | Chrome/Edge/Firefox; Safari iOS 16.4+ con la app en inicio | Push API + VAPID. El servidor solo guarda {fecha, título, texto} |
| **Periodic Background Sync** | ⚠️ A veces (~1 vez al día; el sistema decide) | Solo Chromium Android/escritorio con la PWA **instalada** | `sw.js` evento `periodicsync` lee el calendario de IndexedDB |
| **Al abrir / volver a la app** | — | Todas | `notify.sync()` muestra lo vencido vía Service Worker |
| **Temporizadores con la app abierta** | — | Todas | Avisos de las próximas 24 h mientras la app esté en primer plano |
| **Centro de alertas in-app** | — | Todas, offline | `computeAlerts()` |

### Limitaciones que NO se pueden saltar
- Sin servidor, **no existe Push verdadero**: el navegador no despierta una web a una hora fija.
- *Notification Triggers* (alarmas locales programadas) fue un experimento de Chrome abandonado; no se usa.
- **iPhone/iPad**: notificaciones web solo si la app se agregó a la pantalla de inicio (iOS 16.4+) y el usuario concedió permiso desde un toque. iOS no soporta Periodic Background Sync → usa `.ics` o el servidor push.
- Los navegadores pueden **borrar datos** de sitios poco usados. Lana pide almacenamiento persistente; aun así, haz respaldos.

## Recomendación para tu caso (pagas 6 días antes)
1. Instala Lana en la pantalla de inicio.
2. Da de alta tus tarjetas con día de corte y día límite (aviso = 6 días, ya viene por defecto).
3. Exporta el `.ics` a tu calendario: tendrás alarmas exactas a las 9:00 en la fecha sugerida y un día antes del límite.
4. (Opcional) Activa notificaciones y/o el servidor push.

## Servidor push opcional
```bash
cd push-server
npm install
PORT=8787 ALLOWED_ORIGIN=https://tu-dominio-de-lana VAPID_SUBJECT=mailto:tu@correo npm start
```
Ponlo detrás de HTTPS (Caddy, Nginx, Cloudflare Tunnel o Tailscale Funnel). En Lana: Ajustes →
Notificaciones → *Push con servidor propio* → URL → Suscribir. Cada cambio en tus datos reenvía el
calendario (solo fechas y textos; si apagas "Mostrar montos", tampoco viajan cifras).
