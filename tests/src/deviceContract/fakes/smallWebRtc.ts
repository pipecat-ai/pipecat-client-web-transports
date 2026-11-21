/**
 * The network side of SmallWebRTCTransport for the device contract suite: a
 * peer connection whose data channel opens once the answer is applied, an
 * offer endpoint (fetch) that answers, and a bot on the data channel that
 * replies to client-ready with bot-ready. None of it touches devices; local
 * media comes from the media manager under test.
 */

import { vi } from "vitest";

import {
  FakeRTCDataChannel,
  FakeRTCPeerConnection,
} from "../../helpers/fakeRTCPeerConnection";

export const OFFER_ENDPOINT = "https://example.test/offer";

class BotDataChannel extends FakeRTCDataChannel {
  constructor() {
    super();
    this.send.mockImplementation((raw: string) => {
      let message: { type?: string } | undefined;
      try {
        message = JSON.parse(raw);
      } catch {
        return; // keepalive pings
      }
      if (message?.type !== "client-ready") return;
      setTimeout(() =>
        this.dispatch("message", {
          data: JSON.stringify({
            label: "rtvi-ai",
            type: "bot-ready",
            id: "bot-ready-1",
            data: { version: "2.3.0" },
          }),
        })
      );
    });
    this.close.mockImplementation(() => {
      this.readyState = "closed";
    });
  }
}

let lastPeerConnection: BotPeerConnection | null = null;

class BotPeerConnection extends FakeRTCPeerConnection {
  constructor() {
    super();
    lastPeerConnection = this;
    this.createDataChannel.mockImplementation(() => {
      this.lastDataChannel = new BotDataChannel();
      return this.lastDataChannel;
    });
    const applyAnswer = this.setRemoteDescription.getMockImplementation()!;
    this.setRemoteDescription.mockImplementation(async () => {
      await applyAnswer();
      const dc = this.lastDataChannel;
      if (!dc) return;
      setTimeout(() => {
        dc.readyState = "open";
        dc.dispatch("open");
      });
    });
  }
}

/**
 * Install the fake peer connection and offer endpoint. failNextOffer() makes
 * the next offer get a 403, which the transport treats as final.
 */
export function installSmallWebRtcNetwork(): {
  failNextOffer: () => void;
  sentTrack: (kind: "mic" | "cam") => MediaStreamTrack | null;
  restore: () => void;
} {
  lastPeerConnection = null;
  const global = globalThis as unknown as { RTCPeerConnection: unknown };
  const previous = global.RTCPeerConnection;
  global.RTCPeerConnection = BotPeerConnection;

  let failNext = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(null, { status: 200 });
      if (failNext) {
        failNext = false;
        return new Response(JSON.stringify({ detail: "refused" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ sdp: "v=0\r\n", type: "answer", pc_id: "peer-1" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    })
  );

  return {
    failNextOffer: () => {
      failNext = true;
    },
    // The transport adds the audio transceiver first, then the video one.
    sentTrack: (kind) =>
      (lastPeerConnection?.transceivers[kind === "mic" ? 0 : 1]?.sender
        .track as unknown as MediaStreamTrack | null) ?? null,
    restore: () => {
      global.RTCPeerConnection = previous;
      vi.unstubAllGlobals();
    },
  };
}
