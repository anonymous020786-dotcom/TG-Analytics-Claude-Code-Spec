# workers/discovery

Channel discovery (`@tga/worker-discovery`): `DiscoveryService` implements DISCOVERY.md (normalize, resolve, scope check, upsert, schedule). `src/main.ts` runs it as the `channel.discovery` consumer (PHASE-08).

Tests share the `*_test` database migrated by `@tga/database` tests.
