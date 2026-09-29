/**
 * WebSocketTransport audio queue: microphone audio captured before the bot is
 * ready is held back, and audio from an ended session never reaches the next one.
 */

import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createFakeMediaManager } from "../helpers/fakeMediaManager";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

describe("WebSocketTransport audio queue", () => {
  let transport: WebSocketTransport;
  let sent: ArrayBuffer[];

  beforeEach(() => {
    transport = new WebSocketTransport({
      mediaManager: createFakeMediaManager() as never,
    });
    wireTransport(transport, buildSpyCallbacks().callbacks);
    sent = [];
    vi.spyOn(transport, "initializeWebsocket").mockImplementation(
      () =>
        ({
          connect: async () => {},
          close: async () => {},
        }) as never
    );
    vi.spyOn(transport, "_sendAudioInput").mockImplementation(async (data) => {
      sent.push(data);
    });
    vi.spyOn(transport, "sendMessage").mockImplementation(() => {});
  });

  test("flushes audio captured before ready once the transport is ready", async () => {
    await transport._connect({ wsUrl: "wss://bot.example/ws" });
    const early = new ArrayBuffer(4);
    transport.handleUserAudioStream(early);
    expect(sent).toEqual([]);

    transport.sendReadyMessage();
    transport.handleUserAudioStream(new ArrayBuffer(8));

    expect(sent[0]).toBe(early);
    expect(sent).toHaveLength(2);
  });

  test("drops audio queued during a session when it disconnects", async () => {
    await transport._connect({ wsUrl: "wss://bot.example/ws" });
    const stale = new ArrayBuffer(4);
    transport.handleUserAudioStream(stale);
    await transport._disconnect();

    await transport._connect({ wsUrl: "wss://bot.example/ws" });
    transport.sendReadyMessage();
    const fresh = new ArrayBuffer(8);
    transport.handleUserAudioStream(fresh);

    expect(sent).toEqual([fresh]);
  });
});
