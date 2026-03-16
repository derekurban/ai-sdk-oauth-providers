# Gemini CLI OAuth Contract

Last verified: March 16, 2026

## Endpoint and auth source

- Auth source: Gemini CLI / Google Cloud Code Assist OAuth
- Transport endpoint:
  - `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`

## Required auth fields

- `access`
- `refresh`
- `expires`
- `projectId`

## Required headers

- `Authorization: Bearer <access token>`
- `Content-Type: application/json`
- `Accept: text/event-stream`
- `User-Agent: google-cloud-sdk vscode_cloudshelleditor/0.1`
- `X-Goog-Api-Client: gl-node/22.17.0`
- `Client-Metadata: {...}`

## Package behavior

The package targets Gemini CLI / Cloud Code Assist semantics:

- `projectId` is required and stored with the OAuth credentials
- the runtime is treated separately from the public API-key Gemini API surface
- tool declarations are mapped into Cloud Code Assist function declarations

## Supported AI SDK features

- text generation
- streaming
- tool calls and tool results
- JSON compatibility mode

## Unsupported or downgraded features

- no public Gemini API key mode in this package
- tool choice is effectively limited to `AUTO`, `NONE`, or `ANY`
- native JSON schema guarantees are not claimed in `v1`

## Known brittle areas

- Cloud Code Assist is an internal product surface compared to the public Gemini
  API
- `projectId` persistence is mandatory and easy to misconfigure
- request/response shapes can drift separately from the public Gemini API docs

## Upstream references to re-check on drift

- [Gemini GenerateContent API](https://ai.google.dev/api/generate-content)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)

## Drift log

- March 16, 2026: documented the Cloud Code Assist SSE transport and the
  required persisted `projectId`.
