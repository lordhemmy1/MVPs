// audit.js – Audit log writer and audit log viewer page (admin only)
import { db } from './db.js';
import { ui } from './ui.js';
import { sanitize, formatDateSync, exportCSV, getSetting } from './utils.js';
import { auth } from './auth.js';

/**
 * Central audit log writer. Can be used by any module.
 * @param {Object} entry - { user_id, user_name_snapshot, action, entity_type, entity_id?, old_values?, new_values? }
 */
export async function writeAuditLog(entry) {
  try {
    await db.audit_logs.add({
      user_id: entry.user_id,
      user_name_snapshot: entry.user_name_snapshot,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id || null,
      old_values: entry.old_values ? (typeof entry.old_values === 'string' ? entry.old_values : JSON.stringify(entry.old_values)) : null,
      new_values: entry.new_values ? (typeof entry.new_values === 'string' ? entry.new_values : JSON.stringify(entry.new_values)) : null,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Audit log write failed:', e);
  }
}

/* ================================================================
   AUDIT LOG VIEWER PAGE
   ================================================================ */
export async function init() {
  const container = document.getElementById('app-content');
  if (!container) return;

  if (!auth.hasRole('admin')) {
    container.innerHTML = '<p class="text-danger">Access denied. Only administrators can view audit logs.</p>';
    return;
  }

  ui.showSpinner();
  try {
    await renderAuditLogPage(container);
  } catch (err) {
    console.error(err);
    ui.toast('Failed to load audit logs.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

export function destroy() {}

async function renderAuditLogPage(container) {
  container.innerHTML = `
    <div class="audit-page">
      <h2>Audit Logs</h2>
      <div class="filter-bar" style="display:flex; flex-wrap:wrap; gap:var(--space-md); margin-bottom:var(--space-md);">
        <select id="audit-action-filter" class="form-select" style="max-width:180px;">
          <option value="">All Actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="login">Login</option>
          <option value="logout">Logout</option>
          <option value="void">Void</option>
        </select>
        <select id="audit-entity-filter" class="form-select" style="max-width:180px;">
          <option value="">All Entities</option>
          <option value="product">Product</option>
          <option value="user">User</option>
          <option value="sale">Sale</option>
          <option value="stock_in">Stock In</option>
          <option value="stock_out">Stock Out</option>
          <option value="adjustment">Adjustment</option>
          <option value="category">Category</option>
          <option value="supplier">Supplier</option>
        </select>
        <input type="date" id="audit-date-from" class="form-input" style="max-width:150px;" placeholder="From">
        <input type="date" id="audit-date-to" class="form-input" style="max-width:150px;" placeholder="To">
        <button id="apply-audit-filters-btn" class="btn btn-primary">Apply</button>
        <button id="export-audit-csv-btn" class="btn btn-secondary"><i class="fa-solid fa-download"></i> CSV</button>
        <button id="export-audit-pdf-btn" class="btn btn-secondary"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      </div>
      <div id="audit-table-container"></div>
    </div>`;

  let page = 1;
  const perPage = 20;

  async function fetchAndRender() {
    const action = document.getElementById('audit-action-filter')?.value || '';
    const entity = document.getElementById('audit-entity-filter')?.value || '';
    const dateFrom = document.getElementById('audit-date-from')?.value;
    const dateTo = document.getElementById('audit-date-to')?.value;

    let collection = db.audit_logs.orderBy('created_at').reverse();
    let logs = await collection.toArray();

    // Filters
    if (action) logs = logs.filter(l => l.action === action);
    if (entity) logs = logs.filter(l => l.entity_type === entity);
    if (dateFrom) logs = logs.filter(l => l.created_at >= dateFrom);
    if (dateTo) logs = logs.filter(l => l.created_at <= dateTo + 'T23:59:59');

    const total = logs.length;
    const start = (page - 1) * perPage;
    const paged = logs.slice(start, start + perPage);

    const columns = [
      { key: 'created_at', label: 'Date', sortable: true, render: val => formatDateSync(val) },
      { key: 'user_name_snapshot', label: 'User' },
      { key: 'action', label: 'Action', render: val => `<span class="badge badge-neutral">${val}</span>` },
      { key: 'entity_type', label: 'Entity' },
      { key: 'entity_id', label: 'Entity ID' },
      { key: 'old_values', label: 'Old Values', render: val => val ? `<small class="text-muted">${sanitize(val.substring(0, 50))}...</small>` : '—' },
      { key: 'new_values', label: 'New Values', render: val => val ? `<small class="text-muted">${sanitize(val.substring(0, 50))}...</small>` : '—' }
    ];

    ui.renderTable({
      container: document.getElementById('audit-table-container'),
      columns,
      data: paged,
      page,
      perPage,
      totalItems: total,
      onPageChange: (newPage) => {
        page = newPage;
        fetchAndRender();
      },
      emptyMessage: 'No audit logs match the filters.'
    });
  }

  document.getElementById('apply-audit-filters-btn').addEventListener('click', () => {
    page = 1;
    fetchAndRender();
  });

  // CSV Export
  document.getElementById('export-audit-csv-btn').addEventListener('click', async () => {
    const logs = await getAllFilteredLogs();
    exportCSV({
      data: logs.map(l => ({
        date: l.created_at,
        user: l.user_name_snapshot,
        action: l.action,
        entity: l.entity_type,
        entity_id: l.entity_id,
        old_values: l.old_values,
        new_values: l.new_values
      })),
      filename: `audit_logs_${new Date().toISOString().split('T')[0]}.csv`
    });
  });

  // PDF Export
  document.getElementById('export-audit-pdf-btn').addEventListener('click', async () => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      ui.toast('PDF library not loaded.', 'error');
      return;
    }
    const logs = await getAllFilteredLogs();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'pt', 'a4'); // landscape for more columns
    const businessName = await getSetting('business_name', 'Stockify');
    doc.setFontSize(16);
    doc.text(businessName + ' - Audit Logs', 40, 40);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 55);

    const body = logs.map(l => [
      formatDateSync(l.created_at),
      l.user_name_snapshot,
      l.action,
      l.entity_type,
      l.entity_id || '',
      l.old_values ? l.old_values.substring(0, 80) : '',
      l.new_values ? l.new_values.substring(0, 80) : ''
    ]);

    doc.autoTable({
      head: [['Date', 'User', 'Action', 'Entity', 'ID', 'Old Values', 'New Values']],
      body,
      startY: 65,
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 20, right: 20 }
    });

    doc.save(`audit_logs_${new Date().toISOString().split('T')[0]}.pdf`);
    ui.toast('PDF exported.', 'success');
  });

  // Helper to get all filtered logs (without pagination) for export
  async function getAllFilteredLogs() {
    const action = document.getElementById('audit-action-filter')?.value || '';
    const entity = document.getElementById('audit-entity-filter')?.value || '';
    const dateFrom = document.getElementById('audit-date-from')?.value;
    const dateTo = document.getElementById('audit-date-to')?.value;

    let logs = await db.audit_logs.orderBy('created_at').reverse().toArray();
    if (action) logs = logs.filter(l => l.action === action);
    if (entity) logs = logs.filter(l => l.entity_type === entity);
    if (dateFrom) logs = logs.filter(l => l.created_at >= dateFrom);
    if (dateTo) logs = logs.filter(l => l.created_at <= dateTo + 'T23:59:59');
    return logs;
  }

  // Initial load
  await fetchAndRender();
}
