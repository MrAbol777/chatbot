/*
 * Safe operational probe for a Viana confidential-web client.
 *
 * It deliberately uses a fake authorization code. A 400/invalid_grant proves
 * that Viana accepted client_secret_basic without consuming a real OAuth flow.
 * Do not add credentials, authorization codes, or tokens to this output.
 */
const path = require('path');
const dotenv = require('dotenv');
const { loadRuntimeConfig } = require('../src/bootstrap/config');
const { createVianaService } = require('../src/modules/auth/viana.service');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const config = loadRuntimeConfig(process.env).viana;
  if (!config.enabled) {
    console.error(JSON.stringify({ outcome: 'disabled', code: 'VIANA_SIGNIN_DISABLED' }));
    process.exitCode = 1;
    return;
  }

  const service = createVianaService({ config });
  try {
    await service.exchangeCode({
      code: 'danoa-client-auth-probe-invalid-code',
      codeVerifier: 'A'.repeat(64),
      nonce: 'B'.repeat(43)
    });
    console.error(JSON.stringify({ outcome: 'unexpected_success', code: 'VIANA_PROBE_UNEXPECTED_SUCCESS' }));
    process.exitCode = 1;
  } catch (error) {
    const result = {
      outcome: 'rejected',
      code: error?.code || 'VIANA_PROBE_FAILED',
      upstreamStatus: error?.upstreamStatus || error?.status || null,
      oauthError: error?.oauthError || null
    };
    console.log(JSON.stringify(result));
    process.exitCode = result.upstreamStatus === 400 && result.oauthError === 'invalid_grant' ? 0 : 1;
  }
}

main().catch(() => {
  console.error(JSON.stringify({ outcome: 'failed', code: 'VIANA_PROBE_UNEXPECTED_FAILURE' }));
  process.exitCode = 1;
});
