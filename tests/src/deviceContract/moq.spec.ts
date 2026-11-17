import { vi } from "vitest";

import { describeDeviceContract } from "./contract";
import { createFakeMoqWorld } from "./fakes/moq";

vi.mock("@moq/hang", async () => (await import("./fakes/moq")).hangModule());
vi.mock("@moq/hang/catalog", async () =>
  (await import("./fakes/moq")).hangCatalogModule()
);
vi.mock("@moq/hang/container", async () =>
  (await import("./fakes/moq")).hangContainerModule()
);
vi.mock("@moq/publish", async () =>
  (await import("./fakes/moq")).publishModule()
);
vi.mock("@moq/watch", async () => (await import("./fakes/moq")).watchModule());
vi.mock("@moq/net", async () => (await import("./fakes/moq")).netModule());
vi.mock("@moq/json", async () => (await import("./fakes/moq")).jsonModule());

const { MoqTransport } = await import("@pipecat-ai/moq-transport");

describeDeviceContract({
  name: "MoqTransport",
  supportsCam: false,
  create() {
    const world = createFakeMoqWorld();
    return {
      transport: new MoqTransport({ relayUrl: "https://relay.fake/moq" }),
      connectParams: world.connectParams(),
      failNextConnect: () => world.failNextConnect(),
    };
  },
});
