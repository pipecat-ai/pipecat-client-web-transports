# Changelog

All notable changes to **Pipecat Daily WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.9]

- Fix an issue where iOS devices have ~500ms of audio cut off after declaring
  that the track state is playable.

## [0.3.8]

- Fix issue resulting in the camera starting despite enableCam setting.

## [0.3.7]

- Added support for disconnecting the client if the Daily call errors out.

## [0.3.6]

### Fixed

- Fixed an issue where the transport could call `clientReady()` multiple times,
  once for each `track-started` event. Now, `clientReady()` is called for the
  first track only.

- Added support for buffering audio until the bot is ready using the
  `bufferLocalAudioUntilBotReady` property. Once the bot is ready, the buffered
  audio will be sent, allowing the user to begin speaking before the bot has
  joined the call.

## [0.3.4] - 2024-12-16

### Added

- Screen sharing support
  - Added `startScreenShare` and `stopScreenShare` methods
  - Added `isSharingScreen` getter property

## [0.3.3] - 2024-12-11

- Fixed READMEs

## [0.3.2] - 2024-12-11

- Added new abstract `RealtimeWebsocketTransport` class for direct
  voice-to-voice transports

- Added new `GeminiLiveWebsocketTransport`

- Added [basic example](./examples/geminiMultiModalLive) for using
  `GeminiLiveWebsocketTransport`

## [0.2.3] - 2024-12-06

### Fixed

- Added missing event support for managing audio speakers

## [0.2.2] - 2024-11-12

### Added

- Implemented log levels as part of `realtime-ai` package.

## [0.2.1] - 2024-10-28

- Version bump to align with core `realtime-ai` package.
