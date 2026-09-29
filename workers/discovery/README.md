# workers/discovery

Channel discovery (`@tga/worker-discovery`): `DiscoveryService` implements DISCOVERY.md (normalize, resolve, scope check, upsert, schedule). The queue consumer loop that runs it arrives in PHASE-08.

Tests share the `*_test` database migrated by `@tga/database` tests.
