import { renderPageHeader } from '../components.js';

const PAGES = {
  clients: {
    title: 'Clients',
    description: 'Manage client profiles, contact details and billing history.',
  },
  invoices: {
    title: 'Invoices',
    description: 'Create, send and track invoices against each client.',
  },
  payments: {
    title: 'Payments',
    description: 'Record incoming payments and match them to invoices.',
  },
  expenses: {
    title: 'Expenses',
    description: 'Log business costs and recurring bills.',
  },
  'cash-forecast': {
    title: 'Cash Forecast',
    description: 'Project future cash position from invoices and expenses.',
  },
  settings: {
    title: 'Settings',
    description: 'Business profile, currency and account preferences.',
  },
};

const UNKNOWN_PAGE = {
  title: 'CashPilot',
  description: 'This page is not available.',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a "coming later" placeholder page for the given route key.
 * @param {string} key
 * @returns {string} HTML string
 */
export function renderPlaceholderPage(key) {
  const page = Object.prototype.hasOwnProperty.call(PAGES, key)
    ? PAGES[key]
    : UNKNOWN_PAGE;

  return (
    renderPageHeader({ title: page.title, subtitle: '' }) +
    '<section class="card"><div class="placeholder">' +
    '<p><strong>Coming in a later release.</strong></p>' +
    `<p>${escapeHtml(page.description)}</p>` +
    '</div></section>'
  );
}
