# Pipecat Client Web Transports

A mono-repo to house the various supported Transport options to be used with the pipecat-client-web library. Currently, there is a single transport: daily-transport.

## How to use

#### Install relevant packages

```bash
# install core pipecat client sdk
npm install @pipecat-ai/client-js
# install the transport of your chosing

# to install the daily webrtc transport
npm install @pipecat-ai/daily-transport

# OR to install the gemini live transport
# npm install @pipecat-ai/realtime-websocket-transport @pipecat-ai/gemini-live-websocket-transport
```

#### Import and pass transport to your RTVI client

```typescript
import { RTVIClient } from "@pipecat-ai/client-js";
import { DailyTransport } from "@pipecat-ai/daily-transport";

const rtviClient = new RTVIClient({
    transport: new DailyTransport(),
    // ... your RTVI config here
});

await rtviClient.connect();
```

## Documentation

Please refer to the RTVI documentation [here](https://docs.pipecat.ai/client/introduction).

## Local Development

### Build the transport libraries

```bash
$ yarn
$ yarn workspace @pipecat-ai/daily-transport build
$ yarn workspace @pipecat-ai/realtime-websocket-transport build
$ yarn workspace @pipecat-ai/gemini-live-websocket-transport build
```

## Play

### Build and run the Gemini Multimodal Live Demo

**Build:**

```bash
$ cd examples/geminiMultiModalLive
$ npm i
$ npm run dev
```

**Run:**

1. Open browser to http://localhost:5173/
2. Click the link to connect
3. Profit