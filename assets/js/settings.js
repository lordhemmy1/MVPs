// settings.js – Settings page with tabs: Business Profile, Preferences, Notifications, Licence, Change Password, Data Management
import { db, getSetting, setSetting, exportAllData, importAllData } from './db.js';
import { ui } from './ui.js';
import { sanitize, validate, validateEmail, passwordStrength, formatCurrencySync } from './utils.js';
import { auth } from './auth.js';
import { APP_NAME, APP_VERSION } from '../../config.js'; // adjust relative path as needed

// Module state: track active tab
let activeTab = 'business';

export async function init(params = {}) {
  // If params specify a tab (e.g., from router for change-password/profile)
  if (params.tab === 'change-password') activeTab = 'password';
  else if (params.tab === 'profile') activeTab = 'business'; // profile same as business tab
  else activeTab = 'business';

  const container = document.getElementById('app-content');
  if (!container) return;

  if (!auth.hasRole('admin') && activeTab !== 'password') {
    container.innerHTML = '<p class="text-danger">Access denied. Only administrators can access settings.</p>';
    return;
  }
  // If user is not admin, only show Change Password tab (handled by dedicated route, but fallback)
  if (!auth.hasRole('admin')) {
    activeTab = 'password';
  }

  ui.showSpinner();
  try {
    await renderSettingsPage(container);
    switchTab(activeTab);
  } catch (err) {
    console.error(err);
    ui.toast('Failed to load settings.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

export function destroy() {
  // Cleanup color picker live events if needed
}

/* ================================================================
   RENDER SETTINGS PAGE SHELL WITH TABS
   ================================================================ */
async function renderSettingsPage(container) {
  const isAdmin = auth.hasRole('admin');

  container.innerHTML = `
    <div class="settings-page">
      <h2>Settings</h2>
      <div class="tab-bar" id="settings-tabs">
        ${isAdmin ? `<button class="tab-btn" data-tab="business">Business Profile</button>` : ''}
        ${isAdmin ? `<button class="tab-btn" data-tab="preferences">Preferences</button>` : ''}
        ${isAdmin ? `<button class="tab-btn" data-tab="notifications">Notifications</button>` : ''}
        ${isAdmin ? `<button class="tab-btn" data-tab="licence">Licence</button>` : ''}
        <button class="tab-btn" data-tab="password">Change Password</button>
        ${isAdmin ? `<button class="tab-btn" data-tab="data">Data Management</button>` : ''}
      </div>
      <div class="tab-content" id="tab-business"></div>
      <div class="tab-content" id="tab-preferences"></div>
      <div class="tab-content" id="tab-notifications"></div>
      <div class="tab-content" id="tab-licence"></div>
      <div class="tab-content" id="tab-password"></div>
      <div class="tab-content" id="tab-data"></div>
    </div>`;

  // Bind tab clicks
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Load initial tab content (after rendering)
  await loadTabContent('business');
  await loadTabContent('preferences');
  await loadTabContent('notifications');
  await loadTabContent('licence');
  await loadTabContent('password');
  await loadTabContent('data');
}

function switchTab(tab) {
  // Update active tab button
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  // Show/hide tab content
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const tabContent = document.getElementById(`tab-${tab}`);
  if (tabContent) tabContent.classList.add('active');
  activeTab = tab;
}

/* ================================================================
   LOAD TAB CONTENT (all rendered once, but shown on demand)
   ================================================================ */
async function loadTabContent(tab) {
  const container = document.getElementById(`tab-${tab}`);
  if (!container || container.dataset.loaded) return;

  switch (tab) {
    case 'business': await renderBusinessProfileTab(container); break;
    case 'preferences': await renderPreferencesTab(container); break;
    case 'notifications': await renderNotificationsTab(container); break;
    case 'licence': renderLicenceTab(container); break;
    case 'password': renderChangePasswordTab(container); break;
    case 'data': renderDataManagementTab(container); break;
  }
  container.dataset.loaded = 'true';
}

/* ================================================================
   BUSINESS PROFILE TAB
   ================================================================ */
async function renderBusinessProfileTab(container) {
  const [name, address, phone, email, logoBase64] = await Promise.all([
    getSetting('business_name', 'My Store'),
    getSetting('business_address', ''),
    getSetting('business_phone', ''),
    getSetting('business_email', ''),
    getSetting('business_logo_base64', '')
  ]);

  container.innerHTML = `
    <form id="business-profile-form" class="card">
      <div class="form-group">
        <label class="form-label">Business Name</label>
        <input type="text" name="business_name" class="form-input" value="${sanitize(name)}">
      </div>
      <div class="form-group">
        <label class="form-label">Address</label>
        <textarea name="business_address" class="form-textarea">${sanitize(address)}</textarea>
      </div>
      <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-md);">
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input type="text" name="business_phone" class="form-input" value="${sanitize(phone)}">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" name="business_email" class="form-input" value="${sanitize(email)}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Business Logo (max 1MB, JPG/PNG/WEBP)</label>
        <input type="file" id="business-logo-input" accept="image/jpeg,image/png,image/webp" class="form-input">
        <div id="logo-preview" style="margin-top:var(--space-sm);">
          ${logoBase64 ? `<img src="${logoBase64}" style="max-height:60px; border-radius:4px;"> <button type="button" id="remove-logo-btn" class="btn btn-ghost btn-sm">Remove</button>` : ''}
        </div>
        <input type="hidden" name="business_logo_base64" id="logo-base64-input" value="">
      </div>
      <button type="submit" class="btn btn-primary">Save Profile</button>
    </form>`;

  let newLogoBase64 = logoBase64;
  const logoInput = document.getElementById('business-logo-input');
  const logoPreview = document.getElementById('logo-preview');
  const logoHidden = document.getElementById('logo-base64-input');

  if (logoInput) {
    logoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1 * 1024 * 1024) {
        ui.toast('Logo must be under 1MB.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        newLogoBase64 = ev.target.result;
        logoPreview.innerHTML = `<img src="${newLogoBase64}" style="max-height:60px; border-radius:4px;"> <button type="button" id="remove-logo-btn" class="btn btn-ghost btn-sm">Remove</button>`;
        logoHidden.value = newLogoBase64;
        document.getElementById('remove-logo-btn')?.addEventListener('click', () => {
          newLogoBase64 = '';
          logoPreview.innerHTML = '';
          logoHidden.value = '';
          logoInput.value = '';
        });
      };
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('business-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    if (newLogoBase64 !== undefined) data.business_logo_base64 = newLogoBase64;

    try {
      await Promise.all([
        setSetting('business_name', data.business_name),
        setSetting('business_address', data.business_address),
        setSetting('business_phone', data.business_phone),
        setSetting('business_email', data.business_email),
        setSetting('business_logo_base64', data.business_logo_base64 || '')
      ]);
      ui.toast('Business profile updated.', 'success');
      // Update topbar business name if needed
      const brandText = document.getElementById('sidebar-app-name');
      if (brandText) brandText.textContent = data.business_name;
    } catch (err) {
      ui.toast('Failed to save profile.', 'error');
    }
  });
}

/* ================================================================
   PREFERENCES TAB
   ================================================================ */
async function renderPreferencesTab(container) {
  const [currency, dateFormat, threshold, primaryColor, sidebarCollapsed] = await Promise.all([
    getSetting('currency_symbol', '$'),
    getSetting('date_format', 'DD/MM/YYYY'),
    getSetting('default_low_stock_threshold', '10'),
    getSetting('primary_color', '#4F46E5'),
    getSetting('sidebar_collapsed', 'false')
  ]);

  container.innerHTML = `
    <form id="preferences-form" class="card">
      <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-md);">
        <div class="form-group">
          <label class="form-label">Currency Symbol</label>
          <input type="text" name="currency_symbol" class="form-input" value="${sanitize(currency)}" maxlength="3">
        </div>
        <div class="form-group">
          <label class="form-label">Date Format</label>
          <select name="date_format" class="form-select">
            <option value="DD/MM/YYYY" ${dateFormat==='DD/MM/YYYY'?'selected':''}>DD/MM/YYYY</option>
            <option value="MM/DD/YYYY" ${dateFormat==='MM/DD/YYYY'?'selected':''}>MM/DD/YYYY</option>
            <option value="YYYY-MM-DD" ${dateFormat==='YYYY-MM-DD'?'selected':''}>YYYY-MM-DD</option>
          </select>
        </div>
      </div>
      <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-md);">
        <div class="form-group">
          <label class="form-label">Default Low Stock Threshold</label>
          <input type="number" name="default_low_stock_threshold" class="form-input" value="${threshold}" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">Primary Colour</label>
          <input type="color" name="primary_color" id="primary-color-picker" class="form-input" value="${primaryColor}" style="height:40px; padding:4px;">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" name="sidebar_collapsed" value="true" ${sidebarCollapsed==='true'?'checked':''}> Sidebar collapsed by default
        </label>
      </div>
      <button type="submit" class="btn btn-primary">Save Preferences</button>
    </form>`;

  // Live primary color preview
  const colorPicker = document.getElementById('primary-color-picker');
  colorPicker.addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--color-primary', e.target.value);
    // Derive hover/light colors (simple adjustment)
    const rgb = hexToRgb(e.target.value);
    if (rgb) {
      document.documentElement.style.setProperty('--color-primary-hover', `rgb(${Math.max(0,rgb.r-20)}, ${Math.max(0,rgb.g-20)}, ${Math.max(0,rgb.b-20)})`);
      document.documentElement.style.setProperty('--color-primary-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
      document.documentElement.style.setProperty('--color-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    }
  });

  document.getElementById('preferences-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    // sidebar_collapsed checkbox sends "true" or missing
    const collapsed = formData.get('sidebar_collapsed') === 'true' ? 'true' : 'false';

    try {
      await Promise.all([
        setSetting('currency_symbol', data.currency_symbol || '$'),
        setSetting('date_format', data.date_format),
        setSetting('default_low_stock_threshold', data.default_low_stock_threshold || '10'),
        setSetting('primary_color', data.primary_color),
        setSetting('sidebar_collapsed', collapsed)
      ]);
      // Apply sidebar collapsed state (optional, page reload may be needed)
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        if (collapsed === 'true') sidebar.classList.add('collapsed');
        else sidebar.classList.remove('collapsed');
      }
      ui.toast('Preferences saved.', 'success');
    } catch (err) {
      ui.toast('Failed to save preferences.', 'error');
    }
  });
}

/* Helper hex to rgb */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/* ================================================================
   NOTIFICATIONS TAB
   ================================================================ */
async function renderNotificationsTab(container) {
  const [enabled, serviceId, templateLow, templateExp, publicKey] = await Promise.all([
    getSetting('email_alerts_enabled', 'false'),
    getSetting('emailjs_service_id', ''),
    getSetting('emailjs_template_id_lowstock', ''),
    getSetting('emailjs_template_id_expiry', ''),
    getSetting('emailjs_public_key', '')
  ]);

  container.innerHTML = `
    <form id="email-settings-form" class="card">
      <div class="form-group">
        <label class="form-label">
          <input type="checkbox" name="email_alerts_enabled" value="true" ${enabled==='true'?'checked':''}> Enable email alerts
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">EmailJS Service ID</label>
        <input type="text" name="emailjs_service_id" class="form-input" value="${sanitize(serviceId)}">
      </div>
      <div class="form-group">
        <label class="form-label">EmailJS Low Stock Template ID</label>
        <input type="text" name="emailjs_template_id_lowstock" class="form-input" value="${sanitize(templateLow)}">
      </div>
      <div class="form-group">
        <label class="form-label">EmailJS Expiry Template ID</label>
        <input type="text" name="emailjs_template_id_expiry" class="form-input" value="${sanitize(templateExp)}">
      </div>
      <div class="form-group">
        <label class="form-label">EmailJS Public Key</label>
        <input type="text" name="emailjs_public_key" class="form-input" value="${sanitize(publicKey)}">
      </div>
      <div style="display:flex; gap:var(--space-md);">
        <button type="submit" class="btn btn-primary">Save Email Settings</button>
        <button type="button" id="test-email-btn" class="btn btn-secondary"><i class="fa-solid fa-paper-plane"></i> Send Test Email</button>
      </div>
    </form>
    <div id="test-email-result" style="margin-top:var(--space-sm);"></div>`;

  document.getElementById('email-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const enabledValue = formData.get('email_alerts_enabled') === 'true' ? 'true' : 'false';
    try {
      await Promise.all([
        setSetting('email_alerts_enabled', enabledValue),
        setSetting('emailjs_service_id', formData.get('emailjs_service_id') || ''),
        setSetting('emailjs_template_id_lowstock', formData.get('emailjs_template_id_lowstock') || ''),
        setSetting('emailjs_template_id_expiry', formData.get('emailjs_template_id_expiry') || ''),
        setSetting('emailjs_public_key', formData.get('emailjs_public_key') || '')
      ]);
      ui.toast('Email notification settings saved.', 'success');
    } catch (err) {
      ui.toast('Save failed.', 'error');
    }
  });

  document.getElementById('test-email-btn').addEventListener('click', async () => {
    const svc = document.querySelector('input[name="emailjs_service_id"]').value.trim();
    const tpl = document.querySelector('input[name="emailjs_template_id_lowstock"]').value.trim(); // use low stock template for test
    const key = document.querySelector('input[name="emailjs_public_key"]').value.trim();
    const bizName = await getSetting('business_name', 'Stockify');
    if (!svc || !tpl || !key) {
      document.getElementById('test-email-result').innerHTML = '<span class="text-danger">Please fill in all EmailJS fields.</span>';
      return;
    }
    try {
      if (window.emailjs) {
        emailjs.init(key);
        await emailjs.send(svc, tpl, {
          product_name: 'Test Product',
          current_quantity: 5,
          threshold: 10,
          business_name: bizName
        });
        document.getElementById('test-email-result').innerHTML = '<span class="text-success">Test email sent successfully.</span>';
        ui.toast('Test email sent.', 'success');
      } else {
        throw new Error('EmailJS SDK not loaded.');
      }
    } catch (error) {
      document.getElementById('test-email-result').innerHTML = `<span class="text-danger">Failed: ${sanitize(error.message)}</span>`;
      ui.toast('Email test failed.', 'error');
    }
  });
}

/* ================================================================
   LICENCE TAB
   ================================================================ */
function renderLicenceTab(container) {
  const activation = JSON.parse(localStorage.getItem('stockify_activation') || '{}');
  const businessName = activation.business_name || 'Not activated';
  const activatedAt = activation.activated_at ? new Date(activation.activated_at).toLocaleString() : '—';

  container.innerHTML = `
    <div class="card">
      <h3>Licence Information</h3>
      <p><strong>Business Name:</strong> ${sanitize(businessName)}</p>
      <p><strong>Activation Date:</strong> ${activatedAt}</p>
      <p><strong>App Version:</strong> ${APP_VERSION}</p>
      <hr style="margin:var(--space-md) 0;">
      <p class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> Deactivating will lock the application and require re-entering the licence key.</p>
      <button id="deactivate-licence-btn" class="btn btn-danger"><i class="fa-solid fa-unlock"></i> Deactivate Licence</button>
    </div>`;

  document.getElementById('deactivate-licence-btn').addEventListener('click', () => {
    ui.showModal({
      title: 'Deactivate Licence',
      body: '<p>Are you sure you want to deactivate? The app will lock and you will need your licence key to reactivate.</p>',
      footer: `
        <button class="btn btn-secondary close-modal">Cancel</button>
        <button class="btn btn-danger" id="confirm-deactivate-btn">Deactivate</button>
      `
    });
    document.getElementById('confirm-deactivate-btn').addEventListener('click', () => {
      localStorage.removeItem('stockify_activation');
      ui.toast('Licence deactivated. Reloading...', 'warning');
      setTimeout(() => window.location.reload(), 1000);
    });
  });
}

/* ================================================================
   CHANGE PASSWORD TAB
   ================================================================ */
function renderChangePasswordTab(container) {
  container.innerHTML = `
    <form id="change-password-form" class="card" style="max-width:500px;">
      <div class="form-group">
        <label class="form-label">Current Password</label>
        <input type="password" name="current_password" class="form-input" required autocomplete="current-password">
      </div>
      <div class="form-group">
        <label class="form-label">New Password</label>
        <input type="password" name="new_password" id="new-password-input" class="form-input" required autocomplete="new-password" minlength="8">
        <div class="progress-bar" style="margin-top:4px;"><div id="password-strength-bar" class="progress-bar-fill" style="width:0;"></div></div>
        <small id="password-strength-text"></small>
      </div>
      <div class="form-group">
        <label class="form-label">Confirm New Password</label>
        <input type="password" name="confirm_password" class="form-input" required>
      </div>
      <button type="submit" class="btn btn-primary">Change Password</button>
    </form>`;

  const newPassInput = document.getElementById('new-password-input');
  const strengthBar = document.getElementById('password-strength-bar');
  const strengthText = document.getElementById('password-strength-text');

  newPassInput.addEventListener('input', () => {
    const val = newPassInput.value;
    const { score, max } = passwordStrength(val);
    const percent = (score / max) * 100;
    strengthBar.style.width = percent + '%';
    if (score <= 1) { strengthBar.style.background = '#DC2626'; strengthText.textContent = 'Weak'; }
    else if (score === 2) { strengthBar.style.background = '#D97706'; strengthText.textContent = 'Fair'; }
    else if (score === 3) { strengthBar.style.background = '#2563EB'; strengthText.textContent = 'Good'; }
    else { strengthBar.style.background = '#059669'; strengthText.textContent = 'Strong'; }
  });

  document.getElementById('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const current = formData.get('current_password');
    const newPass = formData.get('new_password');
    const confirm = formData.get('confirm_password');

    if (!current || !newPass || !confirm) {
      ui.toast('All fields are required.', 'error');
      return;
    }
    if (newPass !== confirm) {
      ui.toast('New passwords do not match.', 'error');
      return;
    }
    if (newPass.length < 8 || !/[A-Z]/.test(newPass) || !/[0-9]/.test(newPass) || !/[^A-Za-z0-9]/.test(newPass)) {
      ui.toast('Password must be at least 8 characters with uppercase, number, and special character.', 'error');
      return;
    }

    try {
      await auth.changePassword(current, newPass);
      ui.toast('Password changed successfully.', 'success');
      document.getElementById('change-password-form').reset();
      strengthBar.style.width = '0';
    } catch (err) {
      ui.toast('Error: ' + err.message, 'error');
    }
  });
}

/* ================================================================
   DATA MANAGEMENT TAB (Export/Import/Clear)
   ================================================================ */
function renderDataManagementTab(container) {
  container.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-md);">
      <h3>Export All Data</h3>
      <p>Download a full backup of all your inventory data as a JSON file.</p>
      <button id="export-data-btn" class="btn btn-primary"><i class="fa-solid fa-download"></i> Export Backup</button>
    </div>
    <div class="card" style="margin-bottom:var(--space-md);">
      <h3>Import Data</h3>
      <p>Restore from a previous backup. <strong class="text-danger">This will overwrite all existing data.</strong></p>
      <input type="file" id="import-data-file" accept=".json" class="form-input" style="max-width:400px;">
      <button id="import-data-btn" class="btn btn-secondary" style="margin-top:var(--space-sm);" disabled>
        <i class="fa-solid fa-upload"></i> Import Backup
      </button>
    </div>
    <div class="card border-danger">
      <h3>Clear All Data</h3>
      <p class="text-danger">This permanently deletes all your records. Licence activation will be kept.</p>
      <button id="clear-data-btn" class="btn btn-danger"><i class="fa-solid fa-trash"></i> Clear All Data</button>
    </div>`;

  // Export
  document.getElementById('export-data-btn').addEventListener('click', async () => {
    try {
      const data = await exportAllData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      ui.toast('Backup exported.', 'success');
    } catch (err) {
      ui.toast('Export failed.', 'error');
    }
  });

  // Import file selection
  const fileInput = document.getElementById('import-data-file');
  const importBtn = document.getElementById('import-data-btn');
  let importFile = null;

  fileInput.addEventListener('change', (e) => {
    importFile = e.target.files[0];
    importBtn.disabled = !importFile;
  });

  importBtn.addEventListener('click', async () => {
    if (!importFile) return;
    ui.showModal({
      title: 'Confirm Import',
      body: '<p class="text-danger">This will replace ALL existing data. Are you absolutely sure?</p>',
      footer: `
        <button class="btn btn-secondary close-modal">Cancel</button>
        <button class="btn btn-danger" id="confirm-import-btn">Import</button>
      `
    });
    document.getElementById('confirm-import-btn').addEventListener('click', async () => {
      try {
        const text = await importFile.text();
        const jsonData = JSON.parse(text);
        await importAllData(jsonData);
        ui.toast('Data imported successfully. Reloading recommended.', 'success');
        ui.closeModal();
      } catch (err) {
        ui.toast('Import failed: ' + err.message, 'error');
      }
    });
  });

  // Clear all data
  document.getElementById('clear-data-btn').addEventListener('click', () => {
    ui.showModal({
      title: 'Clear All Data',
      body: `
        <p class="text-danger">This action cannot be undone. All records will be deleted.</p>
        <div class="form-group">
          <label class="form-label">Type <strong>DELETE</strong> to confirm:</label>
          <input type="text" id="delete-confirm-input" class="form-input">
        </div>`,
      footer: `
        <button class="btn btn-secondary close-modal">Cancel</button>
        <button class="btn btn-danger" id="confirm-clear-btn" disabled>Clear All Data</button>
      `
    });

    const confirmInput = document.getElementById('delete-confirm-input');
    const confirmBtn = document.getElementById('confirm-clear-btn');
    confirmInput.addEventListener('input', () => {
      confirmBtn.disabled = confirmInput.value.trim() !== 'DELETE';
    });

    confirmBtn.addEventListener('click', async () => {
      if (confirmInput.value.trim() !== 'DELETE') return;
      try {
        // Delete all stores except app_settings? We'll clear everything but re-seed.
        await db.transaction('rw', db.tables, async () => {
          for (const table of db.tables) {
            await table.clear();
          }
        });
        // Re-seed default admin and settings
        const { seedDatabase } = await import('./db.js'); // re-import seed
        await seedDatabase();
        ui.toast('All data cleared and default admin recreated.', 'success');
        ui.closeModal();
        window.location.hash = '#/dashboard';
      } catch (err) {
        ui.toast('Clear failed: ' + err.message, 'error');
      }
    });
  });
}
