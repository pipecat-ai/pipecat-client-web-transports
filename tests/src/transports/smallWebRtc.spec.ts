/**
 * Characterization tests for SmallWebRTCTransport's initDevices() contract.
 *
 * Locks in today's behavior ahead of Plan A step 2, which will replace the
 * 'disconnected' sentinel gate in PipecatClient with a MediaState check. Any
 * behavior change here should be paired with a deliberate step-2 edit.
 */

import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { beforeEach, describe, expect, test } from "vitest";

import { createFakeMediaManager } from "../helpers/fakeMediaManager";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

describe("SmallWebRTCTransport.initDevices() — characterization", () => {
  let mediaManager: ReturnType<typeof createFakeMediaManager>;
  let transport: SmallWebRTCTransport;

  beforeEach(() => {
    mediaManager = createFakeMediaManager();
    // FakeMediaManager implements the runtime slice the transport uses but
    // is not a subclass. Casting to `never` here avoids importing the
    // MediaManager type (which transitively pulls wavtools without types).
    transport = new SmallWebRTCTransport({
      mediaManager: mediaManager as never,
    });
  });

  test("initial state after construction is 'disconnected'", () => {
    // Before initialize() runs, the abstract Transport's _state field is
    // already 'disconnected'. The concrete constructor does not change this.
    expect(transport.state).toBe("disconnected");
  });

  test("after initialize(): state is 'disconnected' (same sentinel as post-session)", () => {
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    expect(transport.state).toBe("disconnected");
    // initialize() explicitly sets 'disconnected' — one transition observed,
    // even though the string value is unchanged.
    expect(recorder.states).toEqual([]);
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
    // Today SmallWebRTC forwards unconditionally to mediaManager.initialize()
    // and re-runs state transitions on every call. Step 2 will add a guard at
    // the PipecatClient level based on MediaState, not on TransportState.
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

  test("initDevices() rejection propagates and leaves state at 'initializing'", async () => {
    mediaManager.initializeShouldThrow = new Error("getUserMedia failed");
    const { callbacks, recorder } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    await expect(transport.initDevices()).rejects.toThrow("getUserMedia failed");

    // The transport does not catch; state set to 'initializing' lingers.
    // PipecatClient consumers see a stuck state — Plan A's core motivation.
    expect(transport.state).toBe("initializing");
    expect(recorder.states).toEqual(["initializing"]);
  });
});
