// Expense storage layer backed by the FastAPI SQLite API.

import { apiRequest } from './api.js';

export const EXPENSE_CATEGORIES = Object.freeze([
  'Software & Subscriptions',
  'Internet & Utilities',
  'Rent & Workspace',
  'Equipment',
  'Marketing',
  'Travel',
  'Salaries & Freelancers',
  'Other',
]);

export const PAYMENT_STATUSES = Object.freeze(['paid', 'unpaid']);

const TITLE_MAX = 120;
const VENDOR_MAX = 120;
const NOTES_MAX = 500;
const AMOUNT_MAX = 100000000;
const DUE_SOON_DAYS = 7;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

let expensesCache = [];

export function isPersistent() {
  return true;
}

export async function syncExpenses() {
  expensesCache = await apiRequest('/expenses');
  return listExpenses();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatIso(date) {
  const y = String(date.getFullYear()).padStart(4, '0');
  return `${y}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseIso(iso) {
  if (typeof iso !== 'string') return null;
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

export function todayIso(date = new Date()) {
  return formatIso(date);
}

export function addDaysIso(iso, n) {
  const parsed = parseIso(iso);
  if (!parsed) return '';
  const shifted = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + Number(n));
  return formatIso(shifted);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

function compareExpenses(a, b) {
  if (a.expenseDate !== b.expenseDate) return a.expenseDate < b.expenseDate ? 1 : -1;
  const ta = str(a.title).toLowerCase();
  const tb = str(b.title).toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function compareBills(a, b) {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  const ta = str(a.title).toLowerCase();
  const tb = str(b.title).toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return 0;
}

export function listExpenses() {
  return expensesCache.slice().sort(compareExpenses).map((item) => ({ ...item }));
}

export function getExpense(id) {
  const found = expensesCache.find((item) => item.id === id);
  return found ? { ...found } : null;
}

export function unpaidExpenses() {
  return listExpenses().filter((item) => item.paymentStatus === 'unpaid');
}

export function paidExpenses() {
  return listExpenses().filter((item) => item.paymentStatus === 'paid');
}

export function deriveBillState(expense, today = todayIso()) {
  if (!expense) return 'open';
  if (expense.paymentStatus === 'paid') return 'paid';
  if (!expense.dueDate) return 'open';
  if (expense.dueDate < today) return 'overdue';
  if (expense.dueDate <= addDaysIso(today, DUE_SOON_DAYS)) return 'due_soon';
  return 'open';
}

export function summarizeExpenses(today = todayIso()) {
  const all = expensesCache;
  const monthPrefix = today.slice(0, 7);

  let monthRaw = 0;
  let paidRaw = 0;
  let unpaidRaw = 0;
  const categoryRaw = new Map(EXPENSE_CATEGORIES.map((c) => [c, { total: 0, count: 0 }]));

  for (const item of all) {
    const amount = Number(item.amount) || 0;
    const inMonth = str(item.expenseDate).startsWith(monthPrefix);
    if (item.paymentStatus === 'paid') paidRaw += amount;
    if (item.paymentStatus === 'unpaid') unpaidRaw += amount;
    if (inMonth) {
      monthRaw += amount;
      const bucket = categoryRaw.get(item.category);
      if (bucket) {
        bucket.total += amount;
        bucket.count += 1;
      }
    }
  }

  const monthTotal = round2(monthRaw);

  const upcomingBills = all
    .filter((item) => item.paymentStatus === 'unpaid' && item.dueDate)
    .sort(compareBills)
    .map((item) => ({ ...item, billState: deriveBillState(item, today) }));

  const categoryBreakdown = EXPENSE_CATEGORIES.map((category) => {
    const bucket = categoryRaw.get(category);
    const total = round2(bucket.total);
    return {
      category,
      total,
      count: bucket.count,
      share: monthTotal === 0 ? 0 : round4(total / monthTotal),
    };
  });

  return {
    monthPrefix,
    monthTotal,
    paidTotal: round2(paidRaw),
    unpaidTotal: round2(unpaidRaw),
    upcomingBills,
    categoryBreakdown,
  };
}

export function validateExpense(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};

  const title = str(src.title).trim();
  const category = str(src.category).trim();
  const vendor = str(src.vendor).trim();
  const amountRaw = str(src.amount).trim();
  const expenseDate = str(src.expenseDate).trim();
  const dueDate = str(src.dueDate).trim();
  const paymentStatus = str(src.paymentStatus).trim();
  const notes = str(src.notes).trim();

  if (!title) errors.title = 'Enter a title for this expense.';
  else if (title.length > TITLE_MAX) errors.title = 'Keep the title under 120 characters.';

  if (!EXPENSE_CATEGORIES.includes(category)) errors.category = 'Choose a category.';
  if (vendor.length > VENDOR_MAX) errors.vendor = 'Keep the vendor name under 120 characters.';

  if (!amountRaw) errors.amount = 'Enter the amount.';
  else if (!AMOUNT_RE.test(amountRaw) || Number(amountRaw) > AMOUNT_MAX) {
    errors.amount = 'Enter a valid amount, for example 1500 or 1500.50.';
  } else if (Number(amountRaw) <= 0) {
    errors.amount = 'Amount must be greater than zero.';
  }

  const expenseParsed = parseIso(expenseDate);
  if (!expenseParsed) errors.expenseDate = 'Enter a valid expense date.';

  if (dueDate !== '') {
    if (!parseIso(dueDate)) errors.dueDate = 'Enter a valid due date.';
    else if (expenseParsed && dueDate < expenseDate) {
      errors.dueDate = 'The due date cannot be before the expense date.';
    }
  }

  if (!PAYMENT_STATUSES.includes(paymentStatus)) errors.paymentStatus = 'Choose paid or unpaid.';
  if (notes.length > NOTES_MAX) errors.notes = 'Keep notes under 500 characters.';

  const values = {
    title,
    category,
    vendor,
    amount: round2(Number(amountRaw)),
    expenseDate,
    dueDate,
    paymentStatus,
    notes,
  };

  return { valid: Object.keys(errors).length === 0, errors, values };
}

export async function createExpense(values) {
  const created = await apiRequest('/expenses', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  expensesCache.push(created);
  return { ...created };
}

export async function updateExpense(id, values) {
  const updated = await apiRequest(`/expenses/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  });
  const idx = expensesCache.findIndex((item) => item.id === id);
  if (idx !== -1) expensesCache[idx] = updated;
  return { ...updated };
}

export async function deleteExpense(id) {
  await apiRequest(`/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  expensesCache = expensesCache.filter((item) => item.id !== id);
  return true;
}
