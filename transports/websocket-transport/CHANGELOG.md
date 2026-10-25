# Changelog

All notable changes to **Pipecat Websocket Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.8.0...websocket-transport-v1.8.1) (2026-10-25)

### Changed

* `@pipecat-ai/websocket-transport` now requires `@pipecat-ai/client-js` `~1.15.0` as a peer dependency. Upgrade `@pipecat-ai/client-js` to 1.15.x alongside this release. ([d2a5122](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d2a51222639c6013e1202d74a6abea17204b41df))

## [1.8.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.7.2...websocket-transport-v1.8.0) (2026-10-16)

### Features

* `WebSocketTransport` now implements the `mediaSupport` getter, reporting that it carries audio only: the camera, screen share, and bot video are always reported as unsupported, the bot's audio is supported, and the microphone follows what the media manager reports. Requires `@pipecat-ai/client-js` 1.14.0 or later. ([0b5fe6c](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/0b5fe6c0c5e4866a71dc491fbead54938b51a863))

### Bug Fixes

* Fixed `WebSocketTransport` piling up tokens on its stored URL across connects. Connecting again with a new `token` and no new `wsUrl` used to open a URL like `wss://host/ws?token=old&token=new`, so most servers read the stale token. The token is now added to the base URL on each connect, which gives `wss://host/ws?token=new`. As a result, a connect without a `token` no longer reuses one from an earlier connect. `initializeWebsocket()` now takes an optional `url` argument that defaults to the stored base URL. ([2e9a012](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2e9a0128220454f5bd5cea405c6dd652db60b7d2))
* Fixed `WebSocketTransport` throwing a `TypeError` when a `token` was passed without any URL. It now throws `TransportStartError` and sets the transport state to `"error"`, which is what already happened when neither a URL nor a token was given. ([2e9a012](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2e9a0128220454f5bd5cea405c6dd652db60b7d2))
* `@pipecat-ai/websocket-transport` now exports the `WebSocketTransportOptions` and `WebSocketTransportConstructorOptions` types, so you can type the options passed to the `WebSocketTransport` constructor. ([cddd96f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/cddd96fadbbf06d73d89378f42891aba66460a10))
* `@pipecat-ai/websocket-transport` now exports the `WebSocketSerializer` interface and the `DeserializedData` type, so you can implement a custom serializer and pass it via the `serializer` option. ([cddd96f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/cddd96fadbbf06d73d89378f42891aba66460a10))
* `ProtobufFrameSerializer` now understands the `InterruptionFrame` sent by recent Pipecat servers. Previously these frames caused `Unknown frame kind` deserialization errors. When one arrives, `WebSocketTransport` now stops bot playback and flushes buffered bot audio right away. ([214d7ab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/214d7abf9db1f655b342b0820a7fc22b0356f575))
* `ProtobufFrameSerializer` now logs a warning and ignores frame kinds it doesn't recognize, instead of throwing. ([214d7ab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/214d7abf9db1f655b342b0820a7fc22b0356f575))
* `TwilioSerializer` now treats Twilio's `clear` event as an interruption, so `WebSocketTransport` flushes buffered bot audio when it's received. Previously the event was ignored. ([214d7ab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/214d7abf9db1f655b342b0820a7fc22b0356f575))

### Other

* Bumped the `@pipecat-ai/client-js` peer dependency to `~1.14.0`. Projects using `@pipecat-ai/websocket-transport` should upgrade `@pipecat-ai/client-js` to 1.14.x. ([6f1bf1a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6f1bf1a37e7077e54e27a92b810c1e146be781fe))
* `@pipecat-ai/websocket-transport` now depends on `@daily-co/daily-js` `^0.94.0` (previously `^0.90.0`), which its `DailyMediaManager`-based media handling uses. ([1ffa4f8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ffa4f87edd988bf289768877c16c6d4dd37567d))

### Miscellaneous Chores

* update transport-lib dependencies to 0.2.0 ([730e0e4](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/730e0e4ca2a2abc9f1c1a5b9b88eff4495e19c5a))

## [1.7.2](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.7.1...websocket-transport-v1.7.2) (2026-09-15)


### Bug Fixes

* Fixed issue with mute toggle states being delayed ([51954df](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/51954df18f7f1f23b6965e863ac0425493f9be4d))

## [1.7.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.7.0...websocket-transport-v1.7.1) (2026-07-16)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.13.0

## [1.7.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.7...websocket-transport-v1.7.0) (2026-06-19)


### Features

* support optional auth token in connection params ([2977621](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2977621395afc97e402e7ef1067e21f432d127bc))


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.12.0 ([ef7a2c3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/ef7a2c30f3082d5433e8b0c0423e732a13e5a95f))

## [1.6.7](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.6...websocket-transport-v1.6.7) (2026-06-03)


### Miscellaneous Chores

* Bump client-js dependency for all transports to 1.11.0 ([8a38dab](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/8a38dab477191d4ce2bc31e9f4f40b49da921771))

## [1.6.6](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/websocket-transport-v1.6.5...websocket-transport-v1.6.6) (2026-06-02)


### Bug Fixes

* log a warning instead of an error for unsupported features ([3cae2f2](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/3cae2f2e241ed3518b0915cf19adf7f050aeb0aa))

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
