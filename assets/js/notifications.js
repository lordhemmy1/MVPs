// notifications.js – Notification generation, bell update, EmailJS integration
import { db, getSetting } from './db.js';
import { auth } from './auth.js';
import { sanitize, timeSince } from './utils.js';
import { ui } from './ui.js';

/* ---------------------------------------------------------------
   GENERATE LOW STOCK / EXPIRY NOTIFICATIONS (called from various modules)
   --------------------------------------------------------------- */
async function generateLowStockNotificationIfNeeded(product, newQuantity, user) {
  const threshold = product.low_stock_threshold || Number(await getSetting('default_low_stock_threshold', 10));
  if (newQuantity <= threshold && product.quantity > threshold) {
    // Was above threshold, now at or below – create notification
    const today = new Date().toISOString().split('T')[0];
    const exists = await db.notifications
      .where({ type: 'low_stock', product_id: product.id })
      .filter(n => n.created_at && n.created_at.startsWith(today) && !n.is_read)
      .count();
    if (exists === 0) {
      await db.notifications.add({
        user_id: user ? user.id : (auth.getCurrentUser()?.id || 1),
        type: 'low_stock',
        message: `${product.name} is low on stock (${newQuantity} ≤ ${threshold}).`,
        product_id: product.id,
        is_read: false,
        created_at: new Date().toISOString()
      });
      // Optionally send email alert
      await sendEmailAlertIfEnabled('low_stock', {
        product_name: product.name,
        current_quantity: newQuantity,
        threshold,
        business_name: await getSetting('business_name', 'Stockify')
      });
    }
  }
}

// Export for use by other modules
export { generateLowStockNotificationIfNeeded };

/* ---------------------------------------------------------------
   UPDATE NOTIFICATION BELL (called on route change)
   --------------------------------------------------------------- */
async function updateNotificationBell() {
  const countEl = document.getElementById('notif-count');
  if (!countEl) return;
  try {
    const user = auth.getCurrentUser();
    if (!user) return;
    const count = await db.notifications.where({ is_read: false }).filter(n => n.user_id === user.id || n.user_id === undefined).count();
    countEl.textContent = count;
    countEl.classList.toggle('hidden', count === 0);
  } catch (e) {
    console.error('Bell update error', e);
  }
}

/* ---------------------------------------------------------------
   NOTIFICATION DROPDOWN (populated on bell click)
   --------------------------------------------------------------- */
async function renderNotificationDropdown() {
  const dropdown = document.getElementById('notification-dropdown');
  if (!dropdown) return;
  const user = auth.getCurrentUser();
  if (!user) return;
  const notifications = await db.notifications
    .where('user_id').equals(user.id)
    .or('user_id').equals(undefined) // system-wide
    .reverse()
    .sortBy('created_at');
  const unread = notifications.filter(n => !n.is_read);
  const recent = unread.slice(0, 5).length > 0 ? unread.slice(0, 5) : notifications.slice(0, 5);

  dropdown.innerHTML = recent.length === 0
    ? '<div class="dropdown-item text-muted">No notifications</div>'
    : recent.map(n => `
      <div class="dropdown-item notification-item" data-id="${n.id}">
        <i class="fa-solid ${n.type==='low_stock' ? 'fa-triangle-exclamation text-warning' : n.type==='expiry' ? 'fa-clock text-danger' : 'fa-circle-info text-info'}"></i>
        <div>
          <span class="notification-msg">${sanitize(n.message)}</span>
          <small class="text-muted">${timeSince(n.created_at)}</small>
        </div>
      </div>
    `).join('') +
    '<div class="dropdown-divider"></div>' +
    '<a href="#/notifications" class="dropdown-item text-center text-primary">View All</a>';

  // Bind mark as read
  dropdown.querySelectorAll('.notification-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(el.dataset.id);
      await db.notifications.update(id, { is_read: true });
      await updateNotificationBell();
      renderNotificationDropdown(); // refresh dropdown
    });
  });
}

/* ================================================================
   NOTIFICATIONS FULL PAGE (view all, mark all read, delete)
   ================================================================ */
export async function initNotificationsPage(container) {
  container.innerHTML = `
    <div class="notifications-page">
      <h2>Notifications</h2>
      <div style="display:flex; gap:var(--space-md); margin-bottom:var(--space-md);">
        <button id="mark-all-read-btn" class="btn btn-secondary"><i class="fa-solid fa-check-double"></i> Mark All Read</button>
        <button id="filter-unread-btn" class="btn btn-ghost">Unread</button>
        <button id="filter-all-btn" class="btn btn-ghost active">All</button>
      </div>
      <div id="notifications-list"></div>
    </div>`;

  let showUnread = false;
  const listContainer = document.getElementById('notifications-list');

  async function renderList() {
    const user = auth.getCurrentUser();
    if (!user) return;
    let query = db.notifications.orderBy('created_at').reverse();
    if (showUnread) {
      query = query.filter(n => n.user_id === user.id && !n.is_read);
    } else {
      query = query.filter(n => n.user_id === user.id);
    }
    const notifications = await query.toArray();

    if (notifications.length === 0) {
      listContainer.innerHTML = '<p class="text-muted">No notifications.</p>';
      return;
    }

    let html = '<div class="notification-list">';
    notifications.forEach(n => {
      html += `
        <div class="notification-item card card-hover ${!n.is_read ? 'unread' : ''}" data-id="${n.id}" style="margin-bottom:var(--space-sm); padding:var(--space-md);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <i class="fa-solid ${n.type==='low_stock' ? 'fa-triangle-exclamation text-warning' : n.type==='expiry' ? 'fa-clock text-danger' : 'fa-circle-info text-info'}"></i>
              <span>${sanitize(n.message)}</span>
            </div>
            <div>
              <small class="text-muted">${timeSince(n.created_at)}</small>
              <button class="btn btn-ghost btn-sm delete-notif-btn" data-id="${n.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>`;
    });
    html += '</div>';
    listContainer.innerHTML = html;

    // Mark as read on click
    listContainer.querySelectorAll('.notification-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.delete-notif-btn')) return;
        const id = parseInt(el.dataset.id);
        await db.notifications.update(id, { is_read: true });
        el.classList.remove('unread');
        await updateNotificationBell();
      });
    });
    // Delete
    listContainer.querySelectorAll('.delete-notif-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        await db.notifications.delete(id);
        await updateNotificationBell();
        renderList();
      });
    });
  }

  document.getElementById('mark-all-read-btn').addEventListener('click', async () => {
    const user = auth.getCurrentUser();
    await db.notifications.where({ is_read: false }).filter(n => n.user_id === user.id).modify({ is_read: true });
    await updateNotificationBell();
    renderList();
  });
  document.getElementById('filter-unread-btn').addEventListener('click', () => {
    showUnread = true;
    document.getElementById('filter-unread-btn').classList.add('active');
    document.getElementById('filter-all-btn').classList.remove('active');
    renderList();
  });
  document.getElementById('filter-all-btn').addEventListener('click', () => {
    showUnread = false;
    document.getElementById('filter-all-btn').classList.add('active');
    document.getElementById('filter-unread-btn').classList.remove('active');
    renderList();
  });

  renderList();
}

/* ---------------------------------------------------------------
   EMAIL ALERTS (via EmailJS)
   --------------------------------------------------------------- */
async function sendEmailAlertIfEnabled(templateType, params) {
  try {
    const enabled = await getSetting('email_alerts_enabled', 'false');
    if (enabled !== 'true') return;

    const serviceId = await getSetting('emailjs_service_id', '');
    const templateIdKey = templateType === 'low_stock' ? 'emailjs_template_id_lowstock' : 'emailjs_template_id_expiry';
    const templateId = await getSetting(templateIdKey, '');
    const publicKey = await getSetting('emailjs_public_key', '');

    if (!serviceId || !templateId || !publicKey) {
      console.warn('EmailJS not fully configured.');
      return;
    }

    // Initialize EmailJS (should be done once globally, but we can call init each time with public key)
    if (window.emailjs) {
      emailjs.init(publicKey);
      await emailjs.send(serviceId, templateId, params);
      console.log('Email alert sent.');
    }
  } catch (error) {
    console.error('Email alert failed:', error);
    // Never block the main operation
  }
}

// Initialize dropdown on bell click
document.addEventListener('DOMContentLoaded', () => {
  const bellBtn = document.querySelector('.notification-bell-btn');
  if (bellBtn) {
    bellBtn.addEventListener('click', async () => {
      await renderNotificationDropdown();
    });
  }
});
