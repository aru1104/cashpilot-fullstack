// CashPilot UI components. Each exported render function returns an HTML string.

import { formatINR, formatDate, formatLongDate } from './format.js';
import { getForecastSettings } from './forecast.js';

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSidebar(currentKey, routes) {
  const items = (routes || [])
    .map((route) => {
      const current = route.key === currentKey ? ' aria-current="page"' : '';
      return `<li><a class="nav-link" href="${escapeHtml(route.path)}"${current}>${escapeHtml(route.label)}</a></li>`;
    })
    .join('');

  return `<div class="sidebar-brand"><div class="brand-name">CashPilot</div><div class="brand-tagline">Your business finances. Under control.</div></div>` +
    `<nav aria-label="Main"><ul class="nav-list">${items}</ul></nav>`;
}

export function renderPageHeader({ title, subtitle } = {}) {
  const sub = subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : '';
  return `<header class="page-header"><div><h1 class="page-title">${escapeHtml(title)}</h1>${sub}</div></header>`;
}

export function renderDashboardHeader() {
  const settings = getForecastSettings();
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else greeting = 'Good evening';

  const initials = settings.businessName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || 'CP';

  return `<header class="page-header"><div><h1 class="page-title">${escapeHtml(greeting)}, ${escapeHtml(settings.ownerFirstName)}</h1>` +
    `<p class="page-subtitle">${escapeHtml(formatLongDate(new Date()))}</p></div>` +
    `<div class="profile"><div class="header-meta"><div class="business-name">${escapeHtml(settings.businessName)}</div></div>` +
    `<div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div></div></header>`;
}

export function renderSampleBadge() {
  return '<span class="sample-badge">Live SQLite</span>';
}

export function renderSummaryCard({ label, value, hint } = {}) {
  return `<article class="card"><div class="stat-label">${escapeHtml(label)}</div>` +
    `<div class="stat-value">${escapeHtml(value)}</div><div class="stat-hint">${escapeHtml(hint)}</div></article>`;
}

let cardCounter = 0;

export function renderCard({ title, subtitle, body, extraClass, badge } = {}) {
  cardCounter += 1;
  const id = `card-title-${cardCounter}`;
  const sub = subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : '';
  return `<section class="card ${escapeHtml(extraClass || '')}" aria-labelledby="${id}">` +
    `<div class="card-header"><div><h2 class="card-title" id="${id}">${escapeHtml(title)}</h2>${sub}</div>${badge || ''}</div>` +
    `<div class="card-body">${body || ''}</div></section>`;
}

export function renderStatusBadge(status) {
  switch (status) {
    case 'paid':
      return '<span class="badge badge-paid">Paid</span>';
    case 'due':
      return '<span class="badge badge-due">Due</span>';
    case 'overdue':
      return '<span class="badge badge-overdue">Overdue</span>';
    case 'draft':
      return '<span class="badge badge-draft">Draft</span>';
    default:
      return `<span class="badge badge-draft">${escapeHtml(status)}</span>`;
  }
}

export function renderInvoiceTable(invoices) {
  const rows = (invoices || [])
    .map((inv) =>
      `<tr><td>${escapeHtml(inv.client)}</td><td>${escapeHtml(inv.number)}</td>` +
      `<td class="num">${escapeHtml(formatINR(inv.amount))}</td>` +
      `<td>${escapeHtml(formatDate(inv.dueDate))}</td>` +
      `<td>${renderStatusBadge(inv.status)}</td></tr>`
    )
    .join('');

  return '<div class="table-scroll"><table class="table">' +
    '<caption class="sr-only">Outstanding invoices</caption>' +
    '<thead><tr><th scope="col">Client</th><th scope="col">Invoice</th><th scope="col" class="num">Amount</th>' +
    '<th scope="col">Due date</th><th scope="col">Status</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div>`;
}

export function renderExpenseList(expenses) {
  const items = (expenses || [])
    .map((e) =>
      `<li class="list-item"><div><div>${escapeHtml(e.name)}</div>` +
      `<div class="stat-hint">${escapeHtml(formatDate(e.dueDate))}</div></div>` +
      `<div class="num">${escapeHtml(formatINR(e.amount))}</div></li>`
    )
    .join('');
  return `<ul class="list">${items}</ul>`;
}

export function renderActionCentre(ac = {}) {
  const alertItems = (items, variant) =>
    (items || [])
      .map((it) => `<li class="alert ${variant}"><strong>${escapeHtml(it.title)}</strong><div>${escapeHtml(it.detail)}</div></li>`)
      .join('');

  const actionItems = (ac.actions || []).map((a) => `<li>${escapeHtml(a)}</li>`).join('');

  return '<div class="action-centre">' +
    '<div><h3 class="stat-label">Overdue payments</h3>' +
    `<ul class="list">${alertItems(ac.overdue, 'alert-danger')}</ul></div>` +
    '<div><h3 class="stat-label">Upcoming bills</h3>' +
    `<ul class="list">${alertItems(ac.upcoming, 'alert-warning')}</ul></div>` +
    '<div><h3 class="stat-label">Recommended next actions</h3>' +
    `<ol class="action-list">${actionItems}</ol></div>` +
    '</div>';
}
