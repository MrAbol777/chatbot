# AI Routing Implementation Plan

Status values: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.

| ID | Task | Main area | Dependency | Risk | Test | Status |
|---|---|---|---|---|---|---|
| AR-000 | Repository discovery | docs | none | missed reuse | review | DONE |
| AR-001 | BananaAI official contract | docs/fixtures | AR-000 | guessed contract | contract test | DONE |
| AR-002 | Executable implementation plan | docs | AR-000/001 | scope drift | review | DONE |
| AR-003 | Controlled module boundaries | routing/video | AR-002 | Metis regression | unit | DONE |
| AR-004 | Additive migrations 032–034 | DB | AR-003 | seed overwrite | DB idempotency | DONE |
| AR-005 | Provider registry | routing | AR-004 | duplicate/unknown | unit | DONE |
| AR-006 | Capability resolver/cache/policies | routing | AR-004/005 | stale route | unit/DB | DONE |
| AR-007 | Metis interface compatibility | providers | AR-005 | payload change | regression | DONE |
| AR-008 | BananaAI adapter | providers | AR-001/005 | contract drift | mock-only | DONE |
| AR-009 | Snapshot/attempt transaction | video/DB | AR-004/006 | double quota | DB race | DONE |
| AR-010 | Worker submit/fallback/idempotency | worker | AR-008/009 | double submit | restart/race | DONE |
| AR-011 | Circuit/concurrency/cost guards | routing | AR-009 | false open/cost guess | unit/DB | DONE |
| AR-012 | Admin API/audit/recovery | admin | AR-006/011 | secret leak | auth/redaction | DONE |
| AR-013 | Admin UI | frontend admin | AR-012 | monolith/accessibility | vitest/build | DONE |
| AR-014 | Capability-driven Video UI | frontend video | AR-009/015 | invalid option | vitest | DONE |
| AR-015 | Private I2V media/HMAC gateway | video/storage | AR-004/008 | ownership/token leak | security | DONE |
| AR-016 | Full offline regression | tests | all | accidental network | guarded suites | DONE |
| AR-017 | Readiness/runbooks/final report | docs/scripts | all | false readiness | local-only | DONE |

## Fixed decisions

- Routing key is capability-only.
- Public model is derived from the active route; legacy `modelKey` remains a compatibility assertion.
- BananaAI and all its models remain disabled/private.
- T2V seed points to the existing Metis model with `PRIMARY_ONLY`; I2V seed is disabled/unassigned.
- I2V uses owned private media and an opaque short-lived HMAC gateway.
- Live script has no executable default tuple and is not run.
- No Provider, balance, health, status, result or generation request is allowed during implementation/testing.

## Final offline gates

- Backend Video/AI Routing tests: 188 passed, 0 failed.
- Frontend full test suite: 68 passed, 0 failed.
- Frontend TypeScript/Vite build: passed.
- Guarded migrations 026–034: repeated successfully by DB suites.
- Local-only readiness: passed; BananaAI result contract is `BLOCKED_NEEDS_LIVE_VALIDATION` and the I2V provider-input gateway is `BLOCKED` until deployment configuration exists.
- Secret scan: passed with zero non-fixture credential-like literals.
- No Phase was marked DONE before its relevant offline test/build gate passed.

## Rollback

Disable the feature/provider/routes, stop the worker gracefully and roll application code back. Additive tables/columns remain so old and in-flight snapshots stay readable. No automatic DROP/down migration is used.
