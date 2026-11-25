import { vi } from "vitest";

import { describeDeviceContract } from "./contract";
import { createFakeDailyCall } from "./fakes/daily";
import { installSmallWebRtcNetwork, OFFER_ENDPOINT } from "./fakes/smallWebRtc";

vi.mock(
  "@daily-co/daily-js",
  async () => (await import("./fakes/daily")).dailyModule
);
vi.mock(
  "../../../lib/src/wavtools/index.js",
  async () => (await import("./fakes/wavtools")).wavtoolsModule
);

const { SmallWebRTCTransport } =
  await import("@pipecat-ai/small-webrtc-transport");

describeDeviceContract({
  name: "SmallWebRTCTransport + DailyMediaManager (default)",
  supportsCam: true,
  create() {
    createFakeDailyCall();
    const network = installSmallWebRtcNetwork();
    return {
      transport: new SmallWebRTCTransport({
        webrtcRequestParams: { endpoint: OFFER_ENDPOINT },
      }),
      connectParams: undefined,
      failNextConnect: network.failNextOffer,
      sentTrack: network.sentTrack,
      teardown: network.restore,
    };
  },
});
