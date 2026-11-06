// Capas, micro-categorías, tipos de cuenta y atajos por defecto.

export const LAYERS = [
  { id: 'essentials', name: 'Esenciales', sub: 'Supervivencia', icon: '🏠', color: 'var(--layer-essentials)', consumption: true },
  { id: 'lifestyle', name: 'Estilo de vida', sub: 'Discrecionales', icon: '🎉', color: 'var(--layer-lifestyle)', consumption: true },
  { id: 'savings', name: 'Ahorro, inversión y deuda', sub: 'Futuro', icon: '🌱', color: 'var(--layer-savings)', consumption: false },
];
export const OTHER_LAYER = { id: 'other', name: 'Sin categoría', icon: '❔', color: 'var(--layer-other)', consumption: true };
export const layerById = (id) => LAYERS.find((l) => l.id === id) || OTHER_LAYER;

const C = (id, layer, name, icon) => ({ id, layer, name, icon, builtin: true });

export const DEFAULT_CATEGORIES = [
  // Esenciales / supervivencia
  C('c_renta', 'essentials', 'Vivienda / renta', '🏠'),
  C('c_luz', 'essentials', 'Luz', '💡'),
  C('c_agua', 'essentials', 'Agua', '💧'),
  C('c_gas', 'essentials', 'Gas', '🔥'),
  C('c_internet', 'essentials', 'Internet y celular', '📶'),
  C('c_despensa', 'essentials', 'Despensa básica', '🛒'),
  C('c_transporte', 'essentials', 'Transporte', '🚌'),
  C('c_gasolina', 'essentials', 'Gasolina', '⛽'),
  C('c_salud', 'essentials', 'Salud y farmacia', '💊'),
  C('c_seguros', 'essentials', 'Seguros', '🛡️'),
  C('c_educacion', 'essentials', 'Educación', '🎓'),
  C('c_hogar', 'essentials', 'Mantenimiento hogar', '🔧'),
  C('c_impuestos', 'essentials', 'Impuestos y predial', '🧾'),
  C('c_comisiones', 'essentials', 'Intereses y comisiones', '🏦'),
  // Estilo de vida / discrecionales
  C('c_comer', 'lifestyle', 'Comer fuera', '🍽️'),
  C('c_cafe', 'lifestyle', 'Café', '☕'),
  C('c_antojos', 'lifestyle', 'Antojos', '🍩'),
  C('c_delivery', 'lifestyle', 'Delivery', '🛵'),
  C('c_entretenimiento', 'lifestyle', 'Entretenimiento', '🎬'),
  C('c_suscripciones', 'lifestyle', 'Suscripciones', '📺'),
  C('c_ropa', 'lifestyle', 'Ropa y calzado', '👕'),
  C('c_cuidado', 'lifestyle', 'Cuidado personal', '💇'),
  C('c_salidas', 'lifestyle', 'Salidas y bares', '🍻'),
  C('c_regalos', 'lifestyle', 'Regalos', '🎁'),
  C('c_viajes', 'lifestyle', 'Viajes', '✈️'),
  C('c_hobbies', 'lifestyle', 'Hobbies', '🎮'),
  C('c_mascotas', 'lifestyle', 'Mascotas', '🐾'),
  C('c_compras', 'lifestyle', 'Compras varias', '🛍️'),
  // Ahorro / inversión / deuda
  C('c_emergencia', 'savings', 'Fondo de emergencia', '🆘'),
  C('c_inversion', 'savings', 'Inversión', '📈'),
  C('c_retiro', 'savings', 'Retiro / Afore voluntaria', '🧓'),
  C('c_fondo_aport', 'savings', 'Aportación fondo de ahorro', '🐷'),
  C('c_amortizacion', 'savings', 'Amortización de deuda', '💳'),
  C('c_prestamo', 'savings', 'Mensualidad crédito/préstamo', '🚗'),
];

export const ACCOUNT_KINDS = {
  asset: 'Dinero propio',
  credit: 'Crédito (deuda)',
  voucher: 'Vales / monedero',
};

export const DEFAULT_ACCOUNT_TYPES = [
  { id: 't_cash', name: 'Efectivo', kind: 'asset', icon: '💵', builtin: true },
  { id: 't_debit', name: 'Débito', kind: 'asset', icon: '🏧', builtin: true },
  { id: 't_credit', name: 'Tarjeta de crédito', kind: 'credit', icon: '💳', builtin: true },
  { id: 't_food', name: 'Vales de despensa', kind: 'voucher', icon: '🛒', builtin: true },
  { id: 't_fuel', name: 'Vales de gasolina', kind: 'voucher', icon: '⛽', builtin: true },
  { id: 't_savings', name: 'Ahorro', kind: 'asset', icon: '🐷', builtin: true },
  { id: 't_invest', name: 'Inversión', kind: 'asset', icon: '📈', builtin: true },
];

export const INCOME_TYPES = [
  { id: 'salary', name: 'Salario', icon: '💼', color: 'var(--inc-salary)' },
  { id: 'bonus', name: 'Bono', icon: '🎯', color: 'var(--inc-bonus)' },
  { id: 'savings_fund', name: 'Fondo de ahorro', icon: '🐷', color: 'var(--inc-fund)' },
  { id: 'other', name: 'Otro', icon: '✨', color: 'var(--inc-other)' },
];
export const incomeTypeById = (id) => INCOME_TYPES.find((t) => t.id === id) || INCOME_TYPES[3];

export const TX_KINDS = {
  expense: 'Egreso',
  income: 'Ingreso',
  transfer: 'Transferencia',
  card_payment: 'Pago de tarjeta',
  adjustment: 'Ajuste',
};
export const STATUSES = { pending: 'Pendiente', confirmed: 'Confirmado', reconciled: 'Conciliado' };

export const DEFAULT_SHORTCUTS = [
  { id: 's_cafe', label: 'Café', categoryId: 'c_cafe', amount: 5500 },
  { id: 's_comida', label: 'Comida', categoryId: 'c_comer', amount: 15000 },
  { id: 's_uber', label: 'Transporte', categoryId: 'c_transporte', amount: 9000 },
  { id: 's_antojo', label: 'Antojo', categoryId: 'c_antojos', amount: 4000 },
];

export const ACCOUNT_COLORS = ['#2a78d6', '#6250d6', '#0f766e', '#be185d', '#b45309', '#334155', '#15803d', '#9333ea', '#c2410c', '#0e7490'];
