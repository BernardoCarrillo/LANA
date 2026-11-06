export function uid(prefix = '') {
  const r = (globalThis.crypto && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return prefix + r;
}
/** Id determinista de una ocurrencia recurrente: garantiza que no haya duplicados. */
export const occurrenceId = (ruleId, originalDate) => `r:${ruleId}:${originalDate}`;
