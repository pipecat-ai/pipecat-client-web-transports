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
- 📡 WebRTC connection management via LiveKit
- 🤖 Bot participant tracking
- 📺 Screen sharing support
- 💬 Real-time messaging via data channels
- 🔐 Flexible authentication (auth URL or direct token)

## Usage

### Basic Setup with Auth URL

```javascript
import { PipecatClient } from "@pipecat-ai/client-js";
import { LiveKitTransport } from "@pipecat-ai/livekit-transport";

const pcClient = new PipecatClient({
  transport: new LiveKitTransport(),
  enableCam: false,  // Default camera off
  enableMic: true,   // Default microphone on
  callbacks: {
    // Event handlers
  },
});

// Auth credentials are passed to connect(), not the constructor
await pcClient.connect({
  authUrl: "https://your.server/livekit-auth",
});
```

### Basic Setup with Direct Token

```javascript
import { PipecatClient } from "@pipecat-ai/client-js";
import { LiveKitTransport } from "@pipecat-ai/livekit-transport";

const pcClient = new PipecatClient({
  transport: new LiveKitTransport(),
  enableCam: false,
  enableMic: true,
  callbacks: {
    onConnected: () => console.log("Connected to LiveKit room"),
    onDisconnected: () => console.log("Disconnected from LiveKit room"),
  },
});

await pcClient.connect({
  url: "wss://your-livekit-server.com",
  token: "your-livekit-access-token",
});
```

## API Reference

### Constructor Options

The `LiveKitTransport` constructor accepts LiveKit `RoomOptions` to configure the room:

```typescript
type LiveKitTransportConstructorOptions = RoomOptions;

// Example with custom room options
const transport = new LiveKitTransport({
  adaptiveStream: true,
  dynacast: true,
});
```

**Connection credentials** are passed to `pcClient.connect()`, not the constructor:

```typescript
// Auth URL (server returns { url, token })
await pcClient.connect({ authUrl: "https://your.server/livekit-auth" });

// Direct credentials
await pcClient.connect({ url: "wss://your-livekit-server.com", token: "..." });

// Auth URL with POST body
await pcClient.connect({
  authUrl: "https://your.server/livekit-auth",
  authMethod: "POST",
  authBody: { roomName: "my-room" },
});
```

**RoomOptions** (from LiveKit SDK):
- `adaptiveStream`: Enable/disable adaptive stream
- `dynacast`: Enable/disable dynacast
- `videoCaptureDefaults`: Default video capture settings
- `audioCaptureDefaults`: Default audio capture settings
- And other LiveKit-specific room options

### Connection

```javascript
// With authUrl (credentials fetched automatically)
await pcClient.connect();

// With direct credentials (already provided in constructor)
await pcClient.connect();
```

### Device Management

```javascript
// Get available devices
const mics = await pcClient.getAllMics();
const cams = await pcClient.getAllCams();
const speakers = await pcClient.getAllSpeakers();

// Update devices
pcClient.updateMic(micDeviceId);
pcClient.updateCam(camDeviceId);
pcClient.updateSpeaker(speakerDeviceId);

// Enable/disable devices
pcClient.enableMic(true);
pcClient.enableCam(true);

// Check device status
const isMicOn = pcClient.isMicEnabled;
const isCamOn = pcClient.isCamEnabled;
```

### Screen Sharing

```javascript
// Enable screen sharing
pcClient.enableScreenShare(true);

// Check if screen sharing is active
const isSharing = pcClient.isSharingScreen;

// Disable screen sharing
pcClient.enableScreenShare(false);
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

The transport implements the various [Pipecat event handlers](https://docs.pipecat.ai/client/js/api-reference/callbacks):

```javascript
const pcClient = new PipecatClient({
  transport: new LiveKitTransport({ authUrl: "..." }),
  callbacks: {
    onConnected: () => console.log("Connected"),
    onDisconnected: () => console.log("Disconnected"),
    onTransportStateChanged: (state) => console.log("State:", state),
    onTrackStarted: (track, participant) => console.log("Track started"),
    onTrackStopped: (track, participant) => console.log("Track stopped"),
    onParticipantJoined: (participant) => console.log("Participant joined"),
    onParticipantLeft: (participant) => console.log("Participant left"),
    onMicUpdated: (deviceInfo) => console.log("Mic updated"),
    onCamUpdated: (deviceInfo) => console.log("Camera updated"),
    onSpeakerUpdated: (deviceInfo) => console.log("Speaker updated"),
    onDeviceError: (error) => console.error("Device error:", error),
  },
});
```

## Error Handling

The transport includes error handling for:
- Connection failures
- Device errors
- Authentication issues
- Media device access problems

## Integration with LiveKit Server

This transport is designed to work with LiveKit infrastructure. You'll need:
1. A LiveKit server instance (self-hosted or LiveKit Cloud)
2. An authentication endpoint that generates LiveKit access tokens, or
3. A way to generate LiveKit tokens directly in your application

## License

BSD-2 Clause
