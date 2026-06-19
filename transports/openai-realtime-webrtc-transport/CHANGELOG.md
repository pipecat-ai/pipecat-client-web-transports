# Changelog

All notable changes to **Pipecat OpenAIRealTimeWebRTCTransport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.6](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/openai-realtime-webrtc-transport-v1.5.5...openai-realtime-webrtc-transport-v1.5.6) (2026-06-19)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.12.0 ([781e0dd](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/781e0dd9621f16a00a87308b02174d941400a624))
* Bump client-js dependency for all transports to 1.12.0 ([ef7a2c3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ef7a2c30f3082d5433e8b0c0423e732a13e5a95f))

## [1.5.5](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/openai-realtime-webrtc-transport-v1.5.4...openai-realtime-webrtc-transport-v1.5.5) (2026-06-03)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.11.0 ([67ccb57](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/67ccb57ea8f5f8b7e7424788e2c3cafa863ff08f))
* Bump client-js dependency for all transports to 1.11.0 ([8a38dab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8a38dab477191d4ce2bc31e9f4f40b49da921771))

## [1.5.4](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/openai-realtime-webrtc-transport-v1.5.3...openai-realtime-webrtc-transport-v1.5.4) (2026-05-27)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.10.0 ([7cfe831](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7cfe83100d4e9f2f598db5013833444fccd5257e))

## [1.5.3](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/openai-realtime-webrtc-transport-v1.5.2...openai-realtime-webrtc-transport-v1.5.3) (2026-05-15)


### Miscellaneous Chores

* Bump client-js dependency to latest 1.9.0 and clean up changelogs ([fe9347f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/fe9347f73493d2b64a1304a9c6f80ce84fa721a3))
* Bump daily-js to latest 0.90.0 ([5f05e59](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5f05e599ae5f3a1d2c1403c662ad4f81914bed41))

## [1.5.2](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/openai-realtime-webrtc-transport-v1.5.1...openai-realtime-webrtc-transport-v1.5.2) (2026-05-07)


### Bug Fixes

* persist enableMic/enableCam across the pre-session boundary ([6cf0d9a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6cf0d9a6337b7fc4fe04d440809234f82c734c81))
* persist enableMic/enableCam preference across the pre-session boundary ([610b7e3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/610b7e3f17f23c5c5b507e4821c71a7be32eeafd))


### Miscellaneous Chores

* Bump client-js dependency to latest 1.7.0 ([8825761](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/882576168ed38e4eb01d03211363c7cafed72967))

## [1.5.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/openai-realtime-webrtc-transport-v1.5.0...openai-realtime-webrtc-transport-v1.5.1) (2026-03-17)


### Bug Fixes

* add exports map for proper ESM/CJS resolution ([bd53457](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bd53457d82df32117d2bba09261e1763593c6a42))

## [Unreleased]

- Added default case to `sendMessage` to properly throw an `UnsupportedFeatureError`

## [1.5.0]

- Bump client-js version to work with latest 1.6.0 and support latest features

## [1.4.0]

- Bump client-js version to work with latest 1.5.0 and support latest features
- Bump daily-js version dependency to 0.84.0

## [1.3.0]

- Enable useDevicePreferenceCookies to store preferred devices by default
- Bump client-js version to work with latest 1.4.0 and support latest features

## [1.2.0]

- Bump client-js version to work with latest 1.3.0 and support latest features

## [1.1.1]

- Bump daily-js version dependency to 0.83.1 to get Chrome 140 fix

## [1.1.0]

- Add support for generating `onDeviceError` callbacks/events when receiving a camera or speaker error.

## [1.0.0]

- PipecatClient and Transport 1.0.0 Updates:
  See [the migration guide](https://docs.pipecat.ai/client/js/migration-guide) for details
  - Updated OpenAIRealTimeWebRTCTransport to PipecatClient 1.0.0 changes, which include:
    - Updating naming/dependencies from RTVIClient -> PipecatClient
    - Modified connect() to follow the new pattern of providing connection details at the time of connection vs. constructor
    - Added validation for connection parameters
