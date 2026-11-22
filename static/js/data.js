// Live dashboard data derived from synced stores.

import { formatDayMonth } from './format.js';
import { listClients } from './clients-store.js';
import { listInvoices } from './invoices-store.js';
import { unpaidExpenses } from './expenses-store.js';
import { buildForecast, getForecastSettings } from './forecast.js';

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysFromToday(offset) {
  const t = startOfToday();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset);
}

function parseLocalDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function getLiveDashboardData() {
  const settings = getForecastSettings();
  const clients = new Map(listClients().map((c) => [c.id, c]));
  const invoices = listInvoices();
  const forecast = buildForecast();

  const openStatuses = new Set(['sent', 'partially_paid', 'overdue']);
  const openInvoices = invoices.filter((i) => openStatuses.has(i.displayStatus));

  const totalOutstanding = openInvoices.reduce((s, i) => s + Number(i.remaining || 0), 0);
  const overdueInvoices = openInvoices.filter((i) => i.displayStatus === 'overdue');
  const overdueAmount = overdueInvoices.reduce((s, i) => s + Number(i.remaining || 0), 0);

  const monthHorizon = forecast.horizons.find((h) => h.days === 30) || { income: 0 };

  const tableInvoices = invoices.map((inv) => {
    const client = clients.get(inv.clientId);
    const status = inv.displayStatus === 'sent' || inv.displayStatus === 'partially_paid' ? 'due' : inv.displayStatus;
    return {
      number: inv.number,
      client: client ? (client.businessName || client.fullName) : 'Client removed',
      amount: inv.remaining > 0 ? inv.remaining : inv.total,
      dueDate: parseLocalDate(inv.dueDate),
      status,
    };
  });

  const upcoming = unpaidExpenses()
    .filter((e) => e.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5)
    .map((e) => ({
      name: e.title,
      dueDate: parseLocalDate(e.dueDate),
      amount: e.amount,
    }));

  const overdueAlerts = overdueInvoices.map((inv) => {
    const client = clients.get(inv.clientId);
    const name = client ? (client.businessName || client.fullName) : 'Client';
    return {
      title: `${inv.number} is overdue`,
      detail: `${name} owes ₹${Number(inv.remaining).toLocaleString('en-IN')}. Send a payment reminder today.`,
    };
  });

  const upcomingBills = upcoming.slice(0, 2).map((b) => ({
    title: `${b.name} due soon`,
    detail: `₹${Number(b.amount).toLocaleString('en-IN')} scheduled from available cash.`,
  }));

  const recommendedActions = [
    overdueInvoices.length > 0
      ? `Follow up on ${overdueInvoices.length} overdue invoice(s) totalling ₹${overdueAmount.toLocaleString('en-IN')}.`
      : 'All sent invoices are currently on schedule.',
    'Review upcoming expenses before making new commitments.',
    `Keep at least ₹${Number(settings.minimumCash).toLocaleString('en-IN')} in reserve.`,
  ];

  return {
    businessName: settings.businessName,
    ownerFirstName: settings.ownerFirstName,
    availableCash: settings.openingCash,
    totalOutstanding,
    overdueAmount,
    expectedIncomeThisMonth: monthHorizon.income,
    invoices: tableInvoices,
    upcomingExpenses: upcoming,
    actionCentre: {
      overdue: overdueAlerts,
      upcoming: upcomingBills,
      actions: recommendedActions,
    },
  };
}

export function getCashFlow(days) {
  const forecast = buildForecast();
  const bucketCount = { 30: 5, 60: 9, 90: 13 }[days] || 5;
  const labels = [];
  const incoming = [];
  const outgoing = [];

  for (let i = 0; i < bucketCount; i++) {
    const startDay = i * 7;
    const endDay = startDay + 6;
    labels.push(formatDayMonth(daysFromToday(startDay)));

    const inSum = forecast.events
      .filter((e) => e.kind === 'in' && e.offset >= startDay && e.offset <= endDay)
      .reduce((s, e) => s + e.amount, 0);
    const outSum = forecast.events
      .filter((e) => e.kind === 'out' && e.offset >= startDay && e.offset <= endDay)
      .reduce((s, e) => s + e.amount, 0);

    incoming.push(Math.round(inSum * 100) / 100);
    outgoing.push(Math.round(outSum * 100) / 100);
  }

  return { labels, incoming, outgoing };
}
