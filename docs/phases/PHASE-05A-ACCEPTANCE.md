# Phase 05A Acceptance Matrix

| Area | Required | Status | Evidence |
|---|---|---|---|
| Bot API capabilities for public channels | Verified live | **Pass** | `getChat` + `getChatMemberCount` on `@telegram` |
| Bot API capabilities for public groups | Verified live | **Pass** | `getChat` + `getChatMemberCount` on `@BotTalk` (supergroup) |
| MTProto capabilities | Verified from official docs | **Pass** | CAPABILITY-MATRIX §1, §5 |
| MTProto capabilities | Verified live with a sandboxed account | **Blocked (OD-003)** | No dedicated account or session yet; `messages.getHistory` is user-only |
| Terms of Service constraints recorded | Yes | **Pass** | CAPABILITY-MATRIX §4; D-015, D-016 |
| Rate-limit/error behaviour recorded | Yes | **Pass** | CAPABILITY-MATRIX §3, incl. live `429 retry_after` |
| MTProto account plan (OD-003) | Resolved | **Open** | Narrowed in OPEN-DECISIONS |
| Capability matrix published for PHASE-06 | Yes | **Pass** | `docs/telegram/CAPABILITY-MATRIX.md` |
| No production collection | Yes | **Pass** | Read-only spike probe; nothing stored |
| Secrets | Never committed or printed | **Pass** | Tokens only in git-ignored `.env`; probe never prints them; gitleaks |

**Gate proposal:** accept PHASE-05A as *partial*. PHASE-06 may build the Bot API backend fully and the MTProto backend against documented contracts and fixtures. The live MTProto items stay blocking for any MTProto collector (PHASE-08) until OD-003 is resolved.
