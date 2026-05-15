// auth.js – Authentication, session management, login/logout, password hashing, rate limiting
import { db, getSetting } from './db.js';
import { sanitize } from './utils.js';

// Session storage key
const SESSION_KEY = 'auth_user';

// Rate limiting settings
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000;   // 15 minutes

/* ---------------------------------------------------------------
   PASSWORD HASHING (Web Crypto API - SHA-256 with random salt)
   --------------------------------------------------------------- */
async function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  // Convert salt hex to Uint8Array
  const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const passwordBytes = encoder.encode(password);
  // Concatenate salt + password
  const combined = new Uint8Array(saltBytes.length + passwordBytes.length);
  combined.set(saltBytes);
  combined.set(passwordBytes, saltBytes.length);
  // Hash with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(plainPassword, storedSaltHex, storedHashHex) {
  const computedHash = await hashPassword(plainPassword, storedSaltHex);
  // Timing-safe comparison: convert both to same length arrays and compare
  const a = new TextEncoder().encode(computedHash);
  const b = new TextEncoder().encode(storedHashHex);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/* ---------------------------------------------------------------
   RATE LIMITING (localStorage)
   --------------------------------------------------------------- */
function getAttempts(email) {
  const key = `login_attempts_${email}`;
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (!data) return [];
    // Filter attempts within the window
    const now = Date.now();
    const valid = data.filter(ts => now - ts < ATTEMPT_WINDOW_MS);
    // Save back only valid attempts
    localStorage.setItem(key, JSON.stringify(valid));
    return valid;
  } catch {
    return [];
  }
}

function recordAttempt(email) {
  const key = `login_attempts_${email}`;
  const attempts = getAttempts(email);
  attempts.push(Date.now());
  localStorage.setItem(key, JSON.stringify(attempts));
}

function isBlocked(email) {
  const key = `login_blocked_${email}`;
  const blockUntil = parseInt(localStorage.getItem(key) || '0', 10);
  if (blockUntil && Date.now() < blockUntil) {
    return true;
  }
  // Clear expired block
  if (blockUntil) localStorage.removeItem(key);
  return false;
}

function setBlocked(email) {
  const key = `login_blocked_${email}`;
  localStorage.setItem(key, Date.now() + BLOCK_DURATION_MS);
  // Clear attempts as well
  localStorage.removeItem(`login_attempts_${email}`);
}

function clearAttempts(email) {
  localStorage.removeItem(`login_attempts_${email}`);
  localStorage.removeItem(`login_blocked_${email}`);
}

/* ---------------------------------------------------------------
   SESSION MANAGEMENT
   --------------------------------------------------------------- */
function setSession(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function getCurrentUser() {
  try {
    const data = sessionStorage.getItem(SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function isLoggedIn() {
  return !!getCurrentUser();
}

function hasRole(minRole) {
  const user = getCurrentUser();
  if (!user) return false;
  const roles = ['staff', 'manager', 'admin'];
  const userIndex = roles.indexOf(user.role);
  const requiredIndex = roles.indexOf(minRole);
  return userIndex >= requiredIndex;
}

function userMustChangePassword() {
  const user = getCurrentUser();
  // Additional DB query to check force_password_change flag? 
  // We'll store this flag in the session user object if present.
  // The session user object initially set on login includes 'force_password_change' if true.
  return user && user.force_password_change === true;
}

/* ---------------------------------------------------------------
   ACTIVATION CHECK (licence)
   --------------------------------------------------------------- */
function isActivated() {
  return !!localStorage.getItem('stockify_activation');
}

/* ---------------------------------------------------------------
   LOGIN FLOW
   --------------------------------------------------------------- */
async function login(email, password) {
  // Sanitize email (lowercase, trim)
  const cleanEmail = email.trim().toLowerCase();

  // Rate limiting check
  if (isBlocked(cleanEmail)) {
    const blockUntil = parseInt(localStorage.getItem(`login_blocked_${cleanEmail}`), 10);
    const remaining = Math.ceil((blockUntil - Date.now()) / 1000 / 60);
    throw new Error(`Account temporarily locked. Try again in ${remaining} minute(s).`);
  }

  // Check attempts before proceeding
  const attempts = getAttempts(cleanEmail);
  if (attempts.length >= MAX_ATTEMPTS) {
    setBlocked(cleanEmail);
    throw new Error('Too many failed attempts. Account locked for 15 minutes.');
  }

  // Find user by email
  const user = await db.users.where('email').equals(cleanEmail).first();
  if (!user) {
    recordAttempt(cleanEmail);
    throw new Error('Invalid email or password.');
  }
  if (!user.is_active) {
    recordAttempt(cleanEmail);
    throw new Error('Account is deactivated. Contact administrator.');
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) {
    recordAttempt(cleanEmail);
    throw new Error('Invalid email or password.');
  }

  // Success – clear attempts and update last login
  clearAttempts(cleanEmail);
  const now = new Date().toISOString();
  await db.users.update(user.id, { last_login: now });

  // Prepare session user object (minimal, no password)
  const sessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar_initials: user.avatar_initials,
    force_password_change: user.force_password_change || false
  };

  setSession(sessionUser);

  // Audit log (login)
  await writeAuditLog({
    user_id: user.id,
    user_name_snapshot: user.name,
    action: 'login',
    entity_type: 'user',
    entity_id: user.id,
    new_values: JSON.stringify({ last_login: now })
  });

  return sessionUser;
}

function logout() {
  const user = getCurrentUser();
  if (user) {
    // Audit log logout
    writeAuditLog({
      user_id: user.id,
      user_name_snapshot: user.name,
      action: 'logout',
      entity_type: 'user',
      entity_id: user.id
    }).catch(() => {});
  }
  clearSession();
  window.location.hash = '#/login';
}

/* ---------------------------------------------------------------
   PASSWORD CHANGE
   --------------------------------------------------------------- */
async function changePassword(currentPassword, newPassword) {
  const sessionUser = getCurrentUser();
  if (!sessionUser) throw new Error('Not logged in.');

  const user = await db.users.get(sessionUser.id);
  if (!user) throw new Error('User not found.');

  // Verify current password
  const valid = await verifyPassword(currentPassword, user.password_salt, user.password_hash);
  if (!valid) throw new Error('Current password is incorrect.');

  // Generate new salt and hash
  const newSalt = await generateSalt();
  const newHash = await hashPassword(newPassword, newSalt);

  // Update in DB
  await db.users.update(user.id, {
    password_hash: newHash,
    password_salt: newSalt,
    force_password_change: false
  });

  // Update session
  sessionUser.force_password_change = false;
  setSession(sessionUser);

  // Audit log
  await writeAuditLog({
    user_id: user.id,
    user_name_snapshot: user.name,
    action: 'update',
    entity_type: 'user',
    entity_id: user.id,
    old_values: JSON.stringify({ password_changed: true }),
    new_values: JSON.stringify({ password_changed: true })
  });
}

/* ---------------------------------------------------------------
   AUDIT LOG HELPER (internal)
   --------------------------------------------------------------- */
async function writeAuditLog({ user_id, user_name_snapshot, action, entity_type, entity_id, old_values = null, new_values = null }) {
  try {
    await db.audit_logs.add({
      user_id,
      user_name_snapshot,
      action,
      entity_type,
      entity_id: entity_id || null,
      old_values: old_values ? (typeof old_values === 'string' ? old_values : JSON.stringify(old_values)) : null,
      new_values: new_values ? (typeof new_values === 'string' ? new_values : JSON.stringify(new_values)) : null,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Failed to write audit log:', e);
  }
}

/* ---------------------------------------------------------------
   LOGIN PAGE RENDERING
   --------------------------------------------------------------- */
function showLoginPage() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  // Simple login form
  appContent.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card card">
        <div class="login-logo">
          <img src="assets/images/logo-placeholder.png" alt="Stockify" class="logo-img">
          <h2>Stockify Inventory</h2>
          <p>Sign in to your account</p>
        </div>
        <form id="login-form" novalidate>
          <div class="form-group">
            <label for="login-email" class="form-label">Email</label>
            <input type="email" id="login-email" class="form-input" required autocomplete="email" placeholder="you@example.com">
          </div>
          <div class="form-group">
            <label for="login-password" class="form-label">Password</label>
            <input type="password" id="login-password" class="form-input" required autocomplete="current-password" placeholder="••••••••">
          </div>
          <div id="login-error" class="login-error hidden"></div>
          <button type="submit" class="btn btn-primary btn-block" id="login-submit-btn">
            <i class="fa-solid fa-right-to-bracket"></i> Sign In
          </button>
        </form>
        <p class="login-help">
          Default admin: admin@app.com / Admin@1234
        </p>
      </div>
    </div>`;

  // Bind login form event
  const loginForm = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    // Basic validation
    if (!email || !password) {
      errorEl.textContent = 'Please fill in both fields.';
      errorEl.classList.remove('hidden');
      return;
    }

    const submitBtn = document.getElementById('login-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
    errorEl.classList.add('hidden');

    try {
      await login(email, password);
      // On success, navigate to dashboard
      window.location.hash = '#/dashboard';
    } catch (err) {
      errorEl.textContent = sanitize(err.message);
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
    }
  });
}

/* ---------------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------------- */
export const auth = {
  login,
  logout,
  isLoggedIn,
  getCurrentUser,
  hasRole,
  userMustChangePassword,
  isActivated,
  changePassword,
  showLoginPage,
  // Expose hash functions for user management (password reset)
  generateSalt,
  hashPassword
};
