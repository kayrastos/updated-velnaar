# VELNAR Platform

Enterprise-grade autonomous revenue protection and intelligence platform.

## Architecture & AI Layer

VELNAR features a zero-PII server-side AI intelligence architecture:

- **Server-Side Gateway**: All AI routing, telemetry, token budgeting, and governance occur strictly within server-side Cloudflare Workers.
- **Provider API Credentials**: AI provider credentials (such as Google Gemini, DeepSeek, or Moonshot Kimi API keys) are server-side Cloudflare Worker secrets.
- **Client Security Invariant**: Never expose provider API keys to React/Vite frontend code. Do NOT store keys in Git, `src/`, `.env.example`, Vite `VITE_*` variables, or client-side JavaScript.
- **Deployment**: For Cloudflare deployment, secrets will be configured through Worker secret bindings.
- **Sprint 4.0 Status**: External AI providers remain `NOT_CONFIGURED` by default unless explicitly configured via server environment secrets outside the repository. Live external AI calls require explicit configuration and registered integer microUSD pricing catalogs.
