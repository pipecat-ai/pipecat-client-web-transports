# Pipecat (RTVI) Client Demo with Gemini Multimodal Live

## Overview
This application demonstrates a real-time voice interaction system using the RTVI Client library with Gemini Multimodal Live integration. It enables two-way communication between users and the LLM, featuring voice input/output, text messaging, and various audio controls.

## Features
- Real-time voice interaction with an Gemini Multimodal Live bot
- Microphone input control and device selection
- Text-based message prompting
- Audio visualization through dynamic speech bubbles
- Comprehensive event handling system
- Connection state management

## Prerequisites
- Gemini API key (set as environment variable `VITE_DANGEROUS_GEMINI_API_KEY`)
- Modern web browser with WebSocket support
- Access to microphone

## Dependencies
```
# from base folder
$ yarn
$ yarn workspace @pipecat-ai/realtime-websocket-transport build
$ yarn workspace @pipecat-ai/gemini-live-websocket-transport
```


## Setup and Installation
```
npm i
npm run dev

cp env.example .env
# update .env with API keys
```

Open [http://localhost:5173/](http://localhost:5173/)

## Documentation Reference
[RTVI Client Documentation](https://docs.pipecat.ai/client/introduction)
[Gemini Multimodal Live Documentation](https://ai.google.dev/api/multimodal-live)

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

### RTVIClient Configuration
```typescript
let RTVIConfig: RTVIClientOptions = {
  transport,
  params: {
    baseUrl: "api",
    requestData: { },
  },
  enableMic: true,
  enableCam: false,
  timeout: 30 * 1000,
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

## Notes
- Gemini integration currently does not support transcripts

## Contributing
Feel free to submit issues and pull requests for improvements or bug fixes. Be nice :)

## License
BSD-2 Clause