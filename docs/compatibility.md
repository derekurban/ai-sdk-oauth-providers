# Compatibility Matrix

Last verified: March 16, 2026

## Baseline

| Package | Verified version | Notes |
| --- | --- | --- |
| `ai` | `6.0.116` | Primary SDK surface used by contract tests. |
| `@ai-sdk/provider` | `3.0.8` | Target provider contract for this package. |
| `@mastra/core` | `1.13.2` | Baseline for Mastra agent integration tests. |
| `@mariozechner/pi-ai` | `0.58.4` | OAuth only. Inference/runtime is not reused. |

## Package guarantees

`ai-sdk-oauth-providers` `v1` is intended to provide:

- AI SDK `LanguageModelV3` / `ProviderV3` compatibility
- current Mastra compatibility when used with `withMastraCompat(...)`
- OAuth login, refresh, and credential persistence for the supported providers

## Supported providers

| Provider | Status | Notes |
| --- | --- | --- |
| OpenAI Codex OAuth | Supported, experimental | ChatGPT/Codex auth and backend contracts can drift. Prefer import/device auth. |
| Anthropic OAuth | Supported | Direct Messages transport with Claude Code OAuth identity headers. |
| Gemini CLI OAuth | Supported | Requires a stored `projectId` and targets Cloud Code Assist semantics. |

## Known compatibility notes

- Latest Mastra still needs `withMastraCompat(...)` for `output` and
  `clientTools` agent ergonomics.
- JSON/object generation uses compatibility mode rather than claiming a native
  JSON schema path on every provider-specific OAuth transport.
- This package does not implement non-language-model surfaces in `v1`.

## When to update this matrix

Update this file in the same PR as any compatibility fix when:

- AI SDK minor versions change
- `@ai-sdk/provider` minor versions change
- Mastra minor versions change
- Codex, Claude Code, or Gemini CLI auth/runtime contracts drift
