// Formatting helpers for CashPilot (en-IN locale, rupees).

const inrCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const shortDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const longDate = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dayMonth = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
});

export function formatINR(amount) {
  return inrCurrency.format(amount);
}

export function formatDate(date) {
  return shortDate.format(date);
}

export function formatLongDate(date) {
  return longDate.format(date);
}

export function formatDayMonth(date) {
  return dayMonth.format(date);
}
