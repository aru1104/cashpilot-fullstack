// What-if Simulator page: compares the baseline forecast with a 15-day late payment of the largest open invoice.

import { buildForecast, getForecastSettings } from '../forecast.js';
import { listInvoices } from '../invoices-store.js';
import { listClients } from '../clients-store.js';
import { formatINR, formatDate } from '../format.js';
import { escapeHtml } from '../components.js';

const MINUS = '\u2212';
const DELAY_DAYS = 15;
const OVERDUE_COLLECTION_DAYS = 14;
const OPEN_STATUSES = Object.freeze(['sent', 'partially_paid', 'overdue']);
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_LABELS = Object.freeze({ sent: 'Sent', partially_paid: 'Partially paid', overdue: 'Overdue' });

// Session-only state; not persisted.
let delayEnabled = false;

export function setSimulatorDelay(enabled) {
  delayEnabled = Boolean(enabled);
}

export function getSimulatorDelay() {
  return delayEnabled;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayIso(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parses 'YYYY-MM-DD' into [y, m, d] or null. Never uses new Date(string). */
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
  const parts = parseIso(iso);
  if (!parts) return null;
  const [y, m, d] = parts;
  return todayIso(new Date(y, m - 1, d + n));
}

function dayOffset(fromIso, toIso) {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!a || !b) return null;
  const MS_PER_DAY = 86400000;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / MS_PER_DAY);
}

/** Formats a 'YYYY-MM-DD' string from its parts, never via new Date(string). */
function fmtDate(value) {
  const parts = parseIso(value);
  if (!parts) return '';
  const [y, m, d] = parts;
  return formatDate(new Date(y, m - 1, d));
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function signed(d) {
  if (d === 0) return formatINR(0);
  if (d > 0) return '+' + formatINR(d);
  return MINUS + formatINR(Math.abs(d));
}

/** Pure selection: largest remaining balance among open invoices; ties by dueDate then number. */
export function selectLargestOutstanding(invoices) {
  const eligible = (Array.isArray(invoices) ? invoices : []).filter(
    (inv) => inv && OPEN_STATUSES.includes(inv.displayStatus) && Number(inv.remaining) > 0,
  );
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    const ra = Number(a.remaining);
    const rb = Number(b.remaining);
    if (ra !== rb) return rb - ra;
    const da = String(a.dueDate ?? '');
    const db = String(b.dueDate ?? '');
    if (da !== db) return da < db ? -1 : 1;
    const na = String(a.number ?? '');
    const nb = String(b.number ?? '');
    if (na !== nb) return na < nb ? -1 : 1;
    return 0;
  });
  return eligible[0];
}

export function buildSimulation(today = todayIso()) {
  const asOf = parseIso(today) ? today : todayIso();
  const invoice = selectLargestOutstanding(listInvoices());
  if (!invoice) {
    return {
      hasInvoice: false,
      today: asOf,
      invoice: null,
      client: null,
      originalDue: null,
      simulatedDue: null,
      delayDays: DELAY_DAYS,
      baseline: null,
      scenario: null,
      rows: [],
      warnings: [],
    };
  }

  const client = listClients().find((c) => c.id === invoice.clientId) || null;
  const originalDue = invoice.dueDate;
  const simulatedDue = addDays(originalDue, DELAY_DAYS);

  const settings = getForecastSettings();
  const baseline = buildForecast(asOf, settings);
  const scenario = buildForecast(asOf, settings, { invoiceId: invoice.id, days: DELAY_DAYS });

  // Offset used by forecast.js: overdue -> OVERDUE_COLLECTION_DAYS; no due date -> 0.
  let originalOffset;
  if (!parseIso(originalDue)) {
    originalOffset = 0;
  } else if (originalDue < asOf) {
    originalOffset = OVERDUE_COLLECTION_DAYS;
  } else {
    originalOffset = dayOffset(asOf, originalDue);
  }
  const simulatedOffset = originalOffset + DELAY_DAYS;

  const rows = [0, 1, 2].map((i) => {
    const bh = baseline.horizons[i];
    const sh = scenario.horizons[i];
    const days = bh.days;
    return {
      days,
      baselineClosing: bh.closing,
      scenarioClosing: sh.closing,
      difference: round2(sh.closing - bh.closing),
      baselineBreach: bh.breach,
      scenarioBreach: sh.breach,
      baselineMin: bh.minRunning,
      scenarioMin: sh.minRunning,
      crossesHorizon: (originalOffset <= days) !== (simulatedOffset <= days),
    };
  });

  const warnings = [];
  for (const row of rows) {
    const { days, scenarioBreach, baselineBreach, scenarioMin } = row;
    if ((scenarioBreach === 'negative' || scenarioBreach === 'below_minimum') && scenarioBreach !== baselineBreach) {
      const message =
        scenarioBreach === 'negative'
          ? 'With the 15-day delay, projected cash falls below zero within ' + days + ' days (lowest point ' + formatINR(scenarioMin) + ').'
          : 'With the 15-day delay, projected cash falls below your minimum of ' + formatINR(settings.minimumCash) + ' within ' + days + ' days (lowest point ' + formatINR(scenarioMin) + ').';
      warnings.push({ days, type: scenarioBreach, cause: 'delay', message });
    } else if (scenarioBreach && scenarioBreach === baselineBreach) {
      warnings.push({
        days,
        type: 'existing',
        cause: 'baseline',
        message: 'Existing shortfall in the baseline at ' + days + ' days, not caused by the delay.',
      });
    }
  }

  return {
    hasInvoice: true,
    today: asOf,
    invoice,
    client,
    originalDue,
    simulatedDue,
    delayDays: DELAY_DAYS,
    baseline,
    scenario,
    rows,
    warnings,
  };
}

function renderLargestInvoiceCard(sim) {
  const inv = sim.invoice;
  const client = sim.client;
  const isOverdue = inv.displayStatus === 'overdue';
  const originalText = fmtDate(sim.originalDue) + (isOverdue ? ' (overdue)' : '');
  const simulatedText = fmtDate(sim.simulatedDue);
  const items = [
    ['Client', client ? client.fullName : 'Client removed', ''],
    ['Invoice number', inv.number, ''],
    ['Outstanding amount', formatINR(Number(inv.remaining)), ' num'],
    ['Original expected payment date', originalText, ''],
    ['Simulated payment date', `${simulatedText} <span class="stat-hint">15 days later</span>`, ''],
    ['Status', STATUS_LABELS[inv.displayStatus] || '', ''],
  ]
    .map(([label, value, cls]) => {
      const valueHtml = label === 'Simulated payment date' ? value : escapeHtml(value);
      return `<div><dt>${escapeHtml(label)}</dt><dd class="${cls.trim()}">${valueHtml}</dd></div>`;
    })
    .join('');
  return `<section class="card"><div class="card-header"><h2 class="card-title">Largest outstanding invoice</h2></div><div class="card-body"><dl class="detail-grid">${items}</dl></div></section>`;
}

function renderControlCard() {
  return (
    '<section class="card"><form class="form" data-form="simulator-control" novalidate>' +
    `<label class="toggle-label" for="simulator-delay"><input type="checkbox" id="simulator-delay" name="delay" value="1"${
      delayEnabled ? ' checked' : ''
    }><span>Simulate a 15-day late payment for this invoice</span></label>` +
    '</form></section>'
  );
}

function renderComparisonCard(sim) {
  const hint = delayEnabled
    ? 'Showing the 15-day delay scenario alongside the baseline.'
    : 'Delay is off: the simulated column equals the baseline. Turn on the delay to compare.';
  const rows = sim.rows
    .map((r) => {
      const simulated = delayEnabled ? r.scenarioClosing : r.baselineClosing;
      const diff = delayEnabled ? signed(r.difference) : '₹0';
      return (
        `<tr><th scope="row">${escapeHtml(`${r.days}-day closing cash`)}</th>` +
        `<td class="num">${escapeHtml(formatINR(r.baselineClosing))}</td>` +
        `<td class="num">${escapeHtml(formatINR(simulated))}</td>` +
        `<td class="num">${escapeHtml(diff)}</td></tr>`
      );
    })
    .join('');
  return (
    '<section class="card"><div class="card-header"><h2 class="card-title">Projected closing cash</h2></div><div class="card-body">' +
    `<p class="stat-hint">${escapeHtml(hint)}</p>` +
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Baseline versus 15-day delay</caption>' +
    '<thead><tr><th scope="col">Metric</th><th scope="col" class="num">Baseline (current plan)</th><th scope="col" class="num">15-day delay (simulated)</th><th scope="col" class="num">Difference</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div></div></section>`
  );
}

function renderWarningsCard(sim) {
  const delayWarnings = sim.warnings.filter((w) => w.cause === 'delay');
  const baselineWarnings = sim.warnings.filter((w) => w.cause === 'baseline');

  let status;
  if (!delayEnabled) {
    status = '<div class="notice notice-warning" role="status">Turn on the delay to check whether it causes a shortage.</div>';
  } else if (delayWarnings.length) {
    const paras = delayWarnings.map((w) => `<p>${escapeHtml(w.message)}</p>`).join('');
    status = `<div class="notice notice-error" role="alert">${paras}</div>`;
  } else {
    status = '<div class="notice notice-success" role="status">The delay does not push projected cash below zero or your minimum at 30, 60 or 90 days.</div>';
  }

  let baselineHtml = '';
  if (baselineWarnings.length) {
    baselineHtml =
      '<p class="stat-hint">Existing shortfall, not caused by the delay:</p>' +
      baselineWarnings.map((w) => `<p class="stat-hint">${escapeHtml(w.message)}</p>`).join('');
  }

  return `<section class="card"><div class="card-header"><h2 class="card-title">Shortage check</h2></div><div class="card-body">${status}${baselineHtml}</div></section>`;
}

function renderAssumptionsCard() {
  const items = [
    'Only the largest outstanding invoice moves; all other invoices and expenses stay as in the baseline.',
    'The delayed invoice is collected 15 days after its original due date.',
    'Overdue invoices are assumed collected 14 days from today in the baseline; the delay is added on top of that.',
    'Amounts are the remaining balance after recorded payments; no stored record is changed.',
    'Results use the same forecast rules as the Cash Forecast page.',
  ]
    .map((t) => `<li class="list-item">${escapeHtml(t)}</li>`)
    .join('');
  return `<section class="card"><div class="card-header"><h2 class="card-title">How this simulation works</h2></div><div class="card-body"><ul class="list">${items}</ul></div></section>`;
}

const DISCLAIMER = '<p class="stat-hint">This simulator is temporary. Turning the delay off or leaving the page removes it.</p>';

/** Renders the full What-if Simulator page as an HTML string. */
export function renderSimulatorPage() {
  const header =
    '<header class="page-header"><div><h1 class="page-title">What-if Simulator</h1>' +
    '<p class="page-subtitle">See how a late client payment changes your projected cash.</p></div></header>';
  const sim = buildSimulation(todayIso());

  if (!sim.hasInvoice) {
    return (
      header +
      '<section class="card"><div class="empty-state"><h2 class="empty-title">No outstanding invoices</h2>' +
      '<p class="empty-text">Once an invoice is sent, partially paid or overdue, you can simulate a late payment here.</p>' +
      '<a class="btn btn-secondary" href="#/invoices">Go to invoices</a></div></section>' +
      renderAssumptionsCard() +
      DISCLAIMER
    );
  }

  return (
    header +
    renderLargestInvoiceCard(sim) +
    renderControlCard() +
    renderComparisonCard(sim) +
    renderWarningsCard(sim) +
    renderAssumptionsCard() +
    DISCLAIMER
  );
}

/** Attaches the delay toggle handler to the page root (property handler only). */
export function attachSimulatorHandlers(rootEl) {
  rootEl.onchange = (event) => {
    if (!event.target || event.target.id !== 'simulator-delay') return;
    setSimulatorDelay(event.target.checked);
    rootEl.innerHTML = renderSimulatorPage();
    attachSimulatorHandlers(rootEl);
  };
}
