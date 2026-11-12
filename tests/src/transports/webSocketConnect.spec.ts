/**
 * WebSocketTransport connect url handling: the token is added per connect and
 * never accumulates on the stored base url.
 */

import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { logger, TransportStartError } from "@pipecat-ai/client-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

  afterEach(() => {
    vi.restoreAllMocks();
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

  test("accepts the pipecat runner's /start response as connect params", async () => {
    // Exactly what `POST /start` returns for `{ transport: "websocket" }`
    // when the runner is not using token auth. Everything but wsUrl is
    // either null or not something this transport consumes.
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const params = transport._validateConnectionParams({
      wsUrl: "ws://localhost:7860/ws-client",
      sessionId: "0812c55d-5603-4c29-8060-508f807c62b1",
      token: null,
    });
    expect(params).toEqual({ wsUrl: "ws://localhost:7860/ws-client" });
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    await transport._connect(params);

    expect(urls).toEqual(["ws://localhost:7860/ws-client"]);
  });

  test("ignores unknown params but still rejects a wrongly typed token", () => {
    expect(
      transport._validateConnectionParams({
        ws_url: "ws://localhost:7860/ws-client",
        fileUploadUrl: "/files",
        token: "abc",
      })
    ).toEqual({ wsUrl: "ws://localhost:7860/ws-client", token: "abc" });

    expect(() =>
      transport._validateConnectionParams({
        wsUrl: "ws://localhost:7860/ws-client",
        token: 123,
      })
    ).toThrow(/Invalid type for token/);
  });

  test("logs a misnamed url key and falls back to the stored url", async () => {
    await transport._connect({ wsUrl: "wss://bot.example/ws" });
    const info = vi.spyOn(logger, "info");

    const params = transport._validateConnectionParams({
      url: "wss://other.example/ws",
    });
    expect(params).toEqual({});
    expect(info).toHaveBeenCalledWith(
      "Unrecognized connection parameter: url. Ignored."
    );

    await transport._connect(params);

    expect(urls).toEqual(["wss://bot.example/ws", "wss://bot.example/ws"]);
  });

  test("throws TransportStartError when no url is set, even with a token", async () => {
    await expect(transport._connect({ token: "abc" })).rejects.toBeInstanceOf(
      TransportStartError
    );
    expect(transport.state).toBe("error");
    expect(urls).toEqual([]);
  });
});
