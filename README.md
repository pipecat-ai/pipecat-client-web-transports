# Pipecat Client Web Transports

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/transport)
[![Discord](https://img.shields.io/discord/1239284677165056021)](https://discord.gg/pipecat)

A mono-repo to house the various supported Transport options to be used with the pipecat-client-web library. Currently, there are five transports: `small-webrtc-transport`, `daily-transport`, `websocket-transport`, `livekit-transport` and `moq-transport`.

## Documentation

Pipecat Transports are intended to be used in conjunction with a Pipecat web client. Please refer to the full Pipecat client documentation [here](https://docs.pipecat.ai/client/introduction) and an overview of the [Transport API here](https://docs.pipecat.ai/client/js/transports/transport)

## Current Transports

### [SmallWebRTCTransport](/transports/small-webrtc-transport/README.md)

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/small-webrtc)
[![README](https://img.shields.io/badge/README-goldenrod)](/transports/small-webrtc-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/pipecat/tree/main/examples/p2p-webrtc)
[![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/small-webrtc-transport)](https://www.npmjs.com/package/@pipecat-ai/small-webrtc-transport)

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
[![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/daily-transport)](https://www.npmjs.com/package/@pipecat-ai/daily-transport)

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

### [WebSocketTransport](transports/websocket-transport/README.md)

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/api-reference/client/js/transports/websocket)
[![README](https://img.shields.io/badge/README-goldenrod)](transports/websocket-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/pipecat-examples/tree/main/websocket)
[![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/websocket-transport)](https://www.npmjs.com/package/@pipecat-ai/websocket-transport)

This transport enables a purely WebSocket based connection between clients and your Pipecat application. It implements bidirectional audio and video streaming using a WebSocket for real-time communication.

It is intended for lightweight implementations, particularly for local development and testing. It expects your Pipecat server to include the corresponding server-side [WebSocketTransport](https://docs.pipecat.ai/api-reference/server/services/transport/websocket-server) implementation.

### [LiveKitTransport](/transports/livekit-transport/README.md)

[![Docs](https://img.shields.io/badge/Documentation-blue)](https://docs.pipecat.ai/client/js/transports/livekit)
[![README](https://img.shields.io/badge/README-goldenrod)](/transports/livekit-transport/README.md)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/livekit-transport)

This Transport uses the [LiveKit](https://livekit.io) real-time communication platform to connect to a bot and stream media over a WebRTC connection. This Transport is the client-side counterpart to the Pipecat [LiveKitTransport component](https://docs.pipecat.ai/server/services/transport/livekit).

Typical media flow using a LiveKitTransport:

```

                                       ┌────────────────────────────────────────────┐
                                       │                                            │
  ┌───────────────────┐                │                 Server       ┌─────────┐   │
  │                   │                │                              │Pipecat  │   │
  │      Client       │  RTVI Messages │                              │Pipeline │   │
  │                   │       &        │                              │         │   │
  │ ┌──────────────┐  │  WebRTC Media  │  ┌──────────────┐    media   │ ┌─────┐ │   │
  │ │LiveKitTranspo│◄─┼────────────────┼─►│LiveKitTranspo┼────────────┼─► STT │ │   │
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

### [MoqTransport](/transports/moq-transport/README.md)

[![Docs](https://img.shields.io/badge/documentation-blue)](https://docs.pipecat.ai/client/js/transports)
[![README](https://img.shields.io/badge/README-goldenrod)](/transports/moq-transport/README.md)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/voice-ui-kit/tree/main/examples/01-console)
[![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/moq-transport)](https://www.npmjs.com/package/@pipecat-ai/moq-transport)

This Transport uses [Media over QUIC (MoQ)](https://quic.video/) to connect to a bot, either through a MoQ relay or directly to a bot running in serve mode. This Transport is the client-side counterpart to the Pipecat MoQ transport component (`pipecat.transports.moq.transport`).

Typical media flow using a MoqTransport:

```

                                       ┌────────────────────────────────────────────┐
                                       │                                            │
  ┌───────────────────┐                │                 Server       ┌─────────┐   │
  │                   │                │                              │Pipecat  │   │
  │      Client       │  RTVI Messages │                              │Pipeline │   │
  │                   │       &        │                              │         │   │
  │ ┌──────────────┐  │  WebTransport  │  ┌──────────────┐    media   │ ┌─────┐ │   │
  │ │ MoqTransport │◄─┼────────────────┼─►│ MoqTransport ┼────────────┼─► STT │ │   │
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

## No Longer Supported

`gemini-live-websocket-transport` and `openai-realtime-webrtc-transport` were removed from this repo as of their `1.5.8` releases. Both connected directly from the browser to a third-party LLM API rather than through a Pipecat server, saw essentially no adoption, and couldn't be kept in sync with those APIs as they changed, so they're no longer supported or maintained. The last published npm versions remain installable (`@pipecat-ai/gemini-live-websocket-transport@1.5.8`, `@pipecat-ai/openai-realtime-webrtc-transport@1.5.8`), but are not guaranteed to keep working as the underlying APIs evolve.

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
