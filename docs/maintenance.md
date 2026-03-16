# Maintenance Guide

This package is expected to evolve with three moving targets:

- AI SDK provider contracts
- Mastra agent integration behavior
- OAuth/runtime contracts for Codex, Anthropic OAuth, and Gemini CLI

## Required re-verification cycle

Re-run the contract suite and update the compatibility docs:

1. on every AI SDK minor bump
2. on every `@ai-sdk/provider` minor bump
3. on every Mastra minor bump
4. whenever Codex, Claude Code, or Gemini CLI docs/source change in a way that
   affects auth or transport behavior

## Required docs to update with every compatibility fix

Any PR that changes compatibility behavior must update:

- [`CHANGELOG.md`](../CHANGELOG.md)
- [`docs/compatibility.md`](./compatibility.md)
- the affected file under [`docs/contracts`](./contracts)

## Drift response workflow

1. Reproduce the break against the pinned compatibility baseline.
2. Identify whether the break is:
   - AI SDK contract drift
   - Mastra integration drift
   - provider auth/runtime drift
3. Update the transport or compatibility shim.
4. Add or adjust tests that pin the new behavior.
5. Update the contract doc drift log for the affected provider.
6. Update the compatibility matrix and changelog in the same PR.

## Release policy

- Releases use tags in the form `v<version>`.
- The root publish workflow validates that `package.json` matches the pushed
  tag before publishing.
- `pi-oauth-ai-sdk` is treated as a deprecated predecessor package. It should
  not receive new feature work.

## Manual smoke checks

The automated contract tests should be complemented with a manual smoke pass for
real OAuth credentials before cutting production releases:

- Codex auth import or device auth
- Anthropic OAuth login
- Gemini CLI OAuth login with persisted `projectId`
- one live request per provider
- one Mastra agent smoke test using `withMastraCompat(...)`
