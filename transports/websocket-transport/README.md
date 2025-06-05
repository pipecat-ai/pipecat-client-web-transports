# Real-Time Websocket Transport

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/realtime)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](examples/directToLLMTransports/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/websocket-transport)

A flexible abstract transport class for implementing connections to directly communicate with LLMs that support voice-to-voice modalities.

## Installation

```bash copy
npm install \
@pipecat-ai/client-js \
@pipecat-ai/real-time-websocket-transport
```

## Overview

The `RealTimeWebsocketTransport` class provides a foundation for building transports for direct voice-to-voice communication:

- Audio/video device management
- Bi-directional audio streaming
- Device selection and control
- State management
- Event handling

## Disclaimer

This Transport type is primarily intended for dev-only and testing purposes. Since this transport talks directly with the LLM, there is no way to obscure API Keys necessary for doing so. Developers will need to eventually build a server component with a server-friendly transport (See the [daily-transport](https://docs.pipecat.ai/client/js/transports/daily) as an example.)

## Usage

To use this package, create a new Transport by extending the `RealTimeWebsocketTransport` class and implement the following abstract functions:

```typescript
import { RealTimeWebsocketTransport } from '@pipecat-ai/real-time-websocket-transport';

export interface MyLLMOptions extends LLMServiceOptions {
    api_key: string,
    // define types for all the various options your
    // LLM service may want to support during setup/connection
}

class MyLLMServiceTransport extends RealTimeWebsocketTransport {
  constructor(service_options: GeminiLLMServiceOptions, manager?: MediaManager) {
    super(service_options, manager);
    // Initialize class variables
  }

async initializeLLM(): void {
    // Initialize your LLM service client
  }

  async attachLLMListeners(): void {
    // Set up event listeners to handle message from your LLM service
  }

  async connectLLM(): Promise<void> {
    // Implement connection logic for the LLM
  }

  async disconnectLLM(): Promise<void> {
    // Disconnect from the LLM
  }

  handleUserAudioStream(data: ArrayBuffer): void {
    // Pass the data provided to the LLM
  }

  async sendReadyMessage(): Promise<void> {
    // call this._onMessage() with a BOT_READY message once the
    // LLM is connected and ready to receive data
  }

  sendMessage(message: RTVIMessage): void {
    // Implement sending other LLM-specific messages to the LLM
    // This is how the user can call things like rtviClient.sendMessage(...)
    // and communicate in other ways with the LLM
  }
}
```

## API Reference

### Constructor
```typescript
constructor(service_options: LLMServiceOptions, manager: MediaManager)
```

### Abstract Methods
- `initializeLLM(): void`
- `attachLLMListeners(): void`
- `connectLLM(): Promise<void>`
- `disconnectLLM(): Promise<void>`
- `handleUserAudioStream(data: ArrayBuffer): void`
- `sendReadyMessage()`
- `sendMessage(message: RTVIMessage)`

### Device Management Methods
- `getAllMics(): Promise<MediaDeviceInfo[]>`
- `getAllCams(): Promise<MediaDeviceInfo[]>`
- `getAllSpeakers(): Promise<MediaDeviceInfo[]>`
- `updateMic(micId: string): Promise<void>`
- `updateCam(camId: string): void`
- `updateSpeaker(speakerId: string): void`

### State Properties
- `get state(): TransportState`
- `get isCamEnabled(): boolean`
- `get isMicEnabled(): boolean`

## Events
The transport supports emitting the events defined by the [RTVI Specification](https://docs.pipecat.ai/client/js/api-reference/callbacks)

## License

BSD-2 Clause
