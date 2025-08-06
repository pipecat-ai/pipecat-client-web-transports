# Pipecat's Real-Time Voice Inference - Daily Transport

[![Docs](https://img.shields.io/badge/documentation-blue)](https://docs.pipecat.ai/client/js/transports/daily)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/daily-transport)
[![Demo](https://img.shields.io/badge/Demo-coral)](https://github.com/pipecat-ai/pipecat/tree/main/examples/simple-chatbot)

Daily transport package for use with `@pipecat-ai/client-js`.

## Installation

```bash copy
npm install \
@pipecat-ai/client-js \
@pipecat-ai/daily-transport
```

## Overview

The DailyTransport class provides a WebRTC transport layer using [Daily.co's](https://daily.co) infrastructure. It handles audio/video device management, WebRTC connections, and real-time communication between clients and bots.

## Features

- 🎥 Complete camera device management
- 🎤 Microphone input handling
- 🔊 Speaker output control
- 📡 WebRTC connection management
- 🤖 Bot participant tracking
- 📊 Audio level monitoring
- 💬 Real-time messaging
  
## Usage

### Basic Setup

```javascript
import { PipecatClient } from "@pipecat-ai/client-js";
import { DailyTransport } from "@pipecat-ai/daily-transport";

const pcClient = new PipecatClient({
    transport: new DailyTransport({ dailyFactoryOptions }),
    enableCam: false,  // Default camera off
    enableMic: true,   // Default microphone on
    callbacks: {
      // Event handlers
    },
    // ...
});

pcClient.connect({
  url: 'https://your.daily.co/room'
});
// OR...
pcClient.connect({
  endpoint: 'https://your-server/connect', // endpoint to return url
});
```

## API Reference

### Constructor Options

```typescript
interface DailyTransportConstructorOptions {
  dailyFactoryOptions?: DailyFactoryOptions;  // Daily.co specific configuration
}
```

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

The transport implements the various [Pipecat event handlers](https://docs.pipecat.ai/client/js/api-reference/callbacks). Check out the docs or samples for more info.

## Error Handling

The transport includes error handling for:
- Connection failures
- Device errors
- Authentication issues
- Message transmission problems

## License
BSD-2 Clause
