import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const questionMock = vi.fn(async () => "manual-code");
const closeMock = vi.fn();
const spawnMock = vi.fn(() => ({
  on: vi.fn(),
  unref: vi.fn(),
}));

const authStoreMocks = {
  getProviders: vi.fn(),
  getStatus: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  importOpenAICodexAuth: vi.fn(),
};

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({
    question: questionMock,
    close: closeMock,
  })),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("./auth/store.js", () => ({
  OAuthAuthStore: class OAuthAuthStore {
    constructor(readonly authFile: string) {}

    getProviders() {
      return authStoreMocks.getProviders();
    }

    getStatus(providerId: string) {
      return authStoreMocks.getStatus(providerId);
    }

    login(providerId: string, callbacks: unknown, options?: unknown) {
      return authStoreMocks.login(providerId, callbacks, options);
    }

    logout(providerId: string) {
      return authStoreMocks.logout(providerId);
    }

    importOpenAICodexAuth(sourceAuthFile: string) {
      return authStoreMocks.importOpenAICodexAuth(sourceAuthFile);
    }
  },
}));

const { runCli } = await import("./cli-app.js");

describe("runCli", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    questionMock.mockResolvedValue("manual-code");

    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function joinedOutput(spy: typeof stdoutSpy): string {
    return spy.mock.calls.map((call: [unknown, ...unknown[]]) => String(call[0])).join("");
  }

  it("prints the supported providers", async () => {
    authStoreMocks.getProviders.mockReturnValue([
      { id: "anthropic", name: "Anthropic", usesCallbackServer: true },
      { id: "openai-codex", name: "OpenAI Codex", usesCallbackServer: true },
    ]);

    await runCli(["providers"]);

    const output = joinedOutput(stdoutSpy);
    expect(output).toContain("anthropic\tAnthropic\tcallback-server\n");
    expect(output).toContain("openai-codex\tOpenAI Codex\tcallback-server\n");
  });

  it("prints status for a provider", async () => {
    authStoreMocks.getStatus.mockResolvedValue({
      providerId: "anthropic",
      stored: true,
      expired: false,
      expiresAt: Date.parse("2026-03-17T00:00:00.000Z"),
    });

    await runCli(["status", "--provider", "anthropic", "--auth-file", "./oauth.json"]);

    const output = joinedOutput(stdoutSpy);
    expect(output).toContain("anthropic\n");
    expect(output).toContain("stored: true\n");
    expect(output).toContain("expired: false\n");
    expect(output).toContain("expiresAt: 2026-03-17T00:00:00.000Z\n");
  });

  it("runs Codex device auth login", async () => {
    authStoreMocks.login.mockImplementation(async (_providerId: string, callbacks: any, options?: unknown) => {
      callbacks.onAuth({
        url: "https://auth.openai.com/codex/device",
        instructions: "Enter code: ABCD-EFGH",
      });
      callbacks.onProgress?.("Waiting for device auth");
      await callbacks.onManualCodeInput?.();
      return {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.parse("2026-03-17T00:00:00.000Z"),
        accountId: "acct_test",
      };
    });

    await runCli(["login", "--provider", "openai-codex", "--auth-file", "./oauth.json", "--device-auth"]);

    expect(authStoreMocks.login).toHaveBeenCalledWith(
      "openai-codex",
      expect.any(Object),
      { deviceAuth: true },
    );
    const stderrOutput = joinedOutput(stderrSpy);
    const stdoutOutput = joinedOutput(stdoutSpy);
    expect(stderrOutput).toContain("Open this URL to continue authentication:\nhttps://auth.openai.com/codex/device\n");
    expect(stderrOutput).toContain("Enter code: ABCD-EFGH\n");
    expect(stdoutOutput).toContain("Stored OAuth credentials for openai-codex in ./oauth.json\n");
    expect(stdoutOutput).toContain("expiresAt: 2026-03-17T00:00:00.000Z\n");
    expect(questionMock).toHaveBeenCalledWith("Paste the callback URL or device code: ");
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalled();
  });

  it("imports Codex auth from a provided source", async () => {
    authStoreMocks.importOpenAICodexAuth.mockResolvedValue({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-03-17T00:00:00.000Z"),
      accountId: "acct_test",
    });

    await runCli([
      "import-codex-auth",
      "--auth-file",
      "./oauth.json",
      "--source",
      "./codex-auth.json",
    ]);

    expect(authStoreMocks.importOpenAICodexAuth).toHaveBeenCalledWith("./codex-auth.json");
    const output = joinedOutput(stdoutSpy);
    expect(output).toContain("Imported OpenAI Codex credentials from ./codex-auth.json\n");
    expect(output).toContain("expiresAt: 2026-03-17T00:00:00.000Z\n");
  });

  it("logs out a provider", async () => {
    authStoreMocks.logout.mockResolvedValue(undefined);

    await runCli(["logout", "--provider", "google-gemini-cli", "--auth-file", "./oauth.json"]);

    expect(authStoreMocks.logout).toHaveBeenCalledWith("google-gemini-cli");
    const output = joinedOutput(stdoutSpy);
    expect(output).toContain("Removed stored OAuth credentials for google-gemini-cli\n");
  });
});
