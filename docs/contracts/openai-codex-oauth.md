# OpenAI Codex OAuth Contract

Last verified: March 16, 2026

## Endpoint and auth source

- Auth source: ChatGPT / Codex OAuth credentials
- Recommended auth acquisition:
  - import from official Codex auth
  - device auth
  - browser OAuth fallback
- Transport endpoint:
  - `https://chatgpt.com/backend-api/codex/responses`

## Required auth fields

- `access`
- `refresh`
- `expires`
- `accountId`

## Required headers

- `Authorization: Bearer <access token>`
- `chatgpt-account-id: <accountId>`
- `originator: pi`
- `OpenAI-Beta: responses=experimental`
- `accept: text/event-stream`
- `content-type: application/json`

## Request shape in this package

The package uses a Responses-style request with:

- `instructions`
- `input`
- `tools`
- `tool_choice: "auto"` when tools are enabled
- `parallel_tool_calls: true`
- `max_output_tokens` when requested

## Supported AI SDK features

- text generation
- streaming
- tool calls and tool results
- JSON compatibility mode

## Unsupported or downgraded features

- browser OAuth is documented as experimental
- temperature is ignored
- websocket/session reuse is intentionally deferred from `v1`
- native JSON schema guarantees are not claimed

## Known brittle areas

- Codex auth acceptance rules can drift on the OpenAI side
- backend headers and beta flags can change
- account-linked entitlement behavior can differ across accounts

## Upstream references to re-check on drift

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/create)
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)
- [OpenAI Codex auth source](https://raw.githubusercontent.com/openai/codex/main/codex-rs/login/src/server.rs)
- [OpenAI Codex CLI docs](https://developers.openai.com/codex/cli/)

## Drift log

- March 16, 2026: documented `v1` around the SSE `/codex/responses` path,
  with import/device auth preferred over browser OAuth.
