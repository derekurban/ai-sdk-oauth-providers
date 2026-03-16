import { describe, expect, it } from "vitest";

import { buildOpenAICodexAuthorizeUrl } from "./openai-codex-login.js";

describe("buildOpenAICodexAuthorizeUrl", () => {
  it("uses the current official Codex originator and scope", () => {
    const rawUrl = buildOpenAICodexAuthorizeUrl({
      redirectUri: "http://localhost:1455/auth/callback",
      challenge: "challenge-value",
      state: "state-value",
    });
    const url = new URL(rawUrl);

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
    expect(rawUrl).toContain(
      "scope=openid%20profile%20email%20offline_access%20api.connectors.read%20api.connectors.invoke",
    );
    expect(rawUrl).not.toContain("scope=openid+profile");
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email offline_access api.connectors.read api.connectors.invoke",
    );
  });
});
