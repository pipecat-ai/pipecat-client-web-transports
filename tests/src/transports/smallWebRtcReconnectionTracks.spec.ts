/**
 * Regression tests for issue #236: after an ICE-restart reconnection the call
 * had no local media and no remote audio.
 *
 * attemptReconnection(true) builds the new peer connection first and closes
 * the old one second, which used to break the recovered call twice over:
 *
 * 1. addUserMedia() moves the *same* local MediaStreamTracks onto the new
 *    connection via replaceTrack, but the old connection's senders still
 *    reference them — so closePeerConnection() calling sender.track.stop()
 *    on the old connection silenced the tracks the new connection sends.
 *
 * 2. _incomingTracks is keyed by stream type, and the new connection's
 *    "track" event stores its track under that key before the old connection
 *    is closed. The old remote track's "ended" handler then deleted the
 *    entry — the *new* track's entry — so the new track's "unmute" found
 *    nothing and onTrackStarted never fired for the recovered connection.
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

describe("SmallWebRTCTransport media recovery after an ICE-restart reconnection (issue #236)", () => {
  let mediaManager: ReturnType<typeof createFakeMediaManager>;
  let transport: SmallWebRTCTransport;
  let getCurrentPc: () => FakeRTCPeerConnection;
  let spies: ReturnType<typeof buildSpyCallbacks>["spies"];

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

    const built = buildSpyCallbacks();
    spies = built.spies;
    wireTransport(transport, built.callbacks);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Connects (leaving the never-resolving connect() promise caught — these
   * tests don't need the data channel to open) and returns the first peer
   * connection.
   */
  async function connectAndGetFirstPc(): Promise<FakeRTCPeerConnection> {
    transport.connect().catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    return getCurrentPc();
  }

  /**
   * Drives the recreate-reconnection path: reports ICE failure on `pc` and
   * waits for the replacement connection (negotiated and connected to the
   * same local tracks) to be built and the old one to be closed.
   */
  async function forceIceRestart(
    pc: FakeRTCPeerConnection
  ): Promise<FakeRTCPeerConnection> {
    pc.iceConnectionState = "failed";
    pc.dispatch("iceconnectionstatechange");
    await vi.advanceTimersByTimeAsync(0);
    const newPc = getCurrentPc();
    expect(newPc).not.toBe(pc);
    expect(pc.close).toHaveBeenCalledTimes(1);
    return newPc;
  }

  test("closing the old peer connection does not stop local tracks the new connection is sending", async () => {
    const localAudio = new FakeMediaStreamTrack("audio");
    mediaManager.tracks = vi.fn(() => ({
      local: { audio: localAudio, video: undefined },
    }));

    const pc1 = await connectAndGetFirstPc();
    expect(pc1.transceivers[0].sender.track).toBe(localAudio);

    const pc2 = await forceIceRestart(pc1);

    // The same track object was moved onto the new connection...
    expect(pc2.transceivers[0].sender.track).toBe(localAudio);
    // ...so tearing down the old connection must leave it running. Before
    // the fix, closePeerConnection stopped every old sender's track and the
    // server never received another frame.
    expect(localAudio.stop).not.toHaveBeenCalled();
    expect(localAudio.readyState).toBe("live");
  });

  test("a local track no longer in use by the current connection is still stopped on teardown", async () => {
    const localAudio = new FakeMediaStreamTrack("audio");
    mediaManager.tracks = vi.fn(() => ({
      local: { audio: localAudio, video: undefined },
    }));

    await connectAndGetFirstPc();
    await transport.disconnect();

    expect(localAudio.stop).toHaveBeenCalledTimes(1);
  });

  test("the old remote track's ended event does not evict the new connection's track, so onTrackStarted fires for the recovered audio", async () => {
    const pc1 = await connectAndGetFirstPc();

    // The server's audio track arrives and starts on the first connection.
    const remote1 = new FakeMediaStreamTrack("audio");
    pc1.dispatch("track", { transceiver: { mid: "0" }, track: remote1 });
    remote1.dispatch("unmute");
    expect(spies.onTrackStarted).toHaveBeenCalledWith(remote1);

    const pc2 = await forceIceRestart(pc1);

    // The new connection's remote track is stored under "microphone", and
    // only then does the old connection's teardown end the old track —
    // the ordering that used to delete the new track's map entry.
    const remote2 = new FakeMediaStreamTrack("audio");
    pc2.dispatch("track", { transceiver: { mid: "0" }, track: remote2 });
    spies.onTrackStarted.mockClear();
    spies.onTrackStopped.mockClear();
    remote1.dispatch("mute");
    remote1.dispatch("ended");

    // The old track's death must not tell the app its microphone slot
    // stopped — a live replacement is already registered.
    expect(spies.onTrackStopped).not.toHaveBeenCalled();

    remote2.dispatch("unmute");
    expect(spies.onTrackStarted).toHaveBeenCalledWith(remote2);
  });

  test("a remote track ending with no replacement still reports onTrackStopped and clears its entry", async () => {
    const pc1 = await connectAndGetFirstPc();

    const remote1 = new FakeMediaStreamTrack("audio");
    pc1.dispatch("track", { transceiver: { mid: "0" }, track: remote1 });
    remote1.dispatch("unmute");

    remote1.dispatch("ended");
    expect(spies.onTrackStopped).toHaveBeenCalledWith(remote1);
  });
});
