import { apiRequest } from './api.js';
import { listInvoices } from './invoices-store.js';
import { unpaidExpenses } from './expenses-store.js';

export const FORECAST_HORIZONS = Object.freeze([30, 60, 90]);
export const OVERDUE_COLLECTION_DAYS = 14;
export const MAX_HORIZON_DAYS = 90;

const AMOUNT_LIMIT = 1e10;
const DEFAULT_OPENING_CASH = 485200;
const DEFAULT_MINIMUM_CASH = 50000;
const MS_PER_DAY = 86400000;
const OPEN_INVOICE_STATUSES = Object.freeze(['sent', 'partially_paid', 'overdue']);
const OPENING_PATTERN = /^-?\d+(\.\d{1,2})?$/;
const MINIMUM_PATTERN = /^\d+(\.\d{1,2})?$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

let settingsCache = {
  businessName: 'PixelCraft Studio',
  ownerFirstName: 'Aarav',
  openingCash: DEFAULT_OPENING_CASH,
  minimumCash: DEFAULT_MINIMUM_CASH,
  isDefault: false,
};

export async function syncSettings() {
  const remote = await apiRequest('/settings');
  settingsCache = { ...remote, isDefault: false };
  return getForecastSettings();
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayIso(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseIso(value) {
  if (typeof value !== 'string' || !ISO_PATTERN.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return [y, m, d];
}

function addDays(iso, n) {
  const [y, m, d] = parseIso(iso);
  return todayIso(new Date(y, m - 1, d + n));
}

function dayOffset(fromIso, toIso) {
  const [y1, m1, d1] = parseIso(fromIso);
  const [y2, m2, d2] = parseIso(toIso);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / MS_PER_DAY);
}

function isAmountInRange(value, min) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= AMOUNT_LIMIT;
}

function toText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function getForecastSettings() {
  return {
    businessName: settingsCache.businessName || 'PixelCraft Studio',
    ownerFirstName: settingsCache.ownerFirstName || 'Aarav',
    openingCash: round2(settingsCache.openingCash),
    minimumCash: round2(settingsCache.minimumCash),
    isDefault: Boolean(settingsCache.isDefault),
  };
}

export function validateForecastSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const values = { openingCash: null, minimumCash: null };

  const openingText = toText(source.openingCash);
  if (openingText === '') {
    errors.openingCash = 'Enter the opening cash balance.';
  } else if (!OPENING_PATTERN.test(openingText) || !isAmountInRange(Number(openingText), -AMOUNT_LIMIT)) {
    errors.openingCash = 'Enter a valid amount, for example 485200 or -12000.50.';
  } else {
    values.openingCash = round2(Number(openingText));
  }

  const minimumText = toText(source.minimumCash);
  if (minimumText === '') {
    errors.minimumCash = 'Enter the minimum cash level.';
  } else if (!MINIMUM_PATTERN.test(minimumText) || !isAmountInRange(Number(minimumText), 0)) {
    errors.minimumCash = 'Enter a valid minimum, zero or more, for example 50000.';
  } else {
    values.minimumCash = round2(Number(minimumText));
  }

  return { valid: Object.keys(errors).length === 0, errors, values };
}

export async function saveForecastSettings(input) {
  const result = validateForecastSettings(input);
  if (!result.valid) {
    return { valid: false, errors: result.errors, values: null };
  }
  const updated = await apiRequest('/settings', {
    method: 'PUT',
    body: JSON.stringify({
      businessName: settingsCache.businessName,
      ownerFirstName: settingsCache.ownerFirstName,
      openingCash: result.values.openingCash,
      minimumCash: result.values.minimumCash,
    }),
  });
  settingsCache = { ...updated, isDefault: false };
  return { valid: true, errors: {}, values: result.values };
}

function compareEvents(a, b) {
  if (a.offset !== b.offset) return a.offset - b.offset;
  if (a.kind !== b.kind) return a.kind === 'out' ? -1 : 1;
  if (a.description !== b.description) return a.description < b.description ? -1 : 1;
  const aId = String(a.sourceId);
  const bId = String(b.sourceId);
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

export function buildForecast(today = todayIso(), settings = getForecastSettings(), scenario = null) {
  const asOf = parseIso(today) ? today : todayIso();
  const current = getForecastSettings();
  const source = settings && typeof settings === 'object' ? settings : {};

  const openingCash = isAmountInRange(source.openingCash, -AMOUNT_LIMIT)
    ? round2(source.openingCash)
    : current.openingCash;
  const minimumCash = isAmountInRange(source.minimumCash, 0)
    ? round2(source.minimumCash)
    : current.minimumCash;
  const resolvedSettings = {
    openingCash,
    minimumCash,
    isDefault: typeof source.isDefault === 'boolean' ? source.isDefault : current.isDefault,
  };

  const all = [];
  let draftCount = 0;
  const delayed = scenario && typeof scenario === 'object' && typeof scenario.invoiceId === 'string'
    ? { invoiceId: scenario.invoiceId, days: Number.isInteger(scenario.days) && scenario.days >= 0 ? scenario.days : 0 }
    : null;

  for (const inv of listInvoices()) {
    if (inv.displayStatus === 'draft') {
      draftCount += 1;
      continue;
    }
    if (!OPEN_INVOICE_STATUSES.includes(inv.displayStatus)) continue;
    const remaining = Number(inv.remaining);
    if (!(remaining > 0)) continue;

    const amount = round2(remaining);
    const baseDue = parseIso(inv.dueDate) ? inv.dueDate : '';
    const isDelayed = delayed !== null && delayed.invoiceId === inv.id && baseDue !== '';
    const dueDate = isDelayed ? addDays(baseDue, delayed.days) : baseDue;
    let offset;
    let flag;
    if (!dueDate) {
      offset = 0;
      flag = 'no_due_date';
    } else if (dueDate < asOf) {
      offset = OVERDUE_COLLECTION_DAYS;
      flag = 'overdue';
    } else {
      offset = dayOffset(asOf, dueDate);
      flag = '';
    }

    all.push({
      kind: 'in',
      source: 'invoice',
      sourceId: inv.id,
      reference: inv.number,
      description: 'Invoice ' + inv.number,
      amount,
      offset,
      flag,
    });
  }

  for (const exp of unpaidExpenses()) {
    const amount = round2(Number(exp.amount));
    if (!Number.isFinite(amount)) continue;

    const dueDate = parseIso(exp.dueDate) ? exp.dueDate : '';
    let offset;
    let flag;
    if (!dueDate) {
      offset = 0;
      flag = 'no_due_date';
    } else if (dueDate < asOf) {
      offset = 0;
      flag = 'overdue';
    } else {
      offset = dayOffset(asOf, dueDate);
      flag = '';
    }

    all.push({
      kind: 'out',
      source: 'expense',
      sourceId: exp.id,
      reference: exp.title,
      description: exp.title + (exp.vendor ? ' · ' + exp.vendor : ''),
      amount,
      offset,
      flag,
    });
  }

  const kept = all
    .filter((e) => e.offset <= MAX_HORIZON_DAYS)
    .map((e) => ({ ...e, date: addDays(asOf, e.offset) }));
  const beyondCount = all.length - kept.length;

  kept.sort(compareEvents);

  let balance = openingCash;
  for (const e of kept) {
    balance = round2(balance + (e.kind === 'in' ? e.amount : -e.amount));
    e.runningBalance = balance;
  }

  const horizons = FORECAST_HORIZONS.map((H) => {
    const within = kept.filter((e) => e.offset <= H);
    let incomeRaw = 0;
    let outflowRaw = 0;
    for (const e of within) {
      if (e.kind === 'in') incomeRaw += e.amount;
      else outflowRaw += e.amount;
    }
    const income = round2(incomeRaw);
    const outflow = round2(outflowRaw);
    const closing = round2(openingCash + income - outflow);

    let running = openingCash;
    let minRunning = round2(openingCash);
    let minRunningDate = asOf;
    for (const e of within) {
      running = round2(running + (e.kind === 'in' ? e.amount : -e.amount));
      if (running < minRunning) {
        minRunning = running;
        minRunningDate = e.date;
      }
    }

    const breach = minRunning < 0 ? 'negative' : (minRunning < minimumCash ? 'below_minimum' : '');

    return {
      days: H,
      endDate: addDays(asOf, H),
      income,
      outflow,
      closing,
      minRunning,
      minRunningDate,
      lowCash: breach !== '',
      breach,
    };
  });

  const assumptions = [
    `${draftCount} draft invoice(s) excluded.`,
    'Invoice amounts are the remaining balance after recorded payments.',
    'Invoices are collected on their due date.',
    `Overdue invoices are assumed collected ${OVERDUE_COLLECTION_DAYS} days from today and flagged.`,
    'Unpaid expenses are paid on their due date.',
    'Unpaid expenses without a due date are treated as due today and flagged.',
    'Overdue unpaid expenses are treated as due today and flagged.',
    'Paid expenses are excluded.',
    `${beyondCount} event(s) beyond ${MAX_HORIZON_DAYS} days excluded.`,
    'Same-day outflows are applied before inflows.',
    'Amounts are not tax-adjusted and exclude unbilled work and future invoices not yet created.',
  ];

  return {
    today: asOf,
    settings: resolvedSettings,
    horizons,
    events: kept,
    assumptions,
    scenario: delayed ? { invoiceId: delayed.invoiceId, days: delayed.days, applied: all.some((e) => e.kind === 'in' && e.sourceId === delayed.invoiceId) } : null,
  };
}
