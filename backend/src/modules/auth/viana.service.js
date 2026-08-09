const crypto = require('crypto');

const USERINFO_KEYS = ['dateOfBirth', 'firstName', 'gender', 'grade', 'lastName', 'sub'];

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

function validateUserInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo response is not an object.');
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(USERINFO_KEYS)) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo returned an unexpected response shape.');
  }
  for (const key of ['sub', 'firstName', 'lastName', 'dateOfBirth']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) {
      throw new VianaProtocolError('VIANA_USERINFO_INVALID', `Viana UserInfo field ${key} is invalid.`);
    }
  }
  if (value.sub.length > 191 || value.firstName.length > 191 || value.lastName.length > 191) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo contains an overlong value.');
  }
  if (value.grade !== null && (typeof value.grade !== 'string' || value.grade.length > 64)) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo grade is invalid.');
  }
  if (value.gender !== null && !['MALE', 'FEMALE'].includes(value.gender)) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo gender is invalid.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth)) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo dateOfBirth is invalid.');
  }
  const [year, month, day] = value.dateOfBirth.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana UserInfo dateOfBirth is not a calendar date.');
  }
  return {
    sub: value.sub.trim(),
    firstName: value.firstName.trim(),
    lastName: value.lastName.trim(),
    dateOfBirth: value.dateOfBirth,
    grade: value.grade === null ? null : value.grade.trim(),
    gender: value.gender
  };
}

function calculateGregorianAge(dateOfBirth, currentDate = new Date()) {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  let age = currentDate.getUTCFullYear() - year;
  const currentMonth = currentDate.getUTCMonth() + 1;
  const currentDay = currentDate.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 130) {
    throw new VianaProtocolError('VIANA_USERINFO_INVALID', 'Viana dateOfBirth yields an invalid age.');
  }
  return age;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (text.length > 64 * 1024) {
    throw new VianaProtocolError('VIANA_RESPONSE_TOO_LARGE', 'Viana returned an oversized response.');
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new VianaProtocolError('VIANA_RESPONSE_MALFORMED', `Viana returned non-JSON HTTP ${response.status}.`, {
      retryable: response.status >= 500
    });
  }
}

function mapHttpError(response, body, phase) {
  const oauthError = typeof body?.error === 'string' ? body.error : null;
  const retryable = response.status === 429 || response.status >= 500 || oauthError === 'temporarily_unavailable';
  return new VianaProtocolError(
    `VIANA_${phase.toUpperCase()}_FAILED`,
    `Viana ${phase} request failed.`,
    { status: response.status, retryable, oauthError }
  );
}

function createVianaService({ config, fetchImpl = globalThis.fetch, now = () => new Date(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const generateAuthorizationRequest = () => {
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    const url = new URL(config.authorizationUrl);
    for (const [name, value] of Object.entries({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'profile'
    })) {
      url.searchParams.set(name, value);
    }
    return { state, codeVerifier, codeChallenge, authorizationUrl: url.toString() };
  };

  const request = async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    timeout.unref?.();
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new VianaProtocolError('VIANA_TIMEOUT', 'Viana request timed out.', { retryable: true });
      }
      throw new VianaProtocolError('VIANA_NETWORK_ERROR', 'Viana request failed.', { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  };

  const exchangeCode = async ({ code, codeVerifier }) => {
    const response = await request(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier
      })
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw mapHttpError(response, body, 'token');
    if (
      !body ||
      typeof body.access_token !== 'string' ||
      !body.access_token ||
      body.token_type !== 'Bearer' ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0 ||
      body.scope !== 'profile'
    ) {
      throw new VianaProtocolError('VIANA_TOKEN_INVALID', 'Viana token response is invalid.');
    }
    return body.access_token;
  };

  const fetchUserInfo = async (accessToken) => {
    let attempt = 0;
    while (attempt < 2) {
      const response = await request(config.userInfoUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
      });
      const body = await readJsonResponse(response);
      if (response.ok) return validateUserInfo(body);
      const error = mapHttpError(response, body, 'userinfo');
      if (!error.retryable || attempt > 0) throw error;
      attempt += 1;
      await wait(200);
    }
    throw new VianaProtocolError('VIANA_USERINFO_FAILED', 'Viana UserInfo request failed.');
  };

  const prepareLocalProfile = (profile) => ({
    age: calculateGregorianAge(profile.dateOfBirth, now()),
    displayName: `${profile.firstName} ${profile.lastName}`.trim()
  });

  return { exchangeCode, fetchUserInfo, generateAuthorizationRequest, prepareLocalProfile };
}

module.exports = {
  USERINFO_KEYS,
  VianaProtocolError,
  calculateGregorianAge,
  createVianaService,
  validateUserInfo
};
