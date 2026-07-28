# AI Provider Admin Guide

- Routes select Primary/Fallback model per capability.
- `AUTO_FALLBACK` applies only before a provider accepts a request.
- Every write requires a reason and current route version.
- API keys are environment-only; the UI shows presence, never value.
- Disabling a provider/model/route blocks new submits. Accepted jobs continue from their stored snapshot.
- Circuit reset and unknown-attempt recovery are audited.
- BananaAI and its models are disabled/private by default.
