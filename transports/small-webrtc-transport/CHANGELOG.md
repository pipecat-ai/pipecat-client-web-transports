# Changelog

All notable changes to **Pipecat Small WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/small-webrtc-transport-v1.10.8...small-webrtc-transport-v1.11.0) (2026-09-15)


### Features

* fix request body ([c4d6884](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/c4d688422fabc224f60bbc504538f7c7d7faa3e7))
* implement screen share ([2a5b997](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2a5b9970fce6bedfde6c694bbcfd88a623ac71f2))
* **smallWebRTCTransport:** add iceServers option to constructor for enhanced server configuration ([94aece6](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/94aece6454ca81d16f627af36a02e71eb1d29f07))
* **smallWebRTCTransport:** add waitForICEGathering option to constructor for improved ICE gathering control ([e2413a8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/e2413a8deba906bf13d95d3dbcb1e36e736de6a4))


### Bug Fixes

* add exports map for proper ESM/CJS resolution ([bd53457](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bd53457d82df32117d2bba09261e1763593c6a42))
* Fix SmallWebRTC to return an error in _connectFailed rejection ([bc69b59](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bc69b59a3a6163782627f3ec5fe20f6fb02ea1e5))
* Fix SmallWebRTC to return an error in _connectFailed rejection ([e462176](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/e46217666b8be0528a9a394a7ad7909046ac21fc))
* **small-webrtc-transport:** guard keepalive ping against InvalidStateError in Safari ([ad4291b](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ad4291bf4c0dc75720c9cba918baf1c192ec0d68))
* **small-webrtc-transport:** guard keepalive ping against InvalidStateError in Safari ([76c782a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/76c782a4a8920cdb75230b02cec3cef6154df484)), closes [#63](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/63)
* **small-webrtc-transport:** ignore signalingstatechange events from stale peer connections ([1b9152d](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1b9152dada09ab6a112690dcd4ec23c68caf9a4b)), closes [#169](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/169)
* **small-webrtc-transport:** set state to error, fix a connect() race, and expose status/cause ([8e9f5e5](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8e9f5e55933bb273883d8639d38e472cbab03a7a)), closes [#173](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/173)
* **small-webrtc,websocket:** Fix bot disconnection logic to match Daily ([c6accf2](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/c6accf2a9ad62b3fc1fb8594269354f95a9dc0af))
* **small-webrtc,websocket:** Fix bot disconnection logic to match Daily ([4a231dc](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/4a231dc825ae60eeeb501088bdaea136e2ad22d7))
* **small-webrtc:** stop retrying refused offers and surface the HTTP status ([d757039](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d7570392db5e30e120959cd3d244c1bd6d9c5652))


### Miscellaneous Chores

* Bump client-js dependencies to lastest 1.8.0 ([72c2026](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/72c20269539367048c923b6afa3e9e5bad41f933))
* Bump client-js dependency for all transports to 1.10.0 ([5c4568e](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5c4568e3d5a049118c2983e275805848aacac823))
* Bump client-js dependency for all transports to 1.10.0 ([7cfe831](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7cfe83100d4e9f2f598db5013833444fccd5257e))
* Bump client-js dependency for all transports to 1.11.0 ([67ccb57](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/67ccb57ea8f5f8b7e7424788e2c3cafa863ff08f))
* Bump client-js dependency for all transports to 1.11.0 ([8a38dab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8a38dab477191d4ce2bc31e9f4f40b49da921771))
* Bump client-js dependency for all transports to 1.12.0 ([781e0dd](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/781e0dd9621f16a00a87308b02174d941400a624))
* Bump client-js dependency for all transports to 1.12.0 ([ef7a2c3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ef7a2c30f3082d5433e8b0c0423e732a13e5a95f))
* Bump client-js dependency in transports to 1.13.0 and fix changelogs ([0dba28c](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/0dba28c4b3fcedd8851e43ad7935b537679efe1b))
* Bump client-js dependency to latest 1.9.0 and clean up changelogs ([175795b](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/175795bd22a660b2f66152864e66cec112b6ecae))
* Bump client-js dependency to latest 1.9.0 and clean up changelogs ([fe9347f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/fe9347f73493d2b64a1304a9c6f80ce84fa721a3))
* bump daily-js to latest 0.90.0 ([5f05e59](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5f05e599ae5f3a1d2c1403c662ad4f81914bed41))
* **daily,gemini,openai,small-webrtc,websocket:** Bump client-js dep… ([9180f89](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9180f890bb01c1e8c2f74a9abe7fc8e0777a86c3))
* **daily,gemini,openai,small-webrtc,websocket:** Bump client-js dependency to latest 1.7.0 ([8825761](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/882576168ed38e4eb01d03211363c7cafed72967))
* **main:** release  small-webrtc-transport 1.10.1 ([0741b14](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/0741b141db43b6dc754b7fd45c5f67c52c2c0852))
* **main:** release  small-webrtc-transport 1.10.1 ([b79d9d5](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/b79d9d5fde8755bac09685d7cb48d0f6b4385491))
* **main:** release  small-webrtc-transport 1.10.2 ([8e8f52c](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8e8f52c9d7250ce3e0c0a97045305f9f4fc5e088))
* **main:** release  small-webrtc-transport 1.10.2 ([6daaa62](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6daaa621ed8d32cd61ac3bce9b14833e994a2bdb))
* **main:** release  small-webrtc-transport 1.10.3 ([68f6c3d](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/68f6c3dba5d2230a5c09c6e685e44cb7d1fe823e))
* **main:** release  small-webrtc-transport 1.10.4 ([b44b8d0](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/b44b8d065a0d199b26e1b0fb4d19fc4f96ce292e))
* **main:** release  small-webrtc-transport 1.10.4 ([d1f0f90](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d1f0f90f71b20324e7abe92a4e17fe5367448d17))
* **main:** release  small-webrtc-transport 1.10.5 ([a341bcf](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a341bcf9e82f38e1cd5d3b71b7c2e133db4aef9e))
* **main:** release  small-webrtc-transport 1.10.5 ([88554d6](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/88554d6deddffa8cd48a6cbb6452f7027091979f))
* **main:** release  small-webrtc-transport 1.10.6 ([7116551](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/71165519a60ae6b7c2e234dbc519f758b44748fa))
* **main:** release  small-webrtc-transport 1.10.6 ([5b74ad0](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5b74ad06eef619abc1b9386fc447ffc8e564f4de))
* **main:** release  small-webrtc-transport 1.10.7 ([cb469f4](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/cb469f4a022becfd165a979632b4b2c7d2ce34ca))
* **main:** release  small-webrtc-transport 1.10.7 ([8eea3c2](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8eea3c227fe717e7d0c4d3b31b825b4d4a015d25))
* **main:** release  small-webrtc-transport 1.10.8 ([41a30de](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/41a30ded98ee7a1dc487ef0afd13e226abd3b134))
* **main:** release  small-webrtc-transport 1.10.8 ([2b4fda9](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2b4fda90e7779ecb1b70040fdca9374cce593195))
* **main:** release  small-webrtc-transport 1.10.8 ([d1b96dc](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d1b96dcacfe85d5dec76bfe244403d4284c0d31d))
* release  small-webrtc-transport 1.10.0 ([41c37fc](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/41c37fc10a808edbaae711acbe00088c15b6eaef))
* release  small-webrtc-transport 1.10.0 ([18caed4](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/18caed420fee80cf72c74c7cbe9ac4f90a868574))
* release  small-webrtc-transport 1.10.3 ([30db686](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/30db686eb8904641b3d90dfec164cfe348655281))

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
