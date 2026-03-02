# Changelog

All notable changes to **Pipecat LiveKit Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.1] - 2026-01-18

### Added

- Initial release of `@pipecat-ai/livekit-transport`
- WebRTC transport implementation using LiveKit infrastructure
- Complete device management for microphone, camera, and speaker
- Support for flexible authentication via `authUrl` or direct `roomUrl`/`roomToken`
- Screen sharing functionality
- Real-time messaging via LiveKit data channels
- Comprehensive event handling for all LiveKit room events
- Participant tracking and management
- Transport state management aligned with Pipecat transport lifecycle
- Full TypeScript type definitions
- Integration with `@pipecat-ai/client-js` v1.5.0+

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
- `@pipecat-ai/client-js`: ~1.5.0 (peer dependency)
