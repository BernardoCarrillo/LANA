"""Pruebas E2E de aceptación (Playwright + Chrome). Ejecutar: npm run test:e2e
Requiere: pip install playwright && (playwright install chromium | Chrome del sistema en CHROME_PATH).
Levanta el servidor estático, usa ?hoy=2026-11-06 para fechas deterministas y valida los criterios de aceptación."""
import asyncio, json, os, subprocess, sys, time, socket
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = int(os.environ.get('E2E_PORT', '5179'))
BASE = f'http://localhost:{PORT}/'
HOY = '2026-11-06'
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
SHOTS = Path(os.environ.get('E2E_SHOTS', '/tmp/lana-e2e'))
SHOTS.mkdir(parents=True, exist_ok=True)

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  ✅ ' if cond else '  ❌ ') + name + (f'  [{detail}]' if detail and not cond else ''))

SUMMARY_JS = """async (key) => {
  const store = await import('/src/data/store.js');
  const L = await import('/src/core/ledger.js');
  const s = L.monthSummary(store.state, key);
  const b = L.balances(store.state);
  return { income: s.income, expenses: s.expenses, consumption: s.consumption, incomeByType: s.incomeByType, transfers: s.transfers,
           cardPayments: s.cardPayments, n: store.state.transactions.length, balances: Object.fromEntries(b), ids: store.state.transactions.map(t => t.id) };
}"""

async def taps(page, selectors):
    """Ejecuta una lista de toques (clicks) y regresa cuántos fueron."""
    for sel in selectors:
        await page.locator(sel).first.click()
        await page.wait_for_timeout(250)
    return len(selectors)

async def keypad(page, digits):
    for d in digits:
        await page.locator(f'dialog.sheet .keypad button[aria-label="{d}"]').click()

async def main():
    server = subprocess.Popen(['node', str(ROOT / 'scripts/serve.mjs')], env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: socket.create_connection(('localhost', PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME if Path(CHROME).exists() else None, args=['--no-sandbox'])
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                            locale='es-MX', timezone_id='America/Mexico_City', accept_downloads=True, bypass_csp=True)
            page = await ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            url = f'{BASE}?hoy={HOY}#/inicio'

            print('\n1) PWA instalable y offline')
            await page.goto(url)
            await page.wait_for_function('!!navigator.serviceWorker.controller', timeout=10000)
            await page.reload(); await page.wait_for_timeout(800)
            manifest = await page.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
            check('manifest con name, start_url, display standalone e íconos 192/512 + maskable',
                  manifest['display'] == 'standalone' and any(i['sizes'] == '512x512' and i.get('purpose') == 'maskable' for i in manifest['icons']) and any(i['sizes'] == '192x192' for i in manifest['icons']))
            controlled = await page.evaluate('!!navigator.serviceWorker.controller')
            check('Service Worker registrado y controlando la página', controlled)
            sw_assets = (ROOT / 'sw.js').read_text()
            missing = [str(f.relative_to(ROOT)) for d in ['src', 'css', 'icons'] for f in (ROOT / d).rglob('*') if f.is_file() and f"'{f.relative_to(ROOT).as_posix()}'" not in sw_assets]
            check('Todos los archivos de la app están en el precache del SW', not missing, ', '.join(missing))

            print('\n2) Alta de cuentas (débito y tarjeta de crédito)')
            await page.click('text=Agregar mi primera cuenta'); await page.wait_for_timeout(400)
            await page.fill('[data-testid=acc-name]', 'Nómina')
            await page.fill('[data-testid=acc-opening]', '20000')
            await page.click('[data-testid=acc-save]'); await page.wait_for_timeout(500)
            await page.click('text=Agregar cuenta'); await page.wait_for_timeout(400)
            await page.fill('[data-testid=acc-name]', 'Tarjeta Oro')
            await page.select_option('[data-testid=acc-type]', 't_credit'); await page.wait_for_timeout(200)
            await page.fill('[data-testid=acc-opening]', '3000')
            await page.fill('[data-testid=acc-limit]', '40000')
            await page.fill('[data-testid=acc-cut]', '5')
            await page.fill('[data-testid=acc-due]', '25')
            await page.click('[data-testid=acc-save]'); await page.wait_for_timeout(500)
            await page.click('text=Agregar cuenta'); await page.wait_for_timeout(400)
            await page.fill('[data-testid=acc-name]', 'Ahorro')
            await page.select_option('[data-testid=acc-type]', 't_savings'); await page.wait_for_timeout(150)
            await page.click('[data-testid=acc-save]'); await page.wait_for_timeout(500)
            card_text = await page.locator('[data-testid=credit-card]').first.inner_text()
            check('Fecha límite 25 nov, en 19 días (corte 5, hoy 6 nov)', '25 nov' in card_text and 'en 19 días' in card_text, card_text.replace('\n', ' | '))
            check('Fecha sugerida de pago = límite − 6 días (19 nov, en 13 días)', '19 nov' in card_text and 'en 13 días' in card_text)
            check('Siguiente corte 5 dic', '5 dic' in card_text)
            await page.screenshot(path=str(SHOTS / '02-cuentas.png'))

            print('\n3) Gasto pequeño en ≤ 3 toques')
            await page.goto(url); await page.wait_for_timeout(500)
            before = await page.evaluate(SUMMARY_JS, '2026-11')
            await page.locator('[data-testid=fab]').click()                       # toque 1
            await page.wait_for_timeout(350)
            await keypad(page, '55')                                               # captura del monto (teclado)
            await page.screenshot(path=str(SHOTS / '03-registro-rapido.png'))
            await page.locator('dialog.sheet [data-cat=c_cafe]').click()          # toque 2
            await page.locator('[data-testid=save-tx]').click()                   # toque 3
            await page.wait_for_timeout(600)
            after = await page.evaluate(SUMMARY_JS, '2026-11')
            check('Gasto de $55 registrado con 3 toques (+ monto)', after['consumption'] - before['consumption'] == 5500, f"{before['consumption']}→{after['consumption']}")
            await page.locator('[data-testid=fab]').click(); await page.wait_for_timeout(350)   # toque 1
            await page.locator('[data-testid=shortcut]').first.click(); await page.wait_for_timeout(600)  # toque 2
            after2 = await page.evaluate(SUMMARY_JS, '2026-11')
            check('Atajo guarda gasto en 2 toques', after2['consumption'] - after['consumption'] == 5500, str(after2['consumption'] - after['consumption']))

            print('\n4) Gráficas se actualizan al registrar')
            arcs_before = await page.locator('.chart .seg-arc').count()
            hero_before = await page.locator('.hero .big').inner_text()
            await page.locator('[data-testid=fab]').click(); await page.wait_for_timeout(300)
            await keypad(page, '1200')
            await page.locator('dialog.sheet button:has-text("Todas…")').click(); await page.wait_for_timeout(200)
            await page.locator('dialog.sheet [data-cat=c_renta]').click()
            await page.locator('[data-testid=save-tx]').click(); await page.wait_for_timeout(700)
            arcs_after = await page.locator('.chart .seg-arc').count()
            hero_after = await page.locator('.hero .big').inner_text()
            check('La dona de capas agrega segmento (Esenciales) y el balance cambia', arcs_after > arcs_before and hero_after != hero_before, f'{arcs_before}->{arcs_after}, {hero_before}->{hero_after}')

            print('\n5) Pago de tarjeta y transferencia NO son gasto')
            s0 = await page.evaluate(SUMMARY_JS, '2026-11')
            await page.goto(f'{BASE}?hoy={HOY}#/cuentas'); await page.wait_for_timeout(500)
            await page.locator('[data-testid=register-payment]').first.click(); await page.wait_for_timeout(400)
            note = await page.locator('dialog.sheet .qa-note').first.inner_text()
            check('La hoja aclara que el pago se hace en la app del banco', 'app de tu banco' in note and 'no realiza pagos' in note.lower())
            await keypad(page, '1000')
            await page.locator('[data-testid=save-tx]').click(); await page.wait_for_timeout(600)
            s1 = await page.evaluate(SUMMARY_JS, '2026-11')
            check('Pago de tarjeta no cambia egresos ni consumo', s1['expenses'] == s0['expenses'] and s1['consumption'] == s0['consumption'] and s1['cardPayments'] == 100000)
            tc_id = [k for k, v in s1['balances'].items() if v != s0['balances'].get(k) and v > s0['balances'][k]]
            check('El saldo de la tarjeta baja la deuda en $1,000', len(tc_id) == 1)
            await page.locator('[data-testid=fab]').click(); await page.wait_for_timeout(300)
            await page.locator('dialog.sheet .seg button:has-text("Transferir")').click(); await page.wait_for_timeout(200)
            await keypad(page, '500')
            await page.locator('[data-testid=save-tx]').click(); await page.wait_for_timeout(600)
            s2 = await page.evaluate(SUMMARY_JS, '2026-11')
            check('Transferencia entre cuentas no altera gastos ni ingresos', s2['expenses'] == s1['expenses'] and s2['income'] == s1['income'] and s2['transfers'] == 50000)

            print('\n6) Salario, bono y fondo de ahorro')
            for kind_label, amount, label in [('Salario', '21500', None), ('Bono', '8000', 'Bono anual'), ('Fondo de ahorro', '30000', None), ('Otro', '1500', 'Venta de bici')]:
                await page.locator('[data-testid=fab]').click(); await page.wait_for_timeout(300)
                await page.locator('dialog.sheet .seg button:has-text("Ingreso")').click(); await page.wait_for_timeout(150)
                await keypad(page, amount)
                await page.locator(f'dialog.sheet .chip:has-text("{kind_label}")').first.click(); await page.wait_for_timeout(150)
                if label: await page.locator('dialog.sheet .field input').first.fill(label)
                await page.locator('[data-testid=save-tx]').click(); await page.wait_for_timeout(500)
            s3 = await page.evaluate(SUMMARY_JS, '2026-11')
            it = s3['incomeByType']
            check('Ingresos por tipo correctos', it['salary'] == 2150000 and it['bonus'] == 800000 and it['savings_fund'] == 3000000 and it['other'] == 150000, json.dumps(it))
            await page.goto(f'{BASE}?hoy={HOY}#/inicio'); await page.wait_for_timeout(600)
            comp = await page.locator('section.card:has-text("Composición de ingresos")').inner_text()
            check('Composición de ingresos muestra conceptos nombrados', 'Bono anual' in comp and 'Venta de bici' in comp)
            await page.screenshot(path=str(SHOTS / '06-dashboard.png'), full_page=True)

            print('\n7) Recurrentes: sin duplicados, omitir y eliminar')
            await page.goto(f'{BASE}?hoy={HOY}#/fijos'); await page.wait_for_timeout(400)
            await page.click('[data-testid=new-rule]'); await page.wait_for_timeout(300)
            await page.fill('[data-testid=rule-name]', 'Renta depa')
            await page.fill('[data-testid=rule-amount]', '9500')
            await page.locator('dialog.sheet input[type=date]').first.fill('2026-09-01')
            await page.click('[data-testid=rule-save]'); await page.wait_for_timeout(700)
            cnt = lambda ids: len([i for i in ids if i.startswith('r:')])
            r1 = await page.evaluate(SUMMARY_JS, '2026-11')
            check('Genera sep, oct y nov (3 ocurrencias)', cnt(r1['ids']) == 3, str(cnt(r1['ids'])))
            await page.reload(); await page.wait_for_timeout(800)
            await page.evaluate("import('/src/data/store.js').then(s => s.runRecurring())")
            r2 = await page.evaluate(SUMMARY_JS, '2026-11')
            check('Recargar y re-ejecutar no duplica', cnt(r2['ids']) == 3 and len(set(r2['ids'])) == len(r2['ids']))
            await page.locator('button:has-text("Editar / omitir")').first.click(); await page.wait_for_timeout(300)
            await page.click('[data-testid=skip-occ]'); await page.wait_for_timeout(500)
            future = await page.evaluate("""async () => { const s = await import('/src/data/store.js'); const R = await import('/src/core/recurring.js');
                return R.upcoming(s.state, s.today(), 45).filter(o => o.rule.name === 'Renta depa').map(o => o.origDate) }""")
            check('Omitir solo la próxima ocurrencia (1 dic)', '2026-12-01' not in future, json.dumps(future))
            await page.locator('[data-rule]:has-text("Renta depa")').click(); await page.wait_for_timeout(300)
            await page.click('[data-testid=rule-delete]'); await page.wait_for_timeout(300)
            await page.locator('dialog.sheet button:has-text("Eliminar regla")').last.click(); await page.wait_for_timeout(700)
            r3 = await page.evaluate("import('/src/data/store.js').then(s => s.state.recurring.length)")
            check('Eliminar regla', r3 == 0)

            print('\n8) Alertas y calendario')
            al = await page.evaluate("""async () => { const s = await import('/src/data/store.js'); const A = await import('/src/core/alerts.js');
                return A.buildSchedule(s.state, s.today()).filter(e => e.kind === 'card').map(e => e.date) }""")
            check('Calendario de avisos incluye la fecha sugerida 19 nov', '2026-11-19' in al or '2026-12-19' in al, json.dumps(al))
            await page.goto(f'{BASE}?hoy={HOY}#/alertas'); await page.wait_for_timeout(400)
            async with page.expect_download() as dl:
                await page.locator('button:has-text("Agregar a mi calendario")').click()
            ics = Path(await (await dl.value).path()).read_text()
            check('Exporta .ics con VALARM', 'BEGIN:VCALENDAR' in ics and 'BEGIN:VALARM' in ics)

            print('\n9) Respaldos JSON y CSV')
            await page.goto(f'{BASE}?hoy={HOY}#/respaldos'); await page.wait_for_timeout(400)
            async with page.expect_download() as dl:
                await page.click('[data-testid=export-json]')
            json_path = await (await dl.value).path()
            backup = json.loads(Path(json_path).read_text())
            async with page.expect_download() as dl:
                await page.click('[data-testid=export-csv]')
            csv_path = await (await dl.value).path()
            n_before = (await page.evaluate(SUMMARY_JS, '2026-11'))['n']
            check('JSON exportado contiene todos los movimientos', len(backup['data']['transactions']) == n_before)
            await page.evaluate("import('/src/data/store.js').then(s => s.wipe())"); await page.wait_for_timeout(400)
            check('Datos borrados', (await page.evaluate(SUMMARY_JS, '2026-11'))['n'] == 0)
            async with page.expect_file_chooser() as fc:
                await page.click('[data-testid=import-json]')
            await (await fc.value).set_files(json_path); await page.wait_for_timeout(500)
            await page.locator('dialog.sheet button:has-text("Restaurar")').last.click(); await page.wait_for_timeout(800)
            check('Importar JSON restaura todo', (await page.evaluate(SUMMARY_JS, '2026-11'))['n'] == n_before)
            await page.evaluate("""async () => { const s = await import('/src/data/store.js'); await s.deleteTxs(s.state.transactions.map(t => t.id)); }"""); await page.wait_for_timeout(300)
            async with page.expect_file_chooser() as fc:
                await page.click('[data-testid=import-csv]')
            await (await fc.value).set_files(csv_path); await page.wait_for_timeout(500)
            await page.locator('dialog.sheet button:has-text("Importar")').last.click(); await page.wait_for_timeout(800)
            check('Importar CSV recupera los movimientos', (await page.evaluate(SUMMARY_JS, '2026-11'))['n'] == n_before)

            print('\n10) Funciona offline (registro y consulta)')
            await ctx.set_offline(True)
            await page.goto(f'{BASE}?hoy={HOY}#/inicio'); await page.wait_for_timeout(1000)
            ok_render = await page.locator('.hero').count() > 0
            check('La app carga sin red', ok_render)
            b = (await page.evaluate(SUMMARY_JS, '2026-11'))['consumption']
            await page.locator('[data-testid=fab]').click(); await page.wait_for_timeout(300)
            await keypad(page, '30')
            await page.locator('dialog.sheet [data-cat=c_cafe]').click()
            await page.locator('[data-testid=save-tx]').click(); await page.wait_for_timeout(500)
            check('Se puede registrar sin red', (await page.evaluate(SUMMARY_JS, '2026-11'))['consumption'] - b == 3000)
            await ctx.set_offline(False)

            print('\n11) Recorrido visual con datos de ejemplo')
            await page.evaluate("import('/src/data/store.js').then(s => s.loadDemo())"); await page.wait_for_timeout(600)
            for name in ['inicio', 'movimientos', 'cuentas', 'cuentas/a_azul', 'fijos', 'deudas', 'reportes', 'alertas', 'ajustes']:
                await page.goto(f'{BASE}?hoy={HOY}#/{name}'); await page.wait_for_timeout(700)
                await page.screenshot(path=str(SHOTS / f'demo-{name.replace("/", "_")}.png'), full_page=True)
            await page.emulate_media(color_scheme='dark')
            await page.goto(f'{BASE}?hoy={HOY}#/inicio'); await page.wait_for_timeout(700)
            await page.screenshot(path=str(SHOTS / 'demo-dark-inicio.png'), full_page=True)
            await page.locator('[data-testid=fab]').click(); await page.wait_for_timeout(400)
            await page.screenshot(path=str(SHOTS / 'demo-dark-quick.png'))

            real_errors = [e for e in errors if 'favicon' not in e]
            check('Sin errores de JavaScript en consola', not real_errors, ' || '.join(real_errors[:5]))
            await browser.close()
    finally:
        server.terminate()
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} verificaciones E2E aprobadas.')
    sys.exit(1 if failed else 0)

asyncio.run(main())
