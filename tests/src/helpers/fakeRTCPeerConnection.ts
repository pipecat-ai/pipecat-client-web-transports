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

export class FakeRTCDataChannel {
  readyState: string = "connecting";
  send = vi.fn();
  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

export class FakeRTCPeerConnection {
  iceGatheringState = "new";
  iceConnectionState = "new";
  signalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  sctp: { maxMessageSize: number } | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;

  createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0\r\n" }));
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
  });
  setRemoteDescription = vi.fn(async () => {});
  addTransceiver = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  getTransceivers = vi.fn(() => []);
  getSenders = vi.fn(() => []);
  close = vi.fn();

  createDataChannel = vi.fn(() => new FakeRTCDataChannel());
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

  (
    globalThis as unknown as { RTCPeerConnection: unknown }
  ).RTCPeerConnection = TrackingFakeRTCPeerConnection;

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
