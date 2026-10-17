# Changelog

All notable changes to **Pipecat LiveKit Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/livekit-transport-v1.0.0...livekit-transport-v1.1.0) (2026-10-17)

### Features

* `LiveKitTransport` now implements the `mediaSupport` getter, reporting that it carries the user's microphone and camera and the bot's audio and video, plus screen share where the browser can share a screen. `PipecatClient.mediaSupport` combines this with what the bot supports so your UI can hide controls that can't work. Requires `@pipecat-ai/client-js` 1.14.0 or later. ([9b4eefc](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9b4eefce744f36e69acc7e4c4c52425efb18237b))

### Other

* Bumped the `@pipecat-ai/client-js` peer dependency to `~1.14.0`. Projects using `@pipecat-ai/livekit-transport` should upgrade `@pipecat-ai/client-js` to 1.14.x. ([6f1bf1a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6f1bf1a37e7077e54e27a92b810c1e146be781fe))

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
