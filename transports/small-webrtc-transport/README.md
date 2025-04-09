# Pipecat's Real-Time Voice Inference - Small WebRTC Transport

[![Docs](https://img.shields.io/badge/documentation-blue)](https://docs.pipecat.ai/client/js/transports/small-webrtc)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/small-webrtc-transport)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/pipecat/tree/main/examples/p2p-webrtc)

Small WebRTC transport package for use with `@pipecat-ai/client-js`.

## Installation

```bash copy
npm install \
@pipecat-ai/client-js \
@pipecat-ai/small-webrtc-transport
```

## Overview

The SmallWebRTCTransport class provides a WebRTC transport layer establishing a PeerConnection with Pipecat SmallWebRTCTransport. It handles audio/video device management, WebRTC connections, and real-time communication between client and bot.

## Features

- 🎥 Complete camera device management
- 🎤 Microphone input handling
- 📡 WebRTC connection management
- 🤖 Bot participant tracking
- 💬 Real-time messaging
  
## Usage

### Basic Setup

```javascript
import { RTVIClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

const transport = new SmallWebRTCTransport();

const rtviClient = new RTVIClient({
    transport,
    enableCam: false,  // Default camera off
    enableMic: true,   // Default microphone on
    callbacks: {
      // Event handlers
    },
    params: {
      baseUrl,
      endpoints
    }
    // ...
});

await rtviClient.connect();
```

## API Reference

### States

The transport can be in one of these states:
- "initializing"
- "initialized"
- "connecting"
- "connected"
- "ready"
- "disconnecting"
- "error"

## Events

The transport implements the various [RTVI event handlers](https://docs.pipecat.ai/client/js/api-reference/callbacks). Check out the docs or samples for more info.

## Error Handling

The transport includes error handling for:
- Connection failures
- Device errors

## License
BSD-2 Clause
