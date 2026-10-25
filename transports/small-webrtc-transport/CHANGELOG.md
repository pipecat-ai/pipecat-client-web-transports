# Changelog

All notable changes to **Pipecat Small WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.11.0...small-webrtc-transport-v1.11.1) (2026-10-25)

### Changed

* `@pipecat-ai/small-webrtc-transport` now requires `@pipecat-ai/client-js` `~1.15.0` as a peer dependency. Upgrade `@pipecat-ai/client-js` to 1.15.x alongside this release. ([d2a5122](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d2a51222639c6013e1202d74a6abea17204b41df))

## [1.11.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.8...small-webrtc-transport-v1.11.0) (2026-10-16)

### Features

* `SmallWebRTCTransport` now implements the `mediaSupport` getter. The bot's audio and video are always supported, and the user's microphone, camera, and screen share follow what the media manager reports through `MediaManager.mediaSupport`. With the default `DailyMediaManager`, screen share is reported as unsupported on browsers without `getDisplayMedia`, such as most mobile browsers. Requires `@pipecat-ai/client-js` 1.14.0 or later. ([14a218c](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/14a218cbd9ce71b29d0f013420e493426c942eb3))

### Bug Fixes

* Fixed calls losing media after an ICE-restart reconnection. When the transport replaced a failed peer connection, closing the old connection stopped the local microphone and camera tracks the new connection was sending, and the old remote track ending removed the new remote track so `onTrackStarted` never fired for the recovered audio. Local tracks still in use now stay live, and events from the old connection's remote tracks no longer affect the replacement tracks. ([7f5011e](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7f5011ee19cbe7221df78826cd100bd2eacfc0cb))

### Other

* Bumped the `@pipecat-ai/client-js` peer dependency to `~1.14.0`. Projects using `@pipecat-ai/small-webrtc-transport` should upgrade `@pipecat-ai/client-js` to 1.14.x. ([6f1bf1a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6f1bf1a37e7077e54e27a92b810c1e146be781fe))
* `@pipecat-ai/small-webrtc-transport` now depends on `@daily-co/daily-js` `^0.94.0` (previously `^0.90.0`), which its `DailyMediaManager`-based media handling uses. ([1ffa4f8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ffa4f87edd988bf289768877c16c6d4dd37567d))

### Miscellaneous Chores

* update transport-lib dependencies to 0.2.0 ([730e0e4](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/730e0e4ca2a2abc9f1c1a5b9b88eff4495e19c5a))

## [1.10.8](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.7...small-webrtc-transport-v1.10.8) (2026-09-15)


### Bug Fixes

* Fixed issue with mute toggle states being delayed ([51954df](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/51954df18f7f1f23b6965e863ac0425493f9be4d))

## [1.10.7](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.6...small-webrtc-transport-v1.10.7) (2026-09-03)


### Bug Fixes

* Fix SmallWebRTC to return an error in `_connectFailed` rejection ([e462176](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/e46217666b8be0528a9a394a7ad7909046ac21fc))
* Guard keepalive ping against `InvalidStateError` in Safari ([76c782a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/76c782a4a8920cdb75230b02cec3cef6154df484)), closes [#63](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/63)
* Ignore `signalingstatechange` events from stale peer connections ([1b9152d](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1b9152dada09ab6a112690dcd4ec23c68caf9a4b)), closes [#169](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/169)
* Fixed issues with offer failures/rejections to set state to `error`, fix a `connect()` race condition, expose the  `status`/`cause` from the original `Error` and stop retrying if the offer is refused ([8e9f5e5](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8e9f5e55933bb273883d8639d38e472cbab03a7a)), closes [#173](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/173)

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
