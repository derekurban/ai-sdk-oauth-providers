import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@mastra/core/agent";
import { tool } from "ai";
import { z } from "zod";

import { createOpenAICodexOAuth } from "./index.js";
import { withMastraCompat } from "./mastra.js";
import { createSseResponse, createTempAuthFile, futureExpiry, readTextStream } from "../test/helpers.js";

function createAgentStub() {
  const tools = { existing: { id: "existing-tool" } };
  const generate = vi.fn(async (_input: unknown, options?: Record<string, unknown>) => ({ options }));
  const stream = vi.fn(async (_input: unknown, options?: Record<string, unknown>) => ({ options }));

  const agent = {
    async listTools() {
      return tools;
    },
    __setTools: vi.fn(),
    generate,
    stream,
  };

  return { agent, generate, stream, tools };
}

function createCodexTextResponse(text: string): Response {
  return createSseResponse([
    { data: { type: "response.output_item.added", item: { type: "message" } } },
    { data: { type: "response.output_text.delta", delta: text.slice(0, Math.max(1, Math.floor(text.length / 2))) } },
    { data: { type: "response.output_text.delta", delta: text.slice(Math.max(1, Math.floor(text.length / 2))) } },
    { data: { type: "response.output_item.done", item: { type: "message", id: "msg_1", content: [{ type: "output_text", text }] } } },
    {
      data: {
        type: "response.completed",
        response: {
          id: "resp_codex",
          status: "completed",
          usage: {
            input_tokens: 12,
            output_tokens: 6,
            total_tokens: 18,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    },
  ]);
}

function createCodexToolCallResponse(toolName: string, input: Record<string, unknown>): Response {
  return createSseResponse([
    {
      data: {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          call_id: "call_weather",
          id: "fc_weather",
          name: toolName,
          arguments: "{}",
        },
      },
    },
    {
      data: {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "call_weather",
          id: "fc_weather",
          name: toolName,
          arguments: JSON.stringify(input),
        },
      },
    },
    {
      data: {
        type: "response.completed",
        response: {
          id: "resp_codex_tool",
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 3,
            total_tokens: 13,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    },
  ]);
}

describe("withMastraCompat", () => {
  it("maps output to structuredOutput for generate calls", async () => {
    const { agent } = createAgentStub();
    const schema = { type: "object" };
    const wrapped = withMastraCompat(agent);

    const result = await wrapped.generate("ping", { output: schema, temperature: 0.2 }) as { options: Record<string, unknown> };

    expect(result.options).toEqual({
      structuredOutput: { schema },
      temperature: 0.2,
    });
  });

  it("temporarily promotes clientTools into agent tools for generate", async () => {
    const { agent, tools } = createAgentStub();
    const wrapped = withMastraCompat(agent);
    const clientTools = {
      weather: { id: "weather-tool", execute: vi.fn() },
    };

    const result = await wrapped.generate("ping", {
      clientTools,
      maxSteps: 3,
    }) as { options: Record<string, unknown> };

    expect(agent.__setTools).toHaveBeenNthCalledWith(1, {
      ...tools,
      ...clientTools,
    });
    expect(result.options).toEqual({
      maxSteps: 3,
    });
    expect(agent.__setTools).toHaveBeenNthCalledWith(2, tools);
  });

  it("wraps an agent only once", async () => {
    const { agent, generate } = createAgentStub();
    const once = withMastraCompat(agent);
    const twice = withMastraCompat(once);

    await twice.generate("ping");

    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("Mastra integration", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function createCodexAgent(responses: Response[], useCompat = false, withTools = true) {
    const fetch = vi.fn(async () => {
      const next = responses.shift();
      if (!next) {
        throw new Error("No mocked Codex response left");
      }
      return next;
    });

    const { authFile, cleanup } = createTempAuthFile("openai-codex", {
      type: "oauth",
      access: "codex-access-token",
      refresh: "codex-refresh-token",
      expires: futureExpiry(),
      accountId: "acct_test",
    });
    cleanups.push(cleanup);

    const provider = createOpenAICodexOAuth({ authFile, fetch });
    const weatherTool = tool({
      description: "Returns a canned forecast for a city.",
      inputSchema: z.object({
        city: z.string(),
      }),
      execute: async ({ city }) => `clear-skies-for-${city.toLowerCase()}`,
    });

    const agent = new Agent({
      id: "oauth-agent",
      name: "OAuth Agent",
      instructions: "You are concise.",
      model: provider.languageModel("gpt-5.4"),
      ...(withTools ? {
        tools: {
          weather: weatherTool as any,
        },
      } : {}),
    } as any);

    return {
      agent: useCompat ? withMastraCompat(agent as any) : agent,
      weatherTool,
    };
  }

  it("supports raw Agent.generate", async () => {
    const { agent } = createCodexAgent([createCodexTextResponse("mastra-generate")]);

    const result = await (agent as any).generate("Reply with exactly: mastra-generate");
    expect(result.text).toBe("mastra-generate");
  });

  it("supports raw Agent.stream", async () => {
    const { agent } = createCodexAgent([createCodexTextResponse("mastra-stream")]);

    const result = await (agent as any).stream("Reply with exactly: mastra-stream");
    const text = await readTextStream(result.textStream);
    expect(text).toBe("mastra-stream");
  });

  it("supports structured output with the Mastra compatibility shim", async () => {
    const { agent } = createCodexAgent([createCodexTextResponse("{\"status\":\"ok\",\"code\":7}")], true);

    const result = await (agent as any).generate("Return an object with status ok and code 7.", {
      output: z.object({
        status: z.string(),
        code: z.number(),
      }),
    });

    expect(result.object).toEqual({ status: "ok", code: 7 });
  });

  it("supports clientTools with the Mastra compatibility shim", async () => {
    const { agent, weatherTool } = createCodexAgent([
      createCodexToolCallResponse("weather", { city: "Calgary" }),
      createCodexTextResponse("clear-skies-for-calgary"),
    ], true, false);

    const result = await (agent as any).generate("Use the weather tool for Calgary, then answer with the forecast only.", {
      clientTools: {
        weather: weatherTool as any,
      },
      maxSteps: 3,
    });

    expect(result.text).toBe("clear-skies-for-calgary");
  });
});
