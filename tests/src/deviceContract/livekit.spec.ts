import { vi } from "vitest";

import { describeDeviceContract } from "./contract";
import { failNextLivekitConnect, resetLivekit } from "./fakes/livekit";

vi.mock(
  "livekit-client",
  async () => (await import("./fakes/livekit")).livekitModule
);

const { LiveKitTransport } = await import("@pipecat-ai/livekit-transport");

describeDeviceContract({
  name: "LiveKitTransport",
  supportsCam: true,
  create(devices) {
    resetLivekit(devices);
    return {
      transport: new LiveKitTransport(),
      connectParams: { url: "wss://fake.livekit.cloud", token: "fake-token" },
      failNextConnect: failNextLivekitConnect,
    };
  },
});
