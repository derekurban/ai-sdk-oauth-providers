import type { JSONValue } from "@ai-sdk/provider";

import type { ProviderTransport, TransportCallOptions } from "./shared.js";
import {
  createEmptyAssistantMessage,
  jsonParse,
  mapUsage,
  parseSseEvents,
} from "./shared.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const CLAUDE_CODE_VERSION = "2.1.75";
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

type AnthropicRequestBody = {
  model: string;
  messages: unknown[];
  system?: Array<{ type: "text"; text: string }>;
  max_tokens: number;
  stream: true;
  temperature?: number;
  tools?: unknown[];
  tool_choice?: { type: "auto" | "any" | "none" | "tool"; name?: string };
};

export const anthropicTransport: ProviderTransport = {
  providerId: "anthropic",
  api: "anthropic-messages",
  async stream(options) {
    const output = createEmptyAssistantMessage("anthropic-messages", options.providerId, options.modelId);
    const requestBody = buildRequestBody(options);
    const requestInit: RequestInit = {
      method: "POST",
      headers: buildAnthropicHeaders(options),
      body: JSON.stringify(requestBody),
    };
    if (options.prepared.settings.abortSignal) {
      requestInit.signal = options.prepared.settings.abortSignal;
    }

    const response = await options.fetch(ANTHROPIC_URL, requestInit);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Anthropic OAuth API error (${response.status}): ${text || response.statusText}`);
    }

    return anthropicEventStream(response, output);
  },
};

function buildRequestBody(options: TransportCallOptions): AnthropicRequestBody {
  const body: AnthropicRequestBody = {
    model: options.modelId,
    messages: convertAnthropicMessages(options.prepared.context.messages),
    max_tokens: options.prepared.settings.maxOutputTokens ?? 4096,
    stream: true,
  };

  const system = [CLAUDE_CODE_IDENTITY];
  if (options.prepared.context.systemPrompt?.trim()) {
    system.push(options.prepared.context.systemPrompt);
  }
  body.system = system.map((text) => ({ type: "text", text }));

  if (options.prepared.settings.temperature !== undefined) {
    body.temperature = options.prepared.settings.temperature;
  }

  if (options.prepared.context.tools?.length) {
    body.tools = options.prepared.context.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    if (options.prepared.context.toolChoice) {
      body.tool_choice = mapToolChoice(options.prepared.context.toolChoice);
    }
  }

  return body;
}

function buildAnthropicHeaders(options: TransportCallOptions): Headers {
  const headers = new Headers(options.prepared.settings.headers);
  headers.set("Authorization", `Bearer ${options.credentials.access}`);
  headers.set("anthropic-version", ANTHROPIC_VERSION);
  headers.set("anthropic-dangerous-direct-browser-access", "true");
  headers.set("anthropic-beta", "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("user-agent", `claude-cli/${CLAUDE_CODE_VERSION}`);
  headers.set("x-app", "cli");
  return headers;
}

function convertAnthropicMessages(messages: TransportCallOptions["prepared"]["context"]["messages"]): unknown[] {
  const converted: unknown[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;

    if (message.role === "user") {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.text).join("\n");
      converted.push({
        role: "user",
        content: text,
      });
      continue;
    }

    if (message.role === "assistant") {
      const content = message.content.map((part) => {
        switch (part.type) {
          case "text":
            return { type: "text", text: part.text };
          case "thinking":
            return { type: "text", text: part.thinking };
          case "toolCall":
            return {
              type: "tool_use",
              id: part.id,
              name: part.name,
              input: part.arguments ?? {},
            };
          default: {
            const exhaustive: never = part;
            return exhaustive;
          }
        }
      });
      converted.push({
        role: "assistant",
        content,
      });
      continue;
    }

    const toolMessage = message;
    const toolResults = [{
      type: "tool_result",
      tool_use_id: toolMessage.toolCallId,
      content: toolMessage.content.map((part) => part.text).join("\n"),
      is_error: toolMessage.isError,
    }];

    while (index + 1 < messages.length && messages[index + 1]?.role === "toolResult") {
      index += 1;
      const nextMessage = messages[index]!;
      if (nextMessage.role !== "toolResult") {
        break;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: nextMessage.toolCallId,
        content: nextMessage.content.map((part) => part.text).join("\n"),
        is_error: nextMessage.isError,
      });
    }

    converted.push({
      role: "user",
      content: toolResults,
    });
  }

  return converted;
}

function mapToolChoice(toolChoice: NonNullable<TransportCallOptions["prepared"]["context"]["toolChoice"]>) {
  switch (toolChoice.type) {
    case "auto":
      return { type: "auto" as const };
    case "none":
      return { type: "none" as const };
    case "required":
      return { type: "any" as const };
    case "tool":
      return { type: "tool" as const, name: toolChoice.toolName };
    default: {
      const exhaustive: never = toolChoice;
      return exhaustive;
    }
  }
}

async function* anthropicEventStream(
  response: Response,
  output: ReturnType<typeof createEmptyAssistantMessage>,
) {
  const blockByAnthropicIndex = new Map<number, { contentIndex: number; partialJson?: string }>();
  yield { type: "start", partial: output } as const;

  for await (const sseEvent of parseSseEvents(response)) {
    if (!sseEvent.event) {
      continue;
    }

    if (sseEvent.event === "ping") {
      continue;
    }

    const payload = jsonParse<Record<string, unknown>>(sseEvent.data, "Failed to parse Anthropic SSE event");

    switch (sseEvent.event) {
      case "message_start": {
        const message = payload.message as Record<string, unknown> | undefined;
        if (typeof message?.id === "string") {
          output.responseId = message.id;
        }
        const usage = message?.usage as Record<string, unknown> | undefined;
        output.usage = mapUsage({
          input: numberValue(usage?.input_tokens),
          output: numberValue(usage?.output_tokens),
          cacheRead: numberValue(usage?.cache_read_input_tokens),
          cacheWrite: numberValue(usage?.cache_creation_input_tokens),
        });
        break;
      }
      case "content_block_start": {
        const anthropicIndex = numberValue(payload.index);
        const block = payload.content_block as Record<string, unknown> | undefined;
        const blockType = typeof block?.type === "string" ? block.type : undefined;

        if (anthropicIndex === undefined || !blockType) {
          break;
        }

        if (blockType === "text") {
          output.content.push({ type: "text", text: "" });
          blockByAnthropicIndex.set(anthropicIndex, { contentIndex: output.content.length - 1 });
          yield { type: "text_start", contentIndex: output.content.length - 1, partial: output } as const;
        } else if (blockType === "thinking" || blockType === "redacted_thinking") {
          output.content.push({
            type: "thinking",
            thinking: blockType === "redacted_thinking" ? "[Reasoning redacted]" : "",
          });
          blockByAnthropicIndex.set(anthropicIndex, { contentIndex: output.content.length - 1 });
          yield { type: "thinking_start", contentIndex: output.content.length - 1, partial: output } as const;
        } else if (blockType === "tool_use") {
          output.content.push({
            type: "toolCall",
            id: String(block?.id ?? `tool_${anthropicIndex}`),
            name: String(block?.name ?? "tool"),
            arguments: parseJsonObject(block?.input ?? {}),
          });
          blockByAnthropicIndex.set(anthropicIndex, {
            contentIndex: output.content.length - 1,
            partialJson: "",
          });
          yield { type: "toolcall_start", contentIndex: output.content.length - 1, partial: output } as const;
        }
        break;
      }
      case "content_block_delta": {
        const anthropicIndex = numberValue(payload.index);
        const delta = payload.delta as Record<string, unknown> | undefined;
        const deltaType = typeof delta?.type === "string" ? delta.type : undefined;
        const blockState = anthropicIndex === undefined ? undefined : blockByAnthropicIndex.get(anthropicIndex);

        if (!blockState || !deltaType) {
          break;
        }

        const block = output.content[blockState.contentIndex];
        if (!block) {
          break;
        }

        if (deltaType === "text_delta" && block.type === "text") {
          const textDelta = String(delta?.text ?? "");
          block.text += textDelta;
          yield { type: "text_delta", contentIndex: blockState.contentIndex, delta: textDelta, partial: output } as const;
        } else if (deltaType === "thinking_delta" && block.type === "thinking") {
          const thinkingDelta = String(delta?.thinking ?? "");
          block.thinking += thinkingDelta;
          yield {
            type: "thinking_delta",
            contentIndex: blockState.contentIndex,
            delta: thinkingDelta,
            partial: output,
          } as const;
        } else if (deltaType === "input_json_delta" && block.type === "toolCall") {
          const jsonDelta = String(delta?.partial_json ?? "");
          blockState.partialJson = `${blockState.partialJson ?? ""}${jsonDelta}`;
          block.arguments = parseJsonObject(blockState.partialJson ?? "{}");
          yield {
            type: "toolcall_delta",
            contentIndex: blockState.contentIndex,
            delta: jsonDelta,
            partial: output,
          } as const;
        }
        break;
      }
      case "content_block_stop": {
        const anthropicIndex = numberValue(payload.index);
        const blockState = anthropicIndex === undefined ? undefined : blockByAnthropicIndex.get(anthropicIndex);
        if (!blockState) {
          break;
        }

        const block = output.content[blockState.contentIndex];
        if (block?.type === "text") {
          yield { type: "text_end", contentIndex: blockState.contentIndex, partial: output } as const;
        } else if (block?.type === "thinking") {
          yield { type: "thinking_end", contentIndex: blockState.contentIndex, partial: output } as const;
        } else if (block?.type === "toolCall") {
          block.arguments = parseJsonObject(blockState.partialJson ?? block.arguments);
          yield {
            type: "toolcall_end",
            contentIndex: blockState.contentIndex,
            toolCall: block,
            partial: output,
          } as const;
        }

        if (anthropicIndex !== undefined) {
          blockByAnthropicIndex.delete(anthropicIndex);
        }
        break;
      }
      case "message_delta": {
        const delta = payload.delta as Record<string, unknown> | undefined;
        const usage = payload.usage as Record<string, unknown> | undefined;
        const stopReason = typeof delta?.stop_reason === "string" ? delta.stop_reason : undefined;
        if (stopReason) {
          output.stopReason = mapStopReason(stopReason);
        }
        output.usage = mapUsage({
          input: numberValue(usage?.input_tokens) ?? output.usage.input,
          output: numberValue(usage?.output_tokens) ?? output.usage.output,
          cacheRead: numberValue(usage?.cache_read_input_tokens) ?? output.usage.cacheRead,
          cacheWrite: numberValue(usage?.cache_creation_input_tokens) ?? output.usage.cacheWrite,
        });
        break;
      }
      case "message_stop":
        output.timestamp = Date.now();
        yield { type: "done", reason: output.stopReason, message: output } as const;
        return;
      case "error": {
        const errorPayload = payload.error as Record<string, unknown> | undefined;
        throw new Error(String(errorPayload?.message ?? "Anthropic stream error"));
      }
      default:
        break;
    }
  }

  throw new Error("Anthropic stream ended without message_stop");
}

function parseJsonObject(input: unknown): Record<string, JSONValue> {
  if (typeof input !== "string") {
    if (!input || Array.isArray(input) || typeof input !== "object") {
      return {};
    }
    return input as Record<string, JSONValue>;
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, JSONValue>;
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function mapStopReason(reason: string) {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    case "stop_sequence":
    case "pause_turn":
      return "stop";
    case "refusal":
    case "sensitive":
      return "error";
    default:
      return "error";
  }
}
