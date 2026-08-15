-- Authorization Code + PKCE flows also bind the OIDC ID token to this one-time nonce.
ALTER TABLE app_viana_oauth_flows
  ADD COLUMN IF NOT EXISTS nonce VARCHAR(128) NOT NULL DEFAULT '' AFTER code_verifier;
