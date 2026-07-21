/**
 * Storage boundary used by the video worker and content endpoint.  Implementations
 * must only deal with safe keys and streams; they never receive HTTP requests or DB.
 */
const VIDEO_STORAGE_METHODS = Object.freeze(['createTemporaryTarget', 'writeStream', 'validateStoredFile', 'commitTemporaryFile', 'exists', 'openReadStream', 'stat', 'remove', 'removeTemporary', 'resolveSafeKey']);
function assertVideoStorage(storage) { for (const method of VIDEO_STORAGE_METHODS) if (typeof storage?.[method] !== 'function') throw new Error(`Video storage is missing ${method}`); return storage; }
module.exports = { VIDEO_STORAGE_METHODS, assertVideoStorage };
