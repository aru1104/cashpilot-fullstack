import { formatINR } from '../format.js';
import { getLiveDashboardData, getCashFlow } from '../data.js';
import {
  renderDashboardHeader,
  renderSampleBadge,
  renderSummaryCard,
  renderCard,
  renderInvoiceTable,
  renderExpenseList,
  renderActionCentre,
  escapeHtml,
} from '../components.js';

const CHART_W = 640;
const CHART_H = 260;
const PAD_LEFT = 16;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 36;
const GRID_LINES = 3;
const MAX_X_LABELS = 8;

export function buildChartSvg(days) {
  const series = getCashFlow(days) || {};
  const labels = Array.isArray(series.labels) ? series.labels : [];
  const incoming = Array.isArray(series.incoming) ? series.incoming : [];
  const outgoing = Array.isArray(series.outgoing) ? series.outgoing : [];
  const n = labels.length;

  const plotLeft = PAD_LEFT;
  const plotRight = CHART_W - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = CHART_H - PAD_BOTTOM;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const rawMax = Math.max(0, ...incoming, ...outgoing);
  const max = rawMax > 0 ? rawMax * 1.1 : 1;

  const parts = [];

  for (let g = 1; g <= GRID_LINES; g++) {
    const y = (plotBottom - (plotH * g) / GRID_LINES).toFixed(1);
    parts.push(
      `<line x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}" style="stroke:var(--border)" stroke-width="1"/>`
    );
  }

  if (n > 0) {
    const groupW = plotW / n;
    const barW = Math.max(2, Math.min(groupW * 0.3, 14));
    const gap = 2;
    const labelStep = Math.max(1, Math.ceil(n / MAX_X_LABELS));

    for (let i = 0; i < n; i++) {
      const cx = plotLeft + groupW * i + groupW / 2;
      const inVal = Number(incoming[i]) || 0;
      const outVal = Number(outgoing[i]) || 0;

      const inH = (Math.max(0, inVal) / max) * plotH;
      const outH = (Math.max(0, outVal) / max) * plotH;

      const inX = (cx - gap / 2 - barW).toFixed(1);
      const outX = (cx + gap / 2).toFixed(1);

      parts.push(
        `<rect x="${inX}" y="${(plotBottom - inH).toFixed(1)}" width="${barW.toFixed(1)}" height="${inH.toFixed(1)}" rx="3" style="fill:var(--teal)"><title>Incoming ${escapeHtml(formatINR(inVal))}</title></rect>`
      );
      parts.push(
        `<rect x="${outX}" y="${(plotBottom - outH).toFixed(1)}" width="${barW.toFixed(1)}" height="${outH.toFixed(1)}" rx="3" style="fill:var(--outgoing)"><title>Outgoing ${escapeHtml(formatINR(outVal))}</title></rect>`
      );

      if (i % labelStep === 0) {
        parts.push(
          `<text x="${cx.toFixed(1)}" y="${CHART_H - 12}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${escapeHtml(labels[i])}</text>`
        );
      }
    }
  }

  return (
    `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="Incoming and outgoing money over the next ${Number(days)} days">` +
    parts.join('') +
    `</svg>`
  );
}

export function renderOverview() {
  const live = getLiveDashboardData();
  const summary = [
    renderSummaryCard({
      label: 'Available Cash',
      value: formatINR(live.availableCash),
      hint: 'Opening cash balance',
    }),
    renderSummaryCard({
      label: 'Total Outstanding',
      value: formatINR(live.totalOutstanding),
      hint: 'Across open invoices',
    }),
    renderSummaryCard({
      label: 'Overdue Amount',
      value: formatINR(live.overdueAmount),
      hint: 'Needs follow-up',
      tone: 'danger',
    }),
    renderSummaryCard({
      label: 'Expected Income (30 Days)',
      value: formatINR(live.expectedIncomeThisMonth),
      hint: 'From open invoices',
    }),
  ].join('');

  const chartBody =
    '<div class="segmented" role="group" aria-label="Period">' +
    '<button type="button" data-days="30" aria-pressed="true">Next 30 days</button>' +
    '<button type="button" data-days="60" aria-pressed="false">60 days</button>' +
    '<button type="button" data-days="90" aria-pressed="false">90 days</button>' +
    '</div>' +
    '<div class="chart-wrap" data-chart-wrap>' +
    buildChartSvg(30) +
    '</div>' +
    '<div class="chart-legend">' +
    '<span class="legend-dot" style="background:var(--teal)"></span>Incoming' +
    '<span class="legend-dot" style="background:var(--outgoing)"></span>Outgoing' +
    '</div>';

  const chartCard = renderCard({
    title: 'Cash-flow overview',
    subtitle: 'Incoming vs outgoing money',
    badge: renderSampleBadge(),
    body: chartBody,
    extraClass: 'span-2',
  });

  const invoicesCard = renderCard({
    title: 'Invoices',
    badge: '',
    body: renderInvoiceTable(live.invoices),
    extraClass: 'span-2',
  });

  const expensesCard = renderCard({
    title: 'Upcoming expenses',
    body: renderExpenseList(live.upcomingExpenses),
  });

  const actionCard = renderCard({
    title: 'Action centre',
    body: renderActionCentre(live.actionCentre),
  });

  return (
    renderDashboardHeader() +
    '<section class="summary-grid" aria-label="Financial summary">' +
    summary +
    '</section>' +
    '<div class="dashboard-grid">' +
    chartCard +
    invoicesCard +
    expensesCard +
    actionCard +
    '</div>'
  );
}

export function attachOverviewHandlers(rootEl) {
  if (!rootEl || rootEl.dataset.overviewBound === 'true') return;
  rootEl.dataset.overviewBound = 'true';

  rootEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const btn = target.closest('button[data-days]');
    if (!btn || !rootEl.contains(btn)) return;

    const group = btn.closest('.segmented');
    if (!group) return;

    group.querySelectorAll('button[data-days]').forEach((b) => {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });

    const wrap = rootEl.querySelector('[data-chart-wrap]');
    if (wrap) {
      wrap.innerHTML = buildChartSvg(Number(btn.dataset.days));
    }
  });
}
