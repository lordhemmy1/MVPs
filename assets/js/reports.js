// reports.js – Reports module: daily/weekly/monthly sales, inventory, low stock, expiry, best sellers, stock movement, supplier
import { db, getSetting } from './db.js';
import { ui } from './ui.js';
import { sanitize, formatCurrencySync, formatDateSync, exportCSV, debounce, validate } from './utils.js';
import { auth } from './auth.js';

// Module-level chart instances for cleanup
let activeCharts = [];

function destroyCharts() {
  activeCharts.forEach(chart => chart.destroy());
  activeCharts = [];
}

export async function init(params = {}) {
  const container = document.getElementById('app-content');
  if (!container) return;

  ui.showSpinner();
  try {
    await renderReportsPage(container);
  } catch (err) {
    console.error('Reports init error:', err);
    ui.toast('Failed to load reports.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

export function destroy() {
  destroyCharts();
}

/* ================================================================
   MAIN REPORT PAGE LAYOUT
   ================================================================ */
async function renderReportsPage(container) {
  container.innerHTML = `
    <div class="reports-page">
      <h2>Reports</h2>
      <div class="report-selector" style="margin-bottom:var(--space-lg);">
        <label class="form-label">Select Report</label>
        <select id="report-type-select" class="form-select" style="max-width:400px;">
          <option value="daily_sales">Daily Sales Report</option>
          <option value="weekly_sales">Weekly Sales Summary</option>
          <option value="monthly_sales">Monthly Sales Summary</option>
          <option value="inventory_status">Inventory Status Report</option>
          <option value="out_of_stock">Out of Stock Report</option>
          <option value="low_stock">Low Stock Report</option>
          <option value="expiry">Expiry Report</option>
          <option value="best_selling">Best Selling Products</option>
          <option value="stock_movement">Stock Movement Report</option>
          <option value="supplier">Supplier Report</option>
        </select>
      </div>
      <div id="report-content">
        <div class="card"><p>Select a report type to generate.</p></div>
      </div>
    </div>`;

  const select = document.getElementById('report-type-select');
  const contentDiv = document.getElementById('report-content');

  select.addEventListener('change', async () => {
    destroyCharts();
    const type = select.value;
    ui.showSpinner();
    try {
      await renderReportByType(type, contentDiv);
    } catch (err) {
      console.error(err);
      contentDiv.innerHTML = '<p class="text-danger">Error generating report.</p>';
    } finally {
      ui.hideSpinner();
    }
  });
}

/* ================================================================
   REPORT DISPATCHER
   ================================================================ */
async function renderReportByType(type, container) {
  switch (type) {
    case 'daily_sales': await renderDailySalesReport(container); break;
    case 'weekly_sales': await renderWeeklySalesSummary(container); break;
    case 'monthly_sales': await renderMonthlySalesSummary(container); break;
    case 'inventory_status': await renderInventoryStatusReport(container); break;
    case 'out_of_stock': await renderOutOfStockReport(container); break;
    case 'low_stock': await renderLowStockReport(container); break;
    case 'expiry': await renderExpiryReport(container); break;
    case 'best_selling': await renderBestSellingReport(container); break;
    case 'stock_movement': await renderStockMovementReport(container); break;
    case 'supplier': await renderSupplierReport(container); break;
    default: container.innerHTML = '<p>Unknown report type.</p>';
  }
}

/* ================================================================
   HELPER: RENDER FILTER CONTROLS + TABLE + EXPORT BUTTONS
   ================================================================ */
function renderReportContainer(container, title, filterHtml, tableContainerId, chartContainerId = null, showExport = true) {
  container.innerHTML = `
    <div class="card">
      <h3>${title}</h3>
      ${filterHtml ? `<div class="report-filters" style="margin-bottom:var(--space-md); display:flex; flex-wrap:wrap; gap:var(--space-sm); align-items:flex-end;">${filterHtml}</div>` : ''}
      ${chartContainerId ? `<div id="${chartContainerId}" style="margin-bottom:var(--space-md); max-height:300px;"></div>` : ''}
      <div id="${tableContainerId}"></div>
      ${showExport ? `
        <div style="margin-top:var(--space-md); display:flex; gap:var(--space-sm);">
          <button class="btn btn-secondary export-csv-btn"><i class="fa-solid fa-download"></i> CSV</button>
          <button class="btn btn-secondary export-pdf-btn"><i class="fa-solid fa-file-pdf"></i> PDF</button>
        </div>` : ''}
    </div>`;
}

/* ================================================================
   DAILY SALES REPORT
   ================================================================ */
async function renderDailySalesReport(container) {
  const today = new Date().toISOString().split('T')[0];
  const filterHtml = `
    <label>Date:</label>
    <input type="date" id="daily-date" class="form-input" value="${today}" style="max-width:180px;">
    <button id="generate-daily-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Daily Sales Report', filterHtml, 'daily-table', 'daily-chart');

  async function generate() {
    const dateVal = document.getElementById('daily-date')?.value || today;
    const sales = await db.sales
      .where('status').equals('completed')
      .filter(s => s.created_at && s.created_at.startsWith(dateVal))
      .toArray();

    const totalRevenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
    const transactions = sales.length;
    const avgTransaction = transactions > 0 ? totalRevenue / transactions : 0;

    // Payment method split
    const paymentSplit = { cash: 0, card: 0, transfer: 0, credit: 0 };
    sales.forEach(s => { if (paymentSplit[s.payment_method] !== undefined) paymentSplit[s.payment_method] += s.total_amount; });

    // Items breakdown (aggregate all sale items for these sales)
    const saleIds = sales.map(s => s.id);
    const items = saleIds.length ? await db.sale_items.where('sale_id').anyOf(saleIds).toArray() : [];
    const itemSummary = {};
    items.forEach(i => {
      if (!itemSummary[i.product_id]) itemSummary[i.product_id] = { name: i.product_name_snapshot, quantity: 0, revenue: 0 };
      itemSummary[i.product_id].quantity += i.quantity;
      itemSummary[i.product_id].revenue += i.subtotal;
    });

    // Render summary card
    const summaryHtml = `
      <p><strong>Date:</strong> ${dateVal} | <strong>Transactions:</strong> ${transactions} | <strong>Total Revenue:</strong> ${formatCurrencySync(totalRevenue)} | <strong>Avg Transaction:</strong> ${formatCurrencySync(avgTransaction)}</p>
      <p>Payment Split: Cash ${formatCurrencySync(paymentSplit.cash)}, Card ${formatCurrencySync(paymentSplit.card)}, Transfer ${formatCurrencySync(paymentSplit.transfer)}, Credit ${formatCurrencySync(paymentSplit.credit)}</p>
    `;
    document.getElementById('daily-table').insertAdjacentHTML('beforebegin', summaryHtml);

    // Payment split chart (pie)
    const ctx = document.getElementById('daily-chart')?.getContext('2d');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: ['Cash', 'Card', 'Transfer', 'Credit'],
          datasets: [{
            data: [paymentSplit.cash, paymentSplit.card, paymentSplit.transfer, paymentSplit.credit],
            backgroundColor: ['#059669','#2563EB','#7C3AED','#D97706']
          }]
        },
        options: { responsive: true, maintainAspectRatio: true }
      });
      activeCharts.push(chart);
    }

    // Table of items sold
    const itemArray = Object.values(itemSummary).sort((a,b) => b.revenue - a.revenue);
    const columns = [
      { key: 'name', label: 'Product' },
      { key: 'quantity', label: 'Units Sold' },
      { key: 'revenue', label: 'Revenue', render: v => formatCurrencySync(v) }
    ];
    ui.renderTable({
      container: document.getElementById('daily-table'),
      columns,
      data: itemArray,
      emptyMessage: 'No items sold on this day.'
    });

    // Store data for export
    return { date: dateVal, sales, totalRevenue, transactions, paymentSplit, itemSummary: itemArray };
  }

  document.getElementById('generate-daily-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Daily Sales', data, (data) => [
      ['Date', 'Customer', 'Total', 'Payment'],
      ...data.sales.map(s => [s.created_at?.split('T')[0], s.customer_name, s.total_amount, s.payment_method])
    ]);
  });

  // Initial load
  const initialData = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Daily Sales', initialData, (data) => [
    ['Date', 'Customer', 'Total', 'Payment'],
    ...data.sales.map(s => [s.created_at?.split('T')[0], s.customer_name, s.total_amount, s.payment_method])
  ]);
}

/* ================================================================
   WEEKLY SALES SUMMARY
   ================================================================ */
async function renderWeeklySalesSummary(container) {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
  const startStr = startOfWeek.toISOString().split('T')[0];
  const endStr = today.toISOString().split('T')[0];

  const filterHtml = `
    <label>Week Starting:</label>
    <input type="date" id="weekly-start" class="form-input" value="${startStr}" style="max-width:180px;">
    <button id="generate-weekly-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Weekly Sales Summary', filterHtml, 'weekly-table', 'weekly-chart');

  async function generate() {
    const startDate = document.getElementById('weekly-start')?.value || startStr;
    const start = new Date(startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endStr = end.toISOString().split('T')[0];

    const sales = await db.sales
      .where('status').equals('completed')
      .filter(s => s.created_at >= startDate && s.created_at <= endStr + 'T23:59:59')
      .toArray();

    // Group by day
    const dailyMap = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = 0;
    }
    sales.forEach(s => {
      const day = s.created_at?.split('T')[0];
      if (dailyMap.hasOwnProperty(day)) dailyMap[day] += s.total_amount;
    });

    const totalRevenue = sales.reduce((s, r) => s + r.total_amount, 0);
    const totalUnits = (await db.sale_items.where('sale_id').anyOf(sales.map(s=>s.id)).toArray()).reduce((s,i)=> s + i.quantity, 0);
    const bestDay = Object.entries(dailyMap).sort((a,b)=> b[1]-a[1])[0];

    // Bar chart
    const ctx = document.getElementById('weekly-chart')?.getContext('2d');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: Object.keys(dailyMap).map(d => new Date(d).toLocaleDateString('en', {weekday:'short'})),
          datasets: [{ label: 'Revenue', data: Object.values(dailyMap), backgroundColor: '#4F46E5' }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
      activeCharts.push(chart);
    }

    document.getElementById('weekly-table').innerHTML = `
      <p>Total Revenue: ${formatCurrencySync(totalRevenue)} | Units Sold: ${totalUnits} | Best Day: ${bestDay ? bestDay[0] + ' (' + formatCurrencySync(bestDay[1]) + ')' : '—'}</p>
    `;

    return { startDate, endStr, dailyMap, totalRevenue, totalUnits, bestDay, sales };
  }

  document.getElementById('generate-weekly-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Weekly Sales', data, (d) => [
      ['Day', 'Revenue'],
      ...Object.entries(d.dailyMap).map(([day, rev]) => [day, rev])
    ]);
  });

  const data = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Weekly Sales', data, (d) => [
    ['Day', 'Revenue'],
    ...Object.entries(d.dailyMap).map(([day, rev]) => [day, rev])
  ]);
}

/* ================================================================
   MONTHLY SALES SUMMARY
   ================================================================ */
async function renderMonthlySalesSummary(container) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2,'0');
  const year = now.getFullYear();
  const filterHtml = `
    <label>Month:</label>
    <input type="month" id="monthly-picker" class="form-input" value="${year}-${month}" style="max-width:200px;">
    <button id="generate-monthly-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Monthly Sales Summary', filterHtml, 'monthly-table', 'monthly-chart');

  async function generate() {
    const monthVal = document.getElementById('monthly-picker')?.value || `${year}-${month}`;
    const [y, m] = monthVal.split('-');
    const firstDay = new Date(y, m-1, 1);
    const lastDay = new Date(y, m, 0);
    const firstStr = firstDay.toISOString().split('T')[0];
    const lastStr = lastDay.toISOString().split('T')[0];

    const sales = await db.sales
      .where('status').equals('completed')
      .filter(s => s.created_at >= firstStr && s.created_at <= lastStr + 'T23:59:59')
      .toArray();

    const dailyMap = {};
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate()+1)) {
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = 0;
    }
    sales.forEach(s => {
      const day = s.created_at?.split('T')[0];
      if (dailyMap.hasOwnProperty(day)) dailyMap[day] += s.total_amount;
    });

    const totalRevenue = sales.reduce((s,r)=> s+r.total_amount,0);
    const transactions = sales.length;
    const bestDay = Object.entries(dailyMap).sort((a,b)=> b[1]-a[1])[0];

    // Line chart
    const ctx = document.getElementById('monthly-chart')?.getContext('2d');
    if (ctx) {
      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: Object.keys(dailyMap).map(d => d.split('-')[2]),
          datasets: [{ label: 'Revenue', data: Object.values(dailyMap), borderColor: '#4F46E5', tension: 0.3, fill: false }]
        },
        options: { responsive: true }
      });
      activeCharts.push(chart);
    }

    document.getElementById('monthly-table').innerHTML = `
      <p>Total Revenue: ${formatCurrencySync(totalRevenue)} | Transactions: ${transactions} | Best Day: ${bestDay ? bestDay[0]+' ('+formatCurrencySync(bestDay[1])+')' : '—'}</p>
    `;

    return { monthVal, dailyMap, totalRevenue, transactions, bestDay, sales };
  }

  document.getElementById('generate-monthly-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Monthly Sales', data, (d) => [
      ['Day', 'Revenue'],
      ...Object.entries(d.dailyMap).map(([day, rev]) => [day, rev])
    ]);
  });

  const data = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Monthly Sales', data, (d) => [
    ['Day', 'Revenue'],
    ...Object.entries(d.dailyMap).map(([day, rev]) => [day, rev])
  ]);
}

/* ================================================================
   INVENTORY STATUS REPORT
   ================================================================ */
async function renderInventoryStatusReport(container) {
  renderReportContainer(container, 'Inventory Status Report', null, 'inventory-table');

  const products = await db.products.where('is_active').equals(1).toArray();
  const threshold = Number(await getSetting('default_low_stock_threshold', 10));
  const data = products.map(p => ({
    name: p.name,
    sku: p.sku,
    quantity: p.quantity,
    unit: p.unit,
    cost_value: p.quantity * p.cost_price,
    selling_value: p.quantity * p.selling_price,
    potential_profit: p.quantity * (p.selling_price - p.cost_price),
    status: p.quantity <= 0 ? 'Out of Stock' : p.quantity <= threshold ? 'Low Stock' : 'In Stock'
  }));

  const columns = [
    { key: 'name', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity', label: 'Qty' },
    { key: 'unit', label: 'Unit' },
    { key: 'cost_value', label: 'Cost Value', render: v => formatCurrencySync(v) },
    { key: 'selling_value', label: 'Selling Value', render: v => formatCurrencySync(v) },
    { key: 'potential_profit', label: 'Profit', render: v => formatCurrencySync(v) },
    { key: 'status', label: 'Status', render: v => `<span class="badge ${v==='In Stock'?'badge-success':v==='Low Stock'?'badge-warning':'badge-danger'}">${v}</span>` }
  ];

  ui.renderTable({ container: document.getElementById('inventory-table'), columns, data, emptyMessage: 'No products.' });

  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Inventory Status', data, (d) => [
    ['Name', 'SKU', 'Qty', 'Unit', 'Cost Value', 'Selling Value', 'Profit', 'Status'],
    ...d.map(p => [p.name, p.sku, p.quantity, p.unit, p.cost_value, p.selling_value, p.potential_profit, p.status])
  ]);
}

/* ================================================================
   OUT OF STOCK REPORT
   ================================================================ */
async function renderOutOfStockReport(container) {
  renderReportContainer(container, 'Out of Stock Products', null, 'outofstock-table');

  const products = await db.products.where('is_active').equals(1).filter(p => p.quantity <= 0).toArray();
  // Get last stock-in date for each
  const movements = await db.stock_movements.where('type').equals('stock_in').reverse().sortBy('created_at');
  const lastInMap = {};
  movements.forEach(m => {
    if (!lastInMap[m.product_id]) lastInMap[m.product_id] = m.created_at;
  });

  const data = products.map(p => ({
    name: p.name,
    sku: p.sku,
    last_stock_in: lastInMap[p.id] ? formatDateSync(lastInMap[p.id]) : 'Never'
  }));
  data.sort((a,b) => (a.last_stock_in === 'Never' ? 1 : 0) - (b.last_stock_in === 'Never' ? 1 : 0) || a.last_stock_in.localeCompare(b.last_stock_in));

  const columns = [
    { key: 'name', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'last_stock_in', label: 'Last Stock In' }
  ];

  ui.renderTable({ container: document.getElementById('outofstock-table'), columns, data, emptyMessage: 'All products are in stock.' });

  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Out of Stock', data, (d) => [
    ['Name', 'SKU', 'Last Stock In'],
    ...d.map(p => [p.name, p.sku, p.last_stock_in])
  ]);
}

/* ================================================================
   LOW STOCK REPORT
   ================================================================ */
async function renderLowStockReport(container) {
  renderReportContainer(container, 'Low Stock Report', null, 'lowstock-table');

  const threshold = Number(await getSetting('default_low_stock_threshold', 10));
  const products = await db.products.where('is_active').equals(1).filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || threshold)).toArray();

  const data = products.map(p => ({
    name: p.name,
    sku: p.sku,
    quantity: p.quantity,
    threshold: p.low_stock_threshold || threshold,
    needed: (p.low_stock_threshold || threshold) - p.quantity
  }));
  data.sort((a,b) => (a.quantity / a.threshold) - (b.quantity / b.threshold));

  const columns = [
    { key: 'name', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity', label: 'Qty' },
    { key: 'threshold', label: 'Threshold' },
    { key: 'needed', label: 'Needed to Threshold' }
  ];

  ui.renderTable({ container: document.getElementById('lowstock-table'), columns, data, emptyMessage: 'No low stock products.' });

  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Low Stock', data, (d) => [
    ['Name', 'SKU', 'Qty', 'Threshold', 'Needed'],
    ...d.map(p => [p.name, p.sku, p.quantity, p.threshold, p.needed])
  ]);
}

/* ================================================================
   EXPIRY REPORT
   ================================================================ */
async function renderExpiryReport(container) {
  const filterHtml = `
    <label>Expiring within:</label>
    <select id="expiry-range" class="form-select" style="max-width:150px;">
      <option value="7">7 days</option>
      <option value="14" selected>14 days</option>
      <option value="30">30 days</option>
      <option value="60">60 days</option>
      <option value="90">90 days</option>
    </select>
    <button id="generate-expiry-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Expiry Report', filterHtml, 'expiry-table');

  async function generate() {
    const days = parseInt(document.getElementById('expiry-range')?.value || 14);
    const now = new Date();
    const limitDate = new Date(now);
    limitDate.setDate(limitDate.getDate() + days);
    const products = await db.products.where('is_active').equals(1).filter(p => p.expiry_date && p.quantity > 0).toArray();
    const expiring = products.filter(p => {
      const exp = new Date(p.expiry_date);
      return exp <= limitDate;
    });

    const data = expiring.map(p => ({
      name: p.name,
      sku: p.sku,
      expiry_date: p.expiry_date,
      quantity: p.quantity,
      days_remaining: Math.ceil((new Date(p.expiry_date) - now) / (1000*60*60*24))
    })).sort((a,b) => a.days_remaining - b.days_remaining);

    const columns = [
      { key: 'name', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'expiry_date', label: 'Expiry Date', render: val => formatDateSync(val) },
      { key: 'quantity', label: 'Qty' },
      { key: 'days_remaining', label: 'Days Left', render: val => {
        let cls = 'badge-info';
        if (val <= 0) cls = 'badge-danger';
        else if (val <= 7) cls = 'badge-warning';
        return `<span class="badge ${cls}">${val}</span>`;
      }}
    ];

    ui.renderTable({ container: document.getElementById('expiry-table'), columns, data, emptyMessage: 'No products expiring in this period.' });

    return data;
  }

  document.getElementById('generate-expiry-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Expiry Report', data, (d) => [
      ['Name', 'SKU', 'Expiry Date', 'Qty', 'Days Left'],
      ...d.map(p => [p.name, p.sku, p.expiry_date, p.quantity, p.days_remaining])
    ]);
  });

  const data = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Expiry Report', data, (d) => [
    ['Name', 'SKU', 'Expiry Date', 'Qty', 'Days Left'],
    ...d.map(p => [p.name, p.sku, p.expiry_date, p.quantity, p.days_remaining])
  ]);
}

/* ================================================================
   BEST SELLING PRODUCTS
   ================================================================ */
async function renderBestSellingReport(container) {
  const filterHtml = `
    <label>From:</label>
    <input type="date" id="bs-date-from" class="form-input" style="max-width:180px;">
    <label>To:</label>
    <input type="date" id="bs-date-to" class="form-input" style="max-width:180px;">
    <button id="generate-bs-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Best Selling Products', filterHtml, 'bs-table', 'bs-chart');

  async function generate() {
    const from = document.getElementById('bs-date-from')?.value || '';
    const to = document.getElementById('bs-date-to')?.value || '';
    let salesQuery = db.sales.where('status').equals('completed');
    if (from) salesQuery = salesQuery.filter(s => s.created_at >= from);
    if (to) salesQuery = salesQuery.filter(s => s.created_at <= to + 'T23:59:59');
    const sales = await salesQuery.toArray();
    const saleIds = sales.map(s => s.id);
    const items = saleIds.length ? await db.sale_items.where('sale_id').anyOf(saleIds).toArray() : [];

    const productMap = {};
    items.forEach(i => {
      if (!productMap[i.product_id]) productMap[i.product_id] = { name: i.product_name_snapshot, units: 0, revenue: 0 };
      productMap[i.product_id].units += i.quantity;
      productMap[i.product_id].revenue += i.subtotal;
    });

    const top = Object.values(productMap).sort((a,b) => b.units - a.units).slice(0, 20);

    // Bar chart
    const ctx = document.getElementById('bs-chart')?.getContext('2d');
    if (ctx && top.length > 0) {
      const chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: top.map(p => p.name),
          datasets: [
            { label: 'Units Sold', data: top.map(p => p.units), backgroundColor: '#4F46E5' }
          ]
        },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
      });
      activeCharts.push(chart);
    }

    const columns = [
      { key: 'name', label: 'Product' },
      { key: 'units', label: 'Units Sold' },
      { key: 'revenue', label: 'Revenue', render: v => formatCurrencySync(v) }
    ];
    ui.renderTable({ container: document.getElementById('bs-table'), columns, data: top, emptyMessage: 'No sales data.' });

    return top;
  }

  document.getElementById('generate-bs-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Best Sellers', data, (d) => [
      ['Product', 'Units Sold', 'Revenue'],
      ...d.map(p => [p.name, p.units, p.revenue])
    ]);
  });

  const data = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Best Sellers', data, (d) => [
    ['Product', 'Units Sold', 'Revenue'],
    ...d.map(p => [p.name, p.units, p.revenue])
  ]);
}

/* ================================================================
   STOCK MOVEMENT REPORT
   ================================================================ */
async function renderStockMovementReport(container) {
  const filterHtml = `
    <label>From:</label><input type="date" id="sm-date-from" class="form-input" style="max-width:180px;">
    <label>To:</label><input type="date" id="sm-date-to" class="form-input" style="max-width:180px;">
    <label>Type:</label><select id="sm-type" class="form-select"><option value="">All</option><option value="stock_in">Stock In</option><option value="stock_out">Stock Out</option><option value="adjustment">Adjustment</option><option value="sale">Sale</option><option value="return">Return</option></select>
    <button id="generate-sm-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Stock Movement Report', filterHtml, 'sm-table');

  async function generate() {
    const from = document.getElementById('sm-date-from')?.value;
    const to = document.getElementById('sm-date-to')?.value;
    const type = document.getElementById('sm-type')?.value;
    let query = db.stock_movements.orderBy('created_at').reverse();
    if (from) query = query.filter(m => m.created_at >= from);
    if (to) query = query.filter(m => m.created_at <= to + 'T23:59:59');
    if (type) query = query.filter(m => m.type === type);
    const movements = await query.toArray();

    // Enrich with product and user names
    const productIds = [...new Set(movements.map(m => m.product_id))];
    const userIds = [...new Set(movements.map(m => m.user_id))];
    const [products, users] = await Promise.all([
      db.products.bulkGet(productIds),
      db.users.bulkGet(userIds)
    ]);
    const productMap = Object.fromEntries(products.filter(Boolean).map(p => [p.id, p.name]));
    const userMap = Object.fromEntries(users.filter(Boolean).map(u => [u.id, u.name]));

    const data = movements.map(m => ({
      date: m.created_at,
      product: productMap[m.product_id] || 'Unknown',
      type: m.type,
      quantity: m.quantity,
      reference: m.reference_note || '',
      user: userMap[m.user_id] || ''
    }));

    const columns = [
      { key: 'date', label: 'Date', render: v => formatDateSync(v) },
      { key: 'product', label: 'Product' },
      { key: 'type', label: 'Type' },
      { key: 'quantity', label: 'Qty' },
      { key: 'reference', label: 'Reference' },
      { key: 'user', label: 'User' }
    ];

    ui.renderTable({ container: document.getElementById('sm-table'), columns, data, emptyMessage: 'No movements found.' });

    return data;
  }

  document.getElementById('generate-sm-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Stock Movements', data, (d) => [
      ['Date', 'Product', 'Type', 'Qty', 'Reference', 'User'],
      ...d.map(m => [m.date, m.product, m.type, m.quantity, m.reference, m.user])
    ]);
  });

  const data = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Stock Movements', data, (d) => [
    ['Date', 'Product', 'Type', 'Qty', 'Reference', 'User'],
    ...d.map(m => [m.date, m.product, m.type, m.quantity, m.reference, m.user])
  ]);
}

/* ================================================================
   SUPPLIER REPORT
   ================================================================ */
async function renderSupplierReport(container) {
  const suppliers = await db.suppliers.toArray();
  const filterHtml = `
    <label>Supplier:</label>
    <select id="sup-report-select" class="form-select">
      <option value="">All Suppliers</option>
      ${suppliers.map(s => `<option value="${s.id}">${sanitize(s.name)}</option>`).join('')}
    </select>
    <label>From:</label><input type="date" id="sup-date-from" class="form-input" style="max-width:150px;">
    <label>To:</label><input type="date" id="sup-date-to" class="form-input" style="max-width:150px;">
    <button id="generate-sup-btn" class="btn btn-primary">Generate</button>
  `;
  renderReportContainer(container, 'Supplier Report', filterHtml, 'sup-table');

  async function generate() {
    const supId = document.getElementById('sup-report-select')?.value || '';
    const from = document.getElementById('sup-date-from')?.value;
    const to = document.getElementById('sup-date-to')?.value;

    // Get all stock_in movements related to the supplier(s) via products
    let movementQuery = db.stock_movements.where('type').equals('stock_in');
    if (from) movementQuery = movementQuery.filter(m => m.created_at >= from);
    if (to) movementQuery = movementQuery.filter(m => m.created_at <= to + 'T23:59:59');
    const movements = await movementQuery.toArray();

    const productIds = [...new Set(movements.map(m => m.product_id))];
    const products = await db.products.bulkGet(productIds);
    const productMap = {};
    products.forEach(p => {
      if (p) {
        productMap[p.id] = p;
      }
    });

    // Filter by supplier
    const filtered = movements.filter(m => {
      const prod = productMap[m.product_id];
      if (!prod) return false;
      if (supId) return prod.supplier_id == supId;
      return true; // all suppliers
    });

    // Aggregate
    const summary = {};
    filtered.forEach(m => {
      const prod = productMap[m.product_id];
      const key = prod.supplier_id || 'unknown';
      if (!summary[key]) summary[key] = { supplier_name: suppliers.find(s=>s.id===key)?.name || 'Unknown', events: 0, total_units: 0, total_cost: 0 };
      summary[key].events++;
      summary[key].total_units += m.quantity;
      summary[key].total_cost += m.quantity * (prod.cost_price || 0);
    });

    const data = Object.values(summary);
    const columns = [
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'events', label: 'Stock-In Events' },
      { key: 'total_units', label: 'Total Units' },
      { key: 'total_cost', label: 'Total Cost Value', render: v => formatCurrencySync(v) }
    ];

    ui.renderTable({ container: document.getElementById('sup-table'), columns, data, emptyMessage: 'No data.' });

    return data;
  }

  document.getElementById('generate-sup-btn').addEventListener('click', async () => {
    const data = await generate();
    bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Supplier Report', data, (d) => [
      ['Supplier', 'Events', 'Units', 'Cost Value'],
      ...d.map(s => [s.supplier_name, s.events, s.total_units, s.total_cost])
    ]);
  });

  const data = await generate();
  bindExportButtons('.export-csv-btn', '.export-pdf-btn', 'Supplier Report', data, (d) => [
    ['Supplier', 'Events', 'Units', 'Cost Value'],
    ...d.map(s => [s.supplier_name, s.events, s.total_units, s.total_cost])
  ]);
}

/* ================================================================
   EXPORT HELPERS (CSV / PDF) – bound dynamically after report render
   ================================================================ */
function bindExportButtons(csvSelector, pdfSelector, title, currentData, csvRowMapper) {
  const csvBtn = document.querySelector(csvSelector);
  const pdfBtn = document.querySelector(pdfSelector);
  if (!csvBtn || !pdfBtn) return;

  // Remove previous listeners by cloning (simple approach)
  csvBtn.replaceWith(csvBtn.cloneNode(true));
  pdfBtn.replaceWith(pdfBtn.cloneNode(true));
  const newCsvBtn = document.querySelector(csvSelector);
  const newPdfBtn = document.querySelector(pdfSelector);

  newCsvBtn.addEventListener('click', () => {
    const rows = csvRowMapper(currentData);
    if (!rows || rows.length === 0) return;
    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g,'_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ui.toast('CSV exported.', 'success');
  });

  newPdfBtn.addEventListener('click', async () => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      ui.toast('PDF library not loaded.', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'pt', 'a4');
    // Add header
    const businessName = await getSetting('business_name', 'Stockify');
    doc.setFontSize(16);
    doc.text(businessName, 40, 40);
    doc.setFontSize(12);
    doc.text(title, 40, 60);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 75);

    const rows = csvRowMapper(currentData);
    if (rows && rows.length > 1) {
      const headers = rows[0];
      const body = rows.slice(1);
      doc.autoTable({
        head: [headers],
        body: body,
        startY: 90,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] }
      });
    }
    doc.save(`${title.replace(/\s+/g,'_').toLowerCase()}.pdf`);
    ui.toast('PDF exported.', 'success');
  });
}
