# Websocket Transport

[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/pipecat/tree/main/examples/websocket/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/websocket-transport)

Websocket transport package for use with `@pipecat-ai/client-js`.

## Installation

```bash copy
npm install \
@pipecat-ai/client-js \
@pipecat-ai/websocket-transport
```

## Overview

The WebSocketTransport class provides a Websocket transport layer establishing a connection with Pipecat WebSocketTransport. It handles audio device management and real-time communication between client and bot.

## Features

- 🎤 Microphone input handling
- 🤖 Bot participant tracking
- 💬 Real-time messaging

## Usage

### Basic Setup

```javascript
import { PipecatClient } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

const pcClient = new PipecatClient({
    transport: new WebSocketTransport(),
    enableMic: true,   // Default microphone on
    callbacks: {
      // Event handlers
    },
});

pcClient.connect({
  ws_url: 'https://your.websocket/endpoint'
});
// OR...
pcClient.connect({
  endpoint: 'https://your-server/connect', // endpoint to return ws_url
});
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

The transport implements the various [Pipecat event handlers](https://docs.pipecat.ai/client/js/api-reference/callbacks). Check out the docs or samples for more info.

## Error Handling

The transport includes error handling for:
- Connection failures
- Device errors

## License
BSD-2 Clause

