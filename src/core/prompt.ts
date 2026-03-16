import {
  InvalidPromptError,
  UnsupportedFunctionalityError,
  type LanguageModelV3CallOptions,
  type LanguageModelV3FunctionTool,
  type LanguageModelV3ProviderTool,
  type LanguageModelV3ToolChoice,
  type LanguageModelV3ToolResultOutput,
  type SharedV3Warning,
} from "@ai-sdk/provider";

import type {
  PreparedRuntimeCall,
  RuntimeAssistantContent,
  RuntimeCallSettings,
  RuntimeContext,
  RuntimeResponseFormat,
  RuntimeToolChoice,
  RuntimeToolDefinition,
  RuntimeToolResultMessage,
  RuntimeUserTextPart,
} from "./runtime-types.js";

export function prepareRuntimeCall(options: LanguageModelV3CallOptions): PreparedRuntimeCall {
  const warnings: SharedV3Warning[] = [];
  const tools = selectTools(options.tools, warnings);
  const context = convertPromptToContext(options, tools, warnings);
  const settings = buildRuntimeCallSettings(options);

  pushUnsupportedWarnings(options, warnings);

  return {
    context,
    settings,
    warnings,
  };
}

function buildRuntimeCallSettings(options: LanguageModelV3CallOptions): RuntimeCallSettings {
  const headers = normalizeHeaders(options.headers);

  return {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    ...(headers ? { headers } : {}),
  };
}

function normalizeHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const entries = Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function pushUnsupportedWarnings(options: LanguageModelV3CallOptions, warnings: SharedV3Warning[]): void {
  const features: string[] = [];

  if (options.stopSequences?.length) features.push("stopSequences");
  if (options.topP !== undefined) features.push("topP");
  if (options.topK !== undefined) features.push("topK");
  if (options.presencePenalty !== undefined) features.push("presencePenalty");
  if (options.frequencyPenalty !== undefined) features.push("frequencyPenalty");
  if (options.seed !== undefined) features.push("seed");
  if (options.includeRawChunks) features.push("includeRawChunks");

  for (const feature of features) {
    warnings.push({
      type: "unsupported",
      feature,
      details: "This package currently supports text generation, streaming, tool calling, and JSON compatibility mode only.",
    });
  }
}

function selectTools(
  tools: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool> | undefined,
  warnings: SharedV3Warning[],
): RuntimeToolDefinition[] | undefined {
  const supportedTools = (tools ?? []).flatMap((tool) => {
    if (tool.type === "provider") {
      warnings.push({
        type: "unsupported",
        feature: "provider-tools",
        details: `Provider tool '${tool.name}' is not supported by this package.`,
      });
      return [];
    }

    return [{
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }];
  });

  return supportedTools.length > 0 ? supportedTools : undefined;
}

function convertPromptToContext(
  options: LanguageModelV3CallOptions,
  tools: RuntimeToolDefinition[] | undefined,
  warnings: SharedV3Warning[],
): RuntimeContext {
  const systemPrompts: string[] = [];
  const messages: RuntimeContext["messages"] = [];

  for (const message of options.prompt) {
    switch (message.role) {
      case "system":
        systemPrompts.push(message.content);
        break;
      case "user":
        messages.push({
          role: "user",
          content: convertUserContent(message.content),
        });
        break;
      case "assistant": {
        const converted = convertAssistantContent(message.content);
        if (converted.assistantContent.length > 0) {
          messages.push({
            role: "assistant",
            content: converted.assistantContent,
          });
        }
        messages.push(...converted.toolResults);
        break;
      }
      case "tool":
        messages.push(...convertToolMessage(message.content));
        break;
      default: {
        const exhaustive: never = message;
        throw new InvalidPromptError({
          prompt: options.prompt,
          message: `Unsupported prompt message: ${JSON.stringify(exhaustive)}`,
        });
      }
    }
  }

  const responseFormat = buildResponseFormat(options.responseFormat, warnings);

  if (responseFormat.type === "json") {
    systemPrompts.push(responseFormat.instruction);
  }

  return {
    ...(systemPrompts.length > 0 ? { systemPrompt: systemPrompts.join("\n\n") } : {}),
    messages,
    ...(tools ? { tools } : {}),
    ...(options.toolChoice ? { toolChoice: mapToolChoice(options.toolChoice) } : {}),
    responseFormat,
  };
}

function buildResponseFormat(
  responseFormat: LanguageModelV3CallOptions["responseFormat"],
  warnings: SharedV3Warning[],
): RuntimeResponseFormat {
  if (!responseFormat || responseFormat.type === "text") {
    return { type: "text" };
  }

  warnings.push({
    type: "unsupported",
    feature: "native-json-schema",
    details: "Using compatibility JSON mode instead of a provider-native JSON schema contract.",
  });

  const schemaDescription = responseFormat.schema ? `Schema: ${JSON.stringify(responseFormat.schema)}` : "";
  const nameDescription = responseFormat.name ? `Name: ${responseFormat.name}` : "";
  const outputDescription = responseFormat.description ? `Description: ${responseFormat.description}` : "";
  const instruction = [
    "Return only valid JSON.",
    "Do not wrap the JSON in markdown fences or prose.",
    nameDescription,
    outputDescription,
    schemaDescription,
  ].filter(Boolean).join("\n");

  return {
    type: "json",
    instruction,
    ...(responseFormat.schema ? { schema: responseFormat.schema } : {}),
  };
}

function mapToolChoice(toolChoice: LanguageModelV3ToolChoice): RuntimeToolChoice {
  switch (toolChoice.type) {
    case "auto":
      return { type: "auto" };
    case "none":
      return { type: "none" };
    case "required":
      return { type: "required" };
    case "tool":
      return { type: "tool", toolName: toolChoice.toolName };
    default: {
      const exhaustive: never = toolChoice;
      return exhaustive;
    }
  }
}

function convertUserContent(
  content: Array<{ type: string; text?: string }>,
): string | RuntimeUserTextPart[] {
  const textParts = content.map((part) => {
    if (part.type !== "text") {
      throw unsupportedPromptPart("user", part.type);
    }
    return { type: "text" as const, text: part.text ?? "" };
  });

  if (textParts.length === 0) {
    return "";
  }

  if (textParts.length === 1) {
    return textParts[0]?.text ?? "";
  }

  return textParts;
}

function convertAssistantContent(
  content: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown }>,
): {
  assistantContent: RuntimeAssistantContent[];
  toolResults: RuntimeToolResultMessage[];
} {
  const assistantContent: RuntimeAssistantContent[] = [];
  const toolResults: RuntimeToolResultMessage[] = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        assistantContent.push({ type: "text", text: part.text ?? "" });
        break;
      case "reasoning":
        assistantContent.push({ type: "thinking", thinking: part.text ?? "" });
        break;
      case "tool-call":
        assistantContent.push({
          type: "toolCall",
          id: part.toolCallId ?? "",
          name: part.toolName ?? "",
          arguments: requireJSONObject(part.input, "assistant.tool-call.input"),
        });
        break;
      case "tool-result":
        toolResults.push(toToolResultMessage({
          toolCallId: part.toolCallId ?? "",
          toolName: part.toolName ?? "",
          output: part.output as LanguageModelV3ToolResultOutput,
        }));
        break;
      default:
        throw unsupportedPromptPart("assistant", part.type);
    }
  }

  return { assistantContent, toolResults };
}

function convertToolMessage(
  content: Array<{ type: string; toolCallId?: string; toolName?: string; output?: unknown }>,
): RuntimeToolResultMessage[] {
  return content.map((part) => {
    if (part.type !== "tool-result") {
      throw unsupportedPromptPart("tool", part.type);
    }

    return toToolResultMessage({
      toolCallId: part.toolCallId ?? "",
      toolName: part.toolName ?? "",
      output: part.output as LanguageModelV3ToolResultOutput,
    });
  });
}

function toToolResultMessage(part: {
  toolCallId: string;
  toolName: string;
  output: LanguageModelV3ToolResultOutput;
}): RuntimeToolResultMessage {
  const output = convertToolResultOutput(part.output);

  return {
    role: "toolResult",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    content: output.content,
    isError: output.isError,
  };
}

function convertToolResultOutput(output: LanguageModelV3ToolResultOutput): {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
} {
  switch (output.type) {
    case "text":
      return { content: [{ type: "text", text: output.value }], isError: false };
    case "json":
      return { content: [{ type: "text", text: JSON.stringify(output.value) }], isError: false };
    case "error-text":
      return { content: [{ type: "text", text: output.value }], isError: true };
    case "error-json":
      return { content: [{ type: "text", text: JSON.stringify(output.value) }], isError: true };
    case "execution-denied":
      return { content: [{ type: "text", text: output.reason ?? "Tool execution denied." }], isError: true };
    case "content":
      return {
        content: output.value.map((part) => {
          if (part.type !== "text") {
            throw new UnsupportedFunctionalityError({
              functionality: "tool result multimodal content",
              message: "This package only supports text tool result content.",
            });
          }
          return { type: "text" as const, text: part.text };
        }),
        isError: false,
      };
    default: {
      const exhaustive: never = output;
      throw new InvalidPromptError({
        prompt: output,
        message: `Unsupported tool result output: ${JSON.stringify(exhaustive)}`,
      });
    }
  }
}

function requireJSONObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new InvalidPromptError({
      prompt: value,
      message: `Expected ${field} to be a JSON object.`,
    });
  }

  return value as Record<string, unknown>;
}

function unsupportedPromptPart(role: string, type: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    functionality: `languageModelV3:${role}:${type}`,
    message: `Prompt part '${type}' in ${role} messages is not supported by this package.`,
  });
}
