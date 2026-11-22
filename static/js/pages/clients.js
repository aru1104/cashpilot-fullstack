// Clients page for CashPilot: list, search, add/edit form, detail view and delete confirmation.

import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  validateClient,
  searchClients,
  isPersistent,
} from '../clients-store.js';
import { getInvoicesForClient, getClientOutstanding } from '../invoices-store.js';
import { renderInvoiceStatusBadge } from './invoices.js';
import { formatINR, formatDate } from '../format.js';
import { escapeHtml, renderPageHeader } from '../components.js';

const BACK_TO_CLIENTS = '\u2190 Back to clients';

/** One-shot notice shown on the next render of the clients page. */
let flash = null;

/** Sets the notice shown on the next clients page render. */
export function setFlash(type, message) {
  flash = { type, message };
}

function takeFlash() {
  const current = flash;
  flash = null;
  return current;
}

/** Parses a location.hash string into a clients route object. */
export function parseClientsRoute(hash) {
  const raw = String(hash ?? '').replace(/^#\//, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] !== 'clients') return { view: 'list' };
  if (parts.length === 1) return { view: 'list' };
  if (parts.length === 2 && parts[1] === 'new') return { view: 'new' };
  if (parts.length === 2 || (parts.length === 3 && parts[2] === 'edit')) {
    let id;
    try {
      id = decodeURIComponent(parts[1]);
    } catch {
      return { view: 'list' };
    }
    return { view: parts.length === 2 ? 'detail' : 'edit', id };
  }
  return { view: 'list' };
}

function renderNotice(current) {
  if (!current) return '';
  const cls = current.type === 'error' ? 'notice-error' : 'notice-success';
  return `<div class="notice ${cls}" role="status">${escapeHtml(current.message)}</div>`;
}

function renderHeader(title, subtitle, actionsHtml = '') {
  const sub = subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : '';
  const actions = actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : '';
  return `<header class="page-header"><div><h1 class="page-title">${escapeHtml(title)}</h1>${sub}</div>${actions}</header>`;
}

function renderNotFound() {
  return (
    renderHeader('Clients') +
    '<div class="empty-state"><h2 class="empty-title">Client not found</h2>' +
    '<p class="empty-text">This client may have been deleted.</p>' +
    '<a class="btn btn-secondary" href="#/clients">Back to clients</a></div>'
  );
}

function renderClientRows(list, query) {
  if (listClients().length === 0) {
    return (
      '<div class="empty-state"><h2 class="empty-title">No clients yet</h2>' +
      '<p class="empty-text">Add your first client to start tracking invoices and payments.</p>' +
      '<a class="btn btn-primary" href="#/clients/new">Add client</a></div>'
    );
  }
  if (list.length === 0) {
    return (
      '<div class="empty-state"><p class="empty-text">No clients match \u201C' +
      escapeHtml(query) +
      '\u201D.</p></div>'
    );
  }
  const n = list.length;
  const rows = list
    .map((c) => {
      const encId = encodeURIComponent(c.id);
      return (
        '<tr>' +
        `<td><a class="table-link" href="#/clients/${escapeHtml(encId)}">${escapeHtml(c.fullName)}</a></td>` +
        `<td>${escapeHtml(c.businessName || '\u2014')}</td>` +
        `<td>${escapeHtml(c.email)}</td>` +
        `<td>${escapeHtml(c.phone || '\u2014')}</td>` +
        `<td class="num">${escapeHtml(formatINR(getClientOutstanding(c.id)))}</td>` +
        '</tr>'
      );
    })
    .join('');
  return (
    `<p class="stat-hint">${n} client${n === 1 ? '' : 's'}</p>` +
    '<div class="table-scroll"><table class="table"><caption class="sr-only">Clients</caption><thead><tr>' +
    '<th scope="col">Client</th>' +
    '<th scope="col">Business</th>' +
    '<th scope="col">Email</th>' +
    '<th scope="col">Phone</th>' +
    '<th scope="col" class="num">Outstanding</th>' +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

function renderListView() {
  const warning = isPersistent()
    ? ''
    : '<div class="notice notice-warning" role="status">Browser storage is unavailable, so changes last only for this session.</div>';
  return (
    renderHeader(
      'Clients',
      'Manage the businesses and contacts you invoice.',
      '<a class="btn btn-primary" href="#/clients/new">Add client</a>',
    ) +
    warning +
    '<section class="card">' +
    '<div class="toolbar"><label class="search-field"><span class="sr-only">Search clients</span>' +
    '<input type="search" id="clients-search" class="search-input" placeholder="Search by client or business name" autocomplete="off"></label></div>' +
    `<div data-client-results>${renderClientRows(listClients(), '')}</div>` +
    '</section>'
  );
}

function renderField({ name, label, type = 'text', required = false, maxlength, textarea = false, span = false }, values, errors) {
  const id = `client-${name}`;
  const errId = `${id}-error`;
  const err = errors ? errors[name] : undefined;
  const classes = ['field'];
  if (err) classes.push('field-invalid');
  if (span) classes.push('span-full');
  const aria = err ? ` aria-invalid="true" aria-describedby="${errId}"` : '';
  const value = escapeHtml(values[name] ?? '');
  const control = textarea
    ? `<textarea id="${id}" class="field-textarea" name="${name}" rows="4" maxlength="${maxlength}"${aria}>${value}</textarea>`
    : `<input id="${id}" class="field-input" type="${type}" name="${name}" value="${value}"${required ? ' required' : ''} maxlength="${maxlength}"${aria}>`;
  const errorHtml = err ? `<p class="field-error" id="${errId}">${escapeHtml(err)}</p>` : '';
  return (
    `<div class="${classes.join(' ')}"><label class="field-label" for="${id}">${escapeHtml(label)}</label>` +
    control +
    errorHtml +
    '</div>'
  );
}

function renderFormView(view, id, client, state) {
  const isEdit = view === 'edit';
  const baseValues = client
    ? {
        fullName: client.fullName,
        businessName: client.businessName,
        email: client.email,
        phone: client.phone,
        notes: client.notes,
      }
    : {};
  const values = state && state.values ? state.values : baseValues;
  const errors = (state && state.errors) || {};
  const hasErrors = Object.keys(errors).length > 0;
  const cancelHref = isEdit ? `#/clients/${encodeURIComponent(id)}` : '#/clients';
  const backHref = cancelHref;
  const title = isEdit ? 'Edit client' : 'Add client';
  const subtitle = isEdit ? '' : 'Required fields are marked with *.';
  const formNotice = hasErrors
    ? '<div class="notice notice-error" role="alert">Please fix the highlighted fields.</div>'
    : '';

  return (
    `<a class="back-link" href="${escapeHtml(backHref)}">${BACK_TO_CLIENTS}</a>` +
    renderHeader(title, subtitle) +
    '<section class="card form-card">' +
    `<form class="form" data-form="client" data-mode="${isEdit ? 'edit' : 'create'}" data-id="${escapeHtml(isEdit ? id : '')}" novalidate>` +
    formNotice +
    '<div class="form-grid">' +
    renderField({ name: 'fullName', label: 'Full name *', required: true, maxlength: 100 }, values, errors) +
    renderField({ name: 'businessName', label: 'Business name', maxlength: 120 }, values, errors) +
    renderField({ name: 'email', label: 'Email address *', type: 'email', required: true, maxlength: 254 }, values, errors) +
    renderField({ name: 'phone', label: 'Phone number', type: 'tel', maxlength: 20 }, values, errors) +
    renderField({ name: 'notes', label: 'Notes', maxlength: 1000, textarea: true, span: true }, values, errors) +
    '</div>' +
    '<div class="form-actions"><button type="submit" class="btn btn-primary">Save client</button>' +
    `<a class="btn btn-secondary" href="${escapeHtml(cancelHref)}">Cancel</a></div>` +
    '</form></section>'
  );
}

function renderDetailView(client, state) {
  const id = client.id;
  const encId = encodeURIComponent(id);
  const confirming = Boolean(state && state.confirmDelete);

  const actions =
    `<a class="btn btn-secondary" href="#/clients/${escapeHtml(encId)}/edit">Edit</a>` +
    (confirming
      ? ''
      : `<button type="button" class="btn btn-danger" data-action="ask-delete" data-id="${escapeHtml(id)}">Delete</button>`);

  const confirmPanel = confirming
    ? '<div class="confirm-panel" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-desc">' +
      '<h2 class="card-title" id="confirm-title">Delete this client?</h2>' +
      `<p id="confirm-desc">${escapeHtml(client.fullName)} will be removed from CashPilot. This cannot be undone.</p>` +
      '<div class="form-actions">' +
      `<button type="button" class="btn btn-danger" data-action="confirm-delete" data-id="${escapeHtml(id)}">Yes, delete client</button>` +
      `<button type="button" class="btn btn-secondary" data-action="cancel-delete" data-id="${escapeHtml(id)}">Keep client</button>` +
      '</div></div>'
    : '';

  const phoneHtml = client.phone
    ? `<a href="tel:${escapeHtml(client.phone.replace(/[^0-9+]/g, ''))}">${escapeHtml(client.phone)}</a>`
    : '\u2014';

  const contact =
    '<section class="card"><div class="card-header"><h2 class="card-title">Contact details</h2></div><div class="card-body"><dl class="detail-grid">' +
    `<div class="detail-item"><dt class="detail-label">Email</dt><dd class="detail-value"><a href="mailto:${escapeHtml(client.email)}">${escapeHtml(client.email)}</a></dd></div>` +
    `<div class="detail-item"><dt class="detail-label">Phone</dt><dd class="detail-value">${phoneHtml}</dd></div>` +
    `<div class="detail-item"><dt class="detail-label">Business</dt><dd class="detail-value">${escapeHtml(client.businessName || '\u2014')}</dd></div>` +
    `<div class="detail-item"><dt class="detail-label">Outstanding balance</dt><dd class="detail-value num">${escapeHtml(formatINR(getClientOutstanding(client.id)))}</dd></div>` +
    `<div class="detail-item"><dt class="detail-label">Added</dt><dd class="detail-value">${escapeHtml(formatDate(new Date(client.createdAt)))}</dd></div>` +
    `<div class="detail-item"><dt class="detail-label">Last updated</dt><dd class="detail-value">${escapeHtml(formatDate(new Date(client.updatedAt)))}</dd></div>` +
    '</dl></div></section>';

  const notes =
    '<section class="card"><div class="card-header"><h2 class="card-title">Notes</h2></div><div class="card-body">' +
    (client.notes
      ? `<p class="detail-notes">${escapeHtml(client.notes)}</p>`
      : '<p class="empty-text">No notes added.</p>') +
    '</div></section>';

  const invoices = getInvoicesForClient(client.id);
  const invoiceBody = invoices.length === 0
    ? '<div class="empty-state"><h3 class="empty-title">No invoices for this client yet</h3>' +
      '<p class="empty-text">Invoices you create for this client will appear here.</p>' +
      '<a class="btn btn-secondary" href="#/invoices/new">Create invoice</a></div>'
    : '<div class="table-scroll"><table class="table"><caption class="sr-only">Invoice history</caption><thead><tr>' +
      '<th scope="col">Invoice</th>' +
      '<th scope="col" class="num">Total</th>' +
      '<th scope="col" class="num">Remaining</th>' +
      '<th scope="col">Due date</th>' +
      '<th scope="col">Status</th>' +
      '</tr></thead><tbody>' +
      invoices
        .map((inv) => {
          const [y, m, d] = String(inv.dueDate).split('-').map(Number);
          const due = formatDate(new Date(y, m - 1, d));
          return (
            '<tr>' +
            `<td><a class="table-link" href="#/invoices/${encodeURIComponent(inv.id)}">${escapeHtml(inv.number)}</a></td>` +
            `<td class="num">${escapeHtml(formatINR(inv.total))}</td>` +
            `<td class="num">${escapeHtml(formatINR(inv.remaining))}</td>` +
            `<td>${escapeHtml(due)}</td>` +
            `<td>${renderInvoiceStatusBadge(inv.displayStatus)}</td>` +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
  const invoiceCard =
    '<section class="card"><div class="card-header"><h2 class="card-title">Invoice history</h2></div>' +
    `<div class="card-body">${invoiceBody}</div></section>`;

  return (
    `<a class="back-link" href="#/clients">${BACK_TO_CLIENTS}</a>` +
    renderHeader(client.fullName, client.businessName || 'No business name', actions) +
    confirmPanel +
    contact +
    notes +
    invoiceCard
  );
}

/** Renders the clients page for a route object from parseClientsRoute, returning an HTML string. */
export function renderClientsPage(route, state) {
  const r = route || { view: 'list' };
  const notice = renderNotice(takeFlash());

  if (r.view === 'new') {
    return notice + renderFormView('new', '', null, state);
  }

  if (r.view === 'edit' || r.view === 'detail') {
    const client = getClient(r.id);
    if (!client) return notice + renderNotFound();
    if (r.view === 'edit') return notice + renderFormView('edit', client.id, client, state);
    return notice + renderDetailView(client, state);
  }

  return notice + renderListView();
}

function navigateTo(target, rootEl) {
  // Capture before assigning: once the hash changes, hashchange re-renders the page.
  const unchanged = location.hash === target;
  location.hash = target;
  if (unchanged) {
    rootEl.innerHTML = renderClientsPage(parseClientsRoute(target));
    attachClientsHandlers(rootEl);
  }
}

/** Wires search, delete confirmation and form submission for the clients page into rootEl. */
export function attachClientsHandlers(rootEl) {
  if (!rootEl) return;

  rootEl.oninput = (event) => {
    const target = event.target;
    if (!target || target.id !== 'clients-search') return;
    const slot = rootEl.querySelector('[data-client-results]');
    if (!slot) return;
    const value = target.value;
    slot.innerHTML = renderClientRows(searchClients(listClients(), value), value);
  };

  rootEl.onclick = async (event) => {
    const el = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el) return;
    const id = el.dataset.id;

    if (el.dataset.action === 'ask-delete') {
      rootEl.innerHTML = renderClientsPage({ view: 'detail', id }, { confirmDelete: true });
      attachClientsHandlers(rootEl);
    } else if (el.dataset.action === 'cancel-delete') {
      rootEl.innerHTML = renderClientsPage({ view: 'detail', id });
      attachClientsHandlers(rootEl);
    } else if (el.dataset.action === 'confirm-delete') {
      try { await deleteClient(id); setFlash('success', 'Client deleted.'); } catch (err) { setFlash('error', err.message || 'Could not delete this client.'); } navigateTo('#/clients', rootEl); return;
      const ok = false;
      if (ok) setFlash('success', 'Client deleted.');
      else setFlash('error', 'Could not delete this client. It may already be removed.');
      navigateTo('#/clients', rootEl);
    }
  };

  rootEl.onsubmit = async (event) => {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[data-form="client"]')) return;
    event.preventDefault();

    const mode = form.dataset.mode === 'edit' ? 'edit' : 'create';
    const id = form.dataset.id || '';
    const fd = new FormData(form);
    const result = validateClient({
      fullName: fd.get('fullName'),
      businessName: fd.get('businessName'),
      email: fd.get('email'),
      phone: fd.get('phone'),
      notes: fd.get('notes'),
    });

    if (!result.valid) {
      rootEl.innerHTML = renderClientsPage(
        { view: mode === 'edit' ? 'edit' : 'new', id },
        { values: result.values, errors: result.errors },
      );
      attachClientsHandlers(rootEl);
      const firstInvalid = rootEl.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    let target;
    try {
      if (mode === 'create') {
        const created = await createClient(result.values);
        setFlash('success', 'Client added.');
        target = '#/clients/' + encodeURIComponent(created.id);
      } else {
        await updateClient(id, result.values);
        setFlash('success', 'Client updated.');
        target = '#/clients/' + encodeURIComponent(id);
      }
    } catch (err) {
      setFlash('error', err.message || 'Could not save client.');
      target = '#/clients';
    }
    navigateTo(target, rootEl);
  };
}
