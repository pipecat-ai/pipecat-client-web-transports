/**
 * Regression test for issue #169: the reconnect loop never ended because the
 * reconnectionAttempts counter was being reset by the old peer connection.
 *
 * createPeerConnection() attaches a "signalingstatechange" listener that was
 * checking `this.pc` (the current, possibly-already-replaced connection)
 * instead of the closure's own `pc`. During a reconnection retry,
 * startNewPeerConnection() reassigns `this.pc` to a fresh connection (which
 * starts "stable") *before* the old connection is closed; closing the old
 * connection then fires signalingstatechange on itself, and the buggy
 * handler read `this.pc` (the new, unrelated connection), saw "stable", and
 * called handleReconnectionCompleted() — zeroing reconnectionAttempts. The
 * counter oscillated 1/0/1/0 and the transport retried forever instead of
 * giving up after maxReconnectionAttempts.
 */

import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  FakeRTCPeerConnection,
  installFakeRTCPeerConnection,
} from "../helpers/fakeRTCPeerConnection";
import { createFakeMediaManager } from "../helpers/fakeMediaManager";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

const OFFER_ENDPOINT = "https://example.test/offer";

function successfulAnswerResponse(): Response {
  return new Response(
    JSON.stringify({ sdp: "v=0\r\n", type: "answer", pc_id: "peer-123" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("SmallWebRTCTransport reconnection-attempts counter (issue #169)", () => {
  let mediaManager: ReturnType<typeof createFakeMediaManager>;
  let transport: SmallWebRTCTransport;
  let getCurrentPc: () => FakeRTCPeerConnection;

  beforeEach(() => {
    vi.useFakeTimers();

    getCurrentPc = installFakeRTCPeerConnection().current;

    mediaManager = createFakeMediaManager();
    transport = new SmallWebRTCTransport({
      mediaManager: mediaManager as never,
      webrtcRequestParams: { endpoint: OFFER_ENDPOINT },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("a stale peer connection's signalingstatechange event does not reset the counter, so the transport gives up after maxReconnectionAttempts", async () => {
    // Every offer POST fails, forcing attemptReconnection(true) on a 2s
    // timer. Each retry creates a new RTCPeerConnection and closes the
    // previous one — exactly the sequence that triggers the stale-event bug.
    const networkError = new TypeError("network unreachable");
    const fetchMock = vi.fn(async () => {
      throw networkError;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    const caughtPromise = connectPromise.catch(() => {});

    // Advance well past what 1 initial attempt + 3 retries (2s apart) would
    // need. If the counter were being reset by stale events, the transport
    // would still be retrying at this point and fetch would keep climbing
    // past 4 — this is what "retries every 2s indefinitely" looked like.
    await vi.advanceTimersByTimeAsync(20_000);
    await caughtPromise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(callbacks.onDisconnected).toHaveBeenCalledTimes(1);
  });

  test("a legitimate successful reconnect resets the counter, so a later drop gets the full retry budget again", async () => {
    // First offer POST fails, forcing one reconnection attempt. The retry's
    // offer succeeds, which should reset reconnectionAttempts back to 0 via
    // the *current* connection's own signalingstatechange -> "stable" event
    // (not via a stale one). Every offer POST after that fails again, to
    // prove the next drop gets a full 3 retries rather than picking up where
    // the earlier attempt count left off.
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 2) return successfulAnswerResponse();
      throw new TypeError("network unreachable");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    const caughtPromise = connectPromise.catch(() => {});

    // fetch #1 (initial, fails) -> +2s -> fetch #2 (retry, succeeds).
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Simulate the now-connected peer connection dropping again.
    const connectedPc = getCurrentPc();
    connectedPc.iceConnectionState = "failed";
    connectedPc.dispatch("iceconnectionstatechange");

    // If reconnectionAttempts had NOT been reset by the successful retry,
    // this second drop would only need 2 more failures (reaching the stale
    // count of 3) before giving up — 4 fetch calls total. A correctly reset
    // counter needs the full 3 more retries — 5 fetch calls total.
    await vi.advanceTimersByTimeAsync(3 * 2000);
    await caughtPromise;

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(callbacks.onDisconnected).toHaveBeenCalledTimes(1);
  });
});
