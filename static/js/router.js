// Hash-based router for CashPilot.

import { renderSidebar } from './components.js';
import { renderOverview, attachOverviewHandlers } from './pages/overview.js';
import { renderPlaceholderPage } from './pages/placeholders.js';
import { parseClientsRoute, renderClientsPage, attachClientsHandlers } from './pages/clients.js';
import { parseInvoicesRoute, renderInvoicesPage, attachInvoicesHandlers } from './pages/invoices.js';
import { parsePaymentsRoute, renderPaymentsPage, attachPaymentsHandlers } from './pages/payments.js';
import { parseExpensesRoute, renderExpensesPage, attachExpensesHandlers } from './pages/expenses.js';
import { renderCashForecastPage, attachCashForecastHandlers } from './pages/cash-forecast.js';
import { renderSimulatorPage, attachSimulatorHandlers } from './pages/simulator.js';

export const ROUTES = [
  { key: 'overview', path: '#/overview', label: 'Overview' },
  { key: 'clients', path: '#/clients', label: 'Clients' },
  { key: 'invoices', path: '#/invoices', label: 'Invoices' },
  { key: 'payments', path: '#/payments', label: 'Payments' },
  { key: 'expenses', path: '#/expenses', label: 'Expenses' },
  { key: 'cash-forecast', path: '#/cash-forecast', label: 'Cash Forecast' },
  { key: 'simulator', path: '#/simulator', label: 'What-if Simulator' },
  { key: 'settings', path: '#/settings', label: 'Settings' },
];

let lastKey = null;

export function getRouteKey() {
  const base = location.hash.replace(/^#\//, '').split('/')[0];
  return ROUTES.some((route) => route.key === base) ? base : 'overview';
}

export function render() {
  const key = getRouteKey();
  const route = ROUTES.find((r) => r.key === key);
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main');
  const routeChanged = key !== lastKey;
  lastKey = key;

  sidebar.innerHTML = renderSidebar(key, ROUTES);

  if (key === 'overview') {
    main.innerHTML = renderOverview();
    attachOverviewHandlers(main);
  } else if (key === 'clients') {
    main.innerHTML = renderClientsPage(parseClientsRoute(location.hash));
    attachClientsHandlers(main);
  } else if (key === 'invoices') {
    main.innerHTML = renderInvoicesPage(parseInvoicesRoute(location.hash));
    attachInvoicesHandlers(main);
  } else if (key === 'payments') {
    main.innerHTML = renderPaymentsPage(parsePaymentsRoute(location.hash));
    attachPaymentsHandlers(main);
  } else if (key === 'expenses') {
    main.innerHTML = renderExpensesPage(parseExpensesRoute(location.hash));
    attachExpensesHandlers(main);
  } else if (key === 'cash-forecast') {
    main.innerHTML = renderCashForecastPage();
    attachCashForecastHandlers(main);
  } else if (key === 'simulator') {
    main.innerHTML = renderSimulatorPage();
    attachSimulatorHandlers(main);
  } else {
    main.innerHTML = renderPlaceholderPage(key);
  }

  document.title = `${route.label} · CashPilot`;

  if (routeChanged) {
    main.focus({ preventScroll: false });
  }
  window.scrollTo(0, 0);
}

export function initRouter() {
  window.addEventListener('hashchange', render);
  render();
}
