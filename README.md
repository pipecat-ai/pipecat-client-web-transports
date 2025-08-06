# Pipecat Client Web Transports

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/transport)
[![Discord](https://img.shields.io/discord/1239284677165056021)](https://discord.gg/pipecat)

A mono-repo to house the various supported Transport options to be used with the pipecat-client-web library. Currently, there are four transports: `small-webrtc-transport`, `daily-transport`, `gemini-live-websocket-transport`, and `openai-realtime-webrtc-transport`.

## Documentation

Pipecat Transports are intended to be used in conjunction with a Pipecat web client. Please refer to the full Pipecat client documentation [here](https://docs.pipecat.ai/client/introduction) and an overview of the [Transport API here](https://docs.pipecat.ai/client/js/transports/transport)

## Current Transports

### [SmallWebRTCTransport](/transports/small-webrtc-transport/README.md)

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/small-webrtc)
[![README](https://img.shields.io/badge/README-goldenrod)](/transports/small-webrtc-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/pipecat/tree/main/examples/p2p-webrtc)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/small-webrtc-transport)

This Transport creates a peer-to-peer WebRTC connection between the client and the bot process. This Transport is the client-side counterpart to the Pipecat [SmallWebRTCTransport component](https://docs.pipecat.ai/server/services/transport/small-webrtc).

This is the simplest low-latency audio/video transport for Pipecat. This transport is recommended for local development and demos. Things to be aware of:
  - This transport is a direct connection between the client and the bot process. If you need multiple clients to connect to the same bot, you will need to use a different transport.
  - For production usage at scale, a distributed WebRTC network that can do edge/mesh routing, has session-level observability and metrics, and can offload recording and other auxiliary services is often useful.

Typical media flow using a SmallWebRTCTransport:
```
                                            ┌──────────────────────────────────────────────────┐ 
                                            │                                                  │ 
 ┌─────────────────────────┐                │                       Server       ┌─────────┐   │ 
 │                         │                │                                    │Pipecat  │   │ 
 │            Client       │  RTVI Messages │                                    │Pipeline │   │ 
 │                         │       &        │                                              │   │ 
 │ ┌────────────────────┐  │  WebRTC Media  │  ┌────────────────────┐    media   │ ┌─────┐ │   │ 
 │ │SmallWebRTCTransport│◄─┼────────────────┼─►│SmallWebRTCTransport┼────────────┼─► STT │ │   │ 
 │ └────────────────────┘  │                │  └───────▲────────────┘     in     │ └──┬──┘ │   │ 
 │                         │                │          │                         │    │    │   │ 
 └─────────────────────────┘                │          │                         │ ┌──▼──┐ │   │ 
                                            │          │                         │ │ LLM │ │   │ 
                                            │          │                         │ └──┬──┘ │   │ 
                                            │          │                         │    │    │   │ 
                                            │          │                         │ ┌──▼──┐ │   │ 
                                            │          │           media         │ │ TTS │ │   │ 
                                            │          └─────────────────────────┼─┴─────┘ │   │ 
                                            │                       out          └─────────┘   │ 
                                            │                                                  │ 
                                            └──────────────────────────────────────────────────┘ 
```

### [DailyTransport](/transports/daily/README.md)

[![Docs](https://img.shields.io/badge/Documention-blue)](https://docs.pipecat.ai/client/js/transports/daily)
[![README](https://img.shields.io/badge/README-goldenrod)](/transports/daily/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/pipecat/tree/main/examples/simple-chatbot)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/daily-transport)

This Transport uses the [Daily](https://daily.co) audio and video calling service to connect to a bot and stream media over a WebRTC connection. This Transport is the client-side counterpart to the Pipecat [DailyTransport component](https://docs.pipecat.ai/server/services/transport/daily).

Typical media flow using a DailyTransport:
```
                                                                                       
                                       ┌────────────────────────────────────────────┐  
                                       │                                            │  
  ┌───────────────────┐                │                 Server       ┌─────────┐   │  
  │                   │                │                              │Pipecat  │   │  
  │      Client       │  RTVI Messages │                              │Pipeline │   │  
  │                   │       &        │                              │         │   │  
  │ ┌──────────────┐  │  WebRTC Media  │  ┌──────────────┐    media   │ ┌─────┐ │   │  
  │ │DailyTransport│◄─┼────────────────┼─►│DailyTransport┼────────────┼─► STT │ │   │  
  │ └──────────────┘  │                │  └───────▲──────┘     in     │ └──┬──┘ │   │  
  │                   │                │          │                   │    │    │   │  
  └───────────────────┘                │          │                   │ ┌──▼──┐ │   │  
                                       │          │                   │ │ LLM │ │   │  
                                       │          │                   │ └──┬──┘ │   │  
                                       │          │                   │    │    │   │  
                                       │          │                   │ ┌──▼──┐ │   │  
                                       │          │     media         │ │ TTS │ │   │  
                                       │          └───────────────────┼─┴─────┘ │   │  
                                       │                 out          └─────────┘   │  
                                       │                                            │  
                                       └────────────────────────────────────────────┘  
                                                                                       
```

### [GeminiLiveWebSocketTransport](transports/gemini-live-websocket-transport/README.md)
[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/gemini)
[![README](https://img.shields.io/badge/README-goldenrod)](transports/gemini-live-websocket-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](examples/directToLLMTransports/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/gemini-live-websocket-transport)

This Transport extends the [RealTimeWebSocketTransport](transports/realtime-websocket-transport/README) and connects directly to Gemini over a WebSocket connection using the Multimodal Live API. This type of transport is great for testing different services out without the need to build a server component. Just be aware that it is insecure since you will need to have access to your Gemini API Key client-side so not probably something you want to use in your production app.

Media flow using a GeminiLiveWebSocketTransport:
```
                Client                                      Server        
  ┌────────────────────────────────────┐                                  
  │                                    │                                  
  │           PipecatClient            │                ┌──────────────┐  
  │                                    │    Media over  │              │  
  │  ┌──────────────────────────────┐  │    WebSocket   │    Gemini    │  
  │  │ GeminiLiveWebSocketTransport │◄─┼────────────────┼─►  Server    │  
  │  └──────────────────────────────┘  │                │              │  
  │                                    │                └──────────────┘  
  └────────────────────────────────────┘                                  
```

### [OpenAIRealTimeWebRTCTransport](transports/gemini-live-websocket-transport/README.md)
[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/openai-webrtc)
[![README](https://img.shields.io/badge/README-goldenrod)](transports/openai-realtime-webrtc-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](examples/directToLLMTransports/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/openai-realtime-webrtc-transport)

This Transport connects directly to OpenAI over a WebRTC connection using the RealTime API. This type of transport is great for testing different services out without the need to build a server component. Just be aware that it is insecure since you will need to have access to your OpenAI API Key client-side so not probably something you want to use in your production app. It does not implement the Ephemeral Token process.

Media flow using a OpenAIRealTimeWebRTCTransport:
```
                Client                                      Server        
  ┌─────────────────────────────────────┐                                  
  │                                     │                                  
  │          PipecatClient              │                ┌──────────────┐  
  │                                     │    Media over  │              │  
  │  ┌───────────────────────────────┐  │      WebRTC    │    OpenAI    │  
  │  │ OpenAIRealTimeWebRTCTransport │◄─┼────────────────┼─►  Server    │  
  │  └───────────────────────────────┘  │                │              │  
  │                                     │                └──────────────┘  
  └─────────────────────────────────────┘                                  
```

## Local Development

### Build the transport libraries

```bash
$ npm i
$ npm run build
```

## License
BSD-2 Clause

## Contributing
We welcome contributions from the community! Whether you're fixing bugs, improving documentation, or adding new features, here's how you can help:

- **Found a bug?** Open an [issue](https://github.com/pipecat-ai/pipecat-client-web-transports/issues)
- **Have a feature idea?** Start a [discussion](https://discord.gg/pipecat)
- **Want to contribute code?** Check our [CONTRIBUTING.md](CONTRIBUTING.md) guide
- **Documentation improvements?** [Docs](https://github.com/pipecat-ai/docs) PRs are always welcome

Before submitting a pull request, please check existing issues and PRs to avoid duplicates.

We aim to review all contributions promptly and provide constructive feedback to help get your changes merged.