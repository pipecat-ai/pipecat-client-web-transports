# Pipecat Client Demo for Direct Communication with LLMs

## Overview
This application demonstrates a real-time voice interaction system using the Pipecat Client library with both the Gemini Multimodal Live and OpenAI RealTime WebRTC integrations. It enables two-way communication between users and the LLM, featuring voice input/output, text messaging, and various audio controls.

## Features
- Real-time voice interaction with a Gemini Multimodal Live bot
- Real-time voice interaction with an OpenAI RealTime bot
- Microphone input control and device selection
- Text-based message prompting
- Audio visualization through dynamic speech bubbles
- Comprehensive event handling system
- Connection state management

## Prerequisites
- Gemini API key (set as environment variable `VITE_DANGEROUS_GEMINI_API_KEY`)
- OpenAI API key (set as environment variable `VITE_DANGEROUS_OPENAI_API_KEY`)
- Optional [OpenWeather API](https://openweathermap.org/api) key for fetching weather. If none is provided, the app will generate something random.
- Modern web browser with WebSocket support
- Access to microphone

## Dependencies
```
# from base folder
$ npm i
$ npm run build
```


## Setup and Installation
```
npm i
npm run dev

cp env.example .env
# update .env with API keys
```

### To run the example with Gemini MultiModal Live:

Open [http://localhost:5173/](http://localhost:5173/)

### To run the example with OpenAI RealTime:

Open [http://localhost:5173?service=openai](http://localhost:5173?service=openai)

## Documentation Reference
[Pipecat Client Documentation](https://docs.pipecat.ai/client/introduction)
[Gemini Multimodal Live Documentation](https://ai.google.dev/api/multimodal-live)
[OpenAI RealTime WebRTC Documentation](https://platform.openai.com/docs/guides/realtime-webrtc)

## Usage

### Initialization
The application automatically initializes when the DOM content is loaded. It sets up:
- Audio device selection
- Microphone controls
- Bot connection management
- Event handlers

### Controls
- **Toggle Bot**: Connect/disconnect the AI assistant
- **Mute/Unmute**: Control microphone input
- **Microphone Selection**: Choose input device
- **Text Input**: Send text messages to the bot

### Event Handling
The application handles various events including:
- Transport state changes
- Bot connection status
- Audio track management
- Speech detection
- Error handling
- Audio level visualization

## Key Components

### PipecatClient Configuration
```typescript
let pcConfig: PipecatClientOptions = {
  transport,
  enableMic: true,
  enableCam: false,
};
```

### Gemini Multimodal Live Service Configuration
```typescript
const llm_service_options: GeminiLLMServiceOptions = {
  api_key: process.env.VITE_DANGEROUS_GEMINI_API_KEY,
  model: "models/gemini-2.0-flash-exp",
  // ... additional configuration
};
```

For all service options and their defaults, see [GeminiLLMServiceOptions](../../transports/gemini-live-websocket-transport/src/geminiLiveWebSocketTransport.ts#21)

### OpenAI Realtime API Service Configuration
```typescript
const llm_service_options: OpenAIServiceOptions = {
  api_key: import.meta.env.VITE_DANGEROUS_OPENAI_API_KEY,
  // ... additional configuration
};
```

For all service options and their defaults, see [OpenAIServiceOptions](../../transports/openai-realtime-webrtc-transport/src/OpenAIRealTimeWebRTCTransport.ts#28)

## Notes
- Gemini integration currently does not support transcripts

## License
BSD-2 Clause
