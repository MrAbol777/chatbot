// Origins a developer's own machine and phone use while testing the dev server:
// localhost plus private (RFC 1918) LAN addresses, e.g. http://192.168.1.102:5173
// when opening the Vite "Network" URL from a phone. Only consulted outside production.
const PRIVATE_LAN_HOST = /^(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;

function isDevelopmentOrigin(origin) {
  if (typeof origin !== 'string') return false;
  let url;
  try {
    url = new URL(origin);
  } catch (_error) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Exact origin only: no credentials, path, query or fragment.
  if (url.origin !== origin) return false;
  return PRIVATE_LAN_HOST.test(url.hostname);
}

module.exports = { isDevelopmentOrigin };
