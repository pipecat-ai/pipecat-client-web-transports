# Changelog

All notable changes to **Pipecat Daily WebRTC Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.7.0...daily-transport-v1.8.0) (2026-10-16)

### Features

* `DailyTransport` now implements the `mediaSupport` getter, reporting that it carries the user's microphone and camera and the bot's audio and video, plus screen share where the browser can share a screen. `PipecatClient.mediaSupport` combines this with what the bot supports so your UI can hide controls that can't work. Requires `@pipecat-ai/client-js` 1.14.0 or later. ([24829e8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/24829e8d60ada336fe9fd48e5bc3e0cd8e3adc8b))

### Bug Fixes

* Add 500ms delay to client-ready message for iOS devices ([04c492d](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/04c492dc47d97d52e705209539691440e5b530e2))
* add exports map for proper ESM/CJS resolution ([bd53457](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bd53457d82df32117d2bba09261e1763593c6a42))
* **daily-transport:** catch observer start failures inside startAudioLevelObservers ([1ec396f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ec396f99f1feca64148334b0ddcee9bdb33254a))
* **daily-transport:** start audio level observers on connect ([7273d38](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7273d38ab0b6c3a0b60338b201cbf96a16af6114))
* **daily-transport:** start audio level observers on connect ([c69b589](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/c69b589160cf994b7b476bba685b7c83f9b8cdde)), closes [#216](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/216)
* Fixed issue with mute toggle states being delayed ([a4051c8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a4051c87d4aae2d1007e56400848d6f1efd34455))
* Fixed issue with mute toggle states being delayed ([51954df](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/51954df18f7f1f23b6965e863ac0425493f9be4d))
* persist enableMic/enableCam across the pre-session boundary ([6cf0d9a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6cf0d9a6337b7fc4fe04d440809234f82c734c81))
* persist enableMic/enableCam preference across the pre-session boundary ([610b7e3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/610b7e3f17f23c5c5b507e4821c71a7be32eeafd))

### Other

* Bumped the `@pipecat-ai/client-js` peer dependency to `~1.14.0`. Projects using `@pipecat-ai/daily-transport` should upgrade `@pipecat-ai/client-js` to 1.14.x. ([6f1bf1a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6f1bf1a37e7077e54e27a92b810c1e146be781fe))
* `@pipecat-ai/daily-transport` now depends on `@daily-co/daily-js` `^0.94.0` (previously `^0.90.0`). ([1ffa4f8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ffa4f87edd988bf289768877c16c6d4dd37567d))

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
* curate release notes ([0f9fde6](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/0f9fde66dbb715e02b16796b43a09ce4220285d7))
* **daily,gemini,openai,small-webrtc,websocket:** Bump client-js dep… ([9180f89](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9180f890bb01c1e8c2f74a9abe7fc8e0777a86c3))
* **daily,gemini,openai,small-webrtc,websocket:** Bump client-js dependency to latest 1.7.0 ([8825761](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/882576168ed38e4eb01d03211363c7cafed72967))
* **main:** release  daily-transport 1.6.2 ([f7261cf](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/f7261cf810d1675f6f085654614b2f9ff193f43b))
* **main:** release  daily-transport 1.6.2 ([ddd8cf6](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ddd8cf6879538955d1e07ebf28412ce18d8dde78))
* **main:** release  daily-transport 1.6.3 ([cf6dc67](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/cf6dc67a07b58c586cb72e074f1c12504af39e8e))
* **main:** release  daily-transport 1.6.3 ([a9dfd96](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a9dfd9696d6b27a072ef5e9c292744234a792f93))
* **main:** release  daily-transport 1.6.4 ([90f7e2a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/90f7e2af024be57b1a9effeca08d786b6cfcc9ec))
* **main:** release  daily-transport 1.6.4 ([f5fecae](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/f5fecaeaaa47e3aeeac83859afa628a63ac3c140))
* **main:** release  daily-transport 1.6.5 ([f7aaa43](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/f7aaa43f91d131df98bc8b21d2a7f75e23e79ad5))
* **main:** release  daily-transport 1.6.6 ([0aca491](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/0aca491e8f6ee827d5c8bbc5b4cfea51bfd898a2))
* **main:** release  daily-transport 1.6.6 ([2b957a3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2b957a38941e4dca60d98536d54d5efce91bf10f))
* **main:** release  daily-transport 1.6.7 ([a624f88](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a624f881d476062e6454f4c28879391d4e15ce02))
* **main:** release  daily-transport 1.6.7 ([ff00141](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ff0014181fad84dbc771932bf7fe164dae43f17c))
* **main:** release  daily-transport 1.6.8 ([4ee8b1f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/4ee8b1f12318d366e61ef708fd4361ebbe044c3c))
* **main:** release  daily-transport 1.6.8 ([4f6ae0e](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/4f6ae0e165e15739bc832973b312aa286eb450a0))
* **main:** release  daily-transport 1.6.9 ([961c1c3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/961c1c305db78590ea7110ba079027c5512c6e43))
* **main:** release  daily-transport 1.6.9 ([2b96cd6](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2b96cd687f5abe3961b905719dedbed6e49b3766))
* **main:** release  daily-transport 1.7.0 ([298aad5](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/298aad5294c23c285cf4963db1fc17432e2b24d8))
* release  daily-transport 1.6.1 ([9636cbd](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9636cbdedbce042d3323979e356c48cd5aa7baf0))
* release  daily-transport 1.6.1 ([73236bb](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/73236bbfb17380d861554a326eb6f261b864126b))
* release  daily-transport 1.6.5 ([a6fb292](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a6fb292fdab2089b2850311f21977f2edd08bb3c))

## [1.7.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.9...daily-transport-v1.7.0) (2026-10-16)

### Features

* **daily-transport:** add mediaSupport ([24829e8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/24829e8d60ada336fe9fd48e5bc3e0cd8e3adc8b))
* report media support from each transport ([33dff50](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/33dff50eff8231ecd708e90a10a38104b25b5e0e))

### Bug Fixes

* **daily-transport:** catch observer start failures inside startAudioLevelObservers ([1ec396f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ec396f99f1feca64148334b0ddcee9bdb33254a))
* **daily-transport:** start audio level observers on connect ([7273d38](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7273d38ab0b6c3a0b60338b201cbf96a16af6114))
* **daily-transport:** start audio level observers on connect ([c69b589](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/c69b589160cf994b7b476bba685b7c83f9b8cdde)), closes [#216](https://github.com/pipecat-ai/pipecat-client-web-transports/issues/216)

### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pipecat-ai/transport-lib bumped from ^0.1.0 to ^0.2.0

### Other

* Bumped the `@pipecat-ai/client-js` peer dependency to `~1.14.0`. Projects using `@pipecat-ai/daily-transport` should upgrade `@pipecat-ai/client-js` to 1.14.x. ([6f1bf1a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6f1bf1a37e7077e54e27a92b810c1e146be781fe))
* `@pipecat-ai/daily-transport` now depends on `@daily-co/daily-js` `^0.94.0` (previously `^0.90.0`). ([1ffa4f8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ffa4f87edd988bf289768877c16c6d4dd37567d))

## [1.6.9](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.8...daily-transport-v1.6.9) (2026-09-15)


### Bug Fixes

* Fixed issue with mute toggle states being delayed ([51954df](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/51954df18f7f1f23b6965e863ac0425493f9be4d))

## [1.6.8](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.7...daily-transport-v1.6.8) (2026-07-16)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.13.0

## [1.6.7](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.6...daily-transport-v1.6.7) (2026-06-19)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.12.0 ([ef7a2c3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ef7a2c30f3082d5433e8b0c0423e732a13e5a95f))

## [1.6.6](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.5...daily-transport-v1.6.6) (2026-06-03)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.11.0 ([8a38dab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8a38dab477191d4ce2bc31e9f4f40b49da921771))

## [1.6.5](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.4...daily-transport-v1.6.5) (2026-05-27)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.10.0 ([7cfe831](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7cfe83100d4e9f2f598db5013833444fccd5257e))

## [1.6.4](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.3...daily-transport-v1.6.4) (2026-05-15)


### Miscellaneous Chores

* Bump client-js dependency to latest 1.9.0 and clean up changelogs ([fe9347f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/fe9347f73493d2b64a1304a9c6f80ce84fa721a3))
* bump daily-js to latest 0.90.0 ([5f05e59](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5f05e599ae5f3a1d2c1403c662ad4f81914bed41))

## [1.6.3](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.2...daily-transport-v1.6.3) (2026-05-08)


### Miscellaneous Chores

* Bump client-js dependencies to lastest 1.8.0 ([72c2026](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/72c20269539367048c923b6afa3e9e5bad41f933))

## [1.6.2](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.1...daily-transport-v1.6.2) (2026-05-06)


### Bug Fixes

* persist enableMic/enableCam across the pre-session boundary ([6cf0d9a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6cf0d9a6337b7fc4fe04d440809234f82c734c81))
* persist enableMic/enableCam preference across the pre-session boundary ([610b7e3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/610b7e3f17f23c5c5b507e4821c71a7be32eeafd))

## [1.6.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/daily-transport-v1.6.0...daily-transport-v1.6.1) (2026-03-24)

### Changed

- Bump daily-js version dependency to 0.89.1
- Bump client-js version to work with latest 1.7.0 and support latest features

### Bug Fixes

- add exports map for proper ESM/CJS resolution ([bd53457](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bd53457d82df32117d2bba09261e1763593c6a42))
- Added error handling around `daily.sendAppMessage`
- Set `_maxMessageSize` to the underlyling daily instance's max size (defaults to 10MB)

## [1.6.0]

- Bump client-js version to work with latest 1.6.0 and support latest features

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
