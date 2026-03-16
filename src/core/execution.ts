import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { LoadAPIKeyError } from "@ai-sdk/provider";

import { OAuthAuthStore } from "../auth/store.js";
import type { OAuthProviderId } from "../types.js";
import { prepareRuntimeCall } from "./prompt.js";
import { toGenerateResult } from "./result.js";
import { toLanguageModelV3Stream } from "./stream.js";
import { anthropicTransport } from "../providers/anthropic.js";
import { geminiCliTransport } from "../providers/google-gemini-cli.js";
import { openAICodexTransport } from "../providers/openai-codex.js";
import type { PreparedRuntimeCall, RuntimeAssistantMessage } from "./runtime-types.js";
import type { ProviderTransport } from "../providers/shared.js";

type CreateLanguageModelOptions = {
  providerId: OAuthProviderId;
  modelId: string;
  authStore: OAuthAuthStore;
  fetch?: typeof globalThis.fetch;
};

const transportByProviderId: Record<OAuthProviderId, ProviderTransport> = {
  "anthropic": anthropicTransport,
  "google-gemini-cli": geminiCliTransport,
  "openai-codex": openAICodexTransport,
};

export function createLanguageModel(options: CreateLanguageModelOptions): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: `ai-sdk-oauth-providers/${options.providerId}`,
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate(callOptions: LanguageModelV3CallOptions) {
      const prepared = prepareRuntimeCall(callOptions);
      const { message, warnings } = await executeGenerate(options, prepared);
      return toGenerateResult(message, warnings);
    },
    async doStream(callOptions: LanguageModelV3CallOptions) {
      const prepared = prepareRuntimeCall(callOptions);
      const { source, warnings } = await executeStream(options, prepared);

      return {
        stream: toLanguageModelV3Stream(source, warnings),
      };
    },
  };
}

async function executeGenerate(
  options: CreateLanguageModelOptions,
  prepared: PreparedRuntimeCall,
): Promise<{ message: RuntimeAssistantMessage; warnings: SharedV3Warning[] }> {
  const { source, warnings } = await executeStream(options, prepared);
  let finalMessage: RuntimeAssistantMessage | undefined;

  for await (const event of source) {
    if (event.type === "done") {
      finalMessage = event.message;
      break;
    }

    if (event.type === "error") {
      throw new Error(event.error.responseId ?? "OAuth provider call failed");
    }
  }

  if (!finalMessage) {
    throw new Error("OAuth provider call completed without a final message");
  }

  return { message: finalMessage, warnings };
}

async function executeStream(
  options: CreateLanguageModelOptions,
  prepared: PreparedRuntimeCall,
): Promise<{ source: AsyncIterable<import("./runtime-types.js").RuntimeStreamEvent>; warnings: SharedV3Warning[] }> {
  const warnings = [...prepared.warnings];
  const transport = transportByProviderId[options.providerId];
  const credentials = await loadCredentials(options.authStore, options.providerId);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const source = await transport.stream({
    providerId: options.providerId,
    modelId: options.modelId,
    prepared,
    credentials,
    fetch: fetchImpl,
    warnings,
  });

  return { source, warnings };
}

async function loadCredentials(authStore: OAuthAuthStore, providerId: OAuthProviderId) {
  try {
    return await authStore.getCredentials(providerId);
  } catch (error) {
    throw new LoadAPIKeyError({
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
