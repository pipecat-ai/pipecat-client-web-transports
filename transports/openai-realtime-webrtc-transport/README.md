# OpenAI RealTime WebRTC Transport

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/openai-webrtc)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](examples/directToLLMTransports/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/openai-realtime-webrtc-transport)

A real-time websocket transport implementation for interacting with Google's Gemini Multimodal Live API, supporting bidirectional audio and unidirectional text communication.

## Installation

```bash copy
npm install \
@pipecat-ai/client-js \
@pipecat-ai/openai-realtime-webrtc-transport
```

## Overview

The `OpenAIRealTimeWebRTCTransport` is a fully functional [Pipecat `Transport`](https://docs.pipecat.ai/client/js/transports/transport). It provides a framework for implementing real-time communication directly with the [OpenAI Realtime API using WebRTC](https://platform.openai.com/docs/guides/realtime-webrtc) voice-to-voice service. It handles media device management, audio/video streams, and state management for the connection.

## Features

- Real-time bidirectional communication with OpenAI Realtime API
- Input device management
- Audio streaming support
- Text message support
- Automatic reconnection handling
- Configurable generation parameters
- Support for initial conversation context

## Usage

### Basic Setup

```javascript
import { OpenAIRealTimeWebRTCTransport, OpenAIServiceOptions } from '@pipecat-ai/openai-realtime-webrtc-transport';

const options: OpenAIServiceOptions = {
  api_key: 'YOUR_API_KEY',
  session_config: {
    instructions: 'you are a confused jellyfish',
  }
};

let PipecatConfig: PipecatClientOptions = {
  transport: new OpenAIRealTimeWebRTCTransport(options),
  ...
};

```

### Configuration Options

```typescript
/**********************************
 * OpenAI-specific types
 *   types and comments below are based on:
 *     gpt-4o-realtime-preview-2024-12-17
 **********************************/
type JSONSchema = { [key: string]: any };
export type OpenAIFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: JSONSchema;
};

export type OpenAIServerVad = {
  type: "server_vad";
  create_response?: boolean; // defaults to true
  interrupt_response?: boolean; // defaults to true
  prefix_padding_ms?: number; // defaults to 300ms
  silence_duration_ms?: number; // defaults to 500ms
  threshold?: number; // range (0.0, 1.0); defaults to 0.5
};

export type OpenAISemanticVAD = {
  type: "semantic_vad";
  eagerness?: "low" | "medium" | "high" | "auto"; // defaults to "auto", equivalent to "medium"
  create_response?: boolean; // defaults to true
  interrupt_response?: boolean; // defaults to true
};

export type OpenAISessionConfig = Partial<{
  modalities?: string;
  instructions?: string;
  voice?:
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "sage"
    | "shimmer"
    | "verse";
  input_audio_noise_reduction?: {
    type: "near_field" | "far_field";
  } | null; // defaults to null/off
  input_audio_transcription?: {
    model: "whisper-1" | "gpt-4o-transcribe" | "gpt-4o-mini-transcribe";
    language?: string;
    prompt?: string[] | string; // gpt-4o models take a string
  } | null; // we default this to gpt-4o-transcribe
  turn_detection?: OpenAIServerVad | OpenAISemanticVAD | null; // defaults to server_vad
  temperature?: number;
  max_tokens?: number | "inf";
  tools?: Array<OpenAIFunctionTool>;
}>;

export interface OpenAIServiceOptions {
  api_key: string;
  model?: string;
  initial_messages?: LLMContextMessage[];
  settings?: OpenAISessionConfig;
}
```

### Sending Messages

```javascript
// at setup time...
pcClient.appendToContext({ role: "user", content: 'Hello OpenAI!' });
```

### Handling Events

The transport implements the various [Pipecat event handlers](https://docs.pipecat.ai/client/js/api-reference/callbacks). Check out the docs or samples for more info.

### Updating Session Configuration

```javascript
pcClient.transport.updateSessionConfig({
  instructions: 'you are a an over-sharing neighbor',
  input_audio_noise_reduction: {
    type: 'near_field'
  }
});
```

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
- WebRTC connection errors
- API key validation
- Message transmission errors

## License
BSD-2 Clause
