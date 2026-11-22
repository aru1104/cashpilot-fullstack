// Client storage layer backed by the FastAPI SQLite API.

import { apiRequest } from './api.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{7,20}$/;

let clientsCache = [];

export function isPersistent() {
  return true;
}

export async function syncClients() {
  clientsCache = await apiRequest('/clients');
  return listClients();
}

function normalise(text) {
  return String(text ?? '').trim().toLowerCase();
}

export function listClients() {
  return clientsCache
    .map((c) => ({ ...c }))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), undefined, { sensitivity: 'base' }));
}

export function getClient(id) {
  const found = clientsCache.find((c) => c.id === id);
  return found ? { ...found } : null;
}

export async function createClient(values) {
  const created = await apiRequest('/clients', {
    method: 'POST',
    body: JSON.stringify(values),
  });
  clientsCache.push(created);
  return { ...created };
}

export async function updateClient(id, values) {
  const updated = await apiRequest(`/clients/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  });
  const idx = clientsCache.findIndex((c) => c.id === id);
  if (idx !== -1) clientsCache[idx] = updated;
  return { ...updated };
}

export async function deleteClient(id) {
  await apiRequest(`/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
  clientsCache = clientsCache.filter((c) => c.id !== id);
  return true;
}

export function validateClient(input) {
  const str = (x) => (x == null ? '' : String(x).trim());
  const values = {
    fullName: str(input?.fullName),
    businessName: str(input?.businessName),
    email: str(input?.email),
    phone: str(input?.phone),
    notes: str(input?.notes),
  };
  const errors = {};
  if (!values.fullName) errors.fullName = "Enter the client's full name.";
  else if (values.fullName.length > 100) errors.fullName = 'Keep the name under 100 characters.';
  if (!values.email) errors.email = 'Enter an email address.';
  else if (!EMAIL_RE.test(values.email) || values.email.length > 254) {
    errors.email = 'Enter a valid email address, for example name@company.com.';
  }
  if (values.phone) {
    const digits = (values.phone.match(/[0-9]/g) || []).length;
    if (!PHONE_RE.test(values.phone) || digits < 7 || digits > 15) {
      errors.phone = 'Enter a valid phone number, for example +91 98765 43210.';
    }
  }
  if (values.businessName.length > 120) errors.businessName = 'Keep the business name under 120 characters.';
  if (values.notes.length > 1000) errors.notes = 'Keep notes under 1000 characters.';
  return { valid: Object.keys(errors).length === 0, errors, values };
}

export function searchClients(clients, query) {
  const q = normalise(query);
  if (!q) return [...clients];
  return clients.filter(
    (c) => normalise(c.fullName).includes(q) || normalise(c.businessName).includes(q),
  );
}
