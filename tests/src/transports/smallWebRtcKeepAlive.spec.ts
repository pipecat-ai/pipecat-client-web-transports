/**
 * Regression test for issue #63: SmallWebRTCTransport threw
 * "InvalidStateError: The object is in an invalid state." in Safari.
 *
 * The keepalive interval kept calling dc.send() on a 1s timer with no
 * readyState check. RTCDataChannel transitions through "open" -> "closing"
 * -> "closed", but there is no "closing" event — only "close", which is what
 * actually clears the interval. So there's a window where the channel is
 * "closing" but the interval hasn't been cleared yet; if a tick lands in
 * that window, send() is called on a non-open channel. Chrome tolerates
 * this; Safari throws InvalidStateError.
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

describe("SmallWebRTCTransport data-channel keepalive (issue #63)", () => {
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

  test("the keepalive ping skips send() while the channel is closing, instead of throwing", async () => {
    const fetchMock = vi.fn(async () => successfulAnswerResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { callbacks } = buildSpyCallbacks();
    wireTransport(transport, callbacks);

    const connectPromise = transport.connect();
    await vi.advanceTimersByTimeAsync(0);

    const dc = getCurrentPc().lastDataChannel!;
    dc.readyState = "open";
    dc.dispatch("open");
    await connectPromise;

    // Discard the syncTrackStatus() sends that happen as part of "open".
    dc.send.mockClear();

    // While genuinely open, the ping goes out as normal.
    await vi.advanceTimersByTimeAsync(1000);
    expect(dc.send).toHaveBeenCalledTimes(1);

    // Simulate the channel entering "closing" a tick before "close" actually
    // fires — the real-world race that produced Safari's InvalidStateError.
    dc.readyState = "closing";
    await vi.advanceTimersByTimeAsync(1000);

    expect(dc.send).toHaveBeenCalledTimes(1); // no additional, unguarded send
  });
});
