# AI Routing Rollback

1. Set the global Video feature flag off.
2. Disable affected routes and providers.
3. Stop the Video worker with its graceful shutdown path.
4. Roll application code back to a compatible release.
5. Keep additive routing tables, columns, route snapshots, attempts and stored media intact.
6. Do not drop tables or restore a database unless a separate verified database incident requires it.
7. Existing accepted jobs must be reconciled from their snapshots; they must never be resubmitted to another provider.
