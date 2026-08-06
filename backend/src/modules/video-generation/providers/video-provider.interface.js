function assertVideoProvider(provider) {
  // normalizeResult/fetchResultStream are required by configured storage workers,
  // but remain optional here so old polling-only integrations fail only if a
  // successful result actually reaches storage.
  for (const method of ['getJobStatus', 'normalizeStatus', 'sanitizeError']) {
    if (typeof provider?.[method] !== 'function') throw new Error(`Video provider is missing ${method}`);
  }
  const normalized = Object.create(provider);
  normalized.getProviderKey = typeof provider.getProviderKey === 'function' ? provider.getProviderKey.bind(provider) : () => String(provider.kind || 'legacy');
  normalized.getCapabilities = typeof provider.getCapabilities === 'function' ? provider.getCapabilities.bind(provider) : () => ['video.text_to_video', 'video.image_to_video'];
  normalized.submit = typeof provider.submit === 'function' ? provider.submit.bind(provider) : (input) => input?.capability === 'video.image_to_video' ? provider.submitImageToVideo(input) : provider.submitTextToVideo(input);
  const capabilities = normalized.getCapabilities();
  if (!Array.isArray(capabilities) || capabilities.some((value) => !['video.text_to_video', 'video.image_to_video', 'video.image_to_video_multi'].includes(value))) {
    throw new Error('Video provider capabilities are invalid.');
  }
  return normalized;
}
module.exports = { assertVideoProvider };
