# AI SDK V3 Baseline

Last verified: March 16, 2026

## Target contract

- `LanguageModelV3`
- `ProviderV3`
- `ai@6.0.116`
- `@ai-sdk/provider@3.0.8`

## Required provider behavior

The package implementation is expected to provide:

- `specificationVersion: "v3"`
- `provider` and `modelId`
- `doGenerate(options)`
- `doStream(options)`
- `supportedUrls`

At the provider level, it must provide:

- `languageModel(modelId)`
- stubbed unsupported surfaces for embeddings/images/speech/transcription/reranking

## Supported call features

The package baseline for `v1` is:

- system, user, assistant, and tool messages
- text content
- tool calls and tool results
- non-streaming generation
- streaming generation
- JSON compatibility mode for object generation
- warnings for unsupported or downgraded features

## Unsupported or downgraded features

These are intentionally unsupported or compatibility-only in `v1`:

- multimodal file/url/image prompt parts
- provider-defined tools
- non-language-model categories
- native JSON schema guarantees on every OAuth transport
- arbitrary provider-specific settings outside the documented transport surface

## Baseline warning policy

The package should emit warnings when:

- a requested feature is not supported
- JSON generation falls back to compatibility mode
- a provider-specific setting must be ignored or downgraded

## Upstream references to re-check on drift

- [AI SDK custom providers](https://ai-sdk.dev/providers/custom-providers)
- [AI SDK package](https://www.npmjs.com/package/ai)
- [@ai-sdk/provider package](https://www.npmjs.com/package/@ai-sdk/provider)

## Drift log

- March 16, 2026: baseline established for `ProviderV3` / `LanguageModelV3`
  only. Legacy V2/V3 compatibility shims are intentionally not part of this
  package line.
