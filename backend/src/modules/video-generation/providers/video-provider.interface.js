function assertVideoProvider(provider) {
  // normalizeResult/fetchResultStream are required by configured storage workers,
  // but remain optional here so old polling-only integrations fail only if a
  // successful result actually reaches storage.
  for (const method of ['submitTextToVideo', 'submitImageToVideo', 'getJobStatus', 'normalizeStatus', 'sanitizeError']) {
    if (typeof provider?.[method] !== 'function') throw new Error(`Video provider is missing ${method}`);
  }
  return provider;
}
module.exports = { assertVideoProvider };
