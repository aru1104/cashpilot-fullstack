// Payments page for CashPilot: payment list with search and method filter, record-payment form opened from an invoice, and read-only payment detail.

import {
  listPayments,
  getPayment,
  paymentsForInvoice,
  validatePayment,
  createPayment,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  isPersistent,
} from '../payments-store.js';
import { listInvoices, getInvoice } from '../invoices-store.js';
import { listClients } from '../clients-store.js';
import { formatINR, formatDate } from '../format.js';
import { escapeHtml } from '../components.js';
import { setFlash, takeFlash } from '../flash.js';

const BACK_TO_PAYMENTS = '\u2190 Back to payments';
const BACK_TO_INVOICE = '\u2190 Back to invoice';

const INVOICE_STATUS_TEXT = Object.freeze({
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
});

const INVOICE_BADGE_CLASSES = Object.freeze({
  draft: 'badge badge-draft',
  sent: 'badge badge-sent',
  partially_paid: 'badge badge-partial',
  paid: 'badge badge-paid',
  overdue: 'badge badge-overdue',
});

/** Sets the notice shown on the next payments page render. */
export function setPaymentFlash(type, message) {
  setFlash(type, message);
}

/** Escapes any value for HTML text or attribute use; null and undefined become ''. */
function esc(x) {
  return escapeHtml(x == null ? '' : String(x));
}

/** Reads a key only when it is an own property of the map, otherwise returns the fallback. */
function lookup(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Parses 'YYYY-MM-DD' as a local date (new Date(string) would parse it as UTC). */
function parseLocalDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(iso) {
  return iso ? formatDate(parseLocalDate(iso)) : '\u2014';
}

/** Today's local date as 'YYYY-MM-DD'. */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parses a location.hash string into a payments route object. */
export function parsePaymentsRoute(hash) {
  const raw = String(hash ?? '').replace(/^#\//, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] !== 'payments') return { view: 'list' };
  try {
    if (parts.length === 3 && parts[1] === 'record') {
      return { view: 'record', invoiceId: decodeURIComponent(parts[2]) };
    }
    if (parts.length === 2 && parts[1] !== 'record') {
      return { view: 'detail', id: decodeURIComponent(parts[1]) };
    }
  } catch {
    return { view: 'list' };
  }
  return { view: 'list' };
}

function methodLabel(method) {
  return esc(lookup(PAYMENT_METHOD_LABELS, method, String(method ?? '')));
}

/** Status pill markup for an invoice display status. */
function renderInvoiceBadge(status) {
  const cls = lookup(INVOICE_BADGE_CLASSES, status, 'badge');
  const label = lookup(INVOICE_STATUS_TEXT, status, String(status ?? ''));
  return `<span class="${esc(cls)}">${esc(label)}</span>`;
}

function renderNotice(current) {
  if (!current) return '';
  const cls = current.type === 'error' ? 'notice-error' : 'notice-success';
  return `<div class="notice ${cls}" role="status">${esc(current.message)}</div>`;
}

function renderStorageWarning() {
  return isPersistent()
    ? ''
    : '<div class="notice notice-warning" role="status">Browser storage is unavailable, so changes last only for this session.</div>';
}

function renderHeader(title, subtitle = '') {
  const sub = subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : '';
  return `<header class="page-header"><div><h1 class="page-title">${esc(title)}</h1>${sub}</div></header>`;
}

function renderNotFound(title, text) {
  return (
    renderHeader('Payments') +
    `<div class="empty-state"><h2 class="empty-title">${esc(title)}</h2>` +
    `<p class="empty-text">${esc(text)}</p>` +
    '<a class="btn btn-secondary" href="#/payments">Back to payments</a></div>'
  );
}

/** One label/value pair for a detail-grid; valueHtml must already be escaped by the caller. */
function detailItem(label, valueHtml, extraClass = '') {
  return `<div class="detail-item"><dt class="detail-label">${esc(label)}</dt><dd class="detail-value${extraClass}">${valueHtml}</dd></div>`;
}

/** Wraps one control in a labelled field with an optional error message. */
function fieldHtml({ id, label, error, span = false }, control) {
  const errId = `${id}-error`;
  const classes = ['field'];
  if (error) classes.push('field-invalid');
  if (span) classes.push('span-full');
  const errorHtml = error ? `<p class="field-error" id="${esc(errId)}">${esc(error)}</p>` : '';
  return (
    `<div class="${classes.join(' ')}"><label class="field-label" for="${esc(id)}">${esc(label)}</label>` +
    control +
    errorHtml +
    '</div>'
  );
}

function ariaAttr(id, error) {
  return error ? ` aria-invalid="true" aria-describedby="${esc(id)}-error"` : '';
}

/** Table of payments for the invoice detail view and the record view. Pass an array from paymentsForInvoice(). */
export function renderPaymentTable(payments) {
  const list = Array.isArray(payments) ? payments : [];
  if (list.length === 0) {
    return (
      '<div class="empty-state"><h3 class="empty-title">No payments yet</h3>' +
      '<p class="empty-text">Payments recorded against this invoice will appear here.</p></div>'
    );
  }
  const rows = list
    .map(
      (p) =>
        '<tr>' +
        `<td><a class="table-link" href="#/payments/${esc(encodeURIComponent(p.id))}">${esc(p.reference)}</a></td>` +
        `<td class="num">${esc(formatINR(p.amountReceived))}</td>` +
        `<td>${esc(fmtDate(p.paymentDate))}</td>` +
        `<td>${methodLabel(p.method)}</td>` +
        '</tr>',
    )
    .join('');
  return (
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Payments</caption><thead><tr>' +
    '<th scope="col">Reference</th>' +
    '<th scope="col" class="num">Amount</th>' +
    '<th scope="col">Date</th>' +
    '<th scope="col">Method</th>' +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

/** Table rows and filtering for the payments list. */
function renderPaymentRows(query, method) {
  const all = listPayments();
  if (all.length === 0) {
    return (
      '<div class="empty-state"><h2 class="empty-title">No payments recorded yet</h2>' +
      '<p class="empty-text">Record a payment from an invoice to see it here.</p>' +
      '<a class="btn btn-secondary" href="#/invoices">Go to invoices</a></div>'
    );
  }

  const invoices = new Map(listInvoices().map((inv) => [inv.id, inv]));
  const clients = new Map(listClients().map((c) => [c.id, c]));
  const q = String(query ?? '').trim().toLowerCase();

  const entries = all
    .map((p) => ({
      p,
      inv: invoices.get(p.invoiceId) || null,
      client: clients.get(p.clientId) || null,
    }))
    .filter(({ p, inv, client }) => {
      if (method && p.method !== method) return false;
      if (!q) return true;
      return [p.reference, inv ? inv.number : '', client ? client.fullName : ''].some((v) =>
        String(v ?? '').toLowerCase().includes(q),
      );
    });

  if (entries.length === 0) {
    return '<div class="empty-state"><p class="empty-text">No payments match these filters.</p></div>';
  }

  const n = entries.length;
  const rows = entries
    .map(({ p, inv, client }) => {
      const invoiceCell = inv
        ? `<a class="table-link" href="#/invoices/${esc(encodeURIComponent(inv.id))}">${esc(inv.number)}</a>`
        : esc('Invoice removed');
      return (
        '<tr>' +
        `<td><a class="table-link" href="#/payments/${esc(encodeURIComponent(p.id))}">${esc(p.reference)}</a></td>` +
        `<td>${invoiceCell}</td>` +
        `<td>${esc(client ? client.fullName : 'Client removed')}</td>` +
        `<td class="num">${esc(formatINR(p.amountReceived))}</td>` +
        `<td>${esc(fmtDate(p.paymentDate))}</td>` +
        `<td>${methodLabel(p.method)}</td>` +
        '</tr>'
      );
    })
    .join('');

  return (
    `<p class="stat-hint">${n} payment${n === 1 ? '' : 's'}</p>` +
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Payments</caption><thead><tr>' +
    '<th scope="col">Reference</th>' +
    '<th scope="col">Invoice</th>' +
    '<th scope="col">Client</th>' +
    '<th scope="col" class="num">Amount</th>' +
    '<th scope="col">Date</th>' +
    '<th scope="col">Method</th>' +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

function renderListView() {
  const methodOptions = ['<option value="">All methods</option>']
    .concat(
      PAYMENT_METHODS.map(
        (m) => `<option value="${esc(m)}">${esc(lookup(PAYMENT_METHOD_LABELS, m, m))}</option>`,
      ),
    )
    .join('');

  return (
    renderHeader('Payments', 'Payments received against your invoices.') +
    '<section class="card">' +
    '<div class="toolbar"><label class="search-field"><span class="sr-only">Search payments</span>' +
    '<input type="search" id="payments-search" class="search-input" placeholder="Search by reference, invoice or client" autocomplete="off"></label>' +
    '<label class="sr-only" for="payments-method">Filter by method</label>' +
    `<select id="payments-method" class="filter-select">${methodOptions}</select></div>` +
    `<div data-payment-results>${renderPaymentRows('', '')}</div>` +
    '</section>'
  );
}

/** Record-payment form. state.values holds raw strings; state.errors is keyed by field name. */
function renderPaymentForm(invoiceId, state) {
  const values = (state && state.values) || {};
  const errors = (state && state.errors) || {};
  const hasErrors = Object.keys(errors).length > 0;
  const encInv = encodeURIComponent(invoiceId);
  const paymentDate = values.paymentDate !== undefined ? values.paymentDate : todayIso();

  const formNotice = hasErrors
    ? '<div class="notice notice-error" role="alert">Please fix the highlighted fields.</div>'
    : '';

  const amountField = fieldHtml(
    { id: 'payment-amount', label: 'Amount received (INR) *', error: errors.amount },
    `<input id="payment-amount" class="field-input" type="text" inputmode="decimal" name="amount" value="${esc(values.amount ?? '')}" required${ariaAttr('payment-amount', errors.amount)}>`,
  );

  const dateField = fieldHtml(
    { id: 'payment-date', label: 'Payment date *', error: errors.paymentDate },
    `<input id="payment-date" class="field-input" type="date" name="paymentDate" value="${esc(paymentDate)}" required${ariaAttr('payment-date', errors.paymentDate)}>`,
  );

  const methodOptions = ['<option value="">Select a method</option>']
    .concat(
      PAYMENT_METHODS.map(
        (m) =>
          `<option value="${esc(m)}"${values.method === m ? ' selected' : ''}>${esc(lookup(PAYMENT_METHOD_LABELS, m, m))}</option>`,
      ),
    )
    .join('');
  const methodField = fieldHtml(
    { id: 'payment-method', label: 'Payment method *', error: errors.method },
    `<select id="payment-method" class="field-input filter-select" name="method" required${ariaAttr('payment-method', errors.method)}>${methodOptions}</select>`,
  );

  const notesField = fieldHtml(
    { id: 'payment-notes', label: 'Notes (optional)', error: errors.notes, span: true },
    `<textarea id="payment-notes" class="field-textarea" name="notes" rows="3" maxlength="500"${ariaAttr('payment-notes', errors.notes)}>${esc(values.notes ?? '')}</textarea>`,
  );

  const invoiceErrorHtml = errors.invoiceId
    ? `<p class="field-error span-full" id="payment-invoiceId-error">${esc(errors.invoiceId)}</p>`
    : '';

  return (
    '<section class="card form-card">' +
    `<form class="form" data-form="payment" data-invoice-id="${esc(invoiceId)}" novalidate>` +
    formNotice +
    '<div class="form-grid">' +
    amountField +
    dateField +
    methodField +
    notesField +
    invoiceErrorHtml +
    '</div>' +
    '<div class="form-actions"><button type="submit" class="btn btn-primary">Save payment</button>' +
    `<a class="btn btn-secondary" href="#/invoices/${esc(encInv)}">Cancel</a></div>` +
    '</form></section>'
  );
}

function renderRecordView(invoiceId, state) {
  const inv = getInvoice(invoiceId);
  if (!inv) return renderNotFound('Invoice not found', 'This invoice may have been deleted.');

  const summary =
    '<section class="card"><div class="card-body"><dl class="detail-grid">' +
    detailItem('Invoice total', esc(formatINR(inv.total))) +
    detailItem('Total paid', esc(formatINR(inv.amountPaid))) +
    detailItem('Remaining balance', esc(formatINR(inv.remaining))) +
    detailItem('Status', renderInvoiceBadge(inv.displayStatus)) +
    '</dl></div></section>';

  const blocked = inv.displayStatus === 'draft' || !(inv.remaining > 0);
  const blockedMessage =
    inv.displayStatus === 'draft'
      ? 'Send this invoice before recording a payment.'
      : 'This invoice is already fully paid.';
  const formBlock = blocked
    ? `<div class="notice notice-warning" role="status">${esc(blockedMessage)}</div>`
    : renderPaymentForm(invoiceId, state);

  const existing =
    '<section class="card"><div class="card-header"><h2 class="card-title">Payments on this invoice</h2></div>' +
    `<div class="card-body">${renderPaymentTable(paymentsForInvoice(invoiceId))}</div></section>`;

  return (
    `<a class="back-link" href="#/invoices/${esc(encodeURIComponent(invoiceId))}">${BACK_TO_INVOICE}</a>` +
    renderHeader('Record payment', 'Invoice ' + inv.number) +
    summary +
    formBlock +
    existing
  );
}

function renderDetailView(id) {
  const p = getPayment(id);
  if (!p) return renderNotFound('Payment not found', 'This payment could not be found.');

  const inv = getInvoice(p.invoiceId);
  const client = listClients().find((c) => c.id === p.clientId) || null;
  const invoiceValue = inv
    ? `<a class="table-link" href="#/invoices/${esc(encodeURIComponent(inv.id))}">${esc(inv.number)}</a>`
    : esc('Invoice removed');
  const created = new Date(p.createdAt);
  const recorded = Number.isNaN(created.getTime()) ? '\u2014' : formatDate(created);

  const details =
    '<dl class="detail-grid">' +
    detailItem('Reference', esc(p.reference)) +
    detailItem('Amount', esc(formatINR(p.amountReceived)), ' num') +
    detailItem('Date', esc(fmtDate(p.paymentDate))) +
    detailItem('Method', methodLabel(p.method)) +
    detailItem('Invoice', invoiceValue) +
    detailItem('Client', esc(client ? client.fullName : 'Client removed')) +
    detailItem('Recorded', esc(recorded)) +
    '</dl>' +
    (p.notes ? `<p class="detail-notes">${esc(p.notes)}</p>` : '');

  return (
    `<a class="back-link" href="#/payments">${BACK_TO_PAYMENTS}</a>` +
    renderHeader(p.reference, formatINR(p.amountReceived) + ' received ' + fmtDate(p.paymentDate)) +
    '<section class="card"><div class="card-header"><h2 class="card-title">Payment details</h2></div>' +
    `<div class="card-body">${details}</div></section>`
  );
}

/** Renders the payments page for a route object from parsePaymentsRoute, returning an HTML string. */
export function renderPaymentsPage(route, state) {
  const r = route || { view: 'list' };
  const s = state || {};
  const notice = renderNotice(takeFlash()) + renderStorageWarning();

  if (r.view === 'record') return notice + renderRecordView(r.invoiceId, s);
  if (r.view === 'detail') return notice + renderDetailView(r.id);
  return notice + renderListView();
}

/** Re-renders the list results slot from the current search and method controls. */
function refreshResults(rootEl) {
  const slot = rootEl.querySelector('[data-payment-results]');
  if (!slot) return;
  const search = rootEl.querySelector('#payments-search');
  const method = rootEl.querySelector('#payments-method');
  slot.innerHTML = renderPaymentRows(search ? search.value : '', method ? method.value : '');
}

/** Sets the hash and re-renders through the router; when the hash is already set, dispatches hashchange manually. */
function navigateTo(target) {
  // Capture before assigning: once the hash changes, hashchange re-renders the page.
  const unchanged = location.hash === target;
  location.hash = target;
  if (unchanged) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Wires search, method filter and payment form submission for the payments page into rootEl. */
export function attachPaymentsHandlers(rootEl) {
  if (!rootEl) return;

  const onFilterInput = (event) => {
    const target = event.target;
    if (!target) return;
    if (target.id === 'payments-search' || target.id === 'payments-method') {
      refreshResults(rootEl);
    }
  };

  rootEl.oninput = onFilterInput;
  rootEl.onchange = onFilterInput;

  rootEl.onsubmit = async (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[data-form="payment"]')) return;
    event.preventDefault();

    const invoiceId = form.dataset.invoiceId || '';
    const fd = new FormData(form);
    const str = (name) => {
      const v = fd.get(name);
      return typeof v === 'string' ? v : '';
    };
    const rawValues = {
      amount: str('amount'),
      paymentDate: str('paymentDate'),
      method: str('method'),
      notes: str('notes'),
    };

    const inv = getInvoice(invoiceId);
    const result = validatePayment({ invoiceId, ...rawValues }, inv);

    if (!result.valid) {
      rootEl.innerHTML = renderPaymentsPage(
        { view: 'record', invoiceId },
        { values: rawValues, errors: result.errors },
      );
      attachPaymentsHandlers(rootEl);
      const firstInvalid = rootEl.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    try {
      const p = await createPayment(result.values);
      setPaymentFlash('success', 'Payment ' + p.reference + ' recorded.');
      navigateTo('#/invoices/' + encodeURIComponent(invoiceId));
    } catch (err) {
      setPaymentFlash('error', err.message || 'Could not record payment.');
      navigateTo('#/invoices/' + encodeURIComponent(invoiceId));
    }
  };
}
