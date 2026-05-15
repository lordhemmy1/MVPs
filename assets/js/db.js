// db.js – Dexie database instance, schema, seed function, and export utilities
import { APP_NAME, APP_VERSION } from '../../config.js';

// Define database
const db = new Dexie('StockifyDB');

db.version(1).stores({
  users: '++id, email, role, is_active',
  categories: '++id, name',
  suppliers: '++id, name, is_active',
  products: '++id, category_id, supplier_id, sku, is_active, expiry_date, quantity',
  stock_movements: '++id, product_id, user_id, type, created_at',
  sales: '++id, user_id, status, created_at, payment_method',
  sale_items: '++id, sale_id, product_id',
  notifications: '++id, user_id, type, is_read, created_at',
  audit_logs: '++id, user_id, entity_type, created_at',
  app_settings: 'key'  // primary key is 'key', no auto-increment
});

// Optional: upgrade hooks for future schema changes can be added here

// Seed function – runs only if users store is empty
async function seedDatabase() {
  const userCount = await db.users.count();
  if (userCount > 0) return;

  console.log('Seeding default data...');

  // Default admin account: admin@app.com / Admin@1234 (hashed with salt)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordData = encoder.encode('Admin@1234');
  // Combine salt + password
  const combined = new Uint8Array(salt.length + passwordData.length);
  combined.set(salt);
  combined.set(passwordData, salt.length);
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.users.add({
    name: 'Admin',
    email: 'admin@app.com',
    password_hash: hashHex,
    password_salt: saltHex,
    role: 'admin',
    is_active: true,
    avatar_initials: 'AD',
    last_login: null,
    created_at: new Date().toISOString(),
    force_password_change: true
  });

  // Default settings
  const defaultSettings = [
    { key: 'business_name', value: 'My Store' },
    { key: 'business_address', value: '' },
    { key: 'business_phone', value: '' },
    { key: 'business_email', value: '' },
    { key: 'business_logo_base64', value: '' },
    { key: 'default_low_stock_threshold', value: '10' },
    { key: 'currency_symbol', value: '$' },
    { key: 'date_format', value: 'DD/MM/YYYY' },
    { key: 'emailjs_service_id', value: '' },
    { key: 'emailjs_template_id_lowstock', value: '' },
    { key: 'emailjs_template_id_expiry', value: '' },
    { key: 'emailjs_public_key', value: '' },
    { key: 'email_alerts_enabled', value: 'false' },
    { key: 'primary_color', value: '#4F46E5' },
    { key: 'sidebar_collapsed', value: 'false' }
  ];

  await db.app_settings.bulkPut(defaultSettings);

  // Optionally create a default category and supplier for convenience
  await db.categories.add({ name: 'General', description: 'Default category', created_at: new Date().toISOString() });
  await db.suppliers.add({ name: 'Default Supplier', contact_person: '', phone: '', email: '', address: '', is_active: true, created_at: new Date().toISOString() });

  console.log('Seeding complete.');
}

// Export full database for backup (returns a JSON object with all stores)
async function exportAllData() {
  const data = {};
  const tables = db.tables.map(t => t.name);
  for (const tableName of tables) {
    data[tableName] = await db.table(tableName).toArray();
  }
  return data;
}

// Import data from backup JSON (overwrites existing data after clearing)
async function importAllData(jsonData) {
  // Validation: must contain all store names
  const expectedStores = ['users', 'categories', 'suppliers', 'products', 'stock_movements',
    'sales', 'sale_items', 'notifications', 'audit_logs', 'app_settings'];
  for (const store of expectedStores) {
    if (!(store in jsonData)) {
      throw new Error(`Invalid backup file: missing store "${store}"`);
    }
  }

  await db.transaction('rw', db.tables, async () => {
    // Clear all tables first
    for (const table of db.tables) {
      await table.clear();
    }
    // Bulk add data
    for (const [tableName, rows] of Object.entries(jsonData)) {
      if (rows.length > 0) {
        await db.table(tableName).bulkAdd(rows);
      }
    }
  });
}

// Helper to get a setting value by key (with optional default)
async function getSetting(key, defaultValue = null) {
  const setting = await db.app_settings.get(key);
  return setting ? setting.value : defaultValue;
}

// Helper to set a setting value
async function setSetting(key, value) {
  await db.app_settings.put({ key, value });
}

// Initialize database on module load
seedDatabase();

// Exports
export { db, seedDatabase, exportAllData, importAllData, getSetting, setSetting };
