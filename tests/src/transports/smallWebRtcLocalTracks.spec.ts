/**
 * SmallWebRTCTransport sends local tracks the media manager acquires after
 * connect(). addUserMedia() only sweeps the tracks that exist when the peer
 * connection is built, so a mic acquired later (enableMic(true) with the mic
 * started off) is routed from the track callbacks the transport registers
 * with the manager. This must work for any media manager, not only the
 * default one.
 */

import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  FakeMediaStreamTrack,
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

describe("SmallWebRTCTransport local tracks acquired after connect()", () => {
  let mediaManager: ReturnType<typeof createFakeMediaManager>;
  let transport: SmallWebRTCTransport;
  let getCurrentPc: () => FakeRTCPeerConnection;

  beforeEach(() => {
    vi.useFakeTimers();

    getCurrentPc = installFakeRTCPeerConnection().current;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => successfulAnswerResponse())
    );

    mediaManager = createFakeMediaManager();
    transport = new SmallWebRTCTransport({
      mediaManager: mediaManager as never,
      webrtcRequestParams: { endpoint: OFFER_ENDPOINT },
    });
    wireTransport(transport, buildSpyCallbacks().callbacks);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The track-started listener the transport registered with the manager. */
  function reportTrackStarted(track: FakeMediaStreamTrack, type: string) {
    const [onTrackStarted] = mediaManager.registerTrackCallbacks.mock.calls[0];
    onTrackStarted(track, type);
  }

  async function connectAndGetPc(): Promise<FakeRTCPeerConnection> {
    transport.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    return getCurrentPc();
  }

  test("the transport registers its track listeners with whichever media manager it is given", () => {
    expect(mediaManager.registerTrackCallbacks).toHaveBeenCalledTimes(1);
  });

  test("a local audio track reported after connect() is sent on the audio transceiver", async () => {
    const pc = await connectAndGetPc();
    expect(pc.transceivers[0].sender.track).toBeNull();

    const localAudio = new FakeMediaStreamTrack("audio");
    reportTrackStarted(localAudio, "audio");
    await vi.advanceTimersByTimeAsync(0);

    expect(pc.transceivers[0].sender.track).toBe(localAudio);
  });

  test("a local track reported before connect() is picked up by connect() itself", async () => {
    const localAudio = new FakeMediaStreamTrack("audio");
    mediaManager.tracks = vi.fn(() => ({
      local: { audio: localAudio, video: undefined },
    }));
    reportTrackStarted(localAudio, "audio");

    const pc = await connectAndGetPc();

    expect(pc.transceivers[0].sender.track).toBe(localAudio);
    expect(pc.transceivers[0].sender.replaceTrack).toHaveBeenCalledTimes(1);
  });

  test("a screen audio track is ignored", async () => {
    const pc = await connectAndGetPc();

    reportTrackStarted(new FakeMediaStreamTrack("audio"), "screenAudio");
    await vi.advanceTimersByTimeAsync(0);

    for (const t of pc.transceivers) {
      expect(t.sender.replaceTrack).not.toHaveBeenCalled();
    }
  });

  test("a track already being sent is not replaced again", async () => {
    const localAudio = new FakeMediaStreamTrack("audio");
    mediaManager.tracks = vi.fn(() => ({
      local: { audio: localAudio, video: undefined },
    }));
    const pc = await connectAndGetPc();
    expect(pc.transceivers[0].sender.replaceTrack).toHaveBeenCalledTimes(1);

    reportTrackStarted(localAudio, "audio");
    await vi.advanceTimersByTimeAsync(0);

    expect(pc.transceivers[0].sender.replaceTrack).toHaveBeenCalledTimes(1);
  });
});
