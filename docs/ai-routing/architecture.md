# AI Routing Architecture

## Component diagram

```mermaid
flowchart LR
  UI["User/Admin UI"] --> API["Video/Admin API"]
  API --> APP["Video Application Service"]
  APP --> RES["Capability Route Resolver"]
  RES --> REG["Provider Registry"]
  REG --> M["Metis Adapter"]
  REG --> B["BananaAI Adapter"]
  APP --> DB[(MariaDB)]
  W["Video Worker"] --> DB
  W --> REG
  W --> DL["Secure Result Downloader"]
  DL --> ST["Private Storage"]
```

## Request sequence

```mermaid
sequenceDiagram
  participant U as User
  participant A as Video API
  participant R as Route Resolver
  participant D as MariaDB
  participant W as Worker
  participant P as Provider Adapter
  U->>A: POST generation + idempotency key
  A->>R: resolve capability
  R-->>A: immutable route snapshot
  A->>D: job + reservation + attempt transaction
  A-->>U: 202 queued
  W->>D: claim queued job
  W->>P: submit from snapshot
  P-->>W: task id or classified outcome
  W->>D: persist accepted/ambiguous/rejected state
```

## Fallback sequence

```mermaid
sequenceDiagram
  participant W as Worker
  participant P as Primary
  participant D as Database
  participant F as Fallback
  W->>P: submit
  alt confirmed rejection without task id
    P-->>W: documented rejection
    W->>D: close attempt 1; create attempt 2
    W->>F: submit same job/reservation
  else accepted or ambiguous
    P-->>W: task id or uncertain outcome
    W->>D: accepted or provider_status_unknown
    Note over W,F: no fallback
  end
```

## Job state machine

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> routing
  routing --> submitting
  submitting --> submitted
  submitting --> provider_status_unknown
  submitted --> processing
  processing --> storing
  storing --> succeeded
  queued --> failed
  routing --> failed
  submitting --> failed
  submitted --> failed
  processing --> failed
  storing --> failed
```

## Admin route change

```mermaid
sequenceDiagram
  participant A as Admin
  participant API as Admin API
  participant D as MariaDB
  participant C as Route Cache
  A->>API: update + reason + expectedVersion
  API->>D: lock, validate, audit, version + 1
  D-->>API: committed route
  API->>C: invalidate capability
  API-->>A: safe route DTO
```

## Database relationships

```mermaid
erDiagram
  APP_AI_PROVIDERS ||--o{ APP_VIDEO_MODELS : owns
  APP_AI_CAPABILITY_ROUTES }o--|| APP_AI_PROVIDERS : primary
  APP_AI_CAPABILITY_ROUTES ||--o{ APP_AI_ROUTE_AUDIT_LOGS : audits
  APP_AI_CAPABILITY_ROUTES ||--o{ APP_AI_PROVIDER_ATTEMPTS : snapshots
  APP_VIDEO_GENERATIONS ||--o{ APP_AI_PROVIDER_ATTEMPTS : has
  APP_VIDEO_GENERATIONS ||--|| APP_VIDEO_QUOTA_RESERVATIONS : reserves
  APP_VIDEO_GENERATIONS }o--o| APP_VIDEO_INPUT_MEDIA : uses
  APP_AI_PROVIDERS ||--o{ APP_AI_PROVIDER_HEALTH : health
```
