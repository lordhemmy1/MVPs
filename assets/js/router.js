// router.js – Hash-based SPA router, route permissions, sidebar, breadcrumb, and navigation orchestration
import { auth } from './auth.js';
import { ui } from './ui.js';
import { getSetting } from './db.js';
import { updateNotificationBell } from './notifications.js';

// Feature module imports (each exports { init, destroy } or equivalent functions)
import * as dashboardModule from './dashboard.js';
import * as productsModule from './products.js';
import * as stockModule from './stock.js';
import * as salesModule from './sales.js';
import * as categoriesModule from './categories.js';
import * as suppliersModule from './suppliers.js';
import * as notificationsModule from './notifications.js';
import * as reportsModule from './reports.js';
import * as usersModule from './users.js';
import * as settingsModule from './settings.js';
import * as auditModule from './audit.js';

/* ---------------------------------------------------------------
   ROUTE DEFINITIONS
   Each route: pattern (string with :params), regex (for matching),
   module (object reference), title (for breadcrumb), icon (FA class),
   showInSidebar (boolean), minRole (for access control)
   --------------------------------------------------------------- */
const ROUTES = [
  // Dashboard
  {
    pattern: '/dashboard',
    regex: /^\/dashboard$/,
    module: dashboardModule,
    title: 'Dashboard',
    icon: 'fa-solid fa-grid-2',
    showInSidebar: true,
    minRole: 'staff'
  },
  // Products
  {
    pattern: '/products',
    regex: /^\/products$/,
    module: productsModule,
    title: 'Products',
    icon: 'fa-solid fa-box',
    showInSidebar: true,
    minRole: 'staff'
  },
  {
    pattern: '/products/add',
    regex: /^\/products\/add$/,
    module: productsModule,
    title: 'Add Product',
    icon: null,
    showInSidebar: false,
    minRole: 'manager'
  },
  {
    pattern: '/products/:id/edit',
    regex: /^\/products\/(\d+)\/edit$/,
    module: productsModule,
    title: 'Edit Product',
    icon: null,
    showInSidebar: false,
    minRole: 'manager'
  },
  {
    pattern: '/products/:id',
    regex: /^\/products\/(\d+)$/,
    module: productsModule,
    title: 'Product Detail',
    icon: null,
    showInSidebar: false,
    minRole: 'staff'
  },
  {
    pattern: '/products/import',
    regex: /^\/products\/import$/,
    module: productsModule,
    title: 'Import Products',
    icon: null,
    showInSidebar: false,
    minRole: 'manager'
  },
  // Stock
  {
    pattern: '/stock/in',
    regex: /^\/stock\/in$/,
    module: stockModule,
    title: 'Stock In',
    icon: 'fa-solid fa-arrow-right-to-bracket',
    showInSidebar: true,
    minRole: 'manager'
  },
  {
    pattern: '/stock/out',
    regex: /^\/stock\/out$/,
    module: stockModule,
    title: 'Stock Out',
    icon: 'fa-solid fa-arrow-right-from-bracket',
    showInSidebar: true,
    minRole: 'manager'
  },
  {
    pattern: '/stock/adjust',
    regex: /^\/stock\/adjust$/,
    module: stockModule,
    title: 'Stock Adjustment',
    icon: 'fa-solid fa-sliders',
    showInSidebar: true,
    minRole: 'manager'
  },
  {
    pattern: '/stock/history',
    regex: /^\/stock\/history$/,
    module: stockModule,
    title: 'Stock History',
    icon: 'fa-solid fa-clock-rotate-left',
    showInSidebar: true,
    minRole: 'staff'
  },
  // Sales
  {
    pattern: '/sales/new',
    regex: /^\/sales\/new$/,
    module: salesModule,
    title: 'New Sale',
    icon: 'fa-solid fa-cart-shopping',
    showInSidebar: true,
    minRole: 'staff'
  },
  {
    pattern: '/sales',
    regex: /^\/sales$/,
    module: salesModule,
    title: 'Sales History',
    icon: 'fa-solid fa-receipt',
    showInSidebar: true,
    minRole: 'staff'
  },
  {
    pattern: '/sales/:id',
    regex: /^\/sales\/(\d+)$/,
    module: salesModule,
    title: 'Sale Detail',
    icon: null,
    showInSidebar: false,
    minRole: 'staff'
  },
  {
    pattern: '/sales/:id/receipt',
    regex: /^\/sales\/(\d+)\/receipt$/,
    module: salesModule,
    title: 'Receipt',
    icon: null,
    showInSidebar: false,
    minRole: 'staff'
  },
  // Categories
  {
    pattern: '/categories',
    regex: /^\/categories$/,
    module: categoriesModule,
    title: 'Categories',
    icon: 'fa-solid fa-tags',
    showInSidebar: true,
    minRole: 'manager'
  },
  // Suppliers
  {
    pattern: '/suppliers',
    regex: /^\/suppliers$/,
    module: suppliersModule,
    title: 'Suppliers',
    icon: 'fa-solid fa-truck',
    showInSidebar: true,
    minRole: 'manager'
  },
  {
    pattern: '/suppliers/:id',
    regex: /^\/suppliers\/(\d+)$/,
    module: suppliersModule,
    title: 'Supplier Profile',
    icon: null,
    showInSidebar: false,
    minRole: 'manager'
  },
  // Notifications
  {
    pattern: '/notifications',
    regex: /^\/notifications$/,
    module: notificationsModule,
    title: 'Notifications',
    icon: 'fa-solid fa-bell',
    showInSidebar: true,
    minRole: 'staff'
  },
  // Reports
  {
    pattern: '/reports',
    regex: /^\/reports$/,
    module: reportsModule,
    title: 'Reports',
    icon: 'fa-solid fa-chart-bar',
    showInSidebar: true,
    minRole: 'manager'
  },
  // Users (admin only)
  {
    pattern: '/users',
    regex: /^\/users$/,
    module: usersModule,
    title: 'User Management',
    icon: 'fa-solid fa-users',
    showInSidebar: true,
    minRole: 'admin'
  },
  // Settings (admin only)
  {
    pattern: '/settings',
    regex: /^\/settings$/,
    module: settingsModule,
    title: 'Settings',
    icon: 'fa-solid fa-gear',
    showInSidebar: true,
    minRole: 'admin'
  },
  // Audit logs (admin only)
  {
    pattern: '/audit',
    regex: /^\/audit$/,
    module: auditModule,
    title: 'Audit Logs',
    icon: 'fa-solid fa-magnifying-glass',
    showInSidebar: true,
    minRole: 'admin'
  },
  // Special routes (no module)
  {
    pattern: '/login',
    regex: /^\/login$/,
    module: null,  // handled by auth
    title: 'Login',
    icon: null,
    showInSidebar: false,
    minRole: null
  },
  {
    pattern: '/unauthorized',
    regex: /^\/unauthorized$/,
    module: null,
    title: 'Access Denied',
    icon: null,
    showInSidebar: false,
    minRole: null
  },
  {
    pattern: '/change-password',
    regex: /^\/change-password$/,
    module: null,  // handled by settings.js change password tab
    title: 'Change Password',
    icon: null,
    showInSidebar: false,
    minRole: null
  },
  {
    pattern: '/profile',
    regex: /^\/profile$/,
    module: settingsModule, // reuse settings for profile?
    title: 'My Profile',
    icon: null,
    showInSidebar: false,
    minRole: null
  }
];

/* ---------------------------------------------------------------
   ROUTER STATE
   --------------------------------------------------------------- */
let currentRoute = null;
let currentParams = {};
let currentModuleObject = null;  // reference to the active module (to call destroy)

// Get app content container
const appContent = document.getElementById('app-content');

/* ---------------------------------------------------------------
   HELPER: Parse hash and match route
   --------------------------------------------------------------- */
function matchRouteFromHash(hash) {
  // Remove leading # and query strings for matching (query handling later)
  let path = hash.replace(/^#/, '') || '/';
  // Remove query string for route matching
  const queryIndex = path.indexOf('?');
  const queryString = queryIndex >= 0 ? path.slice(queryIndex) : '';
  path = queryIndex >= 0 ? path.slice(0, queryIndex) : path;

  // Ensure path starts with /
  if (!path.startsWith('/')) path = '/' + path;

  // Try to match each route
  for (const route of ROUTES) {
    const match = path.match(route.regex);
    if (match) {
      // Extract params (group values)
      const params = {};
      if (route.pattern.includes(':id')) {
        // Assume the first capturing group is the id, second might be for receipt etc.
        // We'll map based on pattern segments.
        const patternSegments = route.pattern.split('/').filter(Boolean);
        const matchValues = match.slice(1); // all captured groups
        patternSegments.forEach((seg, idx) => {
          if (seg.startsWith(':')) {
            params[seg.slice(1)] = matchValues[idx] || null;
          }
        });
      }
      return { route, params, queryString };
    }
  }
  // No match – default to dashboard
  return null;
}

/* ---------------------------------------------------------------
   NAVIGATION HANDLER
   --------------------------------------------------------------- */
async function handleRoute() {
  const hash = window.location.hash || '#/dashboard';
  const matched = matchRouteFromHash(hash);

  // If no route matched, redirect to dashboard
  if (!matched) {
    window.location.hash = '#/dashboard';
    return;
  }

  const { route, params, queryString } = matched;

  // Special routes that bypass authentication checks
  if (route.pattern === '/login') {
    // Render login page (auth.js handles it)
    auth.showLoginPage();
    return;
  }
  if (route.pattern === '/unauthorized') {
    renderUnauthorized();
    return;
  }

  // Check activation (licence) – should already be done, but double-check
  if (!auth.isActivated()) {
    // If somehow not activated, force activation screen (handled by activation.js)
    window.location.reload();
    return;
  }

  // Check if user is logged in; if not, redirect to login
  if (!auth.isLoggedIn()) {
    window.location.hash = '#/login';
    return;
  }

  // Force password change if required
  if (auth.userMustChangePassword() && route.pattern !== '/change-password' && route.pattern !== '/logout') {
    window.location.hash = '#/change-password';
    return;
  }

  // Role-based access control
  if (route.minRole && !auth.hasRole(route.minRole)) {
    window.location.hash = '#/unauthorized';
    return;
  }

  // If we are already on the same module route with same params, avoid re-render? We could skip, but safer to always re-init if module handles it.
  // Call destroy on previous module if different
  if (currentModuleObject && typeof currentModuleObject.destroy === 'function') {
    await currentModuleObject.destroy();
  }

  // Update UI elements
  updateSidebarActive(route.pattern);
  updateBreadcrumb(route.title, params);
  await updateNotificationBell(); // update unread count

  // For special routes handled by specific modules but with no explicit init?
  if (route.pattern === '/change-password') {
    // Force settings module to show change-password tab
    if (settingsModule && settingsModule.init) {
      currentModuleObject = settingsModule;
      await settingsModule.init({ tab: 'change-password' });
    }
    return;
  }
  if (route.pattern === '/profile') {
    if (settingsModule && settingsModule.init) {
      currentModuleObject = settingsModule;
      await settingsModule.init({ tab: 'profile' }); // profile tab in settings
    }
    return;
  }

  // For routes with a module, call its init with params and query string
  if (route.module && typeof route.module.init === 'function') {
    currentModuleObject = route.module;
    try {
      // Parse query string into an object for convenience
      const queryParams = parseQueryString(queryString);
      await route.module.init({ ...params, query: queryParams, action: route.pattern });
    } catch (error) {
      console.error('Module init error:', error);
      ui.toast('Failed to load page.', 'error');
    }
  } else {
    // Fallback (should not happen often)
    appContent.innerHTML = '<p>Page not implemented yet.</p>';
  }

  currentRoute = route;
  currentParams = params;
}

/* ---------------------------------------------------------------
   QUERY STRING PARSER
   --------------------------------------------------------------- */
function parseQueryString(qs) {
  const params = {};
  if (!qs) return params;
  qs.replace(/^\?/, '').split('&').forEach(pair => {
    const [key, val] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || '');
  });
  return params;
}

/* ---------------------------------------------------------------
   SIDEBAR RENDERING
   --------------------------------------------------------------- */
function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  const user = auth.getCurrentUser();
  if (!user) return;

  // Filter routes that are visible in sidebar and user has access
  const sidebarRoutes = ROUTES.filter(r => r.showInSidebar && (!r.minRole || auth.hasRole(r.minRole)));

  let html = '';
  sidebarRoutes.forEach(route => {
    html += `
      <a href="#${route.pattern}" class="sidebar-nav-item" data-route="${route.pattern}">
        <i class="${route.icon}"></i>
        <span>${route.title}</span>
      </a>`;
  });

  nav.innerHTML = html;
  // Set active based on current hash
  updateSidebarActiveFromHash();
}

function updateSidebarActive(routePattern) {
  const items = document.querySelectorAll('.sidebar-nav-item');
  items.forEach(item => {
    const route = item.getAttribute('data-route');
    if (route === routePattern) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function updateSidebarActiveFromHash() {
  const hash = window.location.hash;
  const matched = matchRouteFromHash(hash);
  if (matched) {
    updateSidebarActive(matched.route.pattern);
  }
}

/* ---------------------------------------------------------------
   BREADCRUMB
   --------------------------------------------------------------- */
function updateBreadcrumb(title, params) {
  const breadcrumbEl = document.getElementById('breadcrumb');
  if (!breadcrumbEl) return;
  // Simple: just show title; could be enhanced with path segments
  breadcrumbEl.textContent = title || 'Dashboard';
}

/* ---------------------------------------------------------------
   SPECIAL PAGE RENDERERS
   --------------------------------------------------------------- */
function renderUnauthorized() {
  appContent.innerHTML = `
    <div class="empty-state">
      <img src="assets/images/empty-state.svg" alt="No access">
      <h2>Access Denied</h2>
      <p>You do not have the required permissions to view this page.</p>
      <a href="#/dashboard" class="btn btn-primary">Go to Dashboard</a>
    </div>`;
}

/* ---------------------------------------------------------------
   PUBLIC: Initialize application (called after activation)
   --------------------------------------------------------------- */
async function initApp() {
  // Check if user is activated
  if (!auth.isActivated()) {
    console.error('App not activated – activation required.');
    return;
  }

  // Render sidebar based on current user (if logged in)
  if (auth.isLoggedIn()) {
    renderSidebar();
    // Set user info in topbar
    const user = auth.getCurrentUser();
    const avatarEl = document.getElementById('user-avatar-initials');
    const nameEl = document.getElementById('user-name-display');
    if (avatarEl && nameEl) {
      avatarEl.textContent = user.avatar_initials;
      nameEl.textContent = user.name;
    }
    // Update notification bell on load
    await updateNotificationBell();
  }

  // Show app container
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('app').classList.add('visible');

  // Listen to hash changes
  window.addEventListener('hashchange', handleRoute);
  // Trigger initial route
  await handleRoute();

  // Sidebar toggle (mobile)
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // User dropdown toggle
  const userBtn = document.getElementById('user-avatar-btn');
  const userMenu = document.getElementById('user-menu');
  if (userBtn && userMenu) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenu.classList.toggle('show');
    });
    document.addEventListener('click', () => userMenu.classList.remove('show'));
  }

  // Notification dropdown
  const bellBtn = document.querySelector('.notification-bell-btn');
  const notifDropdown = document.getElementById('notification-dropdown');
  if (bellBtn && notifDropdown) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('show');
    });
    document.addEventListener('click', () => notifDropdown.classList.remove('show'));
  }
}

// Exports
export { initApp, handleRoute, renderSidebar };
