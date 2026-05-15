// dashboard.js – Dashboard page: KPIs, charts, recent sales, low stock/expiry panels, notification checks
import { db, getSetting } from './db.js';
import { ui } from './ui.js';
import { sanitize, formatCurrencySync, formatDateSync, timeSince, debounce } from './utils.js';
import { updateNotificationBell } from './notifications.js'; // for bell update after generating notifications

/* Module-level chart instances to destroy on navigation */
let salesTrendChart = null;
let topProductsChart = null;
let categoryDistChart = null;

/* Main init – called by router */
export async function init() {
  const container = document.getElementById('app-content');
  if (!container) return;

  // Render dashboard skeleton
  container.innerHTML = `
    <div class="dashboard-page">
      <!-- KPI cards row -->
      <div class="kpi-grid" id="kpi-grid">${ui.renderSkeletonLoader(6)}</div>

      <!-- Charts row -->
      <div class="charts-row" style="display:grid; grid-template-columns:2fr 1fr; gap:var(--space-md); margin-top:var(--space-lg);">
        <div class="card chart-card">
          <h3>Sales Trend (Last 30 Days)</h3>
          <canvas id="sales-trend-chart" style="max-height:250px;"></canvas>
        </div>
        <div class="card chart-card">
          <h3>Category Stock</h3>
          <canvas id="category-dist-chart" style="max-height:250px;"></canvas>
        </div>
      </div>

      <!-- Top 5 products chart + low stock -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-md); margin-top:var(--space-lg);">
        <div class="card">
          <h3>Top 5 Best Sellers (This Month)</h3>
          <canvas id="top-products-chart" style="max-height:200px;"></canvas>
        </div>
        <div class="card">
          <h3>Low Stock Products</h3>
          <div id="low-stock-panel">${ui.renderSkeletonLoader(3)}</div>
        </div>
      </div>

      <!-- Expiry panel -->
      <div class="card" style="margin-top:var(--space-lg);">
        <h3>Expiry Alerts (Next 30 Days)</h3>
        <div id="expiry-panel">${ui.renderSkeletonLoader(3)}</div>
      </div>

      <!-- Recent sales -->
      <div class="card" style="margin-top:var(--space-lg);">
        <h3>Recent Sales</h3>
        <div id="recent-sales-table">${ui.renderSkeletonLoader(3)}</div>
      </div>

      <!-- Quick actions -->
      <div class="quick-actions" style="margin-top:var(--space-lg); display:flex; gap:var(--space-md);">
        <a href="#/products/add" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Add Product</a>
        <a href="#/sales/new" class="btn btn-secondary"><i class="fa-solid fa-cart-shopping"></i> Record Sale</a>
        <a href="#/stock/in" class="btn btn-secondary"><i class="fa-solid fa-arrow-right-to-bracket"></i> Stock In</a>
      </div>
    </div>
  `;

  // Load data and populate
  try {
    ui.showSpinner();
    const dashboardData = await fetchDashboardData();
    renderKPIs(dashboardData.kpis);
    renderSalesTrendChart(dashboardData.salesTrend);
    renderTopProductsChart(dashboardData.topProducts);
    renderCategoryDistributionChart(dashboardData.categoryDistribution);
    renderRecentSales(dashboardData.recentSales);
    renderLowStockPanel(dashboardData.lowStockProducts);
    renderExpiryPanel(dashboardData.expiryProducts);

    // Generate notifications (low stock / expiry) if not already generated today
    await checkAndGenerateNotifications(dashboardData.lowStockProducts, dashboardData.expiryProducts);
    await updateNotificationBell();
  } catch (err) {
    console.error('Dashboard load error:', err);
    ui.toast('Failed to load dashboard data.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

/* Cleanup on navigation away */
export function destroy() {
  if (salesTrendChart) { salesTrendChart.destroy(); salesTrendChart = null; }
  if (topProductsChart) { topProductsChart.destroy(); topProductsChart = null; }
  if (categoryDistChart) { categoryDistChart.destroy(); categoryDistChart = null; }
}

/* ---------------------------------------------------------------
   DATA FETCHING & AGGREGATION
   --------------------------------------------------------------- */
async function fetchDashboardData() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  // Fetch all needed data in parallel
  const [products, categories, sales, saleItems, stockMovements, lowStockThreshold, currencySymbol] = await Promise.all([
    db.products.where('is_active').equals(1).toArray(),
    db.categories.toArray(),
    db.sales.where('status').equals('completed').toArray(),
    db.sale_items.toArray(),
    db.stock_movements.toArray(),
    getSetting('default_low_stock_threshold', 10).then(Number),
    getSetting('currency_symbol', '$')
  ]);

  // KPIs
  const activeProducts = products.filter(p => p.is_active);
  const totalProducts = activeProducts.length;
  const totalCategories = categories.length;

  // Total stock value: sum(quantity * cost_price)
  let totalStockValue = 0;
  activeProducts.forEach(p => {
    totalStockValue += (p.quantity || 0) * (p.cost_price || 0);
  });

  // Low stock count: active products where quantity <= threshold
  const threshold = lowStockThreshold || 10;
  const lowStockProducts = activeProducts.filter(p => (p.quantity || 0) <= threshold);
  const lowStockCount = lowStockProducts.length;

  // Expiring soon: active products with expiry_date within 30 days and quantity > 0
  const expiryDateLimit = new Date(now);
  expiryDateLimit.setDate(expiryDateLimit.getDate() + 30);
  const expiryProducts = activeProducts.filter(p => {
    if (!p.expiry_date) return false;
    const expDate = new Date(p.expiry_date);
    return p.quantity > 0 && expDate <= expiryDateLimit && expDate >= now;
  });
  const expiringSoonCount = expiryProducts.length;

  // Today's sales revenue
  const todaySales = sales.filter(s => s.created_at && s.created_at.startsWith(todayStr));
  const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total_amount || 0), 0);

  // Sales trend (last 30 days) – grouped by day
  const salesTrendMap = {};
  for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    const dateKey = d.toISOString().split('T')[0];
    salesTrendMap[dateKey] = 0;
  }
  sales.filter(s => s.status === 'completed').forEach(s => {
    const dateKey = s.created_at ? s.created_at.split('T')[0] : null;
    if (dateKey && salesTrendMap.hasOwnProperty(dateKey)) {
      salesTrendMap[dateKey] += s.total_amount || 0;
    }
  });
  const salesTrend = Object.entries(salesTrendMap).map(([date, total]) => ({ date, total }));

  // Top 5 best-selling products this month
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthSales = sales.filter(s => s.status === 'completed' && s.created_at >= firstDayOfMonth);
  const monthSaleIds = monthSales.map(s => s.id);
  const monthItems = saleItems.filter(item => monthSaleIds.includes(item.sale_id));

  const productSalesMap = {};
  monthItems.forEach(item => {
    if (!productSalesMap[item.product_id]) {
      productSalesMap[item.product_id] = { quantity: 0, revenue: 0 };
    }
    productSalesMap[item.product_id].quantity += item.quantity || 0;
    productSalesMap[item.product_id].revenue += item.subtotal || 0;
  });

  const topProductIds = Object.entries(productSalesMap)
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 5)
    .map(([id]) => parseInt(id));

  const topProducts = [];
  for (const pid of topProductIds) {
    const prod = products.find(p => p.id === pid);
    const stats = productSalesMap[pid];
    topProducts.push({
      product_id: pid,
      name: prod ? prod.name : 'Unknown',
      units_sold: stats.quantity,
      revenue: stats.revenue
    });
  }

  // Category distribution (quantity sum per category)
  const catDistMap = {};
  activeProducts.forEach(p => {
    const catId = p.category_id || 0;
    if (!catDistMap[catId]) catDistMap[catId] = 0;
    catDistMap[catId] += p.quantity || 0;
  });
  const categoryDistribution = categories.map(cat => ({
    category_name: cat.name,
    quantity: catDistMap[cat.id] || 0
  })).filter(c => c.quantity > 0);

  // Recent sales (last 10 completed)
  const recentSales = sales
    .filter(s => s.status === 'completed')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  // Get item count for each recent sale
  const recentSaleIds = recentSales.map(s => s.id);
  const saleItemCounts = {};
  const allRecentItems = saleItems.filter(item => recentSaleIds.includes(item.sale_id));
  allRecentItems.forEach(item => {
    if (!saleItemCounts[item.sale_id]) saleItemCounts[item.sale_id] = 0;
    saleItemCounts[item.sale_id] += item.quantity || 0;
  });

  return {
    kpis: {
      totalProducts,
      totalCategories,
      totalStockValue,
      lowStockCount,
      expiringSoonCount,
      todayRevenue,
      currencySymbol
    },
    salesTrend,
    topProducts,
    categoryDistribution,
    recentSales: recentSales.map(s => ({
      ...s,
      items_count: saleItemCounts[s.id] || 0
    })),
    lowStockProducts,
    expiryProducts
  };
}

/* ---------------------------------------------------------------
   RENDER KPI CARDS
   --------------------------------------------------------------- */
function renderKPIs(kpis) {
  const grid = document.getElementById('kpi-grid');
  if (!grid) return;
  const sym = kpis.currencySymbol;

  const cards = [
    { icon: 'fa-box', label: 'Active Products', value: kpis.totalProducts, color: '#4F46E5' },
    { icon: 'fa-tags', label: 'Categories', value: kpis.totalCategories, color: '#7C3AED' },
    { icon: 'fa-coins', label: 'Stock Value', value: formatCurrencySync(kpis.totalStockValue, sym), color: '#059669' },
    { icon: 'fa-triangle-exclamation', label: 'Low Stock', value: kpis.lowStockCount, color: '#D97706' },
    { icon: 'fa-clock', label: 'Expiring Soon', value: kpis.expiringSoonCount, color: '#DC2626' },
    { icon: 'fa-chart-line', label: 'Today\'s Revenue', value: formatCurrencySync(kpis.todayRevenue, sym), color: '#2563EB' }
  ];

  grid.innerHTML = cards.map(c => `
    <div class="card kpi-card">
      <div class="kpi-icon" style="background:${c.color}20; color:${c.color};">
        <i class="fa-solid ${c.icon}"></i>
      </div>
      <div class="kpi-content">
        <h4>${c.value}</h4>
        <p>${c.label}</p>
      </div>
    </div>
  `).join('');
}

/* ---------------------------------------------------------------
   CHARTS (using Chart.js global)
   --------------------------------------------------------------- */
function renderSalesTrendChart(data) {
  const ctx = document.getElementById('sales-trend-chart')?.getContext('2d');
  if (!ctx) return;
  if (salesTrendChart) salesTrendChart.destroy();

  const labels = data.map(d => d.date);
  const values = data.map(d => d.total);

  salesTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data: values,
        borderColor: '#4F46E5',
        backgroundColor: 'rgba(79,70,229,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } }
      }
    }
  });
}

function renderTopProductsChart(data) {
  const ctx = document.getElementById('top-products-chart')?.getContext('2d');
  if (!ctx) return;
  if (topProductsChart) topProductsChart.destroy();

  topProductsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(p => p.name),
      datasets: [
        {
          label: 'Units Sold',
          data: data.map(p => p.units_sold),
          backgroundColor: '#4F46E5',
          borderRadius: 4
        },
        {
          label: 'Revenue',
          data: data.map(p => p.revenue),
          backgroundColor: '#A78BFA',
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: false } }
    }
  });
}

function renderCategoryDistributionChart(data) {
  const ctx = document.getElementById('category-dist-chart')?.getContext('2d');
  if (!ctx) return;
  if (categoryDistChart) categoryDistChart.destroy();

  categoryDistChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(c => c.category_name),
      datasets: [{
        data: data.map(c => c.quantity),
        backgroundColor: ['#4F46E5','#7C3AED','#2563EB','#059669','#D97706','#DC2626','#8B5CF6','#EC4899']
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'right' } }
    }
  });
}

/* ---------------------------------------------------------------
   RECENT SALES TABLE
   --------------------------------------------------------------- */
function renderRecentSales(sales) {
  const container = document.getElementById('recent-sales-table');
  if (!container) return;

  if (sales.length === 0) {
    container.innerHTML = ui.renderEmptyState({ message: 'No sales yet.' });
    return;
  }

  const columns = [
    { key: 'created_at', label: 'Date', render: (val) => formatDateSync(val) },
    { key: 'customer_name', label: 'Customer', render: (val) => val || 'Walk-in' },
    { key: 'items_count', label: 'Items' },
    { key: 'total_amount', label: 'Total', render: (val) => formatCurrencySync(val) },
    { key: 'payment_method', label: 'Payment' },
    { key: 'id', label: '', render: (val) => `<a href="#/sales/${val}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-eye"></i></a>` }
  ];

  ui.renderTable({
    container,
    columns,
    data: sales,
    page: 1,
    perPage: 10,
    emptyMessage: 'No recent sales.'
  });
}

/* ---------------------------------------------------------------
   LOW STOCK PANEL
   --------------------------------------------------------------- */
function renderLowStockPanel(products) {
  const panel = document.getElementById('low-stock-panel');
  if (!panel) return;
  if (products.length === 0) {
    panel.innerHTML = '<p class="text-muted">All products are sufficiently stocked.</p>';
    return;
  }

  let html = '<ul class="alert-list">';
  products.slice(0, 10).forEach(p => {
    html += `
      <li class="alert-item">
        <span class="alert-name">${sanitize(p.name)}</span>
        <span class="badge badge-warning">Qty: ${p.quantity}</span>
        <a href="#/stock/in" class="btn btn-ghost btn-sm"><i class="fa-solid fa-plus"></i> Stock In</a>
      </li>`;
  });
  html += '</ul>';
  panel.innerHTML = html;
}

/* ---------------------------------------------------------------
   EXPIRY PANEL
   --------------------------------------------------------------- */
function renderExpiryPanel(products) {
  const panel = document.getElementById('expiry-panel');
  if (!panel) return;
  if (products.length === 0) {
    panel.innerHTML = '<p class="text-muted">No products expiring within 30 days.</p>';
    return;
  }

  const now = new Date();
  let html = '<ul class="alert-list">';
  products.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date)).slice(0, 10).forEach(p => {
    const daysRemaining = Math.ceil((new Date(p.expiry_date) - now) / (1000 * 60 * 60 * 24));
    const badgeClass = daysRemaining <= 0 ? 'badge-danger' : (daysRemaining <= 7 ? 'badge-warning' : 'badge-info');
    html += `
      <li class="alert-item">
        <span class="alert-name">${sanitize(p.name)}</span>
        <span class="badge ${badgeClass}">${daysRemaining <= 0 ? 'Expired' : daysRemaining + 'd'}</span>
      </li>`;
  });
  html += '</ul>';
  panel.innerHTML = html;
}

/* ---------------------------------------------------------------
   NOTIFICATION CHECK & GENERATION
   --------------------------------------------------------------- */
async function checkAndGenerateNotifications(lowStockProducts, expiryProducts) {
  const today = new Date().toISOString().split('T')[0];
  const user = JSON.parse(sessionStorage.getItem('auth_user'));
  if (!user) return;

  // Low stock notifications
  for (const product of lowStockProducts) {
    const exists = await db.notifications
      .where({ type: 'low_stock', product_id: product.id })
      .filter(n => n.created_at && n.created_at.startsWith(today) && !n.is_read)
      .count();
    if (exists === 0) {
      await db.notifications.add({
        user_id: user.id,
        type: 'low_stock',
        message: `${product.name} is low on stock (${product.quantity} remaining, threshold ${product.low_stock_threshold || 10}).`,
        product_id: product.id,
        is_read: false,
        created_at: new Date().toISOString()
      });
    }
  }

  // Expiry notifications
  for (const product of expiryProducts) {
    const exists = await db.notifications
      .where({ type: 'expiry', product_id: product.id })
      .filter(n => n.created_at && n.created_at.startsWith(today) && !n.is_read)
      .count();
    if (exists === 0) {
      const daysRem = Math.ceil((new Date(product.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
      await db.notifications.add({
        user_id: user.id,
        type: 'expiry',
        message: `${product.name} expires in ${daysRem} day(s) (${product.expiry_date}).`,
        product_id: product.id,
        is_read: false,
        created_at: new Date().toISOString()
      });
    }
  }

  // Optional EmailJS alerts are triggered in notifications module if email alerts enabled.
}
