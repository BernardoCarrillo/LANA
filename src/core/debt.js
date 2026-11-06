// Simulación simple de pago de deuda (tarjetas). Interés mensual = tasa anual / 12, con IVA 16 % sobre intereses
// (así se cobra en México). Es una aproximación educativa: el banco calcula con saldo promedio diario.
const IVA = 0.16;

/**
 * Simula pagar `payment` fijo cada mes, o una función payment(balance, monthIndex).
 * @returns {{months:number, totalInterest:number, totalPaid:number, schedule:number[], paysOff:boolean}}
 */
export function simulatePayoff(balance, apr, payment, { maxMonths = 360 } = {}) {
  const r = (apr || 0) / 12;
  let bal = balance, totalInterest = 0, totalPaid = 0, m = 0;
  const schedule = [bal];
  while (bal > 0 && m < maxMonths) {
    const interest = Math.round(bal * r * (1 + IVA));
    bal += interest;
    totalInterest += interest;
    let p = typeof payment === 'function' ? payment(bal, m) : payment;
    p = Math.min(Math.max(0, Math.round(p)), bal);
    if (p <= interest && p < bal && typeof payment !== 'function') { // el saldo nunca baja
      return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, schedule, paysOff: false };
    }
    bal -= p; totalPaid += p; m++;
    schedule.push(bal);
  }
  return { months: bal > 0 ? Infinity : m, totalInterest, totalPaid, schedule, paysOff: bal <= 0 };
}

/** Pagar solo el mínimo (estimado) cada mes. */
export function simulateMinimum(balance, apr, { limit = 0, minPct = 0.015, floor = 20000 } = {}) {
  const r = (apr || 0) / 12;
  return simulatePayoff(balance, apr, (bal) => {
    const interestPart = bal * r * (1 + IVA) / (1 + r * (1 + IVA)); // interés ya sumado este mes
    return Math.max(bal * minPct + interestPart, limit * 0.0125, Math.min(floor, bal));
  }, { maxMonths: 600 });
}

/** Pago mensual necesario para liquidar en n meses (anualidad). */
export function paymentForMonths(balance, apr, n) {
  const r = (apr || 0) / 12 * (1 + IVA);
  if (n <= 0) return balance;
  if (r === 0) return Math.ceil(balance / n);
  return Math.ceil(balance * r / (1 - Math.pow(1 + r, -n)));
}
