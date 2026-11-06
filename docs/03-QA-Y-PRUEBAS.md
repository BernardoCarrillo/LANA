# Fase 3 · QA, pruebas y refinamiento

## Cómo correr las pruebas
```bash
npm test            # 37 pruebas unitarias del núcleo financiero (node:test, sin dependencias)
npm run test:e2e    # 28 verificaciones E2E en Chrome móvil (Playwright para Python)
```
El E2E levanta su propio servidor, simula un iPhone (390×844, táctil, es-MX, America/Mexico_City)
y fija la fecha con `?hoy=2026-11-06` para que corte/límite/días restantes sean deterministas.
Guarda capturas en `/tmp/lana-e2e/` (claro y oscuro).

## Matriz de criterios de aceptación

| Criterio | Cómo se verifica | Resultado |
|---|---|---|
| Se instala como PWA | Manifest (standalone, 192/512, maskable, shortcuts) + SW controlando la página | ✅ E2E |
| Funciona offline (registro y consulta) | `context.set_offline(True)` → recarga, consulta y registra un gasto | ✅ E2E |
| Todo el app shell en caché | El E2E compara cada archivo de `src/ css/ icons/` contra el precache de `sw.js` | ✅ E2E |
| Gasto pequeño en ≤ 3 toques | (+) → chip “Café” → Guardar (monto con el teclado propio). Atajo: 2 toques | ✅ E2E |
| Pago de tarjeta no aumenta gastos/egresos | Unitario + E2E: egresos y consumo idénticos antes/después; deuda baja | ✅ |
| Salario, bono, fondo de ahorro en ingresos | E2E registra los 4 tipos y valida `incomeByType` y conceptos nombrados | ✅ |
| Comparación mes con mes | Dashboard: tabla vs mes anterior + barras 6 meses; Reportes: 12 meses | ✅ visual |
| Transferencia no altera gastos | Unitario + E2E | ✅ |
| Recurrente sin duplicados, omitir/eliminar | Unitario (idempotencia, excepciones, editar serie) + E2E (recarga y re-ejecución) | ✅ |
| Corte/pago y días restantes correctos | Unitario (fin de mes, bisiesto, cruce de año) + E2E (corte 5, límite 25, hoy 6-nov → 19 días; sugerido 19-nov → 13 días) | ✅ |
| Gráficas se actualizan | E2E: la dona gana segmento y el balance cambia tras registrar | ✅ |
| Alertas configurables y documentadas | Ajustes → Notificaciones; `docs/02-…md`; E2E del calendario y `.ics` | ✅ |
| Exportación/importación | E2E: exporta JSON y CSV, borra todo, restaura JSON, reimporta CSV | ✅ |
| Respaldo cifrado | Unitario: AES-GCM ida y vuelta; contraseña incorrecta falla | ✅ |
| Sin errores de consola | E2E | ✅ |

## Hallazgos corregidos durante QA
1. **`replaceChildren(null)` pintaba "null"** en la barra superior → helper `frag()` que filtra nulos.
2. **Recarga en la primera instalación del SW** (`controllerchange`) → solo recarga si ya había una versión previa.
3. **El registro rápido no abría** (variable usada antes de inicializarse) → la hoja usa la referencia del `<dialog>` recibida.
4. **Monto sugerido + teclear concatenaba** (3000 → 30001000) → un monto prellenado se reemplaza al teclear, como texto seleccionado.
5. **Tarjeta nueva con deuda quedaba "sin saldo al corte"** → por defecto la deuda inicial se fecha en el último corte (editable).
6. **Botón Guardar fuera de pantalla** en el registro rápido → teclado y botón en un pie fijo; categorías en 2 filas desplazables.
7. Variables CSS (`--cc`) no se aplicaban vía `Object.assign(style)` → `style.setProperty`.
8. Tabla de reportes desbordaba en 390 px → montos compactos, columnas esenciales, solo meses con datos; tasa promedio ponderada.

## Pruebas manuales recomendadas en dispositivo real
- **Android (Chrome):** instalar → conceder notificaciones → Ajustes muestra “Revisión en segundo plano: activo”.
- **iPhone (Safari 16.4+):** Compartir → Agregar a inicio → abrir desde el ícono → activar notificaciones → enviar prueba.
- **Biometría:** Ajustes → Seguridad → Activar biometría → cerrar y volver tras 1 min.
- **Calendario:** Alertas → Agregar a mi calendario → abrir el `.ics` en el teléfono.

## Accesibilidad y rendimiento
- Objetivos táctiles ≥ 40–46 px, foco visible, `<dialog>` nativo (trampa de foco, Esc), `aria-pressed` en chips/segmentos, `role=alert` en errores.
- `prefers-reduced-motion` desactiva animaciones; tema oscuro con su propia paleta validada (no inversión automática).
- Paleta categórica validada con el verificador CVD (contraste < 3:1 en algunos tonos claros compensado con leyendas, etiquetas y tablas).
- Sin dependencias en runtime: ~285 KB de JS/CSS/HTML sin minificar; todo se sirve desde caché.
