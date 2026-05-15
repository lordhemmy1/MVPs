// sales.js – Sales recording: new sale (cart), history, detail, void, receipt
import { db, getSetting } from './db.js';
import { ui } from './ui.js';
import {
  sanitize, formatCurrencySync, formatDateSync, debounce,
  validate, exportCSV, generateId
} from './utils.js';
import { auth } from './auth.js';
import { generateLowStockNotificationIfNeeded } from './notifications.js';

// Cart state (in-memory, persisted to sessionStorage)
let cart = [];
const CART_STORAGE_KEY = 'sales_cart';

function saveCart() {
  sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function loadCart() {
  try {
    const stored = sessionStorage.getItem(CART_STORAGE_KEY);
    if (stored) {
      cart = JSON.parse(stored);
    } else {
      cart = [];
    }
  } catch {
    cart = [];
  }
}

function clearCart() {
  cart = [];
  sessionStorage.removeItem(CART_STORAGE_KEY);
}

// Module state
let currentView = null;

export async function init(params = {}) {
  const { id, action } = params;

  if (action?.includes('/sales/new')) currentView = 'new';
  else if (action?.includes('/receipt')) {
    currentView = 'receipt';
    currentSaleId = parseInt(id);
  } else if (id && !action) {
    currentView = 'detail';
    currentSaleId = parseInt(id);
  } else {
    currentView = 'history'; // default sales list
  }

  const container = document.getElementById('app-content');
  if (!container) return;
  ui.showSpinner();
  try {
    switch (currentView) {
      case 'new': await renderNewSale(container); break;
      case 'history': await renderSalesHistory(container); break;
      case 'detail': await renderSaleDetail(container, currentSaleId); break;
      case 'receipt': await renderReceipt(container, currentSaleId); break;
      default: await renderSalesHistory(container);
    }
  } catch (err) {
    console.error(err);
    ui.toast('Failed to load sales page.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

export function destroy() {
  // No global listeners to remove
}

/* ================================================================
   NEW SALE (Cart)
   ================================================================ */
async function renderNewSale(container) {
  loadCart(); // restore cart from session

  container.innerHTML = `
    <div class="sale-page" style="display:flex; gap:var(--space-lg); flex-wrap:wrap;">
      <div class="sale-products-panel" style="flex:2; min-width:300px;">
        <h2>New Sale</h2>
        <div class="form-group">
          <label class="form-label">Search Product</label>
          <div id="product-search-container" style="position:relative;">
            <input type="text" id="sale-product-search" class="form-input" placeholder="Type name or SKU..." autocomplete="off">
            <div class="search-dropdown" id="sale-product-dropdown"></div>
          </div>
        </div>
        <div id="cart-items" style="margin-top:var(--space-md);">
          <!-- cart rows rendered here -->
        </div>
      </div>
      <div class="sale-cart-panel card" style="flex:1; min-width:280px;">
        <h3>Cart</h3>
        <div id="cart-summary"></div>
        <form id="sale-form" style="margin-top:var(--space-md);">
          <div class="form-group">
            <label class="form-label">Payment Method *</label>
            <select name="payment_method" class="form-select" required>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Customer Name (optional)</label>
            <input type="text" name="customer_name" class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea name="notes" class="form-textarea" rows="2"></textarea>
          </div>
          <div class="form-actions">
            <button type="button" id="clear-cart-btn" class="btn btn-ghost"><i class="fa-solid fa-trash"></i> Clear</button>
            <button type="submit" id="confirm-sale-btn" class="btn btn-primary btn-block" disabled>
              <i class="fa-solid fa-check"></i> Confirm Sale (<span id="grand-total">$0.00</span>)
            </button>
          </div>
        </form>
      </div>
    </div>`;

  // Setup product search dropdown (SearchableDropdown)
  const searchInput = document.getElementById('sale-product-search');
  const dropdown = document.getElementById('sale-product-dropdown');

  const fetchProducts = async (query) => {
    if (!query) return [];
    return db.products
      .where('is_active').equals(1)
      .filter(p => p.quantity > 0 && (p.name.toLowerCase().includes(query.toLowerCase()) || (p.sku && p.sku.toLowerCase().includes(query.toLowerCase()))))
      .limit(10)
      .toArray();
  };

  const renderItem = (product) => {
    return `<span>${sanitize(product.name)}</span> <small class="text-muted">SKU: ${sanitize(product.sku)} | Qty: ${product.quantity} | ${formatCurrencySync(product.selling_price)}</small>`;
  };

  new ui.SearchableDropdown({
    inputEl: searchInput,
    containerEl: document.getElementById('product-search-container'),
    fetchItems: fetchProducts,
    renderItem,
    onSelect: (product) => {
      addToCart(product);
      searchInput.value = '';
      dropdown.classList.remove('show');
    }
  });

  // Cart rendering function
  function renderCart() {
    const cartContainer = document.getElementById('cart-items');
    const summaryDiv = document.getElementById('cart-summary');
    if (!cartContainer) return;

    if (cart.length === 0) {
      cartContainer.innerHTML = '<p class="text-muted">No items in cart.</p>';
      summaryDiv.innerHTML = '';
      updateGrandTotal();
      return;
    }

    let html = '<table class="table"><thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead><tbody>';
    cart.forEach((item, index) => {
      html += `
        <tr>
          <td>${sanitize(item.name)}</td>
          <td>${formatCurrencySync(item.unit_price)}</td>
          <td><input type="number" class="form-input cart-qty-input" data-index="${index}" value="${item.quantity}" min="1" max="${item.max_stock}" style="width:70px;"></td>
          <td>${formatCurrencySync(item.unit_price * item.quantity)}</td>
          <td><button class="btn btn-ghost btn-sm remove-item-btn" data-index="${index}"><i class="fa-solid fa-trash text-danger"></i></button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    cartContainer.innerHTML = html;

    // Summary
    const total = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    summaryDiv.innerHTML = `<p><strong>Subtotal:</strong> ${formatCurrencySync(total)}</p>`;

    // Bind quantity change and remove
    cartContainer.querySelectorAll('.cart-qty-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'));
        const newQty = parseInt(e.target.value);
        if (isNaN(newQty) || newQty < 1) {
          e.target.value = cart[idx].quantity;
          return;
        }
        if (newQty > cart[idx].max_stock) {
          ui.toast('Not enough stock available.', 'error');
          e.target.value = cart[idx].quantity;
          return;
        }
        cart[idx].quantity = newQty;
        saveCart();
        renderCart();
        updateGrandTotal();
      });
    });

    cartContainer.querySelectorAll('.remove-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.closest('button').getAttribute('data-index'));
        cart.splice(idx, 1);
        saveCart();
        renderCart();
        updateGrandTotal();
      });
    });

    updateGrandTotal();
  }

  function addToCart(product) {
    const existing = cart.find(item => item.product_id === product.id);
    if (existing) {
      if (existing.quantity < existing.max_stock) {
        existing.quantity += 1;
      } else {
        ui.toast('Stock limit reached for this product.', 'warning');
        return;
      }
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        unit_price: product.selling_price,
        quantity: 1,
        max_stock: product.quantity // current stock at time of adding
      });
    }
    saveCart();
    renderCart();
  }

  function updateGrandTotal() {
    const total = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    const totalSpan = document.getElementById('grand-total');
    if (totalSpan) totalSpan.textContent = formatCurrencySync(total);
    const confirmBtn = document.getElementById('confirm-sale-btn');
    if (confirmBtn) confirmBtn.disabled = cart.length === 0;
  }

  // Clear cart button
  document.getElementById('clear-cart-btn').addEventListener('click', () => {
    if (cart.length === 0) return;
    ui.showModal({
      title: 'Clear Cart',
      body: '<p>Are you sure you want to remove all items from the cart?</p>',
      footer: `
        <button class="btn btn-secondary close-modal">Cancel</button>
        <button class="btn btn-danger" id="confirm-clear-btn">Clear</button>
      `
    });
    document.getElementById('confirm-clear-btn').addEventListener('click', () => {
      clearCart();
      renderCart();
      ui.closeModal();
      ui.toast('Cart cleared.', 'info');
    });
  });

  // Confirm sale
  document.getElementById('sale-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (cart.length === 0) return;

    const formData = new FormData(e.target);
    const paymentMethod = formData.get('payment_method');
    const customerName = formData.get('customer_name') || 'Walk-in';
    const notes = formData.get('notes') || null;

    // Re-validate all quantities against current stock in IndexedDB within a transaction
    try {
      const user = auth.getCurrentUser();
      let saleId = null;

      await db.transaction('rw', [db.products, db.sales, db.sale_items, db.stock_movements, db.audit_logs, db.notifications], async () => {
        // Re-fetch products and check stock
        for (const item of cart) {
          const product = await db.products.get(item.product_id);
          if (!product || !product.is_active || product.quantity < item.quantity) {
            throw new Error(`Insufficient stock for "${item.name}". Only ${product?.quantity || 0} available.`);
          }
        }

        // Calculate total
        const totalAmount = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

        // Create sale record
        saleId = await db.sales.add({
          user_id: user.id,
          customer_name: customerName,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          notes: notes,
          status: 'completed',
          created_at: new Date().toISOString()
        });

        // Sale items and stock movements
        for (const item of cart) {
          const product = await db.products.get(item.product_id);
          const subtotal = item.unit_price * item.quantity;

          await db.sale_items.add({
            sale_id: saleId,
            product_id: item.product_id,
            product_name_snapshot: product.name,
            product_sku_snapshot: product.sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: subtotal
          });

          // Stock movement (sale)
          await db.stock_movements.add({
            product_id: item.product_id,
            user_id: user.id,
            type: 'sale',
            quantity: -item.quantity,
            reference_note: `Sale #${saleId}`,
            created_at: new Date().toISOString()
          });

          // Update product quantity
          const newQty = product.quantity - item.quantity;
          await db.products.update(item.product_id, {
            quantity: newQty,
            updated_at: new Date().toISOString()
          });

          // Audit log per product
          await db.audit_logs.add({
            user_id: user.id,
            user_name_snapshot: user.name,
            action: 'update',
            entity_type: 'product',
            entity_id: item.product_id,
            old_values: JSON.stringify({ quantity: product.quantity }),
            new_values: JSON.stringify({ quantity: newQty }),
            created_at: new Date().toISOString()
          });

          // Low stock check
          await generateLowStockNotificationIfNeeded(product, newQty, user);
        }

        // Audit for sale itself
        await db.audit_logs.add({
          user_id: user.id,
          user_name_snapshot: user.name,
          action: 'create',
          entity_type: 'sale',
          entity_id: saleId,
          new_values: JSON.stringify({ total_amount: totalAmount, customer: customerName, items: cart.length }),
          created_at: new Date().toISOString()
        });
      });

      ui.toast('Sale completed successfully.', 'success');
      clearCart();
      renderCart();
      // Offer print receipt
      ui.showModal({
        title: 'Sale Completed',
        body: `<p>Sale #${saleId} recorded.</p>`,
        footer: `
          <a href="#/sales/${saleId}/receipt" class="btn btn-primary"><i class="fa-solid fa-print"></i> Print Receipt</a>
          <button class="btn btn-secondary close-modal">Close</button>
        `
      });

    } catch (error) {
      ui.toast(error.message, 'error');
    }
  });

  // Initial render
  renderCart();
}

/* ================================================================
   SALES HISTORY (list)
   ================================================================ */
async function renderSalesHistory(container) {
  container.innerHTML = `
    <div class="sales-history-page">
      <h2>Sales History</h2>
      <div class="filter-bar" style="display:flex; gap:var(--space-md); margin-bottom:var(--space-md); flex-wrap:wrap;">
        <input type="date" id="sale-date-from" class="form-input">
        <input type="date" id="sale-date-to" class="form-input">
        <select id="sale-payment-filter" class="form-select">
          <option value="">All Payments</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="transfer">Transfer</option>
          <option value="credit">Credit</option>
        </select>
        <select id="sale-status-filter" class="form-select">
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="voided">Voided</option>
        </select>
        <button id="apply-sales-filter-btn" class="btn btn-primary">Apply</button>
        <button id="export-sales-btn" class="btn btn-secondary"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>
      <div id="sales-table-container"></div>
      <div class="daily-summary card" style="margin-top:var(--space-md);">
        <h4>Today's Summary</h4>
        <div id="daily-summary-content"></div>
      </div>
    </div>`;

  let state = { page: 1, perPage: 20, filters: {} };

  async function fetchAndRender() {
    const tableContainer = document.getElementById('sales-table-container');
    let sales = await db.sales.orderBy('created_at').reverse().toArray();

    const dateFrom = document.getElementById('sale-date-from')?.value;
    const dateTo = document.getElementById('sale-date-to')?.value;
    const payment = document.getElementById('sale-payment-filter')?.value;
    const status = document.getElementById('sale-status-filter')?.value;

    if (dateFrom) sales = sales.filter(s => s.created_at >= dateFrom);
    if (dateTo) sales = sales.filter(s => s.created_at <= dateTo + 'T23:59:59');
    if (payment) sales = sales.filter(s => s.payment_method === payment);
    if (status) sales = sales.filter(s => s.status === status);

    // Get item counts per sale
    const saleIds = sales.map(s => s.id);
    const items = await db.sale_items.where('sale_id').anyOf(saleIds).toArray();
    const countMap = {};
    items.forEach(i => { countMap[i.sale_id] = (countMap[i.sale_id] || 0) + i.quantity; });

    const total = sales.length;
    const start = (state.page - 1) * state.perPage;
    const paged = sales.slice(start, start + state.perPage);

    const columns = [
      { key: 'id', label: 'Receipt #' },
      { key: 'created_at', label: 'Date', render: val => formatDateSync(val) },
      { key: 'customer_name', label: 'Customer' },
      { key: 'item_count', label: 'Items', render: (_, row) => countMap[row.id] || 0 },
      { key: 'total_amount', label: 'Total', render: val => formatCurrencySync(val) },
      { key: 'payment_method', label: 'Payment' },
      { key: 'status', label: 'Status', render: val => `<span class="badge ${val==='completed'?'badge-success':'badge-danger'}">${val}</span>` },
      { key: 'actions', label: '', render: (_, row) => `
        <a href="#/sales/${row.id}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-eye"></i></a>
        ${row.status==='completed' && auth.hasRole('manager') ? `<button class="btn btn-ghost btn-sm void-sale-btn" data-id="${row.id}"><i class="fa-solid fa-ban text-danger"></i></button>` : ''}
      `}
    ];

    ui.renderTable({
      container: tableContainer,
      columns,
      data: paged,
      page: state.page,
      perPage: state.perPage,
      totalItems: total,
      onPageChange: (p) => { state.page = p; fetchAndRender(); },
      emptyMessage: 'No sales found.'
    });

    // Bind void buttons
    tableContainer.querySelectorAll('.void-sale-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const saleId = parseInt(btn.getAttribute('data-id'));
        confirmVoidSale(saleId);
      });
    });

    // Today's summary
    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter(s => s.created_at?.startsWith(today) && s.status === 'completed');
    const revenue = todaySales.reduce((s, r) => s + r.total_amount, 0);
    const summary = document.getElementById('daily-summary-content');
    if (summary) summary.innerHTML = `<p><strong>Transactions:</strong> ${todaySales.length} | <strong>Revenue:</strong> ${formatCurrencySync(revenue)}</p>`;
  }

  document.getElementById('apply-sales-filter-btn').addEventListener('click', () => { state.page = 1; fetchAndRender(); });
  document.getElementById('export-sales-btn').addEventListener('click', async () => {
    const salesAll = await db.sales.toArray();
    exportCSV({
      data: salesAll,
      filename: `sales_${new Date().toISOString().split('T')[0]}.csv`,
      headers: ['id', 'customer_name', 'total_amount', 'payment_method', 'status', 'created_at']
    });
  });

  await fetchAndRender();
}

/* ================================================================
   SALE DETAIL + VOID
   ================================================================ */
let currentSaleId = null;

async function renderSaleDetail(container, saleId) {
  currentSaleId = saleId;
  const sale = await db.sales.get(saleId);
  if (!sale) {
    container.innerHTML = '<p>Sale not found.</p>';
    return;
  }
  const items = await db.sale_items.where('sale_id').equals(saleId).toArray();

  container.innerHTML = `
    <div class="sale-detail">
      <h2>Sale #${sale.id} <span class="badge ${sale.status==='completed'?'badge-success':'badge-danger'}">${sale.status}</span></h2>
      <div class="card">
        <p><strong>Date:</strong> ${formatDateSync(sale.created_at)}</p>
        <p><strong>Customer:</strong> ${sanitize(sale.customer_name || 'Walk-in')}</p>
        <p><strong>Payment:</strong> ${sale.payment_method}</p>
        <p><strong>Total:</strong> ${formatCurrencySync(sale.total_amount)}</p>
        <p><strong>Notes:</strong> ${sale.notes || '—'}</p>
      </div>
      <div class="card" style="margin-top:var(--space-md);">
        <h3>Items</h3>
        <table class="table">
          <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td>${sanitize(i.product_name_snapshot)}</td>
                <td>${sanitize(i.product_sku_snapshot || '—')}</td>
                <td>${i.quantity}</td>
                <td>${formatCurrencySync(i.unit_price)}</td>
                <td>${formatCurrencySync(i.subtotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:var(--space-md);">
        ${sale.status === 'completed' && auth.hasRole('manager') ? `
          <button id="void-sale-btn" class="btn btn-danger"><i class="fa-solid fa-ban"></i> Void Sale</button>
        ` : ''}
        <a href="#/sales" class="btn btn-secondary">Back</a>
      </div>
    </div>`;

  if (sale.status === 'completed') {
    document.getElementById('void-sale-btn')?.addEventListener('click', () => confirmVoidSale(saleId));
  }
}

async function confirmVoidSale(saleId) {
  const sale = await db.sales.get(saleId);
  if (!sale || sale.status !== 'completed') return;

  ui.showModal({
    title: 'Void Sale',
    body: `<p>Are you sure you want to void sale #${saleId}? This will restore stock and cannot be undone.</p>`,
    footer: `
      <button class="btn btn-secondary close-modal">Cancel</button>
      <button class="btn btn-danger" id="confirm-void-btn">Void</button>
    `
  });

  document.getElementById('confirm-void-btn').addEventListener('click', async () => {
    try {
      const user = auth.getCurrentUser();
      await db.transaction('rw', [db.products, db.sales, db.stock_movements, db.audit_logs], async () => {
        const items = await db.sale_items.where('sale_id').equals(saleId).toArray();
        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            // Restore quantity
            const newQty = (product.quantity || 0) + item.quantity;
            await db.products.update(item.product_id, {
              quantity: newQty,
              updated_at: new Date().toISOString()
            });
            // Record return movement
            await db.stock_movements.add({
              product_id: item.product_id,
              user_id: user.id,
              type: 'return',
              quantity: item.quantity,
              reference_note: `Void sale #${saleId}`,
              created_at: new Date().toISOString()
            });
            // Audit per product
            await db.audit_logs.add({
              user_id: user.id,
              user_name_snapshot: user.name,
              action: 'update',
              entity_type: 'product',
              entity_id: item.product_id,
              old_values: JSON.stringify({ quantity: product.quantity }),
              new_values: JSON.stringify({ quantity: newQty }),
              created_at: new Date().toISOString()
            });
          }
        }
        // Update sale status
        await db.sales.update(saleId, { status: 'voided' });
        await db.audit_logs.add({
          user_id: user.id,
          user_name_snapshot: user.name,
          action: 'void',
          entity_type: 'sale',
          entity_id: saleId,
          new_values: JSON.stringify({ status: 'voided' }),
          created_at: new Date().toISOString()
        });
      });
      ui.toast('Sale voided and stock restored.', 'success');
      ui.closeModal();
      // Refresh page
      if (currentView === 'detail') {
        await renderSaleDetail(document.getElementById('app-content'), saleId);
      } else {
        // history refresh
        await renderSalesHistory(document.getElementById('app-content'));
      }
    } catch (err) {
      ui.toast('Void failed: ' + err.message, 'error');
    }
  });
}

/* ================================================================
   RECEIPT VIEW
   ================================================================ */
async function renderReceipt(container, saleId) {
  const sale = await db.sales.get(saleId);
  if (!sale) {
    container.innerHTML = '<p>Receipt not found.</p>';
    return;
  }
  const items = await db.sale_items.where('sale_id').equals(saleId).toArray();
  const businessName = (await db.app_settings.get('business_name'))?.value || 'My Store';
  const logo = (await db.app_settings.get('business_logo_base64'))?.value;

  container.innerHTML = `
    <div class="receipt-container">
      <div class="receipt-header">
        ${logo ? `<img src="${logo}" class="receipt-logo" alt="logo">` : ''}
        <h3>${sanitize(businessName)}</h3>
        <p>Sale Receipt #${sale.id}</p>
      </div>
      <div class="receipt-divider"></div>
      <p><strong>Date:</strong> ${formatDateSync(sale.created_at)}</p>
      <p><strong>Customer:</strong> ${sanitize(sale.customer_name || 'Walk-in')}</p>
      <div class="receipt-divider"></div>
      <table style="width:100%; font-size:0.9rem;">
        ${items.map(i => `
          <tr>
            <td>${sanitize(i.product_name_snapshot)}</td>
            <td style="text-align:right;">${i.quantity} x ${formatCurrencySync(i.unit_price)}</td>
            <td style="text-align:right;">${formatCurrencySync(i.subtotal)}</td>
          </tr>
        `).join('')}
      </table>
      <div class="receipt-divider"></div>
      <p style="text-align:right; font-size:1.2rem;"><strong>Total: ${formatCurrencySync(sale.total_amount)}</strong></p>
      <p>Payment: ${sale.payment_method}</p>
      <p class="thank-you">Thank you!</p>
      <button id="print-receipt-btn" class="btn btn-primary" style="margin-top:var(--space-md);"><i class="fa-solid fa-print"></i> Print</button>
    </div>`;

  document.getElementById('print-receipt-btn').addEventListener('click', () => window.print());
}
