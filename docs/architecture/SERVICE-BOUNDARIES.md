# Service Boundaries

Presentation -> application service -> domain service -> repository -> external adapter.

Telegram, payments, email, object storage and search are adapters. Domain logic must not depend directly on provider SDKs.

Web: presentation.
API: application/domain access.
Workers: asynchronous external/data processing.
Scheduler: schedules jobs only.
Bot: thin interface over shared services.
