# Changelog

All notable changes to **Pipecat Websocket Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.5](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.4...websocket-transport-v1.6.5) (2026-05-27)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.10.0 ([7cfe831](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/7cfe83100d4e9f2f598db5013833444fccd5257e))

## [1.6.4](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.3...websocket-transport-v1.6.4) (2026-05-15)


### Miscellaneous Chores

* Bump client-js dependency to latest 1.9.0 and clean up changelogs ([fe9347f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/fe9347f73493d2b64a1304a9c6f80ce84fa721a3))
* Bump daily-js to latest 0.90.0 ([5f05e59](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/5f05e599ae5f3a1d2c1403c662ad4f81914bed41))

## [1.6.3](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.2...websocket-transport-v1.6.3) (2026-05-08)


### Miscellaneous Chores

* Bump client-js dependencies to lastest 1.8.0 ([72c2026](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/72c20269539367048c923b6afa3e9e5bad41f933))

## [1.6.2](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.1...websocket-transport-v1.6.2) (2026-03-24)

### Changed

- Bump daily-js version dependency to 0.89.1
- Bump client-js version to work with latest 1.7.0 and support latest features

### Bug Fixes

- Fix bot disconnection logic to match Daily ([c6accf2](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/c6accf2a9ad62b3fc1fb8594269354f95a9dc0af))


## [1.6.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.0...websocket-transport-v1.6.1) (2026-03-11)

### Bug Fixes

- add exports map for proper ESM/CJS resolution ([bd53457](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/bd53457d82df32117d2bba09261e1763593c6a42))
- Set `_maxMessageSize` to the server's supported max size (1 MB)


## [1.6.0]

- Bump client-js version to work with latest 1.6.0 and support latest features

## [1.5.0]

- Bump client-js version to work with latest 1.5.0 and support latest features
- Bump daily-js version dependency to 0.84.0

## [1.4.0]

- Enable useDevicePreferenceCookies to store preferred devices by default
- Bump client-js version to work with latest 1.4.0 and support latest features

## [1.3.0]

- Bump client-js version to work with latest 1.3.0 and support latest features

## [1.2.1]

- Bump daily-js version dependency to 0.83.1 to get Chrome 140 fix

## [1.2.0]

- Deprecated the transport option `ws_url` in lieu of a properly camelCased `wsUrl` for consistency. `ws_url` is still accepted from endpoints.
- Fixed connection type to not allow anything but `wsUrl` as providing other options are no-ops.

## [1.1.0]

- Add support for generating `onDeviceError` callbacks/events when receiving a camera or speaker error.

## [1.0.0]

- PipecatClient and Transport 1.0.0 Updates:
  See [the migration guide](https://docs.pipecat.ai/client/js/migration-guide) for details
  - Updated WebsocketTransport to PipecatClient 1.0.0 changes, which include:
    - Updating naming/dependencies from RTVIClient -> PipecatClient
    - Modified connect() to follow the new pattern of providing connection details at the time of connection vs. constructor
    - Added validation for connection parameters
