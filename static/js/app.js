// CashPilot entry point. Syncs live SQLite data from FastAPI before starting the router.

import { initRouter } from './router.js';
import { syncClients } from './clients-store.js';
import { syncInvoices } from './invoices-store.js';
import { syncPayments } from './payments-store.js';
import { syncExpenses } from './expenses-store.js';
import { syncSettings } from './forecast.js';

async function start() {
  if (!location.hash) {
    history.replaceState(null, '', '#/overview');
  }
  const main = document.getElementById('main');
  if (main) {
    main.innerHTML = '<div class="placeholder"><p>Connecting to CashPilot database...</p></div>';
  }
  try {
    await Promise.all([
      syncClients(),
      syncInvoices(),
      syncPayments(),
      syncExpenses(),
      syncSettings(),
    ]);
  } catch (err) {
    if (main) {
      main.innerHTML = `<div class="notice notice-error" role="alert">Could not reach the backend API (${err.message}). Make sure uvicorn is running on port 8000.</div>`;
    }
    return;
  }
  initRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
