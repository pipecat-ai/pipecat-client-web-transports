# Pipecat Client Web Transports

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/reference/js/transports/transport)
[![Discord](https://img.shields.io/discord/1239284677165056021)](https://discord.gg/pipecat)

A mono-repo to house the various supported Transport options to be used with the pipecat-client-web library. Currently, there are two transports: `daily-transport` and `gemini-live-websocket-transport`.

## Documentation

Pipecat Transports are intended to be used in conjunction with a Pipecat web client. Please refer to the full Pipecat client documentation [here](https://docs.pipecat.ai/client/introduction) and an overview of the [Transport API here](https://docs.pipecat.ai/client/reference/js/transports/transport)

## Current Transports

### [DailyTransport](/transports/daily/README.md)

[![Docs](https://img.shields.io/badge/Documention-blue)](https://docs.pipecat.ai/client/reference/js/transports/daily)
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
[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/reference/js/transports/gemini)
[![README](https://img.shields.io/badge/README-goldenrod)](transports/gemini-live-websocket-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](examples/geminiMultiModalLive/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/gemini-live-websocket-transport)

This Transport extends the [LLMDirectTransport](transports/llm-direct-transport/README) and connects directly to Gemini over a WebSocket connection using the Multimodal Live API. This type of transport is great for testing different services out without the need to build a server component. Just be aware that it is insecure since you will need to have access to your Gemini API Key client-side so not probably something you want to use in your production app.

Media flow using a GeminiLiveWebSocketTransport:
```
                Client                                      Server        
  ┌────────────────────────────────────┐                                  
  │                                    │                                  
  │            RTVIClient              │                ┌──────────────┐  
  │                                    │    Media over  │              │  
  │  ┌──────────────────────────────┐  │    WebSocket   │    Gemini    │  
  │  │ GeminiLiveWebSocketTransport │◄─┼────────────────┼─►  Server    │  
  │  └──────────────────────────────┘  │                │              │  
  │                                    │                └──────────────┘  
  └────────────────────────────────────┘                                  
```

## Local Development

### Build the transport libraries

```bash
$ yarn
$ yarn workspace @pipecat-ai/daily-transport build
$ yarn workspace @pipecat-ai/llm-direct-transport build
$ yarn workspace @pipecat-ai/gemini-live-websocket-transport build
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