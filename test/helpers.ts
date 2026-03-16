import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OAuthCredentialRecord, OAuthProviderId } from "../src/types.js";

export function createTempAuthFile(
  providerId: OAuthProviderId,
  record: OAuthCredentialRecord,
): { authFile: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "ai-sdk-oauth-providers-"));
  const authFile = join(directory, "auth.json");
  writeFileSync(authFile, JSON.stringify({ [providerId]: record }, null, 2), "utf8");

  return {
    authFile,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export function createSseResponse(events: Array<{ event?: string; data: unknown | string }>): Response {
  const payload = events.map((entry) => {
    const eventLine = entry.event ? `event: ${entry.event}\n` : "";
    const data = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data);
    return `${eventLine}data: ${data}\n\n`;
  }).join("");

  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

export async function readTextStream(stream: AsyncIterable<string>): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    output += chunk;
  }
  return output;
}

export function futureExpiry(hours = 1): number {
  return Date.now() + hours * 60 * 60 * 1000;
}
