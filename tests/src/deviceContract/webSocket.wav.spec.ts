import { vi } from "vitest";

import { describeDeviceContract } from "./contract";
import { createFakeDailyCall } from "./fakes/daily";
import {
  failNextSocket,
  passThroughSerializer,
  WS_URL,
} from "./fakes/webSocket";

vi.mock(
  "@daily-co/daily-js",
  async () => (await import("./fakes/daily")).dailyModule
);
vi.mock(
  "../../../lib/src/websocket-utils/reconnectingWebSocket.ts",
  async () => (await import("./fakes/webSocket")).reconnectingWebSocketModule
);
vi.mock(
  "../../../lib/src/wavtools/index.js",
  async () => (await import("./fakes/wavtools")).wavtoolsModule
);

const { WebSocketTransport } = await import("@pipecat-ai/websocket-transport");
const { WavMediaManager } = await import("@pipecat-ai/transport-lib");

describeDeviceContract({
  name: "WebSocketTransport + WavMediaManager",
  supportsCam: false,
  create() {
    createFakeDailyCall();
    const transport = new WebSocketTransport({
      mediaManager: new WavMediaManager(),
      serializer: passThroughSerializer,
    });
    return {
      transport,
      connectParams: { wsUrl: WS_URL },
      failNextConnect: failNextSocket,
    };
  },
});
