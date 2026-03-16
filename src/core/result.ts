import type {
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

import type { RuntimeAssistantMessage } from "./runtime-types.js";

export function toGenerateResult(
  message: RuntimeAssistantMessage,
  warnings: SharedV3Warning[],
): LanguageModelV3GenerateResult {
  return {
    content: toContent(message),
    finishReason: toFinishReason(message.stopReason),
    usage: toUsage(message),
    response: {
      ...toResponseMetadata(message),
    },
    warnings,
  };
}

export function toResponseMetadata(message: RuntimeAssistantMessage): LanguageModelV3ResponseMetadata {
  return {
    ...(message.responseId ? { id: message.responseId } : {}),
    timestamp: new Date(message.timestamp),
    modelId: message.model,
  };
}

export function toFinishReason(reason: RuntimeAssistantMessage["stopReason"]): LanguageModelV3FinishReason {
  return {
    unified: toUnifiedFinishReason(reason),
    raw: reason,
  };
}

export function toUsage(message: RuntimeAssistantMessage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
      noCache: message.usage.input,
      cacheRead: message.usage.cacheRead,
      cacheWrite: message.usage.cacheWrite,
    },
    outputTokens: {
      total: message.usage.output,
      text: message.usage.output,
      reasoning: undefined,
    },
    raw: {
      totalTokens: message.usage.totalTokens,
    },
  };
}

function toUnifiedFinishReason(
  reason: RuntimeAssistantMessage["stopReason"],
): LanguageModelV3FinishReason["unified"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "toolUse":
      return "tool-calls";
    case "error":
    case "aborted":
      return "error";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function toContent(message: RuntimeAssistantMessage): LanguageModelV3GenerateResult["content"] {
  return message.content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text",
          text: part.text,
        };
      case "thinking":
        return {
          type: "reasoning",
          text: part.thinking,
        };
      case "toolCall":
        return {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          input: JSON.stringify(part.arguments ?? {}),
        };
      default: {
        const exhaustive: never = part;
        return exhaustive;
      }
    }
  });
}
