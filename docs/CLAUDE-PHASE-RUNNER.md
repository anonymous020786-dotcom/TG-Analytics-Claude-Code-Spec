# Claude Code Phase Runner

Read `CLAUDE.md`, the requested phase, and all referenced documents.

Before editing:
1. Inspect repository.
2. Summarize current state.
3. Identify impacted files.
4. Identify risks.
5. State implementation plan.

Implement only the requested phase.

After editing:
1. Run lint.
2. Run typecheck.
3. Run relevant unit/integration/E2E tests.
4. Run production build.
5. Run phase security checks.
6. Fix failures.
7. Update docs/ADRs.
8. Review diff for accidental future work.

Final report:
- summary
- changed files
- tests/results
- security checks
- migrations
- known limitations
- next-phase dependencies
