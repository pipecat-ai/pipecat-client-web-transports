# Pipecat's Real-Time Voice Inference - Gemini Multimodal Live Websocket Transport

[![Docs](https://img.shields.io/badge/documentation-blue)](https://docs.pipecat.ai/client/introduction)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/gemini-live-websocket-transport)

Gemini Multimodal Live transport package for use with `@pipecat-ai/client-js`.

## How to use

#### Install relevant packages

```bash
npm install @pipecat-ai/client-js @pipecat-ai/gemini-live-websocket-transport
```

#### Import and pass transport to your RTVI client
```typescript
import { RTVIClient } from "@pipecat-ai/client-js";
import { GeminiLiveWebSocketTransport } from "@pipecat-ai/gemini-live-websocket-transport";

const rtviClient = new RTVIClient({
    transport: new GeminiLiveWebSocketTransport(),
    // ... your RTVI config here
});

await rtviClient.connect();
```

### Documentation

Please refer to the RTVI documentation [here](https://docs.pipecat.ai/client/introduction).

### Disclaimer

Please note that this transport is meant for local development and testing and is not suited for production as it will reveal your Google Gemini API Key. [FIX ME: Link to next steps/guide]