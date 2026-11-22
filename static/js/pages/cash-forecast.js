// Cash Forecast page: projected cash from unpaid invoices and unpaid expenses.

import {
  FORECAST_HORIZONS,
  OVERDUE_COLLECTION_DAYS,
  getForecastSettings,
  validateForecastSettings,
  saveForecastSettings,
  buildForecast,
} from '../forecast.js';
import { setFlash, takeFlash } from '../flash.js';
import { formatINR, formatDate } from '../format.js';
import { escapeHtml } from '../components.js';

const MINUS = '\u2212';

/** Formats a 'YYYY-MM-DD' string from its parts, never via new Date(string). */
function fmtDate(value) {
  if (typeof value !== 'string') return '';
  const [y, m, d] = value.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d));
}

function renderFlash(flash) {
  if (!flash) return '';
  const cls = flash.type === 'success' ? 'notice-success' : 'notice-error';
  return `<div class="notice ${cls}" role="status">${escapeHtml(flash.message)}</div>`;
}

function renderLowCashAlert(forecast, minimumCash) {
  const first = forecast.horizons.find((h) => h.lowCash);
  if (!first) {
    return '<div class="notice notice-success" role="status">No projected shortfall in the next 90 days at your current minimum.</div>';
  }
  const low = `(lowest point ${formatINR(first.minRunning)} on ${fmtDate(first.minRunningDate)})`;
  if (first.breach === 'negative') {
    return `<div class="notice notice-error" role="alert">${escapeHtml(
      `Cash is projected to go negative within ${first.days} days ${low}.`,
    )}</div>`;
  }
  return `<div class="notice notice-error" role="alert">${escapeHtml(
    `Cash is projected to fall below your minimum of ${formatINR(minimumCash)} within ${first.days} days ${low}.`,
  )}</div>`;
}

function renderSummaryCards(settings, forecast) {
  const cards = [
    `<div class="card"><p class="stat-label">Opening cash</p><p class="stat-value">${escapeHtml(
      formatINR(settings.openingCash),
    )}</p><p class="stat-hint">Current balance you entered</p></div>`,
  ];
  for (const h of forecast.horizons) {
    const hint = `Income ${formatINR(h.income)} · Outflow ${formatINR(h.outflow)} · to ${fmtDate(h.endDate)}`;
    const badge = h.lowCash ? ' <span class="badge badge-overdue">Low cash</span>' : '';
    cards.push(
      `<div class="card"><p class="stat-label">${escapeHtml(`In ${h.days} days`)}</p><p class="stat-value">${escapeHtml(
        formatINR(h.closing),
      )}</p><p class="stat-hint">${escapeHtml(hint)}${badge}</p></div>`,
    );
  }
  return `<div class="summary-grid">${cards.join('')}</div>`;
}

function renderField(name, label, value, error) {
  const id = `forecast-${name}`;
  const invalidCls = error ? ' field-invalid' : '';
  const aria = error ? ` aria-invalid="true" aria-describedby="${id}-error"` : '';
  const errorHtml = error ? `<p class="field-error" id="${id}-error">${escapeHtml(error)}</p>` : '';
  return `<div class="field${invalidCls}"><label class="field-label" for="${id}">${escapeHtml(
    label,
  )}</label><input id="${id}" class="field-input" type="text" inputmode="decimal" name="${name}" value="${escapeHtml(
    value,
  )}"${aria}>${errorHtml}</div>`;
}

function renderSettingsCard(inputs, errors) {
  const err = errors || {};
  return `<section class="card"><div class="card-header"><h2 class="card-title">Opening cash and minimum</h2></div><div class="card-body">` +
    `<form class="form" data-form="forecast-settings" novalidate><div class="form-grid">` +
    renderField('openingCash', 'Opening cash balance (INR) *', inputs.openingCash, err.openingCash) +
    renderField('minimumCash', 'Minimum cash level (INR) *', inputs.minimumCash, err.minimumCash) +
    `</div><div class="form-actions"><button type="submit" class="btn btn-primary">Save forecast settings</button></div></form>` +
    `</div></section>`;
}

function renderAssumptionsCard(forecast) {
  const items = forecast.assumptions
    .map((a) => `<li class="list-item">${escapeHtml(a)}</li>`)
    .join('');
  return `<section class="card"><div class="card-header"><h2 class="card-title">How this forecast is calculated</h2></div><div class="card-body"><ul class="list">${items}</ul></div></section>`;
}

const PLOT_LEFT = 60;
const PLOT_RIGHT = 620;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 200;

function renderChart(settings, forecast) {
  const horizons = forecast.horizons;
  const zeroY = (PLOT_TOP + PLOT_BOTTOM) / 2;
  const half = (PLOT_BOTTOM - PLOT_TOP) / 2;
  let scale = Math.max(
    ...horizons.map((h) => Math.abs(h.closing)),
    Math.abs(settings.minimumCash),
    Math.abs(settings.openingCash),
  ) * 1.1;
  if (!scale) scale = 1;
  const toY = (v) => zeroY - (v / scale) * half;
  const minY = Math.min(PLOT_BOTTOM, Math.max(PLOT_TOP, toY(settings.minimumCash)));

  const slot = (PLOT_RIGHT - PLOT_LEFT) / (horizons.length || 1);
  const barW = Math.min(90, slot * 0.5);
  const bars = horizons
    .map((h, i) => {
      const cx = PLOT_LEFT + slot * (i + 0.5);
      const y = toY(h.closing);
      const top = Math.min(y, zeroY);
      const height = Math.max(1, Math.abs(y - zeroY));
      const fill = h.closing < 0 ? 'var(--danger)' : 'var(--teal)';
      return (
        `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" style="fill:${fill}"></rect>` +
        `<text x="${cx.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-size="11">${escapeHtml(formatINR(h.closing))}</text>` +
        `<text x="${cx.toFixed(1)}" y="232" text-anchor="middle" font-size="12" style="fill:var(--muted)">${escapeHtml(`In ${h.days} days`)}</text>`
      );
    })
    .join('');

  const svg =
    `<svg viewBox="0 0 640 260" role="img" aria-label="Projected closing cash for 30, 60 and 90 days">` +
    `<line x1="${PLOT_LEFT}" y1="${zeroY}" x2="${PLOT_RIGHT}" y2="${zeroY}" style="stroke:var(--border)"></line>` +
    bars +
    `<line x1="${PLOT_LEFT}" y1="${minY.toFixed(1)}" x2="${PLOT_RIGHT}" y2="${minY.toFixed(1)}" stroke-dasharray="6 4" style="stroke:var(--outgoing)"></line>` +
    `</svg>`;

  const legend =
    `<div class="chart-legend"><span><span class="legend-dot" style="background:var(--teal)"></span>Closing cash</span>` +
    `<span><span class="legend-dot" style="background:var(--outgoing)"></span>Minimum level</span></div>`;

  return `<section class="card"><div class="card-header"><h2 class="card-title">Projected closing cash by period</h2></div><div class="card-body"><div class="chart-wrap">${svg}</div>${legend}</div></section>`;
}

function renderNote(ev) {
  if (ev.flag === 'overdue' && ev.kind === 'in') {
    return `<span class="badge badge-overdue">${escapeHtml(
      `Overdue, assumed collected in ${OVERDUE_COLLECTION_DAYS} days`,
    )}</span>`;
  }
  if (ev.flag === 'overdue' && ev.kind === 'out') {
    return '<span class="badge badge-overdue">Overdue, treated as due today</span>';
  }
  if (ev.flag === 'no_due_date') {
    return '<span class="badge badge-draft">No due date, treated as due today</span>';
  }
  return '';
}

function renderTransactionsCard(forecast) {
  let body;
  if (!forecast.events.length) {
    body =
      '<div class="empty-state"><h2 class="empty-title">No expected transactions</h2>' +
      '<p class="empty-text">Add invoices or unpaid expenses to see projected cash movements.</p></div>';
  } else {
    const rows = forecast.events
      .map((ev) => {
        const isIn = ev.kind === 'in';
        const amount = isIn ? `+${formatINR(ev.amount)}` : `${MINUS}${formatINR(ev.amount)}`;
        return (
          `<tr><td>${escapeHtml(fmtDate(ev.date))}</td>` +
          `<td>${escapeHtml(ev.description)}</td>` +
          `<td>${isIn ? 'Income' : 'Expense'}</td>` +
          `<td class="num">${escapeHtml(amount)}</td>` +
          `<td class="num">${escapeHtml(formatINR(ev.runningBalance))}</td>` +
          `<td>${renderNote(ev)}</td></tr>`
        );
      })
      .join('');
    body =
      '<div class="table-scroll"><table class="table"><caption class="sr-only">Expected transactions</caption>' +
      '<thead><tr><th>Date</th><th>Description</th><th>Type</th><th class="num">Amount</th><th class="num">Running balance</th><th>Note</th></tr></thead>' +
      `<tbody>${rows}</tbody></table></div>`;
  }
  return `<section class="card"><div class="card-header"><h2 class="card-title">Expected transactions (next 90 days)</h2></div><div class="card-body">${body}</div></section>`;
}

/** Shared body for the normal and error paths. inputs = { openingCash, minimumCash } as strings. */
function renderPageBody(inputs, errors, flashHtml) {
  const settings = getForecastSettings();
  const forecast = buildForecast(new Date(), settings);
  const defaultNotice = settings.isDefault
    ? '<div class="notice notice-warning" role="status">Opening cash and minimum cash are sample values. Change them below to match your bank balance.</div>'
    : '';
  return (
    flashHtml +
    '<header class="page-header"><div><h1 class="page-title">Cash Forecast</h1>' +
    '<p class="page-subtitle">Projected cash for the next 90 days from unpaid invoices and unpaid expenses.</p></div></header>' +
    defaultNotice +
    renderLowCashAlert(forecast, settings.minimumCash) +
    renderSummaryCards(settings, forecast) +
    renderSettingsCard(inputs, errors) +
    renderAssumptionsCard(forecast) +
    renderChart(settings, forecast) +
    renderTransactionsCard(forecast) +
    '<p class="stat-hint">Every figure is calculated from stored invoice and expense records using fixed rules.</p>'
  );
}

/** Renders the full Cash Forecast page as an HTML string. */
export function renderCashForecastPage() {
  const settings = getForecastSettings();
  const inputs = { openingCash: String(settings.openingCash), minimumCash: String(settings.minimumCash) };
  return renderPageBody(inputs, null, renderFlash(takeFlash()));
}

/** Attaches the settings form handler to the page root (property handler only). */
export function attachCashForecastHandlers(rootEl) {
  rootEl.onsubmit = async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.form !== 'forecast-settings') return;
    event.preventDefault();

    const data = new FormData(form);
    const raw = {
      openingCash: String(data.get('openingCash') ?? ''),
      minimumCash: String(data.get('minimumCash') ?? ''),
    };
    const result = await saveForecastSettings(raw);

    if (!result.valid) {
      rootEl.innerHTML = renderPageBody(raw, result.errors, '');
      attachCashForecastHandlers(rootEl);
      rootEl.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    setFlash('success', 'Forecast settings saved.');
    rootEl.innerHTML = renderCashForecastPage();
    attachCashForecastHandlers(rootEl);
  };
}
