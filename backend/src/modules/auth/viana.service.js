const crypto = require('crypto');

class VianaProtocolError extends Error {
  constructor(code, message, { status = 502, retryable = false, oauthError = null } = {}) {
    super(message);
    this.name = 'VianaProtocolError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.oauthError = oauthError;
  }
}

function parseAbsoluteHttpsUrl(value, name) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid');
    return url;
  } catch {
    throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', `Viana Discovery returned an invalid ${name}.`);
  }
}

function decodeJsonPart(value, code) {
  try {
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch {
    throw new VianaProtocolError(code, 'Viana returned an invalid ID token.');
  }
}

function validateStudentSelf(value) {
  const profile = value?.data && typeof value.data === 'object' ? value.data : value;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new VianaProtocolError('VIANA_STUDENT_SELF_INVALID', 'Viana student response is not an object.');
  }
  for (const key of ['id', 'firstName', 'lastName', 'dateOfBirth']) {
    if (typeof profile[key] !== 'string' || !profile[key].trim()) {
      throw new VianaProtocolError('VIANA_STUDENT_SELF_INVALID', `Viana student field ${key} is invalid.`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) {
    throw new VianaProtocolError('VIANA_STUDENT_SELF_INVALID', 'Viana student dateOfBirth is invalid.');
  }
  const [year, month, day] = profile.dateOfBirth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new VianaProtocolError('VIANA_STUDENT_SELF_INVALID', 'Viana student dateOfBirth is not a calendar date.');
  }
  return {
    sub: typeof profile.id === 'string' && profile.id.trim() ? profile.id.trim() : '',
    firstName: profile.firstName.trim(),
    lastName: profile.lastName.trim(),
    dateOfBirth: profile.dateOfBirth,
    grade: typeof profile.grade === 'string' && profile.grade.trim() ? profile.grade.trim() : null,
    gender: ['MALE', 'FEMALE'].includes(profile.gender) ? profile.gender : null
  };
}

function calculateGregorianAge(dateOfBirth, currentDate = new Date()) {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  let age = currentDate.getUTCFullYear() - year;
  const currentMonth = currentDate.getUTCMonth() + 1;
  const currentDay = currentDate.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 130) {
    throw new VianaProtocolError('VIANA_STUDENT_SELF_INVALID', 'Viana dateOfBirth yields an invalid age.');
  }
  return age;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (text.length > 64 * 1024) throw new VianaProtocolError('VIANA_RESPONSE_TOO_LARGE', 'Viana returned an oversized response.');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new VianaProtocolError('VIANA_RESPONSE_MALFORMED', `Viana returned non-JSON HTTP ${response.status}.`, { retryable: response.status >= 500 });
  }
}

function mapHttpError(response, body, phase) {
  const oauthError = typeof body?.error === 'string' ? body.error : null;
  return new VianaProtocolError(`VIANA_${phase.toUpperCase()}_FAILED`, `Viana ${phase} request failed.`, {
    status: response.status,
    retryable: response.status === 429 || response.status >= 500 || oauthError === 'temporarily_unavailable',
    oauthError
  });
}

function createVianaService({ config, fetchImpl = globalThis.fetch, now = () => new Date(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let discoveryPromise = null;

  const request = async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    timeout.unref?.();
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new VianaProtocolError('VIANA_TIMEOUT', 'Viana request timed out.', { retryable: true });
      throw new VianaProtocolError('VIANA_NETWORK_ERROR', 'Viana request failed.', { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  };

  const getDiscovery = async () => {
    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        const response = await request(config.discoveryUrl, { headers: { Accept: 'application/json' } });
        const body = await readJsonResponse(response);
        if (!response.ok) throw mapHttpError(response, body, 'discovery');
        const issuer = parseAbsoluteHttpsUrl(body?.issuer, 'issuer');
        if (issuer.origin !== new URL(config.discoveryUrl).origin) throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', 'Viana Discovery issuer is not trusted.');
        const result = {
          issuer: issuer.origin,
          authorizationUrl: parseAbsoluteHttpsUrl(body?.authorization_endpoint, 'authorization_endpoint').toString(),
          tokenUrl: parseAbsoluteHttpsUrl(body?.token_endpoint, 'token_endpoint').toString(),
          userInfoUrl: parseAbsoluteHttpsUrl(body?.userinfo_endpoint, 'userinfo_endpoint').toString(),
          jwksUrl: parseAbsoluteHttpsUrl(body?.jwks_uri, 'jwks_uri').toString(),
          codeChallengeMethods: Array.isArray(body?.code_challenge_methods_supported) ? body.code_challenge_methods_supported : [],
          responseTypes: Array.isArray(body?.response_types_supported) ? body.response_types_supported : [],
          tokenAuthMethods: Array.isArray(body?.token_endpoint_auth_methods_supported) ? body.token_endpoint_auth_methods_supported : []
        };
        if (!result.responseTypes.includes('code') || !result.codeChallengeMethods.includes('S256') || !result.tokenAuthMethods.includes('client_secret_basic')) {
          throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', 'Viana Discovery does not support the required Confidential Web flow.');
        }
        return result;
      })().catch((error) => {
        discoveryPromise = null;
        throw error;
      });
    }
    return discoveryPromise;
  };

  const verifyIdToken = async ({ idToken, nonce, discovery }) => {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new VianaProtocolError('VIANA_ID_TOKEN_INVALID', 'Viana returned an invalid ID token.');
    const header = decodeJsonPart(parts[0], 'VIANA_ID_TOKEN_INVALID');
    const claims = decodeJsonPart(parts[1], 'VIANA_ID_TOKEN_INVALID');
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string' || !header.kid) {
      throw new VianaProtocolError('VIANA_ID_TOKEN_INVALID', 'Viana ID token signing metadata is invalid.');
    }
    const jwksResponse = await request(discovery.jwksUrl, { headers: { Accept: 'application/json' } });
    const jwks = await readJsonResponse(jwksResponse);
    if (!jwksResponse.ok || !Array.isArray(jwks?.keys)) throw new VianaProtocolError('VIANA_JWKS_INVALID', 'Viana signing keys are unavailable.', { retryable: jwksResponse.status >= 500 });
    const key = jwks.keys.find((item) => item?.kid === header.kid && item?.kty === 'RSA' && item?.use !== 'enc');
    if (!key) throw new VianaProtocolError('VIANA_ID_TOKEN_INVALID', 'Viana ID token key is unknown.', { retryable: true });
    let verified = false;
    try {
      verified = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch {}
    if (!verified) throw new VianaProtocolError('VIANA_ID_TOKEN_INVALID', 'Viana ID token signature is invalid.');
    const timestamp = Math.floor(now().getTime() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== discovery.issuer || !audience.includes(config.clientId) || claims.nonce !== nonce || !Number.isFinite(claims.exp) || claims.exp <= timestamp || !Number.isFinite(claims.iat) || claims.iat > timestamp + 60) {
      throw new VianaProtocolError('VIANA_ID_TOKEN_INVALID', 'Viana ID token claims are invalid.');
    }
    return claims;
  };

  const generateAuthorizationRequest = async () => {
    const discovery = await getDiscovery();
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const url = new URL(discovery.authorizationUrl);
    for (const [name, value] of Object.entries({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, scope: 'openid profile student.self:read', state, nonce, code_challenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(name, value);
    return { state, nonce, codeVerifier, authorizationUrl: url.toString() };
  };

  const exchangeCode = async ({ code, codeVerifier, nonce }) => {
    const discovery = await getDiscovery();
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const response = await request(discovery.tokenUrl, {
      method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: codeVerifier })
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw mapHttpError(response, body, 'token');
    if (!body || typeof body.access_token !== 'string' || !body.access_token || body.token_type !== 'Bearer' || typeof body.id_token !== 'string' || !body.id_token) throw new VianaProtocolError('VIANA_TOKEN_INVALID', 'Viana token response is invalid.');
    await verifyIdToken({ idToken: body.id_token, nonce, discovery });
    return body.access_token;
  };

  const fetchStudentSelf = async (accessToken) => {
    let attempt = 0;
    while (attempt < 2) {
      const response = await request(`${config.apiUrl}/students/me`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      const body = await readJsonResponse(response);
      if (response.ok) return validateStudentSelf(body);
      const error = mapHttpError(response, body, 'student_self');
      if (!error.retryable || attempt > 0) throw error;
      attempt += 1;
      await wait(200);
    }
  };

  return { exchangeCode, fetchStudentSelf, generateAuthorizationRequest, getDiscovery, prepareLocalProfile: (profile) => ({ age: calculateGregorianAge(profile.dateOfBirth, now()), displayName: `${profile.firstName} ${profile.lastName}`.trim() }) };
}

module.exports = { VianaProtocolError, calculateGregorianAge, createVianaService, validateStudentSelf };
