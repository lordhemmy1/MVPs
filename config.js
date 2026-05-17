// config.js – Application constants and licence configuration
// This file is customised per customer by the seller. Do not share your real licence key.

/**
 * LICENCE_KEY_HASH
 * SHA-256 hash (hex string) of the unique licence key assigned to the customer.
 * Generate with: echo -n "YOUR_KEY" | sha256sum | tr -d ' -'
 * Replace the placeholder below with the real hash before delivering to the customer.
 */
export const LICENCE_KEY_HASH = '52d4b0749ee141f756bd5c35ce4f874c1de6a037bc28ff873d433c925095f4c1';

/** Application display name – appears in UI, reports, and topbar */
export const APP_NAME = 'Stockdity Inventory';

/** Current version number – displayed in sidebar and used for cache busting */
export const APP_VERSION = '1.0.0';

/** Default currency symbol (e.g., ₦, $, £) – can be changed in Settings */
export const DEFAULT_CURRENCY_SYMBOL = '₦';

/** Default timezone identifier (e.g., Africa/Lagos) – informational only */
export const DEFAULT_TIMEZONE = 'Africa/Lagos';
