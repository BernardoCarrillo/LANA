# Lana · Finanzas por capas — Fase 1: PRD + UX + Arquitectura

> PWA de finanzas personales para México, mobile-first, local-first.
> **No ejecuta pagos, no se conecta a bancos y no promete pagos reales.** Los pagos de
> tarjeta se hacen en la app del banco; aquí solo se **registran** para conciliar saldos.

---

## 1. PRD (Product Manager)

### 1.1 Problema
El usuario tiene varias tarjetas de crédito, débito y vales (despensa, gasolina). Pierde
visibilidad de: cuánto gasta por capa, cuándo corta y cuándo vence cada tarjeta, qué gastos
fijos vienen, cómo se compone su ingreso (salario, bonos, fondo de ahorro) y cómo va mes con mes.

### 1.2 Objetivos y métricas de éxito
| Objetivo | Métrica |
|---|---|
| Registro sin fricción | Gasto pequeño en **≤ 3 toques** (con atajo: 2 toques) |
| Nunca pagar tarde | Aviso en la fecha sugerida (límite − 6 días por defecto) y el día límite |
| Datos confiables | Pagos de tarjeta y transferencias **nunca** cuentan como gasto |
| Visión mensual | Dashboard con comparación vs mes anterior y 6/12 meses |
| Privacidad | 0 peticiones de red a terceros; datos solo en el dispositivo |

### 1.3 Alcance MVP (todo implementado)
1. **Dashboard mensual** con selector de mes: balance, ingresos, egresos, gasto de consumo, ahorro,
   tasa de ahorro, deuda, gasto por capa (dona interactiva), presupuesto por capa, próximos pagos,
   comparación vs mes anterior (deltas), 6 meses ingresos vs egresos, composición de ingresos,
   evolución de deuda, ritmo de gasto diario acumulado vs mes anterior, mapa de calor del mes.
2. **Registro rápido** (hoja inferior con teclado numérico propio, chips de categoría y atajos).
3. **Cuentas y tarjetas** con tipos editables (efectivo, débito, crédito, vales de despensa,
   vales de gasolina, ahorro, inversión + los que el usuario cree). Crédito: límite, saldo,
   disponible, pago mínimo, tasa, día de corte, día límite, utilización, días restantes.
4. **Movimientos**: ingreso, egreso, transferencia, pago de tarjeta, ajuste. Estados
   pendiente/confirmado/conciliado. Búsqueda, filtros y etiquetas.
5. **Capas** con micro-categorías editables (≈ 30 predefinidas).
6. **Gastos/ingresos fijos** con reglas recurrentes, autogeneración idempotente, editar/omitir
   una ocurrencia o la serie, eliminar regla.
7. **Deudas y tarjetas**: simulación de pago, evolución de saldo y utilización, historial de
   pagos registrados, conciliación contra el saldo de la app del banco.
8. **Reportes**: tabla mes a mes (12 meses), composición de ingresos, reporte separado de vales.
9. **Alertas**: centro de alertas in-app + notificaciones del sistema (Service Worker,
   Notifications API, Periodic Background Sync, Push API con servidor opcional autohospedado)
   + exportación a calendario `.ics` con alarmas (el método más confiable en teléfono).
10. **Respaldos**: JSON (completo) y CSV (movimientos), exportar/importar, restaurar.
11. **Seguridad**: bloqueo con biometría (WebAuthn de plataforma) y/o PIN; sin telemetría.

### 1.4 Fuera de alcance (deliberadamente)
- Conexión a bancos, agregadores, open banking, scraping o ejecución de pagos.
- Sincronización en la nube entre dispositivos (se usa respaldo/restauración manual).
- Cálculo exacto de intereses del banco (se concilia contra el saldo real del estado de cuenta).

### 1.5 Supuestos documentados
| # | Supuesto |
|---|---|
| S1 | Moneda única **MXN**; montos guardados en **centavos enteros** para evitar errores de redondeo. |
| S2 | Las compras con tarjeta de crédito son **gasto en la fecha de compra** (devengado), no al pagar. |
| S3 | **Fecha límite** de un estado de cuenta = primer `díaLímite` posterior a la fecha de corte. Días 29–31 se ajustan al último día del mes. |
| S4 | Fecha sugerida de pago = fecha límite − **6 días** (configurable por tarjeta y globalmente). |
| S5 | Si la fecha límite cae en día inhábil, la app **no la mueve** (avisa antes; el usuario paga antes). |
| S6 | Pago mínimo: si el usuario captura el del estado de cuenta, se usa ese; si no, se **estima** como `max(% del saldo al corte, 1.25 % del límite)` y se marca como estimado. |
| S7 | **Gasto de consumo** = egresos de las capas *Esenciales* + *Estilo de vida*. **Egresos** = todos los movimientos tipo egreso (incluye capa *Ahorro/Inversión/Deuda*). **Ahorro del mes** = ingresos − gasto de consumo. **Tasa de ahorro** = ahorro / ingresos. **Balance (flujo neto)** = ingresos − egresos. |
| S8 | Transferencias y pagos de tarjeta solo mueven saldo entre cuentas propias: **no** son ingreso ni gasto. |
| S9 | Una transferencia a una cuenta de ahorro/inversión propia es transferencia (el dinero sigue siendo tuyo). Para registrar un ahorro que sale de tus cuentas (p. ej. aportación a afore voluntaria externa) se usa un egreso de la capa *Ahorro/Inversión/Deuda*. |
| S10 | Vales: saldo propio, sin deuda; se reportan aparte y no suman al "dinero disponible" líquido. |
| S11 | Ingresos tipificados: `salario` (recurrente), `bono` (extraordinario, con nombre libre), `fondo de ahorro` (anual) y `otro` (con nombre libre, p. ej. "Aguinaldo", "PTU", "Venta"). |
| S12 | Recurrentes se generan como **pendientes** por defecto (el usuario confirma con un toque); configurable a "confirmado automático". |
| S13 | El "fondo de ahorro del trabajo" se registra como ingreso del mes en que se recibe. |

---

## 2. UX/UI (Diseñador)

### 2.1 Principios
- **Pulgar primero**: navegación inferior; acción principal (+) al centro, al alcance del pulgar.
- **Cero formularios largos** para gastos pequeños: monto → categoría → guardar.
- **Visual y claro**: color por capa (Esenciales = azul, Estilo de vida = ámbar, Ahorro/Deuda = verde),
  cifras grandes, deltas con flecha y color, gráficas animadas, tarjetas con aspecto de tarjeta física.
- **Accesible**: contraste AA, objetivos táctiles ≥ 44 px, `prefers-reduced-motion`, modo oscuro automático.

### 2.2 Arquitectura de información
```
[Inicio]  [Movimientos]  [ + ]  [Cuentas]  [Más]
                                            ├─ Gastos fijos
                                            ├─ Deudas y tarjetas
                                            ├─ Reportes (mes a mes, ingresos, vales)
                                            ├─ Alertas
                                            ├─ Presupuestos
                                            ├─ Categorías y tipos de cuenta
                                            ├─ Respaldos
                                            └─ Seguridad y notificaciones
```

### 2.3 Flujo crítico: gasto pequeño (≤ 3 toques)
```
Toque 1: botón (+)          → abre hoja con teclado numérico (monto enfocado),
                              cuenta = última usada, fecha = hoy, estado = confirmado
(teclear monto: 5 5)        → entrada de datos, no navegación
Toque 2: chip "☕ Café"       → categorías ordenadas por uso
Toque 3: "Guardar"           → toast con "Deshacer"
```
**Atajo (2 toques):** (+) → chip de atajo "☕ Café · $55" guarda directo (con Deshacer).
También existe el atajo del ícono de la app (mantener presionado → "Gasto rápido").

### 2.4 Flujo: registrar pago de tarjeta (hecho en la app del banco)
Cuentas → tarjeta → **Registrar pago** → la hoja llega prellenada como *Pago de tarjeta*
con el monto "para no generar intereses" sugerido y la cuenta de origen habitual → Guardar.
El texto de la hoja dice explícitamente: *"Registra aquí el pago que ya hiciste en la app de tu banco."*

### 2.5 Flujo: conciliación
Tarjeta → **Conciliar** → capturas el saldo que muestra tu banco → la app muestra la
diferencia → opciones: *registrar como intereses/comisiones (gasto)* o *ajuste (no es gasto)* →
los movimientos hasta esa fecha pasan a **conciliado**.

### 2.6 Recurrentes: editar/omitir
Cada ocurrencia (generada o futura) ofrece: **Solo esta** (editar monto/fecha u omitir) o
**Toda la serie** (editar regla; se aplica a ocurrencias futuras y pendientes). Eliminar regla
pregunta si también borra las ocurrencias pendientes (las confirmadas se conservan).

---

## 3. Arquitectura (Ingeniería frontend + PWA)

### 3.1 Decisiones
| Decisión | Motivo |
|---|---|
| **Vanilla JS (ES Modules), sin build** | Cero dependencias en runtime, carga instantánea, fácil de auditar y de hospedar en cualquier servidor estático. |
| **IndexedDB** + estado en memoria | Datos pequeños (miles de movimientos); lectura en memoria = UI instantánea; escritura *write-through*. |
| **Núcleo puro (`src/core`)** | Toda la lógica financiera es pura y se prueba en Node (`node --test`) sin navegador. |
| **Gráficas SVG propias** | Sin CDN (funciona offline), animadas, ligeras, temables con CSS. |
| **Service Worker clásico** | Precache *cache-first* del app shell, notificaciones, `periodicsync`, `push`. |
| **Centavos enteros** | Exactitud contable. |

### 3.2 Estructura
```
index.html, manifest.webmanifest, sw.js, icons/
css/app.css
src/
  app.js                 arranque, router por hash, render
  core/                  ← lógica pura, probada en Node
    money.js  dates.js  categories.js  ledger.js  cards.js
    recurring.js  debt.js  alerts.js  csv.js  backup.js  ics.js  ids.js
  data/db.js             wrapper IndexedDB
  data/store.js          estado + acciones (persisten y re-renderizan)
  ui/h.js                micro-helper DOM
  ui/charts.js           dona, barras agrupadas/apiladas, líneas, anillos, heatmap
  ui/sheet.js            hojas inferiores, toasts, diálogos
  ui/quickadd.js         registro rápido
  ui/views/*.js          dashboard, movimientos, cuentas, fijos, deudas, reportes, alertas, ajustes
  platform/notify.js     permisos, programación de notificaciones, push opcional
  platform/lock.js       biometría WebAuthn + PIN (PBKDF2)
tests/                   unitarios (node:test) + e2e (Playwright)
push-server/             servidor Web Push opcional y autohospedado
```

### 3.3 Modelo de datos (IndexedDB `lana-db`)
```js
Account      { id, name, typeId, color, icon, openingBalance /*centavos, con signo*/, openingDate,
               archived, credit?: { limit, cutDay, dueDay, apr, minPct, minPaymentOverride,
               reminderDaysBefore } }
AccountType  { id, name, kind: 'asset'|'credit'|'voucher', icon }
Category     { id, layer: 'essentials'|'lifestyle'|'savings', name, icon }
Transaction  { id, kind: 'income'|'expense'|'transfer'|'card_payment'|'adjustment',
               amount /*centavos>0; ajuste con signo*/, date 'YYYY-MM-DD', accountId,
               toAccountId?, categoryId?, incomeType?: 'salary'|'bonus'|'savings_fund'|'other',
               incomeLabel?, note, tags[], status: 'pending'|'confirmed'|'reconciled',
               recurringId?, occurrenceDate?, createdAt, updatedAt }
Recurring    { id, name, kind, amount, accountId, toAccountId?, categoryId?, incomeType?,
               incomeLabel?, freq: 'months'|'weeks'|'semimonthly', interval, startDate,
               endDate?, noticeDays, autoConfirm, active,
               exceptions: { 'YYYY-MM-DD': { skip?: true, amount?, date? } } }
Reconciliation { id, accountId, date, bankBalance, appBalance, diff, resolution }
settings     { key → value }  (presupuestos, preferencias, seguridad, atajos, horario de avisos)
```
**Idempotencia de recurrentes:** el id de cada ocurrencia es determinista
`r:<reglaId>:<fechaOriginal>`. Generar dos veces escribe el mismo registro (sin duplicados).
Borrar una ocurrencia generada crea una excepción `skip` para que no se regenere.

### 3.4 Saldos
Todos los saldos tienen signo (activo positivo; deuda negativa).
`saldo = saldoInicial + Σ entradas − Σ salidas` (ingresos, egresos, transferencias in/out, pagos, ajustes).
Crédito: `deuda = max(0, −saldo)`, `disponible = límite + saldo`, `utilización = deuda / límite`.

### 3.5 Ciclo de tarjeta
- Corte vigente = último `díaCorte` ≤ hoy. Siguiente corte = siguiente `díaCorte` > hoy.
- Fecha límite de un corte C = primer `díaLímite` > C (mismo mes si `díaLímite > díaCorte`, si no el siguiente).
- **Saldo al corte** = saldo con movimientos hasta C. **Pago para no generar intereses** ≈ saldo al corte − pagos registrados después de C.
- **Días restantes** = diferencia en días calendario (zona horaria local, sin horas).

### 3.6 Notificaciones (límites reales, ver `docs/02-NOTIFICACIONES.md`)
1. **Centro de alertas in-app**: siempre funciona, offline.
2. **Notificación del sistema al abrir/volver a la app** vía Service Worker.
3. **Periodic Background Sync** (Chrome/Edge Android con la PWA instalada): el SW revisa
   ~1 vez al día un calendario de avisos precalculado y guardado en IndexedDB. *El navegador decide la frecuencia.*
4. **Push API** real con **servidor opcional autohospedado** (`push-server/`, VAPID). Sin servidor no existe push verdadero.
5. **Calendario `.ics`** con alarmas: la forma **más confiable** de tener recordatorios a una hora exacta en iOS/Android.

### 3.7 Seguridad y privacidad
- Sin analíticas, sin CDNs, sin fuentes externas, CSP restrictiva.
- `navigator.storage.persist()` para reducir el riesgo de que el navegador borre datos.
- Bloqueo con **WebAuthn** (Face ID/huella del dispositivo) o **PIN** (PBKDF2-SHA-256, 150 000 iteraciones).
  Limitación: sin servidor, el bloqueo es una **barrera de acceso local**, no cifrado de la base de datos;
  los respaldos pueden cifrarse con contraseña (AES-GCM).
