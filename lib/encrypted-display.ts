/**
 * Placeholder shown in the UI when payee/notes are ciphertext and the privacy key
 * is not available. Kept separate from the IndexedDB cache module so UI bundles
 * do not pull in `idb` / cache helpers.
 */
export const ENCRYPTED_DISPLAY = "(encrypted)"
