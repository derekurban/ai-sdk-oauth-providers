import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OAuthAuthStore } from "./store.js";

function buildJwt(payload: object): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

describe("OAuthAuthStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a missing auth file and reports an unstored provider", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    const store = new OAuthAuthStore(authFile);

    const status = await store.getStatus("anthropic");

    expect(status).toEqual({
      providerId: "anthropic",
      stored: false,
    });
    expect(existsSync(authFile)).toBe(true);
    expect(readFileSync(authFile, "utf8")).toBe("{}");
  });

  it("imports Codex auth.json and persists normalized credentials", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    const sourceAuthFile = join(directory, "codex-auth.json");
    const accessToken = buildJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_imported",
      },
    });

    writeFileSync(sourceAuthFile, JSON.stringify({
      tokens: {
        access_token: accessToken,
        refresh_token: "refresh-token",
        account_id: "acct_imported",
      },
    }), "utf8");

    const store = new OAuthAuthStore(authFile);
    const record = await store.importOpenAICodexAuth(sourceAuthFile);

    expect(record).toMatchObject({
      type: "oauth",
      access: accessToken,
      refresh: "refresh-token",
      accountId: "acct_imported",
    });
    expect(await store.getRecord("openai-codex")).toMatchObject({
      access: accessToken,
      refresh: "refresh-token",
      accountId: "acct_imported",
    });
  });

  it("refreshes expired Codex credentials and persists the update", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    const expiredAccess = buildJwt({
      exp: Math.floor(Date.now() / 1000) - 60,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_before",
      },
    });
    const refreshedAccess = buildJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_after",
      },
    });

    writeFileSync(authFile, JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: expiredAccess,
        refresh: "refresh-before",
        expires: Date.now() - 60_000,
        accountId: "acct_before",
      },
    }), "utf8");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: refreshedAccess,
      refresh_token: "refresh-after",
      expires_in: 3600,
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    })));

    const store = new OAuthAuthStore(authFile);
    const record = await store.getCredentials("openai-codex");

    expect(record.access).toBe(refreshedAccess);
    expect(record.refresh).toBe("refresh-after");
    expect(record.accountId).toBe("acct_after");

    const persisted = JSON.parse(readFileSync(authFile, "utf8")) as {
      "openai-codex": { access: string; refresh: string; accountId: string };
    };

    expect(persisted["openai-codex"].access).toBe(refreshedAccess);
    expect(persisted["openai-codex"].refresh).toBe("refresh-after");
    expect(persisted["openai-codex"].accountId).toBe("acct_after");
  });

  it("serializes concurrent refreshes under the file lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    const expiredAccess = buildJwt({
      exp: Math.floor(Date.now() / 1000) - 60,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_before",
      },
    });
    const refreshedAccess = buildJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_after",
      },
    });

    writeFileSync(authFile, JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: expiredAccess,
        refresh: "refresh-before",
        expires: Date.now() - 60_000,
        accountId: "acct_before",
      },
    }), "utf8");

    const fetchSpy = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(JSON.stringify({
        access_token: refreshedAccess,
        refresh_token: "refresh-after",
        expires_in: 3600,
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const firstStore = new OAuthAuthStore(authFile);
    const secondStore = new OAuthAuthStore(authFile);
    const [first, second] = await Promise.all([
      firstStore.getCredentials("openai-codex"),
      secondStore.getCredentials("openai-codex"),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.access).toBe(refreshedAccess);
    expect(second.access).toBe(refreshedAccess);
  });

  it("removes stored credentials on logout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");

    writeFileSync(authFile, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      },
    }), "utf8");

    const store = new OAuthAuthStore(authFile);
    await store.logout("anthropic");

    expect(await store.getRecord("anthropic")).toBeUndefined();
  });

  it("throws on corrupt auth files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    writeFileSync(authFile, "{not-json", "utf8");

    const store = new OAuthAuthStore(authFile);

    await expect(store.getStatus("anthropic")).rejects.toThrow("Failed to parse auth file");
  });

  it("throws when no credentials are stored for a provider", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    const store = new OAuthAuthStore(authFile);

    await expect(store.getCredentials("anthropic")).rejects.toThrow("No stored OAuth credentials for provider: anthropic");
  });

  it("surfaces refresh failures", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oauth-store-"));
    const authFile = join(directory, "auth.json");
    const expiredAccess = buildJwt({
      exp: Math.floor(Date.now() / 1000) - 60,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_before",
      },
    });

    writeFileSync(authFile, JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: expiredAccess,
        refresh: "refresh-before",
        expires: Date.now() - 60_000,
        accountId: "acct_before",
      },
    }), "utf8");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", {
      status: 502,
      headers: {
        "content-type": "text/plain",
      },
    })));

    const store = new OAuthAuthStore(authFile);
    await expect(store.getCredentials("openai-codex")).rejects.toThrow("OpenAI Codex token exchange failed with status 502");
  });
});
