/**
 * Regression tests for issue #173: SmallWebRTCTransport swallowing HTTP
 * errors from the offer endpoint.
 *
 * Covers the three behaviors fixed in negotiate()/stop():
 *  - a deterministic 4xx from the offer POST fails fast instead of being
 *    blindly retried on the reconnection timer
 *  - the final connect() rejection carries the original status/error
 *    (message + `cause`) instead of a bare TransportStartError
 *  - ICE candidates are only flushed once negotiation actually succeeds, so
 *    a failed offer doesn't produce PATCHes with a null pc_id
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

const fakeIceCandidate = {
  candidate: "candidate:1 1 UDP 1 1.2.3.4 1234 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};

function successfulAnswerResponse(): Response {
  return new Response(
    JSON.stringify({ sdp: "v=0\r\n", type: "answer", pc_id: "peer-123" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("SmallWebRTCTransport offer-failure handling (issue #173)", () => {
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

  test("a 4xx offer response fails fast: no retry is scheduled, and the rejection carries the status", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 429, statusText: "Too Many Requests" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    let caught: unknown;
    // Attach the catch handler synchronously, before the promise ever has a
    // chance to reject, so Node doesn't flag it as briefly unhandled.
    const caughtPromise = connectPromise.catch((e) => {
      caught = e;
    });
    await vi.advanceTimersByTimeAsync(0);
    await caughtPromise;

    expect((caught as Error).message).toContain("429");
    expect(
      ((caught as Error & { cause?: unknown }).cause as Response).status
    ).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advancing well past the 2s blind-retry delay must not produce a second
    // offer request — a deterministic 4xx should never be retried.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a 4xx offer response sets state to 'error' and never fires onConnected", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 429 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    const caughtPromise = connectPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await caughtPromise;

    expect(transport.state).toBe("error");
    expect(callbacks.onConnected).not.toHaveBeenCalled();
    expect(callbacks.onDisconnected).toHaveBeenCalledTimes(1);
  });

  test("non-4xx failures still retry, and the final rejection carries the last error as `cause`", async () => {
    const networkError = new TypeError("network unreachable");
    const fetchMock = vi.fn(async () => {
      throw networkError;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    let caught: unknown;
    const caughtPromise = connectPromise.catch((e) => {
      caught = e;
    });

    // 1 initial attempt + 3 reconnection attempts (maxReconnectionAttempts),
    // each spaced 2s apart, before the transport gives up.
    await vi.advanceTimersByTimeAsync(4 * 2000);
    await caughtPromise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((caught as Error).message).toContain("network unreachable");
    expect((caught as Error & { cause?: unknown }).cause).toBe(networkError);
  });

  test("a failed offer does not flush queued ICE candidates (no PATCH follows the failed POST)", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 429 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    const caughtPromise = connectPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    getCurrentPc().onicecandidate?.({ candidate: fakeIceCandidate });

    // Let the 200ms ICE-flush debounce (and the deferred stop()) elapse.
    await vi.advanceTimersByTimeAsync(5000);
    await caughtPromise;

    // Only the offer POST happened — the queued candidate was never PATCHed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a successful negotiation allows queued ICE candidates to be flushed", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method =
          input instanceof Request ? input.method : (init?.method ?? "GET");
        if (method === "PATCH") {
          return new Response(null, { status: 200 });
        }
        return successfulAnswerResponse();
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    // The fake data channel never fires "open", so connect() stays pending
    // forever here — that's fine, we only care about negotiate()'s side
    // effects on ICE flushing.
    void transport.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1); // just the offer POST so far

    getCurrentPc().onicecandidate?.({ candidate: fakeIceCandidate });
    await vi.advanceTimersByTimeAsync(300); // 200ms flush debounce

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, patchInit] = fetchMock.mock.calls[1] as [RequestInfo, RequestInit];
    expect(patchInit.method).toBe("PATCH");
  });
});
