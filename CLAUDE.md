# CLAUDE.md — TG Analytics

## Mission
Build a secure, scalable, fast, SEO-friendly Telegram public channel and group analytics platform phase-by-phase.

## Mandatory rules
- Read relevant documentation before coding.
- Implement only the requested phase.
- Never invent requirements, credentials or unsupported API capabilities.
- Inspect existing code before changing it.
- Never commit secrets or `.env` files.
- Every database change requires a migration.
- Every API input requires validation.
- Every authenticated endpoint requires server-side authorization.
- Large collections require pagination.
- Expensive work should use queues/workers.
- Every worker must be idempotent.
- External calls require timeouts, bounded retries and error classification.
- Never use infinite retries.
- Never bypass Telegram restrictions or collect unauthorized/private data.
- Never disable security controls to make tests pass.
- Never rewrite unrelated working code.
- Production changes require staging verification.
- Destructive operations require explicit approval.
- Preserve public API compatibility.
- Use feature flags for risky changes.
- Record material architecture decisions as ADRs.

## Verification
Run relevant lint, typecheck, unit, integration, E2E and build checks before phase completion.

## Execution protocol
READ -> INSPECT -> PLAN -> IMPLEMENT -> TEST -> SECURITY CHECK -> PERFORMANCE CHECK -> DOCUMENT -> COMMIT -> STAGING -> ACCEPTANCE.

## Never do
- Build the entire product in one uncontrolled pass.
- Use browser scraping as the primary Telegram architecture.
- Store raw API keys/payment secrets.
- Trust client-side authorization.
- Grant paid access from browser redirects alone.
- Create mass thin SEO pages.
- Introduce microservices/Kubernetes without measured need.
- Delete historical observations merely because collection failed.

## Definition of Done
A phase is complete only when functional, security, testing, documentation and acceptance gates pass.
