// One-shot notice shared by all CashPilot pages. Consumed once; cleared on reload because it lives in memory only.
let current = null;
/** Sets the notice shown on the next page render. */
export function setFlash(type, message) { current = { type, message }; }
/** Returns and clears the pending notice, or null. */
export function takeFlash() { const c = current; current = null; return c; }
