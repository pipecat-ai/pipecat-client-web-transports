# Changelog

All notable changes to **Pipecat MoqTransport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/moq-transport-v0.1.1...moq-transport-v0.1.2) (2026-09-15)


### Bug Fixes

* **moq-transport:** hold client-ready until the bot audio subscription is live ([dc56c47](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/dc56c4700950ec55697705f3fb9f3f86f314eeb8))
* **moq-transport:** hold client-ready until the bot audio subscription is live ([795b91a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/795b91a2cea0f7cc12849e869e88fc5ea8a1f5d7))

## [0.1.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/moq-transport-v0.1.0...moq-transport-v0.1.1) (2026-08-13)


### Bug Fixes

* moq transport ([61c4d97](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/61c4d97e9a062ee9cb2f6e6e6160243ad80124cd))
* wait for the bot's broadcast before subscribing to the transcript ([9ff8594](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9ff8594ae6596f591d1f2507634b85acc108b84b))

## [0.1.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/moq-transport-v0.0.1...moq-transport-v0.1.0) (2026-07-16)

- Initial release of `@pipecat-ai/moq-transport`.
- Media-over-QUIC transport built on `@moq/net`, `@moq/publish`, `@moq/watch`, `@moq/json`, and `@moq/signals`.
- Microphone capture and Opus publish under `<namespace>/<clientId>`.
- Catalog-driven subscription to the bot broadcast at `<namespace>/<botId>`, with bounded-latency audio playback via `@moq/watch` (`Watch.Broadcast` + `Watch.Audio.Source`/`Decoder`/`Emitter`).
- Bidirectional RTVI message delivery over dedicated transcript tracks (`@moq/json` lossless append-log streams): bot→client events/transcripts, and client→bot messages including `client-ready`.
- WebTransport connection with WebSocket fallback (raced by `@moq/net`), and `serverCertificateHashes` support for self-signed dev relays.
