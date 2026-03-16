import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import lockfile from "proper-lockfile";

import {
  getOAuthProvider,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  type OAuthProviderInterface,
} from "@mariozechner/pi-ai/oauth";

import {
  importOpenAICodexCredentialsFromCodexAuth,
  loginOpenAICodexWithBrowserAuth,
  loginOpenAICodexWithDeviceAuth,
  refreshOpenAICodexCredentials,
} from "./openai-codex-login.js";
import {
  OAUTH_PROVIDER_IDS,
  type OAuthAuthFile,
  type OAuthCredentialRecord,
  type OAuthProviderId,
  type OAuthProviderStatus,
} from "../types.js";

type AuthData = Partial<Record<OAuthProviderId, OAuthCredentialRecord>>;

type LockedMutationResult<T> = {
  result: T;
  next?: AuthData;
};

function getSupportedOAuthProvider(providerId: OAuthProviderId): OAuthProviderInterface {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown OAuth provider: ${providerId}`);
  }
  return provider;
}

export function getSupportedOAuthProviders(): OAuthProviderInterface[] {
  return OAUTH_PROVIDER_IDS.map((providerId) => getSupportedOAuthProvider(providerId));
}

export class OAuthAuthStore {
  constructor(readonly authFile: OAuthAuthFile) {}

  async login(
    providerId: OAuthProviderId,
    callbacks: OAuthLoginCallbacks,
    options?: { deviceAuth?: boolean },
  ): Promise<OAuthCredentialRecord> {
    const credentials = providerId === "openai-codex"
      ? options?.deviceAuth
        ? await loginOpenAICodexWithDeviceAuth(callbacks)
        : await loginOpenAICodexWithBrowserAuth(callbacks)
      : await getSupportedOAuthProvider(providerId).login(callbacks);

    const record: OAuthCredentialRecord = { type: "oauth", ...credentials };
    await this.writeRecord(providerId, record);
    return record;
  }

  async importOpenAICodexAuth(sourceAuthFile: string): Promise<OAuthCredentialRecord> {
    const credentials = importOpenAICodexCredentialsFromCodexAuth(sourceAuthFile);
    const record: OAuthCredentialRecord = { type: "oauth", ...credentials };
    await this.writeRecord("openai-codex", record);
    return record;
  }

  async logout(providerId: OAuthProviderId): Promise<void> {
    await this.withLock(async (data) => {
      const next = { ...data };
      delete next[providerId];
      return { result: undefined, next };
    });
  }

  async getStatus(providerId: OAuthProviderId): Promise<OAuthProviderStatus> {
    const data = await this.read();
    const record = data[providerId];

    if (!record) {
      return { providerId, stored: false };
    }

    return {
      providerId,
      stored: true,
      expiresAt: record.expires,
      expired: Date.now() >= record.expires,
    };
  }

  async getRecord(providerId: OAuthProviderId): Promise<OAuthCredentialRecord | undefined> {
    const data = await this.read();
    return data[providerId];
  }

  async getCredentials(providerId: OAuthProviderId): Promise<OAuthCredentialRecord> {
    return this.withLock(async (data) => {
      const current = data[providerId];
      if (!current) {
        throw new Error(`No stored OAuth credentials for provider: ${providerId}`);
      }

      if (Date.now() < current.expires) {
        return { result: current };
      }

      const refreshed = providerId === "openai-codex"
        ? await refreshOpenAICodexCredentials(current.refresh)
        : await getSupportedOAuthProvider(providerId).refreshToken(current as OAuthCredentials);

      const nextRecord: OAuthCredentialRecord = {
        ...current,
        ...refreshed,
        type: "oauth",
      };

      return {
        result: nextRecord,
        next: {
          ...data,
          [providerId]: nextRecord,
        },
      };
    });
  }

  getProviders(): OAuthProviderInterface[] {
    return getSupportedOAuthProviders();
  }

  private async writeRecord(providerId: OAuthProviderId, record: OAuthCredentialRecord): Promise<void> {
    await this.withLock(async (data) => ({
      result: undefined,
      next: { ...data, [providerId]: record },
    }));
  }

  private async read(): Promise<AuthData> {
    this.ensureFile();
    return this.parseData(readFileSync(this.authFile, "utf8"));
  }

  private async withLock<T>(mutate: (data: AuthData) => Promise<LockedMutationResult<T>>): Promise<T> {
    this.ensureFile();

    const release = await lockfile.lock(this.authFile, {
      realpath: false,
      retries: {
        retries: 10,
        factor: 2,
        minTimeout: 50,
        maxTimeout: 2000,
        randomize: true,
      },
      stale: 30_000,
    });

    try {
      const current = this.parseData(readFileSync(this.authFile, "utf8"));
      const { result, next } = await mutate(current);
      if (next) {
        writeFileSync(this.authFile, JSON.stringify(next, null, 2), "utf8");
        chmodSync(this.authFile, 0o600);
      }
      return result;
    } finally {
      await release();
    }
  }

  private ensureFile(): void {
    const parent = dirname(this.authFile);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(this.authFile)) {
      writeFileSync(this.authFile, "{}", "utf8");
      chmodSync(this.authFile, 0o600);
    }
  }

  private parseData(content: string): AuthData {
    try {
      const parsed = JSON.parse(content) as AuthData;
      return parsed ?? {};
    } catch (error) {
      throw new Error(`Failed to parse auth file '${this.authFile}': ${String(error)}`);
    }
  }
}
