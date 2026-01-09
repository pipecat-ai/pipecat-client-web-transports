# Changelog

All notable changes to **Pipecat Daily WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Added error handling around `daily.sendAppMessage`
- Set `_maxMessageSize` to the underlyling daily instance's max size (defaults to 10MB)

## [1.5.0]

- Bump client-js version to work with latest 1.5.0 and support latest features

## [1.4.1]

- Bump daily-js version dependency to 0.84.0

## [1.4.0]

- Enable useDevicePreferenceCookies to store preferred devices by default
- Bump client-js version to work with latest 1.4.0 and support latest features

## [1.3.0]

- Bump client-js version to work with latest 1.3.0 and support latest features

## [1.2.1]

- Bump daily-js version dependency to 0.83.1 to get Chrome 140 fix

## [1.2.0]

- Add support for current PipecatCloud and Pipecat runners which pass `dailyRoom` and `dailyToken`

## [1.1.0]

- Add support for generating `onDeviceError` callbacks/events when receiving a camera or speaker error.

## [1.0.0]

- PipecatClient and Transport 1.0.0 Updates:
  See [the migration guide](https://docs.pipecat.ai/client/js/migration-guide) for details
  - Updated DailyTransport to PipecatClient 1.0.0 changes, which include:
    - Updating naming/dependencies from RTVIClient -> PipecatClient
    - Added AudioBufferingStarted/Stopped events to allowable base callbacks, making registering for these events simpler and done in the same way you register for other RTVI events.
    - Modified connect() to follow the new pattern of providing connection details at the time of connection vs. constructor
    - Added validation for connection parameters
- New `getSessionInfo()` method returns the [Daily meeting session summary](https://docs.daily.co/reference/daily-js/instance-methods/meeting-session-summary#main) making it easier to dynamically grab the session id for the Daily call.
 
## [0.4.0]

- Bumped dependency to @pipecat-ai/client-js@~0.4.0

## [0.3.10]

- Fix an issue where iOS devices have ~500ms of audio cut off after declaring
  that the track state is playable.

## [0.3.9]

DO NOT USE

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
