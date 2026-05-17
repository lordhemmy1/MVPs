// users.js – User management (admin only): list, add, edit, deactivate, reset password
import { db } from './db.js';
import { ui } from './ui.js';
import { sanitize, validate, validateEmail, generateId } from './utils.js';
import { auth } from './auth.js';

let currentUserList = [];
let currentPage = 1;
const PER_PAGE = 20;

export async function init() {
  const container = document.getElementById('app-content');
  if (!container) return;

  if (!auth.hasRole('admin')) {
    container.innerHTML = '<p class="text-danger">Access denied.</p>';
    return;
  }

  ui.showSpinner();
  try {
    await renderUserList(container);
  } catch (err) {
    console.error(err);
    ui.toast('Failed to load users.', 'error');
  } finally {
    ui.hideSpinner();
  }
}

export function destroy() {}

/* ================================================================
   RENDER USER LIST PAGE
   ================================================================ */
async function renderUserList(container) {
  container.innerHTML = `
    <div class="users-page">
      <h2>User Management</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:var(--space-md);">
        <button id="add-user-btn" class="btn btn-primary"><i class="fa-solid fa-user-plus"></i> Add User</button>
      </div>
      <div id="users-table-container"></div>
    </div>`;

  const tableContainer = document.getElementById('users-table-container');

  async function fetchAndRender() {
    const users = await db.users.orderBy('name').toArray();
    currentUserList = users;

    const totalPages = Math.ceil(users.length / PER_PAGE) || 1;
    const start = (currentPage - 1) * PER_PAGE;
    const paged = users.slice(start, start + PER_PAGE);

    const columns = [
      { key: 'avatar', label: '', sortable: false, render: (_, user) => `<div class="avatar avatar-sm" style="background:${stringToColor(user.name)};">${user.avatar_initials || getInitials(user.name)}</div>` },
      { key: 'name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role', render: val => `<span class="badge ${val==='admin'?'badge-danger':val==='manager'?'badge-warning':'badge-info'}">${val}</span>` },
      { key: 'is_active', label: 'Status', render: val => val ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>' },
      { key: 'last_login', label: 'Last Login', render: val => val ? new Date(val).toLocaleDateString() : '—' },
      { key: 'actions', label: '', render: (_, user) => `
        <button class="btn btn-ghost btn-sm edit-user-btn" data-id="${user.id}"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost btn-sm reset-password-btn" data-id="${user.id}"><i class="fa-solid fa-key"></i></button>
        ${user.id !== auth.getCurrentUser().id ? `<button class="btn btn-ghost btn-sm toggle-active-btn" data-id="${user.id}" data-active="${user.is_active}">
          <i class="fa-solid ${user.is_active ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted'}"></i>
        </button>` : '<span class="btn btn-ghost btn-sm disabled" title="Cannot deactivate yourself"><i class="fa-solid fa-toggle-off text-muted"></i></span>'}
      `}
    ];

    ui.renderTable({
      container: tableContainer,
      columns,
      data: paged,
      page: currentPage,
      perPage: PER_PAGE,
      totalItems: users.length,
      onPageChange: (p) => { currentPage = p; fetchAndRender(); },
      emptyMessage: 'No users found.'
    });

    // Bind action buttons
    bindUserActions();
  }

  function bindUserActions() {
    document.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const user = currentUserList.find(u => u.id === id);
        if (user) openUserModal(user);
      });
    });
    document.querySelectorAll('.reset-password-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const user = currentUserList.find(u => u.id === id);
        if (user) openResetPasswordModal(user);
      });
    });
    document.querySelectorAll('.toggle-active-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const active = btn.dataset.active === 'true';
        toggleUserActive(id, !active);
      });
    });
  }

  document.getElementById('add-user-btn').addEventListener('click', () => openUserModal(null));

  await fetchAndRender();
}

/* ================================================================
   ADD / EDIT USER MODAL
   ================================================================ */
function openUserModal(user = null) {
  const isEdit = !!user;
  const title = isEdit ? 'Edit User' : 'Add User';

  let bodyHTML = `
    <form id="user-form">
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input type="text" name="name" class="form-input" value="${sanitize(user?.name || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label">Email *</label>
        <input type="email" name="email" class="form-input" value="${sanitize(user?.email || '')}" required ${isEdit ? '' : 'autocomplete="new-email"'}>
      </div>
      <div class="form-group">
        <label class="form-label">Role *</label>
        <select name="role" class="form-select" required>
          <option value="staff" ${user?.role === 'staff' ? 'selected' : ''}>Staff</option>
          <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Manager</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>`;

  if (!isEdit) {
    bodyHTML += `
      <div class="form-group">
        <label class="form-label">Initial Password *</label>
        <input type="password" name="password" class="form-input" required autocomplete="new-password" minlength="8">
        <small class="form-text text-muted">Minimum 8 characters. User must change on first login.</small>
      </div>`;
  }

  bodyHTML += `</form>`;

  ui.showModal({
    title,
    body: bodyHTML,
    footer: `
      <button class="btn btn-secondary close-modal">Cancel</button>
      <button class="btn btn-primary" id="save-user-btn">${isEdit ? 'Update' : 'Create'}</button>
    `,
    size: 'small'
  });

  document.getElementById('save-user-btn').addEventListener('click', async () => {
    const form = document.getElementById('user-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Validation
    const rules = [
      { field: 'name', type: 'required', message: 'Name is required.' },
      { field: 'email', type: 'required', message: 'Email is required.' },
      { field: 'email', type: 'email' },
      { field: 'role', type: 'required' }
    ];
    if (!isEdit) {
      rules.push({ field: 'password', type: 'required', message: 'Password required.' });
      rules.push({ field: 'password', type: 'minLength', value: 8 });
    }
    const validation = validate(rules, data);
    if (!validation.isValid) {
      Object.entries(validation.errors).forEach(([field, msg]) => ui.showFieldError(field, msg));
      return;
    }

    // Check email uniqueness (excluding current user if editing)
    const existing = await db.users.where('email').equals(data.email.toLowerCase().trim()).first();
    if (existing && (!isEdit || existing.id !== user.id)) {
      ui.showFieldError('email', 'Email already in use.');
      return;
    }

    try {
      if (isEdit) {
        await db.users.update(user.id, {
          name: data.name,
          email: data.email.toLowerCase().trim(),
          role: data.role,
          avatar_initials: getInitials(data.name)
        });
        ui.toast('User updated.', 'success');
      } else {
        // Create new user with hashed password and force_password_change = true
        const salt = await auth.generateSalt();
        const hash = await auth.hashPassword(data.password, salt);
        await db.users.add({
          name: data.name,
          email: data.email.toLowerCase().trim(),
          password_hash: hash,
          password_salt: salt,
          role: data.role,
          is_active: true,
          avatar_initials: getInitials(data.name),
          force_password_change: true,
          last_login: null,
          created_at: new Date().toISOString()
        });
        ui.toast('User created. They must change password on first login.', 'success');
      }
      ui.closeModal();
      // Refresh list
      await renderUserList(document.getElementById('app-content'));
    } catch (err) {
      ui.toast('Error saving user: ' + err.message, 'error');
    }
  });
}

/* ================================================================
   RESET PASSWORD MODAL (admin sets new password directly)
   ================================================================ */
function openResetPasswordModal(user) {
  ui.showModal({
    title: `Reset Password for ${sanitize(user.name)}`,
    body: `
      <form id="reset-password-form">
        <div class="form-group">
          <label class="form-label">New Password *</label>
          <input type="password" name="new_password" class="form-input" required minlength="8" autocomplete="new-password">
          <small>Minimum 8 characters. User must change on next login.</small>
        </div>
      </form>`,
    footer: `
      <button class="btn btn-secondary close-modal">Cancel</button>
      <button class="btn btn-primary" id="confirm-reset-btn">Reset</button>
    `
  });

  document.getElementById('confirm-reset-btn').addEventListener('click', async () => {
    const password = document.querySelector('input[name="new_password"]').value.trim();
    if (!password || password.length < 8) {
      ui.showFieldError('new_password', 'Password must be at least 8 characters.');
      return;
    }
    try {
      const salt = await auth.generateSalt();
      const hash = await auth.hashPassword(password, salt);
      await db.users.update(user.id, {
        password_hash: hash,
        password_salt: salt,
        force_password_change: true
      });
      ui.toast('Password reset. User must change on next login.', 'success');
      ui.closeModal();
    } catch (err) {
      ui.toast('Reset failed.', 'error');
    }
  });
}

/* ================================================================
   TOGGLE USER ACTIVE/INACTIVE
   ================================================================ */
async function toggleUserActive(userId, makeActive) {
  const user = await db.users.get(userId);
  if (!user) return;
  if (!makeActive && user.id === auth.getCurrentUser().id) {
    ui.toast('You cannot deactivate your own account.', 'warning');
    return;
  }
  try {
    await db.users.update(userId, { is_active: makeActive });
    ui.toast(`User ${makeActive ? 'activated' : 'deactivated'}.`, 'success');
    // Refresh list
    await renderUserList(document.getElementById('app-content'));
  } catch (err) {
    ui.toast('Failed to update status.', 'error');
  }
}

/* ================================================================
   HELPER: get initials from name
   ================================================================ */
function getInitials(name) {
  if (!name) return 'NA';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/* Helper: generate color from name for avatar */
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 50%, 50%)`;
}
