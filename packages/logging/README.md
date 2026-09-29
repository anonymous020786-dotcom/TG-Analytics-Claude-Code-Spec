# packages/logging

Structured logging (`@tga/logging`): pino JSON logger with ISO timestamps, a `service` field and redaction of secrets and auth headers (`SENSITIVE_KEYS`, `REDACT_PATHS`).

```ts
import { createLogger } from '@tga/logging';
const logger = createLogger({ name: 'worker-metrics' });
```
