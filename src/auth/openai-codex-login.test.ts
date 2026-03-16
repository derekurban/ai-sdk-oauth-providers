import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOpenAICodexAuthorizeUrl,
  importOpenAICodexCredentialsFromCodexAuth,
  loginOpenAICodexWithDeviceAuth,
} from "./openai-codex-login.js";

function buildJwt(payload: object): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

describe("openai-codex-login", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the official authorize URL with percent-encoded scopes", () => {
    const url = buildOpenAICodexAuthorizeUrl({
      redirectUri: "http://localhost:1455/auth/callback",
      challenge: "challenge",
      state: "state",
    });

    expect(url).toContain("originator=codex_cli_rs");
    expect(url).toContain("scope=openid%20profile%20email%20offline_access%20api.connectors.read%20api.connectors.invoke");
    expect(url).not.toContain("scope=openid+profile");
  });

  it("imports credentials from Codex auth.json", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-auth-"));
    const authFile = join(directory, "auth.json");
    const accessToken = buildJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_imported",
      },
    });

    writeFileSync(authFile, JSON.stringify({
      tokens: {
        access_token: accessToken,
        refresh_token: "refresh-token",
        account_id: "acct_imported",
      },
    }), "utf8");

    const credentials = importOpenAICodexCredentialsFromCodexAuth(authFile);
    expect(credentials.access).toBe(accessToken);
    expect(credentials.refresh).toBe("refresh-token");
    expect(credentials.accountId).toBe("acct_imported");
    expect(credentials.expires).toBeGreaterThan(Date.now());
  });

  it("completes the device auth flow and exchanges tokens", async () => {
    const accessToken = buildJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_device",
      },
    });

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_auth_id: "device_auth_123",
        user_code: "ABCD-EFGH",
        interval: 0,
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization_code: "authorization-code",
        code_challenge: "challenge",
        code_verifier: "verifier",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: accessToken,
        refresh_token: "refresh-token",
        expires_in: 3600,
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })));

    const onAuth = vi.fn();
    const onProgress = vi.fn();

    const credentials = await loginOpenAICodexWithDeviceAuth({
      onAuth,
      onPrompt: vi.fn(),
      onManualCodeInput: vi.fn(),
      onProgress,
    });

    expect(onAuth).toHaveBeenCalledWith({
      url: "https://auth.openai.com/codex/device",
      instructions: "Enter code: ABCD-EFGH",
    });
    expect(onProgress).toHaveBeenCalledWith("Waiting for OpenAI Codex device authorization...");
    expect(credentials.access).toBe(accessToken);
    expect(credentials.refresh).toBe("refresh-token");
    expect(credentials.accountId).toBe("acct_device");
  });
});
