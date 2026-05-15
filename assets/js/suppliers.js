// suppliers.js – Supplier management: list, add, edit, deactivate, profile with supply history
import { db } from './db.js';
import { ui } from './ui.js';
import { sanitize, formatCurrencySync, formatDateSync, validate } from './utils.js';
import { auth } from './auth.js';

export async function init(params = {}) {
  const container = document.getElementById('app-content');
  if (!container) return;
  
  // Check if we are on supplier profile (/suppliers/:id)
  const { id } = params;
  if (id && !params.action) {
    await renderSupplierProfile(container, parseInt(id));
    return;
  }

  // Default: supplier list
  await renderSupplierList(container);
}

export function destroy() {}

/* ================================================================
   SUPPLIER LIST
   ================================================================ */
async function renderSupplierList(container) {
  const suppliers = await db.suppliers.toArray();
  // Get total products supplied count per supplier
  const productCounts = {};
  const movements = await db.stock_movements.where('type').equals('stock_in').toArray();
  const productMap = {};
  const products = await db.products.toArray();
  products.forEach(p => { productMap[p.id] = p.supplier_id; });
  movements.forEach(m => {
    const supId = productMap[m.product_id];
    if (supId) {
      productCounts[supId] = (productCounts[supId] || 0) + 1;
    }
  });

  container.innerHTML = `
    <div class="suppliers-page">
      <h2>Suppliers</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:var(--space-md);">
        <button id="add-supplier-btn" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Add Supplier</button>
      </div>
      <div id="suppliers-table-container"></div>
    </div>`;

  const tableContainer = document.getElementById('suppliers-table-container');

  function renderTable() {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'contact_person', label: 'Contact Person', render: val => val || '—' },
      { key: 'phone', label: 'Phone', render: val => val || '—' },
      { key: 'email', label: 'Email', render: val => val || '—' },
      { key: 'is_active', label: 'Status', render: (val) => val ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>' },
      { key: 'product_supplied', label: 'Supplies', render: (_, row) => productCounts[row.id] || 0 },
      { key: 'actions', label: '', render: (_, row) => `
        <a href="#/suppliers/${row.id}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-eye"></i></a>
        <button class="btn btn-ghost btn-sm edit-supplier-btn" data-id="${row.id}"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost btn-sm toggle-supplier-btn" data-id="${row.id}" data-active="${row.is_active}">
          <i class="fa-solid ${row.is_active ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted'}"></i>
        </button>
      `}
    ];

    ui.renderTable({
      container: tableContainer,
      columns,
      data: suppliers,
      emptyMessage: 'No suppliers found.'
    });

    // Bind actions
    tableContainer.querySelectorAll('.edit-supplier-btn').forEach(btn => {
      btn.addEventListener('click', () => openSupplierModal(suppliers.find(s => s.id === parseInt(btn.dataset.id))));
    });
    tableContainer.querySelectorAll('.toggle-supplier-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleSupplierActive(parseInt(btn.dataset.id), btn.dataset.active === 'true'));
    });
  }

  document.getElementById('add-supplier-btn').addEventListener('click', () => openSupplierModal(null));

  renderTable();

  function openSupplierModal(supplier = null) {
    const isEdit = !!supplier;
    ui.showModal({
      title: isEdit ? 'Edit Supplier' : 'Add Supplier',
      body: `
        <form id="supplier-form">
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input type="text" name="name" class="form-input" value="${sanitize(supplier?.name || '')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Contact Person</label>
            <input type="text" name="contact_person" class="form-input" value="${sanitize(supplier?.contact_person || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" name="phone" class="form-input" value="${sanitize(supplier?.phone || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" name="email" class="form-input" value="${sanitize(supplier?.email || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Address</label>
            <textarea name="address" class="form-textarea">${sanitize(supplier?.address || '')}</textarea>
          </div>
        </form>`,
      footer: `
        <button class="btn btn-secondary close-modal">Cancel</button>
        <button class="btn btn-primary" id="save-supplier-btn">${isEdit ? 'Update' : 'Save'}</button>
      `
    });

    document.getElementById('save-supplier-btn').addEventListener('click', async () => {
      const form = document.getElementById('supplier-form');
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      const rules = [{ field: 'name', type: 'required', message: 'Name is required.' }];
      const validation = validate(rules, data);
      if (!validation.isValid) {
        ui.showFieldError('name', validation.errors.name);
        return;
      }

      try {
        if (isEdit) {
          await db.suppliers.update(supplier.id, data);
          ui.toast('Supplier updated.', 'success');
        } else {
          await db.suppliers.add({
            ...data,
            is_active: true,
            created_at: new Date().toISOString()
          });
          ui.toast('Supplier added.', 'success');
        }
        ui.closeModal();
        refreshSuppliers();
      } catch (err) {
        ui.toast('Error saving supplier.', 'error');
      }
    });
  }

  async function toggleSupplierActive(supplierId, currentActive) {
    try {
      await db.suppliers.update(supplierId, { is_active: !currentActive });
      ui.toast(`Supplier ${currentActive ? 'deactivated' : 'activated'}.`, 'success');
      refreshSuppliers();
    } catch (err) {
      ui.toast('Failed to toggle status.', 'error');
    }
  }

  async function refreshSuppliers() {
    const updated = await db.suppliers.toArray();
    suppliers.length = 0;
    suppliers.push(...updated);
    // Recalculate product counts
    for (const key in productCounts) delete productCounts[key];
    const movs = await db.stock_movements.where('type').equals('stock_in').toArray();
    const prods = await db.products.toArray();
    const prodMap = {};
    prods.forEach(p => { prodMap[p.id] = p.supplier_id; });
    movs.forEach(m => {
      const supId = prodMap[m.product_id];
      if (supId) productCounts[supId] = (productCounts[supId] || 0) + 1;
    });
    renderTable();
  }
}

/* ================================================================
   SUPPLIER PROFILE
   ================================================================ */
async function renderSupplierProfile(container, supplierId) {
  const supplier = await db.suppliers.get(supplierId);
  if (!supplier) {
    container.innerHTML = '<p class="text-danger">Supplier not found.</p>';
    return;
  }

  // Supply history: stock_in movements where product's supplier is this supplier
  const productsOfSupplier = await db.products.where('supplier_id').equals(supplierId).toArray();
  const productIds = productsOfSupplier.map(p => p.id);
  const movements = productIds.length > 0 
    ? await db.stock_movements.where('product_id').anyOf(productIds).and(m => m.type === 'stock_in').reverse().sortBy('created_at')
    : [];

  // Total stock supplied (units)
  const totalUnits = movements.reduce((sum, m) => sum + m.quantity, 0);
  // Total cost value (approximation: use current cost_price of product)
  const productMap = Object.fromEntries(productsOfSupplier.map(p => [p.id, p]));
  const totalCost = movements.reduce((sum, m) => sum + (m.quantity * (productMap[m.product_id]?.cost_price || 0)), 0);

  // Enrich movements with product name
  const enrichedMovements = movements.map(m => ({
    ...m,
    product_name: productMap[m.product_id]?.name || 'Unknown'
  }));

  container.innerHTML = `
    <div class="supplier-profile">
      <h2>${sanitize(supplier.name)}</h2>
      <div class="card">
        <p><strong>Contact Person:</strong> ${sanitize(supplier.contact_person || '—')}</p>
        <p><strong>Phone:</strong> ${supplier.phone || '—'}</p>
        <p><strong>Email:</strong> ${supplier.email || '—'}</p>
        <p><strong>Address:</strong> ${sanitize(supplier.address || '—')}</p>
        <p><strong>Status:</strong> ${supplier.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</p>
        <p><strong>Total Units Supplied:</strong> ${totalUnits}</p>
        <p><strong>Total Cost Value:</strong> ${formatCurrencySync(totalCost)}</p>
      </div>
      <div class="card" style="margin-top:var(--space-md);">
        <h3>Supply History</h3>
        <div id="supply-history-table"></div>
      </div>
      <a href="#/suppliers" class="btn btn-secondary" style="margin-top:var(--space-md);">Back to Suppliers</a>
    </div>`;

  const historyContainer = document.getElementById('supply-history-table');
  if (enrichedMovements.length === 0) {
    historyContainer.innerHTML = '<p>No supply history found.</p>';
  } else {
    const columns = [
      { key: 'created_at', label: 'Date', render: val => formatDateSync(val) },
      { key: 'product_name', label: 'Product' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'reference_note', label: 'Reference' }
    ];
    ui.renderTable({
      container: historyContainer,
      columns,
      data: enrichedMovements,
      emptyMessage: 'No history.'
    });
  }
}
