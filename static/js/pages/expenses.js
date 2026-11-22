// Expenses page for CashPilot: expense list with summaries, upcoming bills, category breakdown, search and filters, add/edit form, and expense detail with delete confirmation.

import {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  validateExpense,
  summarizeExpenses,
  deriveBillState,
  EXPENSE_CATEGORIES,
  PAYMENT_STATUSES,
  isPersistent,
  todayIso,
} from '../expenses-store.js';
import { setFlash, takeFlash } from '../flash.js';
import { formatINR, formatDate } from '../format.js';
import { escapeHtml } from '../components.js';

const BACK_TO_EXPENSES = '\u2190 Back to expenses';

const STATUS_LABELS = Object.freeze({ unpaid: 'Unpaid', paid: 'Paid' });

/** Escapes any value for HTML text or attribute use; null and undefined become ''. */
function esc(x) {
  return escapeHtml(x == null ? '' : String(x));
}

/** Parses 'YYYY-MM-DD' as a local date (new Date(string) would parse it as UTC). */
function parseLocalDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(iso) {
  return iso ? formatDate(parseLocalDate(iso)) : '\u2014';
}

/** Formats an ISO timestamp (createdAt / updatedAt) for display, or '—' when unreadable. */
function fmtStamp(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '\u2014' : formatDate(d);
}

/** Parses a location.hash string into an expenses route object. */
export function parseExpensesRoute(hash) {
  const raw = String(hash ?? '').replace(/^#\//, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] !== 'expenses') return { view: 'list' };
  try {
    if (parts.length === 1) return { view: 'list' };
    if (parts.length === 2 && parts[1] === 'new') return { view: 'new' };
    if (parts.length === 2) return { view: 'detail', id: decodeURIComponent(parts[1]) };
    if (parts.length === 3 && parts[2] === 'edit') {
      return { view: 'edit', id: decodeURIComponent(parts[1]) };
    }
  } catch {
    return { view: 'list' };
  }
  return { view: 'list' };
}

function renderNotice(current) {
  if (!current) return '';
  const cls = current.type === 'error' ? 'notice-error' : 'notice-success';
  return `<div class="notice ${cls}" role="status">${esc(current.message)}</div>`;
}

function renderStorageWarning() {
  return isPersistent()
    ? ''
    : '<div class="notice notice-warning" role="status">Browser storage is unavailable, so changes last only for this session.</div>';
}

function renderHeader(title, subtitle = '', actionsHtml = '') {
  const sub = subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : '';
  const actions = actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : '';
  return `<header class="page-header"><div><h1 class="page-title">${esc(title)}</h1>${sub}</div>${actions}</header>`;
}

function renderNotFound(title, text) {
  return (
    renderHeader('Expenses') +
    `<div class="empty-state"><h2 class="empty-title">${esc(title)}</h2>` +
    `<p class="empty-text">${esc(text)}</p>` +
    '<a class="btn btn-secondary" href="#/expenses">Back to expenses</a></div>'
  );
}

/** One label/value pair for a detail-grid; valueHtml must already be escaped by the caller. */
function detailItem(label, valueHtml, extraClass = '') {
  return `<div class="detail-item"><dt class="detail-label">${esc(label)}</dt><dd class="detail-value${extraClass}">${valueHtml}</dd></div>`;
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

/** Status pill(s) for an expense; unpaid bills past their due date also get an overdue pill. */
function renderStatusBadges(exp) {
  if (exp.paymentStatus === 'paid') return '<span class="badge badge-paid">Paid</span>';
  let html = '<span class="badge badge-due">Unpaid</span>';
  if (deriveBillState(exp) === 'overdue') html += ' <span class="badge badge-overdue">Overdue</span>';
  return html;
}

/** Summary cards for the list view. */
function renderSummaryCards(summary) {
  const watch = summary.upcomingBills.filter(
    (b) => b.billState === 'overdue' || b.billState === 'due_soon',
  ).length;
  const card = (label, value, hint = '') =>
    '<div class="card">' +
    `<p class="stat-label">${esc(label)}</p>` +
    `<p class="stat-value">${esc(value)}</p>` +
    (hint ? `<p class="stat-hint">${esc(hint)}</p>` : '') +
    '</div>';
  return (
    '<section class="summary-grid" aria-label="Expense summary">' +
    card('Spent this month', formatINR(summary.monthTotal)) +
    card('Total paid', formatINR(summary.paidTotal), 'All time') +
    card('Total unpaid', formatINR(summary.unpaidTotal), 'All time') +
    card('Bills to watch', String(watch), 'Overdue or due in 7 days') +
    '</section>'
  );
}

/** Overdue and due-soon bills, each with a link to the edit form. */
function renderUpcomingBills(bills) {
  const watch = bills.filter((b) => b.billState === 'overdue' || b.billState === 'due_soon');
  let body;
  if (watch.length === 0) {
    body = '<p class="empty-text">No bills due in the next 7 days or overdue.</p>';
  } else {
    const items = watch
      .map((b) => {
        const editHref = `#/expenses/${esc(encodeURIComponent(b.id))}/edit`;
        if (b.billState === 'overdue') {
          return (
            `<li class="alert alert-danger"><strong>${esc(b.title)}</strong> ` +
            `<span>Overdue since ${esc(fmtDate(b.dueDate))}</span> ` +
            `<a class="table-link" href="${editHref}">Mark as paid</a></li>`
          );
        }
        return (
          `<li class="alert alert-warning"><strong>${esc(b.title)}</strong> ` +
          `<span>Due ${esc(fmtDate(b.dueDate))} \u00b7 ${esc(formatINR(b.amount))}</span> ` +
          `<a class="table-link" href="${editHref}">Review bill</a></li>`
        );
      })
      .join('');
    body = `<ul class="list">${items}</ul>`;
  }
  return (
    '<section class="card"><div class="card-header"><h2 class="card-title">Upcoming bills</h2></div>' +
    `<div class="card-body">${body}</div></section>`
  );
}

/** Per-category spend for the current month, one bar per category. */
function renderCategoryBreakdown(rows) {
  const items = rows
    .map((r) => {
      const pct = Math.round(r.share * 100);
      return (
        '<div class="list-item">' +
        `<div><strong>${esc(r.category)}</strong><p class="stat-hint">${esc(r.count)} expense${r.count === 1 ? '' : 's'}</p></div>` +
        `<span class="num">${esc(formatINR(r.total))}</span>` +
        `<div class="share-bar" role="img" aria-label="${esc(pct)}% of this month's spend"><span style="width:${esc(pct)}%"></span></div>` +
        '</div>'
      );
    })
    .join('');
  return (
    '<section class="card"><div class="card-header"><h2 class="card-title">Spending by category</h2>' +
    '<p class="stat-hint">This month</p></div>' +
    `<div class="card-body">${items}</div></section>`
  );
}

/** Table rows and filtering for the expense list. */
function renderExpenseRows(query, category, status) {
  const all = listExpenses();
  if (all.length === 0) {
    return (
      '<div class="empty-state"><h2 class="empty-title">No expenses recorded yet</h2>' +
      '<p class="empty-text">Add your first expense to start tracking costs and bills.</p>' +
      '<a class="btn btn-primary" href="#/expenses/new">Add expense</a></div>'
    );
  }

  const q = String(query ?? '').trim().toLowerCase();
  const entries = all.filter((e) => {
    if (category && e.category !== category) return false;
    if (status && e.paymentStatus !== status) return false;
    if (!q) return true;
    return [e.title, e.vendor].some((v) => String(v ?? '').toLowerCase().includes(q));
  });

  if (entries.length === 0) {
    return '<div class="empty-state"><p class="empty-text">No expenses match these filters.</p></div>';
  }

  const n = entries.length;
  const rows = entries
    .map(
      (e) =>
        '<tr>' +
        `<td><a class="table-link" href="#/expenses/${esc(encodeURIComponent(e.id))}">${esc(e.title)}</a></td>` +
        `<td>${esc(e.category)}</td>` +
        `<td>${esc(e.vendor || '\u2014')}</td>` +
        `<td class="num">${esc(formatINR(e.amount))}</td>` +
        `<td>${esc(fmtDate(e.expenseDate))}</td>` +
        `<td>${renderStatusBadges(e)}</td>` +
        '</tr>',
    )
    .join('');

  return (
    `<p class="stat-hint">${n} expense${n === 1 ? '' : 's'}</p>` +
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Expenses</caption><thead><tr>' +
    '<th scope="col">Title</th>' +
    '<th scope="col">Category</th>' +
    '<th scope="col">Vendor</th>' +
    '<th scope="col" class="num">Amount</th>' +
    '<th scope="col">Date</th>' +
    '<th scope="col">Status</th>' +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

function renderFilterCard() {
  const categoryOptions = ['<option value="">All categories</option>']
    .concat(EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`))
    .join('');
  return (
    '<section class="card">' +
    '<div class="toolbar"><label class="search-field"><span class="sr-only">Search expenses</span>' +
    '<input type="search" id="expenses-search" class="search-input" placeholder="Search by title or vendor" autocomplete="off"></label>' +
    '<label class="sr-only" for="expenses-category">Filter by category</label>' +
    `<select id="expenses-category" class="filter-select">${categoryOptions}</select>` +
    '<label class="sr-only" for="expenses-status">Filter by payment status</label>' +
    '<select id="expenses-status" class="filter-select">' +
    '<option value="">All statuses</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option>' +
    '</select></div>' +
    `<div data-expense-results>${renderExpenseRows('', '', '')}</div>` +
    '</section>'
  );
}

function renderListView() {
  const summary = summarizeExpenses();
  return (
    renderHeader(
      'Expenses',
      'Track business costs, bills and recurring payments.',
      '<a class="btn btn-primary" href="#/expenses/new">Add expense</a>',
    ) +
    renderSummaryCards(summary) +
    renderUpcomingBills(summary.upcomingBills) +
    renderCategoryBreakdown(summary.categoryBreakdown) +
    renderFilterCard()
  );
}

function defaultFormValues() {
  return {
    title: '',
    category: '',
    vendor: '',
    amount: '',
    expenseDate: todayIso(),
    dueDate: '',
    paymentStatus: 'unpaid',
    notes: '',
  };
}

function formValuesFromExpense(e) {
  return {
    title: e.title ?? '',
    category: e.category ?? '',
    vendor: e.vendor ?? '',
    amount: e.amount == null ? '' : String(e.amount),
    expenseDate: e.expenseDate ?? '',
    dueDate: e.dueDate ?? '',
    paymentStatus: e.paymentStatus ?? 'unpaid',
    notes: e.notes ?? '',
  };
}

/** Add/edit form. state.values holds raw strings; state.errors is keyed by field name. */
function renderExpenseForm(mode, id, state, exp) {
  const errors = (state && state.errors) || {};
  const hasErrors = Object.keys(errors).length > 0;
  let base;
  if (state && state.values) base = state.values;
  else if (mode === 'edit' && exp) base = formValuesFromExpense(exp);
  else base = defaultFormValues();
  const v = (name) => (base[name] === undefined || base[name] === null ? '' : String(base[name]));

  const formNotice = hasErrors
    ? '<div class="notice notice-error" role="alert">Please fix the highlighted fields.</div>'
    : '';

  const titleField = fieldHtml(
    { id: 'expense-title', label: 'Title *', error: errors.title },
    `<input id="expense-title" class="field-input" type="text" name="title" value="${esc(v('title'))}" maxlength="120" required${ariaAttr('expense-title', errors.title)}>`,
  );

  const categoryOptions = ['<option value="">Select a category</option>']
    .concat(
      EXPENSE_CATEGORIES.map(
        (c) => `<option value="${esc(c)}"${v('category') === c ? ' selected' : ''}>${esc(c)}</option>`,
      ),
    )
    .join('');
  const categoryField = fieldHtml(
    { id: 'expense-category', label: 'Category *', error: errors.category },
    `<select id="expense-category" class="field-input filter-select" name="category" required${ariaAttr('expense-category', errors.category)}>${categoryOptions}</select>`,
  );

  const vendorField = fieldHtml(
    { id: 'expense-vendor', label: 'Vendor or payee', error: errors.vendor },
    `<input id="expense-vendor" class="field-input" type="text" name="vendor" value="${esc(v('vendor'))}" maxlength="120"${ariaAttr('expense-vendor', errors.vendor)}>`,
  );

  const amountField = fieldHtml(
    { id: 'expense-amount', label: 'Amount (INR) *', error: errors.amount },
    `<input id="expense-amount" class="field-input" type="text" inputmode="decimal" name="amount" value="${esc(v('amount'))}" required${ariaAttr('expense-amount', errors.amount)}>`,
  );

  const expenseDateField = fieldHtml(
    { id: 'expense-expenseDate', label: 'Expense date *', error: errors.expenseDate },
    `<input id="expense-expenseDate" class="field-input" type="date" name="expenseDate" value="${esc(v('expenseDate'))}" required${ariaAttr('expense-expenseDate', errors.expenseDate)}>`,
  );

  const dueDateField = fieldHtml(
    { id: 'expense-dueDate', label: 'Due date (optional)', error: errors.dueDate },
    `<input id="expense-dueDate" class="field-input" type="date" name="dueDate" value="${esc(v('dueDate'))}"${ariaAttr('expense-dueDate', errors.dueDate)}>`,
  );

  const statusOptions = ['unpaid', 'paid']
    .map((s) => `<option value="${esc(s)}"${v('paymentStatus') === s ? ' selected' : ''}>${esc(STATUS_LABELS[s])}</option>`)
    .join('');
  const statusField = fieldHtml(
    { id: 'expense-paymentStatus', label: 'Payment status *', error: errors.paymentStatus },
    `<select id="expense-paymentStatus" class="field-input filter-select" name="paymentStatus" required${ariaAttr('expense-paymentStatus', errors.paymentStatus)}>${statusOptions}</select>`,
  );

  const notesField = fieldHtml(
    { id: 'expense-notes', label: 'Notes (optional)', error: errors.notes, span: true },
    `<textarea id="expense-notes" class="field-textarea" name="notes" rows="3" maxlength="500"${ariaAttr('expense-notes', errors.notes)}>${esc(v('notes'))}</textarea>`,
  );

  const cancelHref = mode === 'edit' ? `#/expenses/${encodeURIComponent(id)}` : '#/expenses';

  return (
    '<section class="card form-card">' +
    `<form class="form" data-form="expense" data-mode="${esc(mode)}" data-id="${esc(id)}" novalidate>` +
    formNotice +
    '<div class="form-grid">' +
    titleField +
    categoryField +
    vendorField +
    amountField +
    expenseDateField +
    dueDateField +
    statusField +
    notesField +
    '</div>' +
    '<div class="form-actions"><button type="submit" class="btn btn-primary">Save expense</button>' +
    `<a class="btn btn-secondary" href="${esc(cancelHref)}">Cancel</a></div>` +
    '</form></section>'
  );
}

function renderNewView(state) {
  return (
    `<a class="back-link" href="#/expenses">${BACK_TO_EXPENSES}</a>` +
    renderHeader('Add expense', 'Required fields are marked with *.') +
    renderExpenseForm('new', '', state, null)
  );
}

function renderEditView(id, state) {
  const exp = getExpense(id);
  if (!exp) return renderNotFound('Expense not found', 'This expense may have been deleted.');
  return (
    `<a class="back-link" href="#/expenses/${esc(encodeURIComponent(id))}">${BACK_TO_EXPENSES}</a>` +
    renderHeader('Edit expense') +
    renderExpenseForm('edit', id, state, exp)
  );
}

function renderDetailView(id, state) {
  const e = getExpense(id);
  if (!e) return renderNotFound('Expense not found', 'This expense could not be found.');

  const s = state || {};
  const confirming = Boolean(s.confirmDelete);
  const encId = esc(encodeURIComponent(e.id));
  const idAttr = esc(e.id);

  const actions =
    `<a class="btn btn-secondary" href="#/expenses/${encId}/edit">Edit</a>` +
    (confirming
      ? ''
      : `<button type="button" class="btn btn-danger" data-action="ask-delete" data-id="${idAttr}">Delete</button>`);

  const confirmHtml = confirming
    ? '<div class="confirm-panel" role="alertdialog" aria-labelledby="expense-confirm-title" aria-describedby="expense-confirm-desc">' +
      '<h2 class="card-title" id="expense-confirm-title">Delete this expense?</h2>' +
      `<p id="expense-confirm-desc">${esc(e.title)} will be removed from CashPilot. This cannot be undone.</p>` +
      '<div class="form-actions">' +
      `<button type="button" class="btn btn-danger" data-action="confirm-delete" data-id="${idAttr}">Yes, delete expense</button>` +
      `<button type="button" class="btn btn-secondary" data-action="cancel-delete" data-id="${idAttr}">Keep expense</button>` +
      '</div></div>'
    : '';

  const details =
    '<dl class="detail-grid">' +
    detailItem('Amount', esc(formatINR(e.amount)), ' num') +
    detailItem('Category', esc(e.category)) +
    detailItem('Vendor', esc(e.vendor || '\u2014')) +
    detailItem('Expense date', esc(fmtDate(e.expenseDate))) +
    detailItem('Due date', esc(fmtDate(e.dueDate))) +
    detailItem('Payment status', renderStatusBadges(e)) +
    detailItem('Added', esc(fmtStamp(e.createdAt))) +
    detailItem('Last updated', esc(fmtStamp(e.updatedAt))) +
    '</dl>';

  const notes = e.notes
    ? `<p class="detail-notes">${esc(e.notes)}</p>`
    : '<p class="empty-text">No notes added.</p>';

  return (
    `<a class="back-link" href="#/expenses">${BACK_TO_EXPENSES}</a>` +
    renderHeader(e.title, e.vendor || 'No vendor', actions) +
    confirmHtml +
    '<section class="card"><div class="card-header"><h2 class="card-title">Expense details</h2></div>' +
    `<div class="card-body">${details}</div></section>` +
    '<section class="card"><div class="card-header"><h2 class="card-title">Notes</h2></div>' +
    `<div class="card-body">${notes}</div></section>`
  );
}

/** Renders the expenses page for a route object from parseExpensesRoute, returning an HTML string. */
export function renderExpensesPage(route, state) {
  const r = route || { view: 'list' };
  const s = state || {};
  const notice = renderNotice(takeFlash()) + renderStorageWarning();

  if (r.view === 'new') return notice + renderNewView(s);
  if (r.view === 'edit') return notice + renderEditView(r.id, s);
  if (r.view === 'detail') return notice + renderDetailView(r.id, s);
  return notice + renderListView();
}

/** Re-renders the list results slot from the current search and filter controls. */
function refreshResults(rootEl) {
  const slot = rootEl.querySelector('[data-expense-results]');
  if (!slot) return;
  const search = rootEl.querySelector('#expenses-search');
  const category = rootEl.querySelector('#expenses-category');
  const status = rootEl.querySelector('#expenses-status');
  slot.innerHTML = renderExpenseRows(
    search ? search.value : '',
    category ? category.value : '',
    status ? status.value : '',
  );
}

/** Sets the hash and re-renders through the router; when the hash is already set, dispatches hashchange manually. */
function navigateTo(target) {
  // Capture before assigning: once the hash changes, hashchange re-renders the page.
  const unchanged = location.hash === target;
  location.hash = target;
  if (unchanged) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Wires search, filters, form submission and detail actions for the expenses page into rootEl. */
export function attachExpensesHandlers(rootEl) {
  if (!rootEl) return;

  const onFilterInput = (event) => {
    const target = event.target;
    if (!target) return;
    if (
      target.id === 'expenses-search' ||
      target.id === 'expenses-category' ||
      target.id === 'expenses-status'
    ) {
      refreshResults(rootEl);
    }
  };

  rootEl.oninput = onFilterInput;
  rootEl.onchange = onFilterInput;

  rootEl.onclick = async (event) => {
    const target = event.target;
    const el = target && typeof target.closest === 'function' ? target.closest('[data-action]') : null;
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id || '';

    if (action === 'ask-delete') {
      rootEl.innerHTML = renderExpensesPage({ view: 'detail', id }, { confirmDelete: true });
      attachExpensesHandlers(rootEl);
      return;
    }

    if (action === 'cancel-delete') {
      rootEl.innerHTML = renderExpensesPage({ view: 'detail', id });
      attachExpensesHandlers(rootEl);
      return;
    }

    if (action === 'confirm-delete') {
      try {
        await deleteExpense(id);
        setFlash('success', 'Expense deleted.');
      } catch (err) {
        setFlash('error', err.message || 'Could not delete this expense.');
      }
      navigateTo('#/expenses');
    }
  };

  rootEl.onsubmit = async (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[data-form="expense"]')) return;
    event.preventDefault();

    const mode = form.dataset.mode === 'edit' ? 'edit' : 'new';
    const id = form.dataset.id || '';
    const fd = new FormData(form);
    const str = (name) => {
      const v = fd.get(name);
      return typeof v === 'string' ? v : '';
    };
    const rawValues = {
      title: str('title'),
      category: str('category'),
      vendor: str('vendor'),
      amount: str('amount'),
      expenseDate: str('expenseDate'),
      dueDate: str('dueDate'),
      paymentStatus: str('paymentStatus'),
      notes: str('notes'),
    };

    const result = validateExpense(rawValues);

    if (!result.valid) {
      rootEl.innerHTML = renderExpensesPage(
        { view: mode, id },
        { values: rawValues, errors: result.errors },
      );
      attachExpensesHandlers(rootEl);
      const firstInvalid = rootEl.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    let target;
    try {
      if (mode === 'edit') {
        await updateExpense(id, result.values);
        setFlash('success', 'Expense updated.');
        target = '#/expenses/' + encodeURIComponent(id);
      } else {
        const created = await createExpense(result.values);
        setFlash('success', 'Expense added.');
        target = '#/expenses/' + encodeURIComponent(created.id);
      }
    } catch (err) {
      setFlash('error', err.message || 'This expense could not be saved.');
      target = '#/expenses';
    }
    navigateTo(target);
  };
}
