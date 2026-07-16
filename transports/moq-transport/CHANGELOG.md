# Changelog

All notable changes to **Pipecat MoqTransport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1]

- Initial release of `@pipecat-ai/moq-transport`.
- Media-over-QUIC transport built on `@moq/net`, `@moq/publish`, `@moq/watch`, `@moq/json`, and `@moq/signals`.
- Microphone capture and Opus publish under `<namespace>/<clientId>`.
- Catalog-driven subscription to the bot broadcast at `<namespace>/<botId>`, with bounded-latency audio playback via `@moq/watch` (`Watch.Broadcast` + `Watch.Audio.Source`/`Decoder`/`Emitter`).
- Bidirectional RTVI message delivery over dedicated transcript tracks (`@moq/json` lossless append-log streams): bot→client events/transcripts, and client→bot messages including `client-ready`.
- WebTransport connection with WebSocket fallback (raced by `@moq/net`), and `serverCertificateHashes` support for self-signed dev relays.
