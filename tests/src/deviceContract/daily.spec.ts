import { vi } from "vitest";

import { describeDeviceContract } from "./contract";
import { createFakeDailyCall } from "./fakes/daily";

vi.mock(
  "@daily-co/daily-js",
  async () => (await import("./fakes/daily")).dailyModule
);

const { DailyTransport } = await import("@pipecat-ai/daily-transport");

describeDeviceContract({
  name: "DailyTransport",
  supportsCam: true,
  create() {
    const call = createFakeDailyCall();
    return {
      transport: new DailyTransport(),
      connectParams: { url: "https://fake.daily.co/room" },
      failNextConnect: () => {
        call.failNextJoin = true;
      },
    };
  },
});
