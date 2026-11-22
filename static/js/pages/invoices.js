// Invoices page for CashPilot: list, search, filter, add/edit form with line items, detail view and delete confirmation.

import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  validateInvoice,
  invoiceHasPayments,
  nextInvoiceNumber,
  computeTotals,
  lineTotal,
  todayIso,
  isPersistent,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
} from '../invoices-store.js';
import { listClients } from '../clients-store.js';
import { paymentsForInvoice } from '../payments-store.js';
import { renderPaymentTable } from './payments.js';
import { formatINR, formatDate } from '../format.js';
import { escapeHtml, renderPageHeader } from '../components.js';
import { setFlash, takeFlash } from '../flash.js';

const BACK_TO_INVOICES = '\u2190 Back to invoices';
const BACK_TO_INVOICE = '\u2190 Back to invoice';

const STATUS_CLASSES = Object.freeze({
  draft: 'badge badge-draft',
  sent: 'badge badge-sent',
  partially_paid: 'badge badge-partial',
  paid: 'badge badge-paid',
  overdue: 'badge badge-overdue',
});

/** Sets the notice shown on the next invoices page render. */
export function setInvoiceFlash(type, message) {
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

/** Adds n days to a local 'YYYY-MM-DD' string and returns the result in the same format. */
function addDaysIso(iso, n) {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parses a location.hash string into an invoices route object. */
export function parseInvoicesRoute(hash) {
  const raw = String(hash ?? '').replace(/^#\//, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] !== 'invoices') return { view: 'list' };
  if (parts.length === 1) return { view: 'list' };
  if (parts.length === 2 && parts[1] === 'new') return { view: 'new' };
  if (parts.length === 2 || (parts.length === 3 && parts[2] === 'edit')) {
    let id;
    try {
      id = decodeURIComponent(parts[1]);
    } catch {
      return { view: 'list' };
    }
    return { view: parts.length === 2 ? 'detail' : 'edit', id };
  }
  return { view: 'list' };
}

/** Status pill markup for an invoice status (draft, sent, partially_paid, paid, overdue). */
export function renderInvoiceStatusBadge(status) {
  const cls = lookup(STATUS_CLASSES, status, 'badge');
  const label = lookup(INVOICE_STATUS_LABELS, status, String(status ?? ''));
  return `<span class="${esc(cls)}">${esc(label)}</span>`;
}

function renderNotice(current) {
  if (!current) return '';
  const cls = current.type === 'error' ? 'notice-error' : 'notice-success';
  return `<div class="notice ${cls}" role="status">${esc(current.message)}</div>`;
}

function renderHeader(title, subtitle, actionsHtml = '') {
  const sub = subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : '';
  const actions = actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : '';
  return `<header class="page-header"><div><h1 class="page-title">${esc(title)}</h1>${sub}</div>${actions}</header>`;
}

function renderNotFound() {
  return (
    renderHeader('Invoices') +
    '<div class="empty-state"><h2 class="empty-title">Invoice not found</h2>' +
    '<p class="empty-text">This invoice may have been deleted.</p>' +
    '<a class="btn btn-secondary" href="#/invoices">Back to invoices</a></div>'
  );
}

function renderSection(title, bodyHtml) {
  return (
    '<section class="card">' +
    `<div class="card-header"><h2 class="card-title">${esc(title)}</h2></div>` +
    `<div class="card-body">${bodyHtml}</div></section>`
  );
}

/** Table rows and filtering for the invoice list. invoices should come from listInvoices(). */
function renderInvoiceRows(invoices, query, status) {
  if (invoices.length === 0) {
    return (
      '<div class="empty-state"><h2 class="empty-title">No invoices yet</h2>' +
      '<p class="empty-text">Create your first invoice to start tracking payments.</p>' +
      '<a class="btn btn-primary" href="#/invoices/new">Add invoice</a></div>'
    );
  }

  const clients = new Map(listClients().map((c) => [c.id, c]));
  const q = String(query ?? '').trim().toLowerCase();

  const filtered = invoices.filter((inv) => {
    if (status && inv.displayStatus !== status) return false;
    if (!q) return true;
    if (String(inv.number ?? '').toLowerCase().includes(q)) return true;
    const client = clients.get(inv.clientId);
    if (!client) return false;
    return [client.fullName, client.businessName].some((name) =>
      String(name ?? '').toLowerCase().includes(q),
    );
  });

  if (filtered.length === 0) {
    return '<div class="empty-state"><p class="empty-text">No invoices match these filters.</p></div>';
  }

  const n = filtered.length;
  const rows = filtered
    .map((inv) => {
      const client = clients.get(inv.clientId);
      const clientCell = client
        ? esc(client.fullName)
        : '<span class="stat-hint">Client removed</span>';
      return (
        '<tr>' +
        `<td><a class="table-link" href="#/invoices/${esc(encodeURIComponent(inv.id))}">${esc(inv.number)}</a></td>` +
        `<td>${clientCell}</td>` +
        `<td>${esc(fmtDate(inv.issueDate))}</td>` +
        `<td>${esc(fmtDate(inv.dueDate))}</td>` +
        `<td class="num">${esc(formatINR(inv.total))}</td>` +
        `<td class="num">${esc(formatINR(inv.amountPaid))}</td>` +
        `<td class="num">${esc(formatINR(inv.remaining))}</td>` +
        `<td>${renderInvoiceStatusBadge(inv.displayStatus)}</td>` +
        '</tr>'
      );
    })
    .join('');

  return (
    `<p class="stat-hint">${n} invoice${n === 1 ? '' : 's'}</p>` +
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Invoices</caption><thead><tr>' +
    '<th scope="col">Invoice</th>' +
    '<th scope="col">Client</th>' +
    '<th scope="col">Issue date</th>' +
    '<th scope="col">Due date</th>' +
    '<th scope="col" class="num">Amount</th>' +
    '<th scope="col" class="num">Paid</th>' +
    '<th scope="col" class="num">Remaining</th>' +
    '<th scope="col">Status</th>' +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

function renderListView() {
  const clientWarning =
    listClients().length === 0
      ? '<div class="notice notice-warning" role="status">Add a client before creating an invoice. <a class="table-link" href="#/clients/new">Add client</a></div>'
      : '';
  const storageWarning = isPersistent()
    ? ''
    : '<div class="notice notice-warning" role="status">Browser storage is unavailable, so changes last only for this session.</div>';
  const statusOptions = ['<option value="">All statuses</option>']
    .concat(INVOICE_STATUSES.map((s) => `<option value="${esc(s)}">${esc(INVOICE_STATUS_LABELS[s])}</option>`))
    .join('');

  return (
    renderHeader(
      'Invoices',
      'Create, send and track invoices for your clients.',
      '<a class="btn btn-primary" href="#/invoices/new">Add invoice</a>',
    ) +
    clientWarning +
    storageWarning +
    '<section class="card">' +
    '<div class="toolbar"><label class="search-field"><span class="sr-only">Search invoices</span>' +
    '<input type="search" id="invoices-search" class="search-input" placeholder="Search by invoice number or client name" autocomplete="off"></label>' +
    '<label class="sr-only" for="invoices-status">Filter by status</label>' +
    `<select id="invoices-status" class="filter-select">${statusOptions}</select></div>` +
    `<div data-invoice-results>${renderInvoiceRows(listInvoices(), '', '')}</div>` +
    '</section>'
  );
}

/** Values used when the form opens without any state: blank for new, record fields for edit. */
function defaultValues(inv) {
  if (inv) {
    return {
      clientId: inv.clientId ?? '',
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      description: inv.description ?? '',
      lineItems: inv.lineItems.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    };
  }
  const today = todayIso();
  return {
    clientId: '',
    issueDate: today,
    dueDate: addDaysIso(today, 14),
    status: 'draft',
    description: '',
    lineItems: [{ name: '', quantity: 1, unitPrice: '' }],
  };
}

/** Number from a form string; empty or missing input becomes NaN. */
function numberOrNaN(v) {
  if (v === '' || v == null) return NaN;
  return Number(v);
}

/** Line total text for one row, or an em dash while quantity or unit price is invalid. */
function lineTotalText(item) {
  const q = numberOrNaN(item.quantity);
  const p = numberOrNaN(item.unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return '\u2014';
  return formatINR(lineTotal({ quantity: q, unitPrice: p }));
}

/** Subtotal and total for raw line items; invalid numbers count as 0. */
function totalsFor(lineItems) {
  const nums = lineItems.map((item) => {
    const q = numberOrNaN(item.quantity);
    const p = numberOrNaN(item.unitPrice);
    return {
      quantity: Number.isFinite(q) ? q : 0,
      unitPrice: Number.isFinite(p) ? p : 0,
    };
  });
  return computeTotals(nums);
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

function renderLineRow(item, i, itemErrors, disableRemove) {
  const e = itemErrors || {};
  const nameId = `invoice-itemName-${i}`;
  const qtyId = `invoice-itemQuantity-${i}`;
  const priceId = `invoice-itemUnitPrice-${i}`;
  return (
    '<div class="line-row" data-line-row>' +
    `<input type="hidden" name="itemId" value="${esc(item.id)}">` +
    fieldHtml(
      { id: nameId, label: 'Item or service *', error: e.name },
      `<input id="${esc(nameId)}" class="field-input" type="text" name="itemName" value="${esc(item.name)}" maxlength="200" required${ariaAttr(nameId, e.name)}>`,
    ) +
    fieldHtml(
      { id: qtyId, label: 'Quantity', error: e.quantity },
      `<input id="${esc(qtyId)}" class="field-input" type="number" name="itemQuantity" min="0" step="any" value="${esc(item.quantity)}"${ariaAttr(qtyId, e.quantity)}>`,
    ) +
    fieldHtml(
      { id: priceId, label: 'Unit price (INR)', error: e.unitPrice },
      `<input id="${esc(priceId)}" class="field-input" type="number" name="itemUnitPrice" min="0" step="0.01" value="${esc(item.unitPrice)}"${ariaAttr(priceId, e.unitPrice)}>`,
    ) +
    `<div class="field"><span class="field-label">Line total</span><div class="line-total num" data-line-total>${esc(lineTotalText(item))}</div></div>` +
    `<div class="field"><button type="button" class="btn btn-secondary btn-sm" data-action="remove-line" data-index="${i}"${disableRemove ? ' disabled' : ''}>Remove</button></div>` +
    '</div>'
  );
}

function renderFormView(view, id, inv, state) {
  const isEdit = view === 'edit';
  const errors = (state && state.errors) || {};
  const hasErrors = Object.keys(errors).length > 0;
  const values = state && state.values ? state.values : defaultValues(isEdit ? inv : null);
  const mode = isEdit ? 'edit' : 'create';
  const cancelHref = isEdit ? `#/invoices/${encodeURIComponent(id)}` : '#/invoices';
  const title = isEdit ? 'Edit invoice' : 'Create invoice';
  const subtitle = isEdit
    ? `Invoice number ${inv.number} is kept when you save.`
    : 'Required fields are marked with *.';
  const formNotice = hasErrors
    ? '<div class="notice notice-error" role="alert">Please fix the highlighted fields.</div>'
    : '';

  const clients = listClients()
    .slice()
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  const clientOptions = ['<option value="">Select a client</option>']
    .concat(
      clients.map((c) => {
        const text = c.businessName ? `${c.fullName} \u2014 ${c.businessName}` : c.fullName;
        const selected = c.id === values.clientId ? ' selected' : '';
        return `<option value="${esc(c.id)}"${selected}>${esc(text)}</option>`;
      }),
    )
    .join('');
  const clientErr = errors.clientId;
  const clientField = fieldHtml(
    { id: 'invoice-clientId', label: 'Client *', error: clientErr },
    `<select id="invoice-clientId" class="filter-select field-input" name="clientId" required${ariaAttr('invoice-clientId', clientErr)}>${clientOptions}</select>`,
  );

  const numberValue = isEdit ? esc(inv.number) : esc(nextInvoiceNumber(values.issueDate));
  const numberHint = isEdit ? '' : ' <span class="stat-hint">Assigned automatically when saved.</span>';
  const numberField =
    '<div class="field"><span class="field-label">Invoice number</span>' +
    `<p class="detail-value" data-invoice-number>${numberValue}${numberHint}</p></div>`;

  const issueErr = errors.issueDate;
  const issueField = fieldHtml(
    { id: 'invoice-issueDate', label: 'Invoice date *', error: issueErr },
    `<input id="invoice-issueDate" class="field-input" type="date" name="issueDate" value="${esc(values.issueDate)}" required${ariaAttr('invoice-issueDate', issueErr)}>`,
  );

  const dueErr = errors.dueDate;
  const dueField = fieldHtml(
    { id: 'invoice-dueDate', label: 'Due date *', error: dueErr },
    `<input id="invoice-dueDate" class="field-input" type="date" name="dueDate" value="${esc(values.dueDate)}" required${ariaAttr('invoice-dueDate', dueErr)}>`,
  );

  const statusErr = errors.status;
  const statusOptions = [
    ['draft', 'Draft'],
    ['sent', 'Sent'],
  ]
    .map(([value, label]) => `<option value="${value}"${values.status === value ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  const statusField = fieldHtml(
    { id: 'invoice-status', label: 'Status', error: statusErr },
    `<select id="invoice-status" class="field-input filter-select" name="status"${ariaAttr('invoice-status', statusErr)}>${statusOptions}</select>`,
  );

  const descErr = errors.description;
  const descField = fieldHtml(
    { id: 'invoice-description', label: 'Description', error: descErr, span: true },
    `<textarea id="invoice-description" class="field-textarea" name="description" rows="3" maxlength="500"${ariaAttr('invoice-description', descErr)}>${esc(values.description)}</textarea>`,
  );

  const lineItems = values.lineItems && values.lineItems.length ? values.lineItems : [{ name: '', quantity: 1, unitPrice: '' }];
  const itemErrors = Array.isArray(errors.items) ? errors.items : [];
  const disableRemove = lineItems.length <= 1;
  const rowsHtml = lineItems.map((item, i) => renderLineRow(item, i, itemErrors[i], disableRemove)).join('');
  const lineErrorHtml = errors.lineItems
    ? `<p class="field-error" id="invoice-lineItems-error">${esc(errors.lineItems)}</p>`
    : '';
  const lineSection =
    '<section class="line-items-section span-full"><h3 class="card-title">Line items</h3>' +
    `<div class="line-items" data-line-items>${rowsHtml}</div>` +
    lineErrorHtml +
    '<button type="button" class="btn btn-secondary" data-action="add-line">Add line item</button></section>';

  const totals = totalsFor(lineItems);
  const totalsHtml =
    '<div class="totals">' +
    `<div class="totals-row"><span>Subtotal</span><span data-subtotal>${esc(formatINR(totals.subtotal))}</span></div>` +
    `<div class="totals-row totals-grand"><span>Total</span><span data-total>${esc(formatINR(totals.total))}</span></div>` +
    '</div>';

  return (
    `<a class="back-link" href="${esc(cancelHref)}">${isEdit ? BACK_TO_INVOICE : BACK_TO_INVOICES}</a>` +
    renderHeader(title, subtitle) +
    '<section class="card form-card">' +
    `<form class="form" data-form="invoice" data-mode="${mode}" data-id="${esc(isEdit ? id : '')}" novalidate>` +
    formNotice +
    '<div class="form-grid">' +
    clientField +
    numberField +
    issueField +
    dueField +
    statusField +
    descField +
    lineSection +
    '</div>' +
    totalsHtml +
    '<div class="form-actions"><button type="submit" class="btn btn-primary">Save invoice</button>' +
    `<a class="btn btn-secondary" href="${esc(cancelHref)}">Cancel</a></div>` +
    '</form></section>'
  );
}

function detailItem(label, valueHtml) {
  return `<div class="detail-item"><dt class="detail-label">${esc(label)}</dt><dd class="detail-value">${valueHtml}</dd></div>`;
}

function totalRow(label, amount, grand = false) {
  return `<div class="totals-row${grand ? ' totals-grand' : ''}"><span>${esc(label)}</span><span>${esc(formatINR(amount))}</span></div>`;
}

function renderDetailView(inv, state) {
  const encId = encodeURIComponent(inv.id);
  const confirming = Boolean(state && state.confirmDelete);
  const client = listClients().find((c) => c.id === inv.clientId) || null;

  const canRecordPayment = inv.displayStatus !== 'draft' && inv.remaining > 0;
  const blocked = invoiceHasPayments(inv.id);
  const blockedNotice = blocked
    ? '<div class="notice notice-warning" role="status">This invoice has recorded payments, so it cannot be deleted. Its payment records are kept as financial history.</div>'
    : '';
  const actions =
    `<a class="btn btn-secondary" href="#/invoices/${esc(encId)}/edit">Edit</a>` +
    (canRecordPayment
      ? `<a class="btn btn-primary" href="#/payments/record/${esc(encodeURIComponent(inv.id))}">Record payment</a>`
      : '') +
    (confirming || blocked
      ? ''
      : `<button type="button" class="btn btn-danger" data-action="ask-delete" data-id="${esc(inv.id)}">Delete</button>`);

  const confirmPanel = confirming
    ? '<div class="confirm-panel" role="alertdialog" aria-labelledby="invoice-confirm-title" aria-describedby="invoice-confirm-desc">' +
      '<h2 class="card-title" id="invoice-confirm-title">Delete this invoice?</h2>' +
      `<p id="invoice-confirm-desc">${esc(inv.number)} will be removed from CashPilot. This cannot be undone.</p>` +
      '<div class="form-actions">' +
      `<button type="button" class="btn btn-danger" data-action="confirm-delete" data-id="${esc(inv.id)}">Yes, delete invoice</button>` +
      `<button type="button" class="btn btn-secondary" data-action="cancel-delete" data-id="${esc(inv.id)}">Keep invoice</button>` +
      '</div></div>'
    : '';

  const clientLink = client
    ? `<a class="table-link" href="#/clients/${esc(encodeURIComponent(client.id))}">${esc(client.fullName)}</a>`
    : esc('Client removed');

  const detailsBody =
    '<dl class="detail-grid">' +
    detailItem('Invoice number', esc(inv.number)) +
    detailItem('Status', renderInvoiceStatusBadge(inv.displayStatus)) +
    detailItem('Issue date', esc(fmtDate(inv.issueDate))) +
    detailItem('Due date', esc(fmtDate(inv.dueDate))) +
    detailItem('Client', clientLink) +
    '</dl>';

  const clientBody = client
    ? '<dl class="detail-grid">' +
      detailItem('Business', esc(client.businessName || '\u2014')) +
      detailItem('Email', `<a href="mailto:${esc(client.email)}">${esc(client.email)}</a>`) +
      detailItem('Phone', esc(client.phone || '\u2014')) +
      detailItem('Client record', `<a class="table-link" href="#/clients/${esc(encodeURIComponent(client.id))}">View client</a>`) +
      '</dl>'
    : '<p class="empty-text">The client for this invoice has been deleted. The invoice is kept for your records.</p>';

  const itemRows = inv.lineItems
    .map(
      (item) =>
        '<tr>' +
        `<td>${esc(item.name)}</td>` +
        `<td class="num">${esc(item.quantity)}</td>` +
        `<td class="num">${esc(formatINR(item.unitPrice))}</td>` +
        `<td class="num">${esc(formatINR(lineTotal(item)))}</td>` +
        '</tr>',
    )
    .join('');
  const itemsBody =
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Line items</caption><thead><tr>' +
    '<th scope="col">Item</th>' +
    '<th scope="col" class="num">Quantity</th>' +
    '<th scope="col" class="num">Unit price</th>' +
    '<th scope="col" class="num">Line total</th>' +
    `</tr></thead><tbody>${itemRows}</tbody></table></div>`;

  const summaryBody =
    '<div class="totals">' +
    totalRow('Subtotal', inv.subtotal) +
    totalRow('Total', inv.total) +
    totalRow('Total paid', inv.amountPaid) +
    totalRow('Remaining balance', inv.remaining, true) +
    '</div>';

  const descriptionCard = inv.description
    ? renderSection('Description', `<p class="detail-notes">${esc(inv.description)}</p>`)
    : '';

  return (
    `<a class="back-link" href="#/invoices">${BACK_TO_INVOICES}</a>` +
    renderHeader(inv.number, client ? client.fullName : 'Client removed', actions) +
    blockedNotice +
    confirmPanel +
    renderSection('Invoice details', detailsBody) +
    renderSection('Client information', clientBody) +
    renderSection('Line items', itemsBody) +
    renderSection('Summary', summaryBody) +
    renderSection('Payment history', renderPaymentTable(paymentsForInvoice(inv.id))) +
    descriptionCard
  );
}

/** Renders the invoices page for a route object from parseInvoicesRoute, returning an HTML string. */
export function renderInvoicesPage(route, state) {
  const r = route || { view: 'list' };
  const s = state || {};
  const notice = renderNotice(takeFlash());

  if (r.view === 'new') {
    return notice + renderFormView('new', '', null, s);
  }

  if (r.view === 'edit' || r.view === 'detail') {
    const inv = getInvoice(r.id);
    if (!inv) return notice + renderNotFound();
    if (r.view === 'edit') return notice + renderFormView('edit', inv.id, inv, s);
    return notice + renderDetailView(inv, s);
  }

  return notice + renderListView();
}

/** Reads the invoice form, including every line-item row, as raw strings. */
function readInvoiceForm(form) {
  const fd = new FormData(form);
  const str = (name) => {
    const v = fd.get(name);
    return typeof v === 'string' ? v : '';
  };
  const rowValue = (row, name) => {
    const el = row.querySelector(`[name="${name}"]`);
    return el ? el.value : '';
  };
  const lineItems = Array.from(form.querySelectorAll('[data-line-row]')).map((row) => ({
    id: rowValue(row, 'itemId'),
    name: rowValue(row, 'itemName'),
    quantity: rowValue(row, 'itemQuantity'),
    unitPrice: rowValue(row, 'itemUnitPrice'),
  }));
  return {
    clientId: str('clientId'),
    issueDate: str('issueDate'),
    dueDate: str('dueDate'),
    status: str('status'),
    description: str('description'),
    lineItems,
  };
}

/** Recomputes each line total and the subtotal and total text from the form's current inputs. */
function updateFormTotals(form) {
  const items = [];
  form.querySelectorAll('[data-line-row]').forEach((row) => {
    const item = {
      quantity: row.querySelector('[name="itemQuantity"]')?.value ?? '',
      unitPrice: row.querySelector('[name="itemUnitPrice"]')?.value ?? '',
    };
    items.push(item);
    const cell = row.querySelector('[data-line-total]');
    if (cell) cell.textContent = lineTotalText(item);
  });
  const totals = totalsFor(items);
  const sub = form.querySelector('[data-subtotal]');
  const grand = form.querySelector('[data-total]');
  if (sub) sub.textContent = formatINR(totals.subtotal);
  if (grand) grand.textContent = formatINR(totals.total);
}

/** Re-renders the list results slot from the current search and status controls. */
function refreshList(rootEl) {
  const slot = rootEl.querySelector('[data-invoice-results]');
  if (!slot) return;
  const search = rootEl.querySelector('#invoices-search');
  const status = rootEl.querySelector('#invoices-status');
  slot.innerHTML = renderInvoiceRows(
    listInvoices(),
    search ? search.value : '',
    status ? status.value : '',
  );
}

/** Re-renders the form with the given raw values (no errors) and rewires handlers. */
function rerenderForm(rootEl, form, values) {
  const isEdit = form.dataset.mode === 'edit';
  const view = isEdit ? 'edit' : 'new';
  const id = form.dataset.id || '';
  rootEl.innerHTML = renderInvoicesPage({ view, id }, { values });
  attachInvoicesHandlers(rootEl);
}

function navigateTo(target, rootEl) {
  // Capture before assigning: once the hash changes, hashchange re-renders the page.
  const unchanged = location.hash === target;
  location.hash = target;
  if (unchanged) {
    rootEl.innerHTML = renderInvoicesPage(parseInvoicesRoute(target));
    attachInvoicesHandlers(rootEl);
  }
}

/** Wires search, filters, line items, delete confirmation and form submission for the invoices page into rootEl. */
export function attachInvoicesHandlers(rootEl) {
  if (!rootEl) return;

  const onFilterOrFormInput = (event) => {
    const target = event.target;
    if (!target) return;
    if (target.id === 'invoices-search' || target.id === 'invoices-status') {
      refreshList(rootEl);
      return;
    }
    const form = target.closest ? target.closest('form[data-form="invoice"]') : null;
    if (form) updateFormTotals(form);
  };

  rootEl.oninput = onFilterOrFormInput;
  rootEl.onchange = onFilterOrFormInput;

  rootEl.onclick = async (event) => {
    const el = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;

    if (action === 'add-line' || action === 'remove-line') {
      const form = el.closest('form[data-form="invoice"]');
      if (!form) return;
      const values = readInvoiceForm(form);
      if (action === 'add-line') {
        values.lineItems.push({ id: '', name: '', quantity: 1, unitPrice: '' });
      } else {
        const idx = Number(el.dataset.index);
        if (values.lineItems.length > 1 && Number.isInteger(idx) && idx >= 0 && idx < values.lineItems.length) {
          values.lineItems.splice(idx, 1);
        }
      }
      rerenderForm(rootEl, form, values);
    } else if (action === 'ask-delete') {
      if (invoiceHasPayments(id)) {
        setInvoiceFlash('error', 'This invoice has recorded payments, so it cannot be deleted. Its payment records are kept as financial history.');
        rootEl.innerHTML = renderInvoicesPage({ view: 'detail', id });
        attachInvoicesHandlers(rootEl);
        return;
      }
      rootEl.innerHTML = renderInvoicesPage({ view: 'detail', id }, { confirmDelete: true });
      attachInvoicesHandlers(rootEl);
    } else if (action === 'cancel-delete') {
      rootEl.innerHTML = renderInvoicesPage({ view: 'detail', id });
      attachInvoicesHandlers(rootEl);
    } else if (action === 'confirm-delete') {
      if (invoiceHasPayments(id)) {
        setInvoiceFlash('error', 'This invoice has recorded payments, so it cannot be deleted. Its payment records are kept as financial history.');
        rootEl.innerHTML = renderInvoicesPage({ view: 'detail', id });
        attachInvoicesHandlers(rootEl);
        return;
      }
      try {
        const ok = await deleteInvoice(id);
        if (ok) setInvoiceFlash('success', 'Invoice deleted.');
        else setInvoiceFlash('error', 'Could not delete this invoice.');
      } catch (err) {
        setInvoiceFlash('error', err.message || 'Could not delete this invoice.');
      }
      navigateTo('#/invoices', rootEl);
    }
  };

  rootEl.onsubmit = async (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[data-form="invoice"]')) return;
    event.preventDefault();

    const mode = form.dataset.mode === 'edit' ? 'edit' : 'create';
    const id = form.dataset.id || '';
    const values = readInvoiceForm(form);
    const result = mode === 'edit' && id ? validateInvoice(values, id) : validateInvoice(values);

    if (!result.valid) {
      rootEl.innerHTML = renderInvoicesPage(
        { view: mode === 'edit' ? 'edit' : 'new', id },
        { values, errors: result.errors },
      );
      attachInvoicesHandlers(rootEl);
      const firstInvalid = rootEl.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    let target;
    try {
      if (mode === 'create') {
        const created = await createInvoice(result.values);
        setInvoiceFlash('success', 'Invoice created.');
        target = '#/invoices/' + encodeURIComponent(created.id);
      } else {
        await updateInvoice(id, result.values);
        setInvoiceFlash('success', 'Invoice updated.');
        target = '#/invoices/' + encodeURIComponent(id);
      }
    } catch (err) {
      setInvoiceFlash('error', err.message || 'Could not save invoice.');
      target = '#/invoices';
    }
    navigateTo(target, rootEl);
  };
}
