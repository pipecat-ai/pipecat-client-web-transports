# Pipecat's Real-Time Voice Inference - LiveKit Transport

[![Docs](https://img.shields.io/badge/documentation-blue)](https://docs.pipecat.ai/client/js/transports/livekit)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/livekit-transport)

LiveKit transport package for use with `@pipecat-ai/client-js`.

## Installation

```bash
npm install \
@pipecat-ai/client-js \
@pipecat-ai/livekit-transport
```

## Overview

The LiveKitTransport class provides a WebRTC transport layer using [LiveKit](https://livekit.io)'s infrastructure. It handles audio/video device management, WebRTC connections, and real-time communication between clients and bots through LiveKit's real-time media platform.

## Features

- 🎥 Complete camera device management
- 🎤 Microphone input handling
- 🔊 Speaker output control
- 📡 WebRTC connection management
- 🤖 Bot participant tracking
- 📺 Screen sharing support
- 💬 Real-time messaging via data channels

## Usage

```javascript
import { PipecatClient } from "@pipecat-ai/client-js";
import { LiveKitTransport } from "@pipecat-ai/livekit-transport";

const pcClient = new PipecatClient({
  transport: new LiveKitTransport(),
  enableMic: true,
  enableCam: false,
  callbacks: {
    onConnected: () => console.log("Connected"),
    onDisconnected: () => console.log("Disconnected"),
  },
});

// Fetch credentials from your server, then connect
const { url, token } = await fetch("/your-token-endpoint").then(r => r.json());
await pcClient.connect({ url, token });
```

Or use `startBotAndConnect()` to let the base client handle the fetch:

```javascript
await pcClient.startBotAndConnect({
  endpoint: "https://your.server/start-bot",
});
```

## API Reference

### Constructor Options

The `LiveKitTransport` constructor accepts LiveKit [`RoomOptions`](https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomOptions.html) to configure the room:

```typescript
type LiveKitTransportConstructorOptions = RoomOptions;

// Example with custom room options
const transport = new LiveKitTransport({
  adaptiveStream: true,
  dynacast: true,
});
```

### Connection

Pass `url` and `token` to `pcClient.connect()` at connection time:

```typescript
await pcClient.connect({
  url: "wss://your-livekit-server.com",
  token: "your-livekit-access-token",
});
```

Optionally pass LiveKit [`RoomConnectOptions`](https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomConnectOptions.html):

```typescript
await pcClient.connect({
  url: "wss://your-livekit-server.com",
  token: "your-livekit-access-token",
  roomConnectionOptions: { autoSubscribe: true },
});
```

### States

The transport can be in one of these states:
- `"disconnected"` - Not connected to LiveKit room
- `"initializing"` - Setting up devices
- `"initialized"` - Devices ready
- `"connecting"` - Connecting to LiveKit room
- `"connected"` - Connected to LiveKit room
- `"ready"` - Ready for communication
- `"disconnecting"` - Disconnecting from room
- `"error"` - An error occurred

## Events

The transport implements the standard [Pipecat event callbacks](https://docs.pipecat.ai/client/js/api-reference/callbacks). Refer to the docs for the full list of supported events and their signatures.

## Integration with LiveKit Server

This transport is designed to work with LiveKit infrastructure. You'll need:
1. A LiveKit server instance (self-hosted or LiveKit Cloud)
2. A backend endpoint that generates LiveKit access tokens

## License

BSD-2 Clause
