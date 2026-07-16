# Changelog

All notable changes to **Pipecat MoqTransport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/moq-transport-v0.0.1...moq-transport-v0.1.0) (2026-07-16)


### Features

* add moq docs ([99ac7f0](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/99ac7f09a55c246febf8871af28eb582066eafc4))
* add moq transport support ([b678463](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/b678463f7a4332060e21379c5f60962e10ce4c43))
* improving the MoQ transport README ([659f4a5](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/659f4a562d0190c7efdf31f964f51d6dd83c0484))
* improving the MoQ transport README ([5501d99](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5501d99cd1860bbf465660bba33744913eaf174c))
* moq refactor- use libs ([7c9dd26](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7c9dd26197c62f67ab8dfab6fb7469a9575fff3b))
* **moq:** add client→bot RTVI message channel ([1a338ff](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1a338ff41dd673773b3f50968a70c1b929ff18c8))
* **moq:** carry the RTVI transcript on a lossless compressed JSON stream ([a272282](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a27228287e4a0bd3a80c840380b31bed79efedb3))
* **moq:** carry the RTVI transcript on a lossless compressed JSON stream ([79f8cb3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/79f8cb3e8873b4014c3863aa4f23f81a903a5eef))
* **moq:** play bot audio via @moq/watch buffered playback ([e7b95da](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/e7b95dac3669f217a6f54dc69d10659f567f9bcb))

## [0.0.1]

- Initial release of `@pipecat-ai/moq-transport`.
- Media-over-QUIC transport built on `@moq/net`, `@moq/publish`, `@moq/watch`, `@moq/json`, and `@moq/signals`.
- Microphone capture and Opus publish under `<namespace>/<clientId>`.
- Catalog-driven subscription to the bot broadcast at `<namespace>/<botId>`, with bounded-latency audio playback via `@moq/watch` (`Watch.Broadcast` + `Watch.Audio.Source`/`Decoder`/`Emitter`).
- Bidirectional RTVI message delivery over dedicated transcript tracks (`@moq/json` lossless append-log streams): bot→client events/transcripts, and client→bot messages including `client-ready`.
- WebTransport connection with WebSocket fallback (raced by `@moq/net`), and `serverCertificateHashes` support for self-signed dev relays.
