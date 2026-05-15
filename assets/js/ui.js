// ui.js – Shared UI utilities: toast, modal, spinner, table rendering, pagination, sorting, empty states
import { sanitize, formatCurrency, formatDate, getSetting } from './utils.js';

/* ---------------------------------------------------------------
   TOAST NOTIFICATIONS
   --------------------------------------------------------------- */
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.innerHTML = `
    <i class="fa-solid ${icons[type] || icons.info}"></i>
    <span>${sanitize(message)}</span>
  `;

  container.appendChild(toastEl);

  // Auto dismiss
  setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(100%)';
    toastEl.style.transition = 'all 0.3s ease';
    setTimeout(() => toastEl.remove(), 300);
  }, duration);

  // Click to dismiss early
  toastEl.addEventListener('click', () => {
    toastEl.remove();
  });
}

/* ---------------------------------------------------------------
   MODAL MANAGEMENT
   --------------------------------------------------------------- */
let modalCallback = null;

function showModal({ title, body, footer, onClose, size = 'default' }) {
  const container = document.getElementById('modal-container');
  const overlay = document.getElementById('modal-overlay');
  const modalEl = document.getElementById('modal');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const footerEl = document.getElementById('modal-footer');
  const closeBtn = document.getElementById('modal-close');

  if (!container) return;

  titleEl.textContent = title || '';
  bodyEl.innerHTML = typeof body === 'string' ? body : '';
  if (typeof body === 'object' && body instanceof HTMLElement) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(body);
  }
  footerEl.innerHTML = typeof footer === 'string' ? footer : '';
  if (typeof footer === 'object' && footer instanceof HTMLElement) {
    footerEl.innerHTML = '';
    footerEl.appendChild(footer);
  }

  if (size === 'large') {
    modalEl.style.maxWidth = '800px';
  } else {
    modalEl.style.maxWidth = '560px';
  }

  container.classList.add('active');
  modalCallback = onClose || null;

  // Close handlers
  const closeModal = () => {
    container.classList.remove('active');
    if (modalCallback) {
      modalCallback();
      modalCallback = null;
    }
  };

  overlay.onclick = closeModal;
  closeBtn.onclick = closeModal;
}

function closeModal() {
  const container = document.getElementById('modal-container');
  if (container) {
    container.classList.remove('active');
    if (modalCallback) {
      modalCallback();
      modalCallback = null;
    }
  }
}

/* ---------------------------------------------------------------
   SPINNER
   --------------------------------------------------------------- */
function showSpinner() {
  const spinner = document.getElementById('spinner-overlay');
  if (spinner) spinner.classList.remove('hidden');
}

function hideSpinner() {
  const spinner = document.getElementById('spinner-overlay');
  if (spinner) spinner.classList.add('hidden');
}

/* ---------------------------------------------------------------
   TABLE RENDERING WITH SORTABLE HEADERS & PAGINATION
   --------------------------------------------------------------- */
function renderTable({
  container,
  columns,        // Array of { key, label, sortable, render }
  data,           // Array of row objects
  sortKey = null,
  sortDir = 'asc',
  onSort = null,  // callback(key, direction)
  page = 1,
  perPage = 20,
  onPageChange = null,
  emptyMessage = 'No records found.',
  tableClass = ''
}) {
  if (!container) return;

  const totalPages = Math.ceil(data.length / perPage) || 1;
  const start = (page - 1) * perPage;
  const pagedData = data.slice(start, start + perPage);

  // Build HTML
  let html = '<div class="table-wrapper"><table class="' + tableClass + '">';
  // Headers
  html += '<thead><tr>';
  columns.forEach(col => {
    const sortClass = col.sortable ? ' sortable' : '';
    const sortIndicator = (col.sortable && col.key === sortKey)
      ? (sortDir === 'asc' ? ' sort-asc' : ' sort-desc')
      : '';
    html += `<th class="${sortClass}${sortIndicator}" data-sort-key="${col.key}">${col.label}</th>`;
  });
  html += '</tr></thead><tbody>';

  if (pagedData.length === 0) {
    html += `<tr><td colspan="${columns.length}" class="text-center">${emptyMessage}</td></tr>`;
  } else {
    pagedData.forEach(row => {
      html += '<tr>';
      columns.forEach(col => {
        const value = row[col.key];
        const display = col.render ? col.render(value, row) : (value !== undefined ? sanitize(String(value)) : '');
        html += `<td>${display}</td>`;
      });
      html += '</tr>';
    });
  }

  html += '</tbody></table></div>';

  // Pagination controls
  if (totalPages > 1) {
    html += renderPagination(page, totalPages);
  }

  container.innerHTML = html;

  // Bind sort events
  if (onSort) {
    const thElements = container.querySelectorAll('th.sortable');
    thElements.forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort-key');
        const newDir = (key === sortKey && sortDir === 'asc') ? 'desc' : 'asc';
        onSort(key, newDir);
      });
    });
  }

  // Bind pagination events
  if (onPageChange && totalPages > 1) {
    const pageButtons = container.querySelectorAll('.page-btn');
    pageButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPage = parseInt(btn.getAttribute('data-page'), 10);
        if (targetPage && targetPage !== page) {
          onPageChange(targetPage);
        }
      });
    });
  }
}

/* ---------------------------------------------------------------
   PAGINATION HTML GENERATOR
   --------------------------------------------------------------- */
function renderPagination(currentPage, totalPages) {
  let html = '<div class="pagination">';
  // Previous
  html += `<button class="page-btn btn btn-ghost" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

  // Page numbers (simple: show max 5 pages around current)
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = startPage + maxVisible - 1;
  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn btn ${i === currentPage ? 'btn-primary' : 'btn-ghost'}" data-page="${i}">${i}</button>`;
  }

  // Next
  html += `<button class="page-btn btn btn-ghost" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
  html += '</div>';
  return html;
}

/* ---------------------------------------------------------------
   EMPTY STATE RENDERER
   --------------------------------------------------------------- */
function renderEmptyState({ message = 'Nothing here yet.', icon = null, actionText = null, actionLink = null }) {
  return `
    <div class="empty-state">
      <img src="assets/images/empty-state.svg" alt="Empty">
      <h3>${sanitize(message)}</h3>
      ${actionText && actionLink ? `<a href="${actionLink}" class="btn btn-primary">${sanitize(actionText)}</a>` : ''}
    </div>`;
}

/* ---------------------------------------------------------------
   SKELETON LOADER (for dashboards/tables)
   --------------------------------------------------------------- */
function renderSkeletonLoader(lines = 5) {
  let html = '<div class="skeleton-loader">';
  for (let i = 0; i < lines; i++) {
    html += `<div class="skeleton-line" style="animation-delay: ${i * 0.1}s; width: ${80 + Math.random() * 20}%"></div>`;
  }
  html += '</div>';
  return html;
}

/* ---------------------------------------------------------------
   FORM VALIDATION ERROR DISPLAY
   --------------------------------------------------------------- */
function showFieldError(fieldName, message) {
  const field = document.querySelector(`[name="${fieldName}"]`);
  if (!field) return;
  field.classList.add('is-invalid');
  // Remove existing error
  const existing = field.parentElement.querySelector('.form-error-text');
  if (existing) existing.remove();
  const errorEl = document.createElement('span');
  errorEl.className = 'form-error-text';
  errorEl.textContent = message;
  field.parentElement.appendChild(errorEl);
}

function clearFieldErrors(formSelector = null) {
  const form = formSelector ? document.querySelector(formSelector) : document;
  if (!form) return;
  form.querySelectorAll('.is-invalid').forEach(f => f.classList.remove('is-invalid'));
  form.querySelectorAll('.form-error-text').forEach(e => e.remove());
}

/* ---------------------------------------------------------------
   SEARCHABLE DROPDOWN (for product/select search)
   --------------------------------------------------------------- */
class SearchableDropdown {
  constructor({ inputEl, containerEl, fetchItems, renderItem, onSelect }) {
    this.inputEl = inputEl;
    this.containerEl = containerEl;
    this.fetchItems = fetchItems;   // async function(query) returning array of items
    this.renderItem = renderItem;   // function(item) returning HTML string
    this.onSelect = onSelect;       // function(item)
    this.items = [];
    this.activeIndex = -1;
    this.visible = false;

    this._init();
  }

  _init() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'search-dropdown';
    this.containerEl.appendChild(this.dropdown);
    this.inputEl.addEventListener('input', this._debounce(async (e) => {
      const query = e.target.value.trim();
      if (query.length === 0) {
        this.hide();
        return;
      }
      try {
        this.items = await this.fetchItems(query);
        this.activeIndex = -1;
        this._render();
        this.show();
      } catch (err) {
        console.error('Dropdown fetch error:', err);
      }
    }, 300));

    this.inputEl.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.items.length - 1);
        this._highlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this._highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.activeIndex >= 0 && this.items[this.activeIndex]) {
          this._select(this.items[this.activeIndex]);
        }
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    document.addEventListener('click', (e) => {
      if (!this.containerEl.contains(e.target)) {
        this.hide();
      }
    });
  }

  _render() {
    this.dropdown.innerHTML = this.items.map((item, idx) =>
      `<div class="search-dropdown-item${idx === this.activeIndex ? ' active' : ''}" data-index="${idx}">${this.renderItem(item)}</div>`
    ).join('');

    this.dropdown.querySelectorAll('.search-dropdown-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        this._select(this.items[idx]);
      });
    });
  }

  _highlight() {
    const items = this.dropdown.querySelectorAll('.search-dropdown-item');
    items.forEach((el, idx) => {
      if (idx === this.activeIndex) el.classList.add('active');
      else el.classList.remove('active');
    });
  }

  _select(item) {
    this.onSelect(item);
    this.hide();
    this.inputEl.value = '';
  }

  show() {
    this.dropdown.classList.add('show');
    this.visible = true;
  }

  hide() {
    this.dropdown.classList.remove('show');
    this.visible = false;
    this.activeIndex = -1;
  }

  _debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
}

/* ---------------------------------------------------------------
   EXPORT ALL UTILITIES
   --------------------------------------------------------------- */
export const ui = {
  toast,
  showModal,
  closeModal,
  showSpinner,
  hideSpinner,
  renderTable,
  renderPagination,
  renderEmptyState,
  renderSkeletonLoader,
  showFieldError,
  clearFieldErrors,
  SearchableDropdown
};
