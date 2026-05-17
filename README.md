**README.md**

# Stockify Inventory

**Smart inventory, zero infrastructure** – a production-ready, offline-capable Inventory Management System for small to medium retail shops, pharmacies, minimarkets, and warehouses. Built entirely with vanilla HTML5, CSS3, and JavaScript ES6+, Stockify runs directly in the browser, stores all data in IndexedDB, and can be deployed on any static web host without servers, databases, or monthly fees.

---

## Table of Contents

- [Key Features](#key-features)
- [System Requirements](#system-requirements)
- [Quick Start (for Buyers)](#quick-start-for-buyers)
- [Licence Activation](#licence-activation)
- [Default Login](#default-login)
- [Offline Usage](#offline-usage)
- [Security Model](#security-model)
- [Technology Stack](#technology-stack)
- [Licence & Updates](#licence--updates)
- [Support](#support)

---

## Key Features

- **Complete Inventory Lifecycle**  
  Products, categories, suppliers, stock in/out/adjustments, batch expiry tracking, low‑stock alerts, barcode support, and image uploads.

- **Point of Sale (POS)**  
  Fast sales entry with cart, payment method tracking, printable receipts, and void functionality. Sales history with filters.

- **Real‑time Dashboard**  
  KPI cards (total products, stock value, low stock, expiring soon, today’s revenue), sales trend chart, top‑selling products, category distribution, and alert panels.

- **Reports**  
  11 built‑in report types (daily/weekly/monthly sales, inventory status, out‑of‑stock, low stock, expiry, best sellers, stock movement, supplier). All reports exportable to CSV and PDF with branded headers.

- **User & Role Management**  
  Three roles – admin, manager, staff – with granular access control. Force password change on first login, password strength meter, and client‑side rate limiting.

- **Notifications & Email Alerts**  
  Low‑stock and expiry notifications appear in the bell dropdown and on a dedicated page. Optional EmailJS integration sends email alerts.

- **Audit Logs**  
  Every critical action (create, update, delete, login, logout, void) is logged with user, timestamp, and before/after values.

- **Data Import / Export**  
  Bulk import products via CSV (with validation), export products to CSV, full database backup/restore as JSON.

- **Licence Protection**  
  One‑time purchase licence key, validated with SHA‑256 hash. Activation locks the app to a specific business name.

- **Fully Offline**  
  Service Worker caches the entire app. All data lives in IndexedDB. Works without internet after first load.

- **PWA Installable**  
  Manifest enables “Add to Home Screen” on mobile and desktop.

- **No Backend, No Database**  
  Single‑tenant, self‑contained. Deploy to GitHub Pages, Netlify, or any static host.

---

## System Requirements

- A modern web browser: Chrome 90+, Firefox 90+, Edge 90+, Safari 15+
- JavaScript enabled, IndexedDB available (all modern browsers support it)
- 2 MB of free disk space (for the app files) + data storage grows with usage

---

## Quick Start (for Buyers)

1. **Download** the latest release ZIP file from the seller.
2. **Extract** the contents into a folder on your computer.
3. **Deploy** the folder to any static web server (see [DEPLOY.md](DEPLOY.md) for detailed instructions for Netlify, GitHub Pages, cPanel, etc.).
4. **Open** your site in a browser. You will see the activation screen.
5. **Enter** your business name and the licence key provided by the seller.
6. **Click Activate**. The app unlocks and shows the login page.
7. **Log in** with the default admin credentials (see below).
8. **Change the admin password** immediately.
9. **Configure** your business profile, currency, and low‑stock threshold in Settings.

That’s it – you’re ready to manage your inventory.

---

## Licence Activation

The application requires a valid licence key to function. On first load, an activation overlay blocks access. The key is validated against a SHA‑256 hash embedded in `config.js`. The original key is never stored in the source code.

- **Licence key** – a unique, human‑readable string assigned to your business.
- **Business name** – displayed in reports and the topbar; stored in the activation record.
- Activation is stored in `localStorage`. If you clear your browser data, you will need to re‑enter the key.

**Deactivation:**  
You can deactivate the licence from the Settings → Licence tab. This clears the activation record and returns you to the activation screen (useful for transferring the licence to a new domain or reinstallation).

---

## Default Login

The database is seeded with one administrator account:

- **Email:** `admin@app.com`
- **Password:** `Admin@1234`

You will be forced to change this password on first login.

---

## Offline Usage

Once the app is loaded in the browser, it works fully offline. The Service Worker pre‑caches all HTML, CSS, JS, and font files. All data operations go through IndexedDB, which is a local database built into the browser. No internet connection is required for day‑to‑day use.

A subtle “You are offline” banner appears when the network is disconnected.

---

## Security Model

**Important:** Stockify is a client‑side application with no server‑side enforcement. It is designed for trusted users on a private network or behind a web server that provides authentication (e.g., htpasswd, Cloudflare Access). **Do not expose it directly to the public internet without adding an authentication layer in front of it.**

Within these constraints, we implement:

- **Client‑side role checks** – the UI hides admin‑only pages, but the checks are not a substitute for server‑side authorization.
- **Password hashing** – SHA‑256 with a random 16‑byte salt via Web Crypto API. Passwords are never stored as plaintext.
- **Input sanitization** – all dynamic content is rendered via `textContent` or passed through an HTML entity encoder to prevent XSS.
- **Licence key hash** – only the SHA‑256 hash of the key is stored in `config.js`.
- **Rate limiting** – login attempts per email are tracked in localStorage, with temporary lockout after 5 failed attempts.

---

## Technology Stack

- **HTML5, CSS3, Vanilla JavaScript ES6+** – no frameworks, no jQuery
- **IndexedDB** (via Dexie.js 3.x) – client‑side database
- **Chart.js 4.x** – charts on dashboard and reports
- **jsPDF 2.x + AutoTable** – PDF export
- **PapaParse 5.x** – CSV parsing for product import
- **Font Awesome 6 Free** – icon library
- **Inter** font via Google Fonts
- **Web Crypto API** – password hashing and licence validation
- **Service Worker + Cache API** – offline support

All third‑party libraries are loaded from CDNs with pinned versions.

---

## Licence & Updates

Stockify is sold as a **one‑time purchase**. The buyer receives a licence key and the complete source code. The seller may offer optional paid upgrades for lifetime updates.

The `config.js` file is the only file customised per customer. It contains the hashed licence key, app name, version, and default currency/timezone.

---

## Support

For assistance with deployment, licence issues, or custom modifications, contact the seller from whom you purchased the licence.

*Thank you for choosing Stockify!*

File complete. Send 'continue' for the next file.
