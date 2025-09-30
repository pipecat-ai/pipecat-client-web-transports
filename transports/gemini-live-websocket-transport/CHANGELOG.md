# Changelog

All notable changes to **Pipecat GeminiLiveWebsocketTransport** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - Updated GeminiLiveWebsocketTransport to PipecatClient 1.0.0 changes, which include:
    - Updating naming/dependencies from RTVIClient -> PipecatClient
    - Modified connect() to follow the new pattern of providing connection details at the time of connection vs. constructor
    - Added validation for connection parameters
 