import {
  type DeviceState,
  DeviceStateEnum,
  PipecatClient,
  RTVIEvent,
} from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { useEffect, useState } from "react";

function App() {
  const [client, setClient] = useState<PipecatClient | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(
    DeviceStateEnum.NOT_READY,
  );

  useEffect(() => {
    if (client) return;

    const pc = new PipecatClient({
      transport: new SmallWebRTCTransport({
        webrtcRequestParams: {
          endpoint: "/api/offer",
        },
      }),
    });
    pc.addListener(RTVIEvent.DeviceStateChanged, (state) => {
      console.log("Device state changed:", state);
      setDeviceState(state);
    });

    console.log("Client:", pc);
    console.log("Device state:", pc.deviceState);
    setDeviceState(pc.deviceState);

    setClient(pc);
  }, [client]);

  return (
    <div>
      Device state: <code>{deviceState}</code>
      <hr />
      {client && (
        <>
          <button onClick={() => client.initDevices()}>Init devices</button>
          <button onClick={() => client.connect()}>Connect</button>
        </>
      )}
    </div>
  );
}

export default App;
