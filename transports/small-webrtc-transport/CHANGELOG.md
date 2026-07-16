# Changelog

All notable changes to **Pipecat Small WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.6](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.5...small-webrtc-transport-v1.10.6) (2026-07-16)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.13.0

## [1.10.5](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.4...small-webrtc-transport-v1.10.5) (2026-06-19)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.12.0 ([ef7a2c3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ef7a2c30f3082d5433e8b0c0423e732a13e5a95f))

## [1.10.4](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.3...small-webrtc-transport-v1.10.4) (2026-06-03)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.11.0 ([8a38dab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8a38dab477191d4ce2bc31e9f4f40b49da921771))

## [1.10.3](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.2...small-webrtc-transport-v1.10.3) (2026-05-27)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.10.0 ([7cfe831](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7cfe83100d4e9f2f598db5013833444fccd5257e))

## [1.10.2](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.1...small-webrtc-transport-v1.10.2) (2026-05-15)


### Miscellaneous Chores

* Bump client-js dependency to latest 1.9.0 and clean up changelogs ([fe9347f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/fe9347f73493d2b64a1304a9c6f80ce84fa721a3))
* Bump daily-js to latest 0.90.0 ([5f05e59](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5f05e599ae5f3a1d2c1403c662ad4f81914bed41))

## [1.10.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.0...small-webrtc-transport-v1.10.1) (2026-05-13)


### Miscellaneous Chores

* Bump client-js dependencies to lastest 1.8.0 ([72c2026](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/72c20269539367048c923b6afa3e9e5bad41f933))

## [1.10.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.9.0...small-webrtc-transport-v1.10.0) (2026-03-24)


### Features

- Now treating the `pc_id` as the bot's Participant id for use in RTVI APIs like `onBotConnected` and `onBotDisconnected`

### Changed

- Bump daily-js version dependency to 0.89.1
- Bump client-js version to work with latest 1.7.0 and support latest features

### Bug Fixes

- Fixed missing callbacks for `onBotConnected` and `onBotDisconnected` ([c6accf2](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/c6accf2a9ad62b3fc1fb8594269354f95a9dc0af))
- add exports map for proper ESM/CJS resolution ([bd53457](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bd53457d82df32117d2bba09261e1763593c6a42))
- Added message size checking to `sendMessage()` to ensure no large
  messages are sent, causing the data channel to fail and not recover.
- Set `_maxMessageSize` to the peer connections's max size (defaults to 64KB)

## [1.9.0]

### Added

- Bump client-js version to work with latest 1.6.0 and support latest features

### Fixed

- Fix issues surrounding requestData in the offer endpoint
  1. If the endpoint was a Request type, any requestData provided would be lost
  2. Now that runners cache the requestData provided to /start, we do not need to re-send it in the offer (which conveniently ALSO solves issues if the endpoint provided to start was a Request type :))

## [1.8.1]

- Fixed issue causing `updateSpeaker()` not to work.

## [1.8.0]

- Bump client-js version to work with latest 1.5.0 and support latest features

## [1.7.3]

### Added

- Added `offerUrlTemplate` inside the `SmallWebRTCTransportConstructorOptions`, allowing to define a template which will be used
  during the transformation between startBot and connect, to create the offer url pointing to a custom endpoint other than `/api/offer`.
  ```javascript
    transport: new SmallWebRTCTransport({
      offerUrlTemplate: `${this.baseUrl}/sessions/:sessionId/api/offer`
    }),
  ```

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

- Bump daily-js version dependency to 0.84.0

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
