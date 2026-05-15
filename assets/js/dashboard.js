// utils.js – Pure helper functions: formatting, sanitization, validation, CSV, debounce, SKU generation
import { getSetting } from './db.js';

/* ---------------------------------------------------------------
   CURRENCY & DATE FORMATTING (read settings dynamically)
   --------------------------------------------------------------- */
let _currencySymbolCache = null;
let _dateFormatCache = null;

async function getCurrencySymbol() {
  if (_currencySymbolCache) return _currencySymbolCache;
  try {
    _currencySymbolCache = await getSetting('currency_symbol', '$');
  } catch {
    _currencySymbolCache = '$';
  }
  return _currencySymbolCache;
}

async function getDateFormat() {
  if (_dateFormatCache) return _dateFormatCache;
  try {
    _dateFormatCache = await getSetting('date_format', 'DD/MM/YYYY');
  } catch {
    _dateFormatCache = 'DD/MM/YYYY';
  }
  return _dateFormatCache;
}

// Synchronous fallback wrappers (callers should await these if possible)
function formatCurrencySync(amount, symbol = '$') {
  const num = parseFloat(amount) || 0;
  return `${symbol} ${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

async function formatCurrency(amount) {
  const sym = await getCurrencySymbol();
  return formatCurrencySync(amount, sym);
}

function formatDateSync(dateStr, format = 'DD/MM/YYYY') {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  return `${day}/${month}/${year}`; // DD/MM/YYYY default
}

async function formatDate(dateStr) {
  const fmt = await getDateFormat();
  return formatDateSync(dateStr, fmt);
}

/* ---------------------------------------------------------------
   XSS SANITIZATION
   --------------------------------------------------------------- */
function sanitize(str) {
  if (typeof str !== 'string') return str;
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------------
   STRING / NUMBER HELPERS
   --------------------------------------------------------------- */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function calculateProfitMargin(cost, selling) {
  const c = parseFloat(cost) || 0;
  const s = parseFloat(selling) || 0;
  if (c <= 0) return 0;
  return ((s - c) / c) * 100;
}

function timeSince(dateStr) {
  const now = new Date();
  const past = new Date(dateStr);
  const diffMs = now - past;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateSync(dateStr);
}

/* ---------------------------------------------------------------
   DEBOUNCE / THROTTLE
   --------------------------------------------------------------- */
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* ---------------------------------------------------------------
   CSV EXPORT (from array of objects)
   --------------------------------------------------------------- */
function exportCSV({ data, filename = 'export.csv', headers = null }) {
  if (!data || data.length === 0) {
    ui.toast('No data to export.', 'warning');
    return;
  }

  // Determine headers from data keys if not provided
  const headerRow = headers || Object.keys(data[0]);
  let csvContent = headerRow.map(h => `"${h}"`).join(',') + '\n';

  data.forEach(row => {
    const values = headerRow.map(key => {
      let val = row[key] !== undefined ? row[key] : '';
      if (typeof val === 'string') {
        val = val.replace(/"/g, '""'); // escape double quotes
        val = `"${val}"`;
      }
      return val;
    });
    csvContent += values.join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------
   SKU GENERATION (category code + random digits)
   --------------------------------------------------------------- */
function generateSKU(categoryName = 'GEN') {
  const code = categoryName.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GEN';
  const random = String(Math.floor(1000 + Math.random() * 9000)); // 4 digits
  return `${code}-${random}`;
}

/* ---------------------------------------------------------------
   FORM VALIDATION (reusable rules engine)
   --------------------------------------------------------------- */
function validate(rules, data) {
  const errors = {};
  let isValid = true;

  for (const rule of rules) {
    const value = data[rule.field] !== undefined ? data[rule.field] : '';
    const field = rule.field;

    switch (rule.type) {
      case 'required': {
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          errors[field] = rule.message || `${field} is required.`;
          isValid = false;
        }
        break;
      }
      case 'minLength': {
        if (value && value.length < rule.value) {
          errors[field] = rule.message || `${field} must be at least ${rule.value} characters.`;
          isValid = false;
        }
        break;
      }
      case 'maxLength': {
        if (value && value.length > rule.value) {
          errors[field] = rule.message || `${field} must be no more than ${rule.value} characters.`;
          isValid = false;
        }
        break;
      }
      case 'numeric': {
        if (value !== '' && isNaN(Number(value))) {
          errors[field] = rule.message || `${field} must be a number.`;
          isValid = false;
        }
        break;
      }
      case 'min': {
        if (value !== '' && Number(value) < rule.value) {
          errors[field] = rule.message || `${field} must be at least ${rule.value}.`;
          isValid = false;
        }
        break;
      }
      case 'max': {
        if (value !== '' && Number(value) > rule.value) {
          errors[field] = rule.message || `${field} must be no more than ${rule.value}.`;
          isValid = false;
        }
        break;
      }
      case 'email': {
        if (value && !validateEmail(value)) {
          errors[field] = rule.message || 'Please enter a valid email address.';
          isValid = false;
        }
        break;
      }
      case 'pattern': {
        if (value && !new RegExp(rule.value).test(value)) {
          errors[field] = rule.message || `${field} format is invalid.`;
          isValid = false;
        }
        break;
      }
      case 'custom': {
        if (typeof rule.validator === 'function') {
          const valid = rule.validator(value, data);
          if (!valid) {
            errors[field] = rule.message || `${field} is invalid.`;
            isValid = false;
          }
        }
        break;
      }
    }
  }

  return { isValid, errors };
}

/* ---------------------------------------------------------------
   PASSWORD STRENGTH (used in change password)
   --------------------------------------------------------------- */
function passwordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return { score, max: 4 };
}

/* Exports */
export {
  sanitize,
  formatCurrency,
  formatCurrencySync,
  formatDate,
  formatDateSync,
  generateId,
  validateEmail,
  calculateProfitMargin,
  timeSince,
  debounce,
  exportCSV,
  generateSKU,
  validate,
  passwordStrength
};
