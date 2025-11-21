# Changelog

All notable changes to **Pipecat Small WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.2]

### Changed
- Modified `startBotAndConnect` method to handle request data differently for internal endpoint calls:
  - When calling the `start` endpoint: sends the complete `requestData` object (including all properties like `createDailyRoom`, `enableDefaultIceServers`, etc.)
  - When calling the `connect` endpoint: only sends the data contained within the `body` property of `requestData`
  
  **Example:** If `startBotAndConnect` is called with:
  ```
    requestData: {
      createDailyRoom: false,
      enableDefaultIceServers: true,
      body: { character_id: characterId }
    }
  ```
  The `start` endpoint receives the full object, while the `connect` endpoint only receives `{ character_id: characterId }`.

## [1.7.1]

- Fixed an issue in `startBotAndConnect` where `requestData` was not carried over when invoking the `connect` endpoint.

## [1.7.0]

- Allowing `startBotAndConnect` to work with Pipecat Cloud and Pipecat runner.
- Adding support for trickle ice.

## [1.6.1]

- Bump daily-js version depenedency to 0.84.0

## [1.6.0]

- Improving how we wait for ICE gathering to complete.

## [1.5.0]

- Enable useDevicePreferenceCookies to store preferred devices by default
- Bump client-js version to work with latest 1.4.0 and support latest features

## [1.4.0]

- Deprecated the `webrtcUrl` field, replacing it with a new `webrtcRequestParams` field, adding support for passing a complete `APIRequest` type to define the connection endpoint. This allows clients to pass custom headers and data along to the offer/answer endpoint at connection time.

## [1.3.0]

### Added

- Added support for screensharing.

### Changed

- Bump daily-js version dependency to 0.83.1 to get Chrome 140 fix

## [1.2.0]

- Deprecated the transport option `connectionUrl` in lieu of a new and hopefully less confusingly named `webrtcUrl` field

## [1.1.0]

- Add support for generating `onDeviceError` callbacks/events when receiving a camera or speaker error.

## [1.0.0]

- PipecatClient and Transport 1.0.0 Updates:
  See [the migration guide](https://docs.pipecat.ai/client/js/migration-guide) for details
  - Updated SmallWebRTCTransport to PipecatClient 1.0.0 changes, which include:
    - Updating naming/dependencies from RTVIClient -> PipecatClient
    - Modified connect() to follow the new pattern of providing connection details at the time of connection vs. constructor
    - Added validation for connection parameters

## [0.4.0]

- Bumped dependency to @pipecat-ai/client-js@~0.4.0

## [0.0.5] - 2025-05-19

### Fixed

- `SmallWebRTCTransport` updates transport state to 'ready' when client ready message is sent.

## [0.0.4] - 2025-04-29

### Added

- Added `waitForICEGathering` property: this allows users to configure whether the transport should 
    explicitly wait for the iceGatheringState to become complete during the negotiation phase.

### Fixed

- `SmallWebRTCTransport` class now accepts `RTCIceServer`[] instead of just the `String`[] of urls.

## [0.0.3] - 2025-04-11

### Added

- Handling a new incoming `peerLeft` signalling messages from Pipecat.

## [0.0.2] - 2025-04-10

### Added

- Send a signalling message whenever a track is enabled or disabled.
- Handle incoming `renegotiate` signalling messages from Pipecat in a new format.

## [0.0.1] - 2025-04-09

### Added

- Web client transport for the Pipecat **SmallWebRTCTransport**.
