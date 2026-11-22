// Invoice storage layer backed by the FastAPI SQLite API.

import { apiRequest } from './api.js';
import { listClients } from './clients-store.js';
import { sumPaidForInvoice, paymentsForInvoice } from './payments-store.js';
import { formatINR } from './format.js';

const DESCRIPTION_MAX = 500;
const ITEM_NAME_MAX = 200;
const QUANTITY_MAX = 100000;
const UNIT_PRICE_MAX = 100000000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^INV-(\d{4})-(\d+)$/;

export const INVOICE_STATUSES = Object.freeze(['draft', 'sent', 'partially_paid', 'paid', 'overdue']);

export const INVOICE_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
});

let invoicesCache = [];

export function isPersistent() {
  return true;
}

export async function syncInvoices() {
  invoicesCache = await apiRequest('/invoices');
  return listInvoices();
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function lineTotal(item) {
  return round2(Number(item.quantity) * Number(item.unitPrice));
}

export function computeTotals(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const subtotal = round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
  return { subtotal, total: subtotal };
}

export function todayIso(date = new Date()) {
  return localDate(date);
}

export function deriveStatus(record, today = todayIso()) {
  const { total } = computeTotals(record.lineItems);
  const paid = Number(record.amountPaid) || 0;
  const remaining = Math.max(0, round2(total - paid));
  if (total > 0 && remaining <= 0) return 'paid';
  if (record.status !== 'draft' && record.dueDate < today) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return record.status;
}

function enrich(record, today) {
  const paid = sumPaidForInvoice(record.id);
  const withPaid = { ...record, amountPaid: paid };
  const { subtotal, total } = computeTotals(record.lineItems);
  const remaining = Math.max(0, round2(total - paid));
  return {
    ...withPaid,
    subtotal,
    total,
    remaining,
    displayStatus: deriveStatus(withPaid, today),
  };
}

export function enrichInvoice(record, today = todayIso()) {
  return enrich(record, today);
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

export function nextInvoiceNumber(issueDate) {
  const year = isValidDate(issueDate) ? issueDate.slice(0, 4) : String(new Date().getFullYear());
  let max = 0;
  for (const r of invoicesCache) {
    const m = NUMBER_RE.exec(String(r.number ?? ''));
    if (m && m[1] === year) max = Math.max(max, Number(m[2]));
  }
  return `INV-${year}-${pad3(max + 1)}`;
}

function compareInvoices(a, b) {
  const ai = String(a.issueDate ?? '');
  const bi = String(b.issueDate ?? '');
  if (ai !== bi) return ai < bi ? 1 : -1;
  const an = String(a.number ?? '');
  const bn = String(b.number ?? '');
  if (an !== bn) return an < bn ? 1 : -1;
  return 0;
}

export function listInvoices() {
  const today = todayIso();
  return invoicesCache
    .map((r) => enrich(r, today))
    .sort(compareInvoices);
}

export function getInvoice(id) {
  const today = todayIso();
  const found = invoicesCache.find((r) => r.id === id);
  return found ? enrich(found, today) : null;
}

export function getInvoicesForClient(clientId) {
  const today = todayIso();
  return invoicesCache
    .filter((r) => r.clientId === clientId)
    .map((r) => enrich(r, today))
    .sort(compareInvoices);
}

export function getClientOutstanding(clientId) {
  const total = getInvoicesForClient(clientId).reduce((sum, inv) => sum + inv.remaining, 0);
  return round2(total);
}

function validateItem(item) {
  const itemErrors = {};
  if (!item.name) itemErrors.name = 'Enter a name for this item.';
  else if (item.name.length > ITEM_NAME_MAX) itemErrors.name = 'Keep the item name under 200 characters.';

  if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > QUANTITY_MAX) {
    itemErrors.quantity = 'Quantity must be greater than zero.';
  }

  if (item.rawUnitPrice === '' || !Number.isFinite(item.unitPrice)) {
    itemErrors.unitPrice = 'Enter a valid unit price.';
  } else if (item.unitPrice < 0) {
    itemErrors.unitPrice = 'Unit price cannot be negative.';
  } else if (item.unitPrice > UNIT_PRICE_MAX) {
    itemErrors.unitPrice = 'Enter a valid unit price.';
  }
  return itemErrors;
}

export function validateInvoice(input, existingId = undefined) {
  const str = (x) => (x == null ? '' : String(x).trim());
  const rawItems = Array.isArray(input?.lineItems) ? input.lineItems : [];

  const items = rawItems.map((item) => {
    const out = {
      name: str(item?.name),
      quantity: Number(item?.quantity),
      unitPrice: Number(item?.unitPrice),
      rawUnitPrice: str(item?.unitPrice),
    };
    if (item?.id) out.id = str(item.id);
    return out;
  });

  const values = {
    clientId: str(input?.clientId),
    issueDate: str(input?.issueDate),
    dueDate: str(input?.dueDate),
    description: str(input?.description),
    status: str(input?.status) || 'draft',
    lineItems: items.map(({ rawUnitPrice, ...rest }) => rest),
  };

  const errors = {};
  const clientIds = new Set(listClients().map((c) => c.id));
  if (!values.clientId || !clientIds.has(values.clientId)) {
    errors.clientId = 'Choose a client for this invoice.';
  }

  const issueOk = isValidDate(values.issueDate);
  if (!issueOk) errors.issueDate = 'Enter a valid invoice date.';

  const dueOk = isValidDate(values.dueDate);
  if (!dueOk) errors.dueDate = 'Enter a valid due date.';
  else if (issueOk && values.dueDate < values.issueDate) {
    errors.dueDate = 'The due date cannot be before the invoice date.';
  }

  if (values.description.length > DESCRIPTION_MAX) {
    errors.description = 'Keep the description under 500 characters.';
  }

  if (values.status !== 'draft' && values.status !== 'sent') {
    errors.status = 'Choose draft or sent.';
  }

  if (items.length === 0) errors.lineItems = 'Add at least one line item.';

  const itemErrors = items.map(validateItem);
  if (itemErrors.some((e) => Object.keys(e).length > 0)) errors.items = itemErrors;

  if (existingId) {
    const paid = sumPaidForInvoice(existingId);
    const totals = computeTotals(values.lineItems.map((it) => ({ quantity: it.quantity, unitPrice: it.unitPrice })));
    if (!errors.lineItems && Number.isFinite(totals.total) && paid > 0 && round2(totals.total) < paid) {
      errors.lineItems = 'The total cannot be below the ' + formatINR(paid) + ' already paid on this invoice. Keep the total at or above that amount, or record a refund outside CashPilot.';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, values };
}

export async function createInvoice(values) {
  const created = await apiRequest('/invoices', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  invoicesCache.push(created);
  return enrich(created, todayIso());
}

export async function updateInvoice(id, values) {
  const updated = await apiRequest(`/invoices/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  });
  const idx = invoicesCache.findIndex((r) => r.id === id);
  if (idx !== -1) invoicesCache[idx] = updated;
  return enrich(updated, todayIso());
}

export function invoiceHasPayments(id) {
  return paymentsForInvoice(id).length > 0;
}

export async function deleteInvoice(id) {
  if (invoiceHasPayments(id)) return false;
  await apiRequest(`/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  invoicesCache = invoicesCache.filter((r) => r.id !== id);
  return true;
}
