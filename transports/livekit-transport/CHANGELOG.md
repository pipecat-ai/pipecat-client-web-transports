# Changelog

All notable changes to **Pipecat LiveKit Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/livekit-transport-v1.0.0...livekit-transport-v1.1.0) (2026-09-04)


### Features

* add livekit transport ([9c860dd](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9c860dd225b537eb9b994959d74d7ce287a6d35d))


### Bug Fixes

* **livekit-transport:** address review feedback from PR [#171](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/171) ([9f5e470](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9f5e4707de1d0d2d5ed13d02903edeac93caa5f7))
* **livekit-transport:** guard abort after publish, before connected ([10cf08f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/10cf08f4beed8b7190480c1af3ac4f029163152a))
* **livekit-transport:** keep pre-join tracks alive through connect ([8a1f66b](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8a1f66b7d60c7287a8f2e6a052751c278717e15b))
* **livekit-transport:** only dispatch rtvi-ai data messages ([534e674](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/534e674252a4882b3fba17297444933e2a688ba7))

## [1.0.0] - 2026-01-18

### Added

- Initial release of `@pipecat-ai/livekit-transport`
- WebRTC transport implementation using LiveKit infrastructure
- Complete device management for microphone, camera, and speaker
- Support for flexible authentication via `authUrl` or direct `url`/`token`
- Screen sharing functionality
- Real-time messaging via LiveKit data channels
- Comprehensive event handling for all LiveKit room events
- Participant tracking and management
- Transport state management aligned with Pipecat transport lifecycle
- Full TypeScript type definitions
- Integration with `@pipecat-ai/client-js` v1.13.0+

### Features

- 🎥 Camera device management with hot-swapping
- 🎤 Microphone input handling with device switching
- 🔊 Speaker output control
- 📡 WebRTC connection management via LiveKit SDK
- 🤖 Bot participant identification and tracking
- 📺 Screen sharing with audio support
- 💬 Real-time messaging and data channel communication
- 🔐 Flexible authentication methods (auth URL or direct credentials)
- ⚡ Automatic device enumeration and change detection
- 🎯 Proper synchronization of device states

### Dependencies

- `livekit-client`: ^2.17.0
- `@pipecat-ai/client-js`: ^1.13.0 (peer dependency)
