# Anthropic OAuth Contract

Last verified: March 16, 2026

## Endpoint and auth source

- Auth source: Anthropic OAuth / Claude Code login
- Transport endpoint:
  - `https://api.anthropic.com/v1/messages`

## Required auth fields

- `access`
- `refresh`
- `expires`

## Required headers

- `Authorization: Bearer <access token>`
- `anthropic-version: 2023-06-01`
- `anthropic-dangerous-direct-browser-access: true`
- `anthropic-beta: claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14`
- `accept: text/event-stream`
- `content-type: application/json`
- `user-agent: claude-cli/<version>`
- `x-app: cli`

## Package behavior

The package intentionally keeps the Anthropic OAuth runtime minimal:

- it uses the Messages API directly
- it adds the Claude Code identity/system prelude needed for OAuth-backed calls
- it does not attempt to emulate the full Claude Code runtime or tool catalog

## Supported AI SDK features

- text generation
- streaming
- tool calls and tool results
- JSON compatibility mode
- tool choice mapping for `auto`, `none`, `required`, and named tool selection

## Unsupported or downgraded features

- no full Claude Code runtime emulation
- no native JSON schema guarantee
- reasoning signatures are not treated as a stable package contract in `v1`

## Known brittle areas

- OAuth-specific beta headers may change
- Claude Code identity requirements can drift
- Anthropic streaming payload details may evolve before the public SDK surfaces
  them uniformly

## Upstream references to re-check on drift

- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [Claude Code authentication](https://docs.anthropic.com/en/docs/claude-code/authentication)

## Drift log

- March 16, 2026: documented the direct Messages transport with Claude Code
  OAuth headers and minimal identity behavior.
