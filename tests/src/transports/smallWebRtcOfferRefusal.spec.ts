/**
 * SmallWebRTCTransport offer handling: a 4xx from the offer endpoint must
 * reject connect() with the status and stop — no blind re-offer, no trickle-ICE
 * for a peer connection the server never created.
 */

import { makeRequest } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from "vitest";

import { createFakeMediaManager } from "../helpers/fakeMediaManager";
import { buildSpyCallbacks, wireTransport } from "../helpers/observeTransport";

vi.mock("@pipecat-ai/client-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pipecat-ai/client-js")>()),
  makeRequest: vi.fn(),
}));

const makeRequestMock = makeRequest as Mock;

class FakePeerConnection {
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  iceGatheringState = "gathering";
  iceConnectionState = "new";
  signalingState = "have-local-offer";
  localDescription: RTCSessionDescriptionInit | null = null;
  sctp = null;

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  addTransceiver = vi.fn();
  getTransceivers = vi.fn(() => []);
  getSenders = vi.fn(() => []);
  close = vi.fn();
  createDataChannel = vi.fn(() => ({
    readyState: "connecting",
    addEventListener: vi.fn(),
    close: vi.fn(),
  }));
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0" }));
  setRemoteDescription = vi.fn(async () => {});
  // Gathering starts as soon as a local description is set — the same moment
  // the transport POSTs the offer — so a candidate is in flight before the
  // server has answered.
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
    this.onicecandidate?.({
      candidate: { candidate: "candidate:0", sdpMid: "0", sdpMLineIndex: 0 },
    });
  });
}

const OFFER_ENDPOINT = "https://example.test/webrtc/offer";
const FLUSH_MS = 200;
const RETRY_MS = 2000;

describe("SmallWebRTCTransport offer refusal", () => {
  let transport: SmallWebRTCTransport;
  let fetchMock: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    makeRequestMock.mockReset();

    transport = new SmallWebRTCTransport({
      mediaManager: createFakeMediaManager() as never,
      webrtcRequestParams: { endpoint: OFFER_ENDPOINT },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("4xx: connect() rejects with the status and the offer is not re-sent", async () => {
    makeRequestMock.mockRejectedValue(new Response(null, { status: 429 }));
    const { spies } = buildSpyCallbacks();
    wireTransport(transport, spies as never);

    const connecting = transport.connect();
    await expect(connecting).rejects.toMatchObject({ status: 429 });
    expect(transport.state).toBe("error");
    expect(spies.onDisconnected).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(makeRequestMock).toHaveBeenCalledTimes(1);
  });

  test("4xx: no trickle-ICE PATCH is sent for the refused offer", async () => {
    makeRequestMock.mockRejectedValue(new Response(null, { status: 429 }));
    wireTransport(transport, buildSpyCallbacks().callbacks);

    await transport.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(FLUSH_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("5xx: still retries, but ICE candidates wait for an answer", async () => {
    makeRequestMock.mockRejectedValue(new Response(null, { status: 503 }));
    wireTransport(transport, buildSpyCallbacks().callbacks);

    void transport.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(FLUSH_MS * 2);
    expect(makeRequestMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(makeRequestMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("disconnect() cancels a pending re-offer", async () => {
    makeRequestMock.mockRejectedValue(new Response(null, { status: 503 }));
    wireTransport(transport, buildSpyCallbacks().callbacks);

    void transport.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(makeRequestMock).toHaveBeenCalledTimes(1);

    await transport.disconnect();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(makeRequestMock).toHaveBeenCalledTimes(1);
  });
});
