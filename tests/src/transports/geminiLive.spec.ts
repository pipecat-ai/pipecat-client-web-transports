/**
 * Characterization tests for GeminiLiveWebsocketTransport's initDevices()
 * contract. Locks in today's behavior ahead of Plan A step 2.
 */

import { GeminiLiveWebsocketTransport } from "@pipecat-ai/gemini-live-websocket-transport";
import { beforeEach, describe, expect, test } from "vitest";

import { createFakeMediaManager } from "../helpers/fakeMediaManager";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

describe("GeminiLiveWebsocketTransport.initDevices() — characterization", () => {
  let mediaManager: ReturnType<typeof createFakeMediaManager>;
  let transport: GeminiLiveWebsocketTransport;

  beforeEach(() => {
    mediaManager = createFakeMediaManager();
    transport = new GeminiLiveWebsocketTransport(
      { api_key: "test-key" },
      mediaManager as never
    );
  });

  test("initial state after construction is 'disconnected'", () => {
    expect(transport.state).toBe("disconnected");
  });

  test("happy-path initDevices(): disconnected → initializing → initialized", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();

    expect(mediaManager.initializeCallCount).toBe(1);
    expect(transport.state).toBe("initialized");
    expect(recorder.states).toEqual(["initializing", "initialized"]);
  });

  test("repeated initDevices() calls re-enter 'initializing' each time (NOT idempotent at the transport layer)", async () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await transport.initDevices();
    await transport.initDevices();

    expect(mediaManager.initializeCallCount).toBe(2);
    expect(transport.state).toBe("initialized");
    expect(recorder.states).toEqual([
      "initializing",
      "initialized",
      "initializing",
      "initialized",
    ]);
  });

  test.each([
    [{ enableMic: true, enableCam: false }],
    [{ enableMic: false, enableCam: false }],
    [{ enableMic: true, enableCam: true }],
    [{ enableMic: false, enableCam: true }],
  ])(
    "initialize(%j) forwards enableMic/enableCam through to mediaManager.setClientOptions",
    (opts) => {
      const { callbacks } = buildSpyCallbacks();
      wireTransport(transport, callbacks, opts);

      expect(mediaManager.setClientOptions).toHaveBeenCalledTimes(1);
      expect(mediaManager.setClientOptions).toHaveBeenCalledWith(
        expect.objectContaining(opts)
      );
    }
  );

  test("initDevices() rejection propagates and leaves state at 'initializing'", async () => {
    mediaManager.initializeShouldThrow = new Error("wav init failed");
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await expect(transport.initDevices()).rejects.toThrow("wav init failed");
    expect(transport.state).toBe("initializing");
    expect(recorder.states).toEqual(["initializing"]);
  });
});
