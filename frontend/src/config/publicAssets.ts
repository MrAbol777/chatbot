const publicAssetUrl = (path: string): string => {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${import.meta.env.BASE_URL}${normalizedPath}`;
};

/**
 * Stable, non-bundled files copied from `public/` to the build root by Vite.
 *
 * Keep React-imported, component-specific assets under `src/assets/`.
 * Only assets that need a predictable public URL belong here.
 */
export const PUBLIC_ASSETS = Object.freeze({
  botAvatar: publicAssetUrl('brand/danoa-avatar.png'),
  brandMark: publicAssetUrl('brand/danoa-logo-v2-transparent.png'),
});
