const crypto = require('crypto');

const REQUIRED_SCOPES = ['openid', 'profile', 'student.self:read', 'students.contact:read', 'students.sensitive:read'];

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

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asTrimmedString = (value, max = 191) =>
  typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;

function validateDate(value, fieldName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new VianaProtocolError('VIANA_STUDENT_INVALID', `${fieldName} is invalid.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new VianaProtocolError('VIANA_STUDENT_INVALID', `${fieldName} is not a calendar date.`);
  }
  return value;
}

function validateUserInfo(value) {
  if (!isObject(value)) throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo response is not an object.');
  const sub = asTrimmedString(value.sub);
  if (!sub) throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo subject is invalid.');
  return { sub };
}

function validateStudent(value) {
  const body = isObject(value?.data) ? value.data : value;
  if (!isObject(body)) throw new VianaProtocolError('VIANA_STUDENT_INVALID', 'Viana student response is not an object.');
  const firstName = asTrimmedString(body.firstName);
  const lastName = asTrimmedString(body.lastName);
  const id = asTrimmedString(body.id);
  if (!firstName || !lastName) throw new VianaProtocolError('VIANA_STUDENT_INVALID', 'Viana student name is invalid.');
  const optionalString = (field, max = 64) => {
    if (body[field] === null || body[field] === undefined || body[field] === '') return null;
    const result = asTrimmedString(body[field], max);
    if (!result) throw new VianaProtocolError('VIANA_STUDENT_INVALID', `Viana student ${field} is invalid.`);
    return result;
  };
  const rawPoints = body.points;
  const points = rawPoints === null || rawPoints === undefined || rawPoints === '' ? null : Number(rawPoints);
  if (points !== null && (!Number.isFinite(points) || !Number.isInteger(points) || points < -2147483648 || points > 2147483647)) {
    throw new VianaProtocolError('VIANA_STUDENT_INVALID', 'Viana student points is invalid.');
  }
  return {
    id,
    firstName,
    lastName,
    grade: optionalString('grade'),
    dateOfBirth: validateDate(body.dateOfBirth, 'Viana student dateOfBirth'),
    studentPhone: optionalString('studentPhone', 32),
    guardianPhone: optionalString('guardianPhone', 32),
    points,
    gender: body.gender === 'MALE' || body.gender === 'FEMALE' ? body.gender : null
  };
}

function calculateGregorianAge(dateOfBirth, currentDate = new Date()) {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  let age = currentDate.getUTCFullYear() - year;
  const currentMonth = currentDate.getUTCMonth() + 1;
  const currentDay = currentDate.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 130) throw new VianaProtocolError('VIANA_STUDENT_INVALID', 'Viana dateOfBirth yields an invalid age.');
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

function parseEndpoint(value, name, issuerOrigin) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.origin !== issuerOrigin) throw new Error();
    return url.toString();
  } catch {
    throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', `Viana Discovery ${name} is invalid.`);
  }
}

function createVianaService({ config, fetchImpl = globalThis.fetch, now = () => new Date(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let discoveryCache = null;
  let discoveryExpiresAt = 0;
  let discoveryLoading = null;

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

  const loadDiscovery = async () => {
    if (discoveryCache && Date.now() < discoveryExpiresAt) return discoveryCache;
    if (discoveryLoading) return discoveryLoading;
    discoveryLoading = (async () => {
      const response = await request(config.discoveryUrl, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error' });
      const body = await readJsonResponse(response);
      if (!response.ok || !isObject(body)) throw mapHttpError(response, body, 'discovery');
      let issuer;
      try {
        issuer = new URL(body.issuer);
        if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.hash || issuer.pathname !== '/' || issuer.search) throw new Error();
      } catch {
        throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', 'Viana Discovery issuer is invalid.');
      }
      const supportedScopes = new Set(Array.isArray(body.scopes_supported) ? body.scopes_supported : []);
      if (!REQUIRED_SCOPES.every((scope) => supportedScopes.has(scope))) {
        throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', 'Viana Discovery does not support the required scopes.');
      }
      if (!Array.isArray(body.code_challenge_methods_supported) || !body.code_challenge_methods_supported.includes('S256')) {
        throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', 'Viana Discovery does not support PKCE S256.');
      }
      if (!Array.isArray(body.token_endpoint_auth_methods_supported) || !body.token_endpoint_auth_methods_supported.includes('client_secret_basic')) {
        throw new VianaProtocolError('VIANA_DISCOVERY_INVALID', 'Viana Discovery does not support client_secret_basic.');
      }
      const value = {
        issuer: issuer.toString().replace(/\/$/, ''),
        authorizationUrl: parseEndpoint(body.authorization_endpoint, 'authorization_endpoint', issuer.origin),
        tokenUrl: parseEndpoint(body.token_endpoint, 'token_endpoint', issuer.origin),
        userInfoUrl: parseEndpoint(body.userinfo_endpoint, 'userinfo_endpoint', issuer.origin)
      };
      discoveryCache = value;
      discoveryExpiresAt = Date.now() + 15 * 60 * 1000;
      return value;
    })();
    try {
      return await discoveryLoading;
    } finally {
      discoveryLoading = null;
    }
  };

  const generateAuthorizationRequest = async () => {
    const discovery = await loadDiscovery();
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const url = new URL(discovery.authorizationUrl);
    for (const [name, value] of Object.entries({
      response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
      scope: REQUIRED_SCOPES.join(' '), state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256'
    })) url.searchParams.set(name, value);
    return { state, nonce, codeVerifier, authorizationUrl: url.toString() };
  };

  const exchangeCode = async ({ code, codeVerifier }) => {
    const discovery = await loadDiscovery();
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const response = await request(discovery.tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: codeVerifier })
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw mapHttpError(response, body, 'token');
    if (!isObject(body) || !asTrimmedString(body.access_token, 8192) || body.token_type !== 'Bearer' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
      throw new VianaProtocolError('VIANA_TOKEN_INVALID', 'Viana token response is invalid.');
    }
    return body.access_token;
  };

  const fetchWithSingleRetry = async (url, accessToken, phase, validate) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      const body = await readJsonResponse(response);
      if (response.ok) return validate(body);
      const error = mapHttpError(response, body, phase);
      if (!error.retryable || attempt) throw error;
      await wait(200);
    }
    throw new VianaProtocolError(`VIANA_${phase.toUpperCase()}_FAILED`, `Viana ${phase} request failed.`);
  };

  const fetchUserInfo = async (accessToken) => {
    const discovery = await loadDiscovery();
    return fetchWithSingleRetry(discovery.userInfoUrl, accessToken, 'userinfo', validateUserInfo);
  };
  const fetchCurrentStudent = async (accessToken) => fetchWithSingleRetry(config.studentSelfUrl, accessToken, 'student', validateStudent);
  const prepareLocalProfile = (student) => ({ age: calculateGregorianAge(student.dateOfBirth, now()), displayName: `${student.firstName} ${student.lastName}`.trim() });

  return { exchangeCode, fetchCurrentStudent, fetchUserInfo, generateAuthorizationRequest, loadDiscovery, prepareLocalProfile };
}

module.exports = { REQUIRED_SCOPES, VianaProtocolError, calculateGregorianAge, createVianaService, validateStudent, validateUserInfo };
