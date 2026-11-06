# Lana · Finanzas por capas 🇲🇽

PWA **local-first** de finanzas personales para México, mobile-first y muy visual.
Tarjetas de crédito (corte, límite, “pagar 6 días antes”), débito, efectivo, vales de despensa y gasolina,
gastos fijos automatizados, ingresos (salario, bonos, fondo de ahorro y otros con nombre), capas de gasto,
comparativos mes a mes, simulador de deuda, conciliación, alertas y respaldos.

> **Lana no ejecuta pagos, no se conecta a bancos y no promete pagos reales.** Pagas en la app de tu banco
> y aquí solo **registras** el pago para conciliar saldos.

## Arranque rápido
```bash
npm start          # http://localhost:5173  (Node 18+, sin dependencias)
npm test           # pruebas unitarias
npm run test:e2e   # pruebas E2E (requiere: pip install playwright && python -m playwright install chromium)
```
Abre la app y elige **“Explorar con datos de ejemplo”** o **“Agregar mi primera cuenta”**.

## Instalar en tu teléfono
La PWA necesita HTTPS. Opciones gratuitas:
- **GitHub Pages:** sube esta carpeta a un repo y activa *Pages → GitHub Actions*. El workflow
  `.github/workflows/ci-pages.yml` corre las pruebas y publica.
- **Netlify / Cloudflare Pages:** arrastra la carpeta (sin build; directorio raíz = esta carpeta).

Luego en **Android/Chrome**: menú → *Instalar app*. En **iPhone/Safari**: Compartir → *Agregar a inicio*.
Mantén presionado el ícono para los atajos *Gasto rápido*, *Registrar ingreso* y *Registrar pago de tarjeta*.

## Cómo se usa (lo esencial)
| Quiero… | Cómo |
|---|---|
| Registrar un gasto pequeño | **(+)** → categoría → **Guardar** (3 toques). Con atajo: **(+)** → “☕ Café $55” (2 toques) |
| Registrar el pago de una tarjeta | Cuentas → tarjeta → **Registrar pago** (sugiere “para no generar intereses” y el mínimo) |
| Mover dinero entre mis cuentas | (+) → **Transferir** (no cuenta como gasto) |
| Automatizar renta/servicios/salario | Más → **Gastos fijos** → Nueva regla (mensual, bimestral, quincenal, anual…) |
| Omitir o cambiar solo un mes | Gastos fijos → Próximas → **Editar / omitir** (solo esta) o **Editar toda la serie** |
| Cuadrar con mi banco | Tarjeta → **Conciliar** → captura el saldo del banco → intereses/comisiones o ajuste |
| Ver mi mes | Inicio: balance, capas, mes con mes, composición de ingresos, ritmo de gasto, mapa de calor |
| Avisos en el teléfono | Alertas → **Activar notificaciones** y **Agregar a mi calendario (.ics)** |
| Respaldar | Más → Respaldos → JSON (o cifrado) / CSV |

## Definiciones (para que los números cuadren)
- **Ingresos**: movimientos tipo ingreso (salario, bono, fondo de ahorro, otro con nombre).
- **Egresos**: todos los gastos (las 3 capas). **Gasto de consumo**: capas Esenciales + Estilo de vida.
- **Ahorro del mes** = ingresos − gasto de consumo. **Tasa de ahorro** = ahorro ÷ ingresos.
- **Balance** = ingresos − egresos. **Deuda** = saldo de tarjetas al cierre del mes.
- **Transferencias y pagos de tarjeta** solo mueven dinero entre tus cuentas: nunca son gasto ni ingreso.
- **Pendiente** no afecta saldos hasta que lo confirmas; **Conciliado** = coincide con tu banco.

## Documentación
- `docs/01-PRD-UX-ARQUITECTURA.md` — PRD, supuestos, flujos UX, modelo de datos y arquitectura.
- `docs/02-NOTIFICACIONES-Y-LIMITACIONES.md` — qué avisos llegan, cómo y en qué plataformas.
- `docs/03-QA-Y-PRUEBAS.md` — matriz de criterios de aceptación, hallazgos y pruebas manuales.

## Estructura
```
index.html  manifest.webmanifest  sw.js  css/  icons/
src/core/       lógica financiera pura (probada en Node)
src/data/       IndexedDB + estado
src/ui/         gráficas SVG, hojas, registro rápido, vistas
src/platform/   notificaciones, push, biometría/PIN
push-server/    servidor Web Push opcional (autohospedado)
tests/          unitarias (node:test) y E2E (Playwright)
```

## Privacidad y seguridad
Datos solo en tu dispositivo (IndexedDB), sin cuentas ni nube, sin telemetría, sin CDNs (CSP restrictiva).
Bloqueo con biometría del dispositivo (WebAuthn) o PIN (PBKDF2). El bloqueo es una barrera local: para
proteger archivos fuera de la app, usa **respaldo cifrado** (AES-GCM con contraseña).
Para pruebas existe el parámetro `?hoy=AAAA-MM-DD`, que fija la fecha “de hoy”.

## Licencia
MIT.
