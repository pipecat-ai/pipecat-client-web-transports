/**
 * Minimal RTCPeerConnection/RTCDataChannel doubles for SmallWebRTCTransport
 * negotiation tests. Real WebRTC machinery (ICE gathering, SDP munging,
 * signaling state transitions) is not exercised — these fakes only implement
 * the surface smallWebRTCTransport.ts actually calls: createOffer /
 * setLocalDescription / setRemoteDescription for negotiate(), addTransceiver /
 * createDataChannel for setup, and getTransceivers / getSenders / close for
 * teardown.
 */

import { vi } from "vitest";

/**
 * Stand-in for MediaStreamTrack, usable both as a local track (handed out by
 * a fake MediaManager and moved between connections via replaceTrack) and as
 * a remote track (delivered through a "track" event and later fired with
 * "unmute"/"mute"/"ended" by the test).
 */
export class FakeMediaStreamTrack {
  kind: string;
  readyState: "live" | "ended" = "live";

  constructor(kind: string = "audio") {
    this.kind = kind;
  }

  private listeners = new Map<string, Set<(ev?: unknown) => void>>();

  addEventListener = vi.fn((type: string, cb: (ev?: unknown) => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  });
  removeEventListener = vi.fn((type: string, cb: (ev?: unknown) => void) => {
    this.listeners.get(type)?.delete(cb);
  });

  stop = vi.fn(() => {
    // Per spec, stop() ends the track silently — no "ended" event fires.
    this.readyState = "ended";
  });

  /** Simulates the browser firing `type` on this track. */
  dispatch(type: string, ev?: unknown) {
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }
}

export class FakeRTCRtpSender {
  track: FakeMediaStreamTrack | null = null;

  replaceTrack = vi.fn(async (track: FakeMediaStreamTrack | null) => {
    this.track = track;
  });
}

export class FakeRTCRtpTransceiver {
  mid: string;
  sender = new FakeRTCRtpSender();
  stop = vi.fn();

  constructor(mid: string) {
    this.mid = mid;
  }
}

export class FakeRTCDataChannel {
  readyState: string = "connecting";
  send = vi.fn();
  close = vi.fn();

  // Real per-instance listener registry so tests can simulate the browser
  // actually firing "open" / "close" — e.g. to drive the keepalive-interval
  // setup/teardown in createDataChannel().
  private listeners = new Map<string, Set<(ev?: unknown) => void>>();

  addEventListener = vi.fn((type: string, cb: (ev?: unknown) => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  });
  removeEventListener = vi.fn((type: string, cb: (ev?: unknown) => void) => {
    this.listeners.get(type)?.delete(cb);
  });

  /** Simulates the browser firing `type` on this channel. */
  dispatch(type: string, ev?: unknown) {
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }
}

export class FakeRTCPeerConnection {
  iceGatheringState = "new";
  iceConnectionState = "new";
  signalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  sctp: { maxMessageSize: number } | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;

  // Real per-instance listener registry (rather than a bare vi.fn() no-op)
  // so tests can simulate the browser actually firing events — e.g. close()
  // firing "signalingstatechange" on itself, which is what a stale peer
  // connection does mid-reconnection.
  private listeners = new Map<string, Set<(ev?: unknown) => void>>();

  createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0\r\n" }));
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
  });
  setRemoteDescription = vi.fn(async () => {
    // Real browsers land in "stable" once a valid answer is applied, and
    // fire signalingstatechange as part of that transition.
    this.signalingState = "stable";
    this.dispatch("signalingstatechange");
  });
  // Transceivers get mids "0"/"1"/"2" in creation order, matching the
  // transport's audio/video/screenVideo convention (see
  // addInitialTransceivers and the "track" event's mid -> streamType map).
  transceivers: FakeRTCRtpTransceiver[] = [];
  addTransceiver = vi.fn(() => {
    const transceiver = new FakeRTCRtpTransceiver(
      String(this.transceivers.length)
    );
    this.transceivers.push(transceiver);
    return transceiver;
  });
  getTransceivers = vi.fn(() => this.transceivers);
  getSenders = vi.fn(() => this.transceivers.map((t) => t.sender));

  /** The most recently created data channel, for tests to reach into. */
  lastDataChannel: FakeRTCDataChannel | null = null;
  createDataChannel = vi.fn(() => {
    this.lastDataChannel = new FakeRTCDataChannel();
    return this.lastDataChannel;
  });

  addEventListener = vi.fn((type: string, cb: (ev?: unknown) => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  });
  removeEventListener = vi.fn((type: string, cb: (ev?: unknown) => void) => {
    this.listeners.get(type)?.delete(cb);
  });

  /** Simulates the browser firing `type` on this connection. */
  dispatch(type: string, ev?: unknown) {
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }

  close = vi.fn(() => {
    // Real browsers transition signalingState to "closed" and fire
    // signalingstatechange when close() is called.
    this.signalingState = "closed";
    this.dispatch("signalingstatechange");
  });
}

/**
 * Installs FakeRTCPeerConnection as the global RTCPeerConnection and returns
 * a getter for the most recently constructed instance, so tests can reach in
 * and fire onicecandidate / inspect calls after driving the transport through
 * its public API.
 */
export function installFakeRTCPeerConnection(): {
  current: () => FakeRTCPeerConnection;
} {
  let latest: FakeRTCPeerConnection | null = null;

  class TrackingFakeRTCPeerConnection extends FakeRTCPeerConnection {
    constructor() {
      super();
      latest = this;
    }
  }

  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
    TrackingFakeRTCPeerConnection;

  return {
    current: () => {
      if (!latest) {
        throw new Error(
          "No FakeRTCPeerConnection has been constructed yet — call this after transport.connect() has started."
        );
      }
      return latest;
    },
  };
}
