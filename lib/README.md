# @pipecat-ai/transport-lib

Internal, unpublished workspace package. Holds media-management and websocket
utilities (`MediaManager`, `DailyMediaManager`, `ReconnectingWebSocket`,
`wavtools`) shared by `@pipecat-ai/daily-transport`,
`@pipecat-ai/small-webrtc-transport`, and `@pipecat-ai/websocket-transport`.

This package is not published to npm. Its version is tracked so that
release-please's `node-workspace` plugin can propagate a patch release to
dependent transport packages whenever this shared code changes.
