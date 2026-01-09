# Changelog

All notable changes to **Pipecat Websocket Transport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Set `_maxMessageSize` to the server's supported max size (1 MB)

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
 