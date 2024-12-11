# Gemini Live Websocket Transport

A real-time websocket transport implementation for interacting with Google's Gemini Multimodal Live API, supporting bidirectional audio and unidirectional text communication.

## Installation

```bash
npm install @pipecat-ai/client-js @pipecat-ai/real-time-websocket-transport @pipecat-ai/gemini-live-websocket-transport
```

## Overview

The `GeminiLiveWebsocketTransport` class extends the `RealTimeWebsocketTransport` to implement a fully functional [RTVI `Transport`](https://docs.pipecat.ai/client/reference/js/transports/transport). It provides a framework for implementing real-time communication directly with the [Gemini Multimodal Live](https://ai.google.dev/api/multimodal-live) voice-to-voice service. It handles media device management, audio/video streams, and state management for the connection.

## Features

- Real-time bidirectional communication with Gemini Multimodal Live
- Audio streaming support
- Text message support
- Automatic reconnection handling
- Configurable generation parameters
- Support for initial conversation context

## Usage

### Basic Setup

```javascript
import { GeminiLiveWebsocketTransport, GeminiLLMServiceOptions } from '@pipecat-ai/gemini-live-websocket-transport';

const options: GeminiLLMServiceOptions = {
  api_key: 'YOUR_API_KEY',
  generation_config: {
    temperature: 0.7,
    maxOutput_tokens: 1000
  }
};

const transport = new GeminiLiveWebsocketTransport(options);
let RTVIConfig: RTVIClientOptions = {
  transport,
  ...
};

```

### Configuration Options

```typescript
interface GeminiLLMServiceOptions {
  api_key: string;                    // Required: Your Gemini API key
  initial_messages?: Array<{          // Optional: Initial conversation context
    content: string;
    role: string;
  }>;
  generation_config?: {               // Optional: Generation parameters
    candidate_count?: number;
    maxOutput_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    response_modalities?: string;
    speech_config?: {
      voice_config?: {
        prebuilt_voice_config?: {
          voice_name: "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede";
        };
      };
    };
  };
}
```

### Sending Messages

```javascript
// Send text prompt message
rtviClient.sendMessage({
  type: 'send-text',
  data: 'Hello, Gemini!'
});
```

### Handling Events

The transport implements the various [RTVI event handlers](https://docs.pipecat.ai/client/reference/js/callbacks). Check out the docs or samples for more info.

## API Reference

### Methods

- `initialize()`: Set up the transport and establish connection
- `sendMessage(message)`: Send a text message
- `handleUserAudioStream(data)`: Stream audio data to the model
- `disconnectLLM()`: Close the connection
- `sendReadyMessage()`: Signal ready state

### States

The transport can be in one of the following states:
- "disconnected"
- "initializing"
- "initialized"
- "connecting"
- "connected"
- "ready"
- "disconnecting
- "error"

## Error Handling

The transport includes comprehensive error handling for:
- Connection failures
- Websocket errors
- API key validation
- Message transmission errors

## License
BSD-2 Clause

## Contributing
Feel free to submit issues and pull requests for improvements or bug fixes. Be nice :)