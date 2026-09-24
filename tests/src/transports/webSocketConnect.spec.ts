/**
 * WebSocketTransport connect url handling: the token is added per connect and
 * never accumulates on the stored base url.
 */

import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { TransportStartError } from "@pipecat-ai/client-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createFakeMediaManager } from "../helpers/fakeMediaManager";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

describe("WebSocketTransport connect url", () => {
  let transport: WebSocketTransport;
  let urls: string[];

  beforeEach(() => {
    transport = new WebSocketTransport({
      mediaManager: createFakeMediaManager() as never,
    });
    wireTransport(transport, buildSpyCallbacks().callbacks);
    urls = [];
    vi.spyOn(transport, "initializeWebsocket").mockImplementation(
      (url?: string) => {
        urls.push(url ?? (transport as unknown as { _wsUrl: string })._wsUrl);
        return { connect: async () => {} } as never;
      }
    );
  });

  test("uses only the current token on each connect", async () => {
    await transport._connect({ wsUrl: "wss://bot.example/ws", token: "old" });
    await transport._connect({ token: "new" });

    expect(urls).toEqual([
      "wss://bot.example/ws?token=old",
      "wss://bot.example/ws?token=new",
    ]);
  });

  test("appends the token to an url that already has a query", async () => {
    await transport._connect({
      wsUrl: "wss://bot.example/ws?room=a",
      token: "t k",
    });

    expect(urls).toEqual(["wss://bot.example/ws?room=a&token=t%20k"]);
  });

  test("throws TransportStartError when no url is set, even with a token", async () => {
    await expect(transport._connect({ token: "abc" })).rejects.toBeInstanceOf(
      TransportStartError
    );
    expect(transport.state).toBe("error");
    expect(urls).toEqual([]);
  });
});
