// Payment storage layer backed by the FastAPI SQLite API.

import { apiRequest } from './api.js';
import { formatINR } from './format.js';

const NOTES_MAX = 500;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PAYMENT_METHODS = Object.freeze(['upi', 'bank_transfer', 'cash', 'card', 'other']);

export const PAYMENT_METHOD_LABELS = Object.freeze({
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
});

let paymentsCache = [];

export function isPersistent() {
  return true;
}

export async function syncPayments() {
  paymentsCache = await apiRequest('/payments');
  return listPayments();
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function comparePayments(a, b) {
  const ad = String(a.paymentDate ?? '');
  const bd = String(b.paymentDate ?? '');
  if (ad !== bd) return ad < bd ? 1 : -1;
  const ar = String(a.reference ?? '');
  const br = String(b.reference ?? '');
  if (ar !== br) return ar < br ? 1 : -1;
  return 0;
}

export function listPayments() {
  return paymentsCache.slice().sort(comparePayments).map((r) => ({ ...r }));
}

export function getPayment(id) {
  const found = paymentsCache.find((r) => r.id === id);
  return found ? { ...found } : null;
}

export function paymentsForInvoice(invoiceId) {
  return paymentsCache
    .filter((r) => r.invoiceId === invoiceId)
    .sort(comparePayments)
    .map((r) => ({ ...r }));
}

export function sumPaidForInvoice(invoiceId) {
  const total = paymentsCache
    .filter((r) => r.invoiceId === invoiceId)
    .reduce((sum, r) => sum + (Number(r.amountReceived) || 0), 0);
  return round2(total);
}

export function validatePayment(input, invoice) {
  const str = (x) => (x == null ? '' : String(x).trim());
  const amountStr = str(input?.amount);
  const paymentDate = str(input?.paymentDate);
  const method = str(input?.method);
  const notes = str(input?.notes);
  const invoiceId = str(input?.invoiceId);
  const amountValue = round2(Number(amountStr));

  const values = {
    invoiceId,
    amount: amountValue,
    paymentDate,
    method,
    notes,
  };

  const errors = {};

  if (!invoice) {
    errors.invoiceId = 'Choose an invoice to record this payment against.';
  } else if (invoice.displayStatus === 'draft') {
    errors.invoiceId = 'Send this invoice before recording a payment.';
  } else if (invoice.displayStatus === 'paid' || !(invoice.remaining > 0)) {
    errors.invoiceId = 'This invoice is already fully paid.';
  }

  if (amountStr === '') {
    errors.amount = 'Enter the amount received.';
  } else if (!AMOUNT_RE.test(amountStr) || !Number.isFinite(Number(amountStr))) {
    errors.amount = 'Enter a valid amount, for example 1500 or 1500.50.';
  } else if (amountValue <= 0) {
    errors.amount = 'Payment amount must be greater than zero.';
  } else if (invoice && amountValue > invoice.remaining) {
    errors.amount = 'The payment cannot exceed the remaining balance of ' + formatINR(invoice.remaining) + '.';
  }

  if (!isValidDate(paymentDate)) errors.paymentDate = 'Enter a valid payment date.';
  if (!PAYMENT_METHODS.includes(method)) errors.method = 'Choose a payment method.';
  if (notes.length > NOTES_MAX) errors.notes = 'Keep notes under 500 characters.';

  return { valid: Object.keys(errors).length === 0, errors, values };
}

export async function createPayment(values) {
  const created = await apiRequest('/payments', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  paymentsCache.push(created);
  return { ...created };
}
