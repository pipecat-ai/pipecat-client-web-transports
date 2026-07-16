# MoQ (Media over QUIC) Transport

[![Docs](https://img.shields.io/badge/documentation-blue)](https://docs.pipecat.ai/client/js/transports)
![NPM Version](https://img.shields.io/npm/v/@pipecat-ai/moq-transport)
[![Demo](https://img.shields.io/badge/Demo-forestgreen)](https://github.com/pipecat-ai/voice-ui-kit/tree/main/examples/01-console)

Media-over-QUIC transport package for use with `@pipecat-ai/client-js`.

## Installation

```bash copy
npm install \
@pipecat-ai/client-js \
@pipecat-ai/moq-transport
```

## Overview

The `MoqTransport` class connects a `PipecatClient` to a Pipecat MoQ bot, either through a MoQ relay or directly to a bot running in serve mode. It publishes the local microphone as an Opus broadcast and consumes the bot's broadcast — both audio and a bot→client RTVI message track — using catalog discovery, so codec and sample rate are negotiated at connect time rather than pinned in code. RTVI messages also flow client→bot over a matching transcript track on the client's own broadcast, carrying `client-ready`, typed text input, function-call results, and other client→server RTVI traffic.

Connection management uses WebTransport with a WebSocket fallback (raced by `@moq/net`), with auto-reconnect via `Connection.Reload`.

## Features

- 🎤 Microphone capture and Opus publish (`@moq/publish`)
- 📡 WebTransport with WebSocket fallback and auto-reconnect (`@moq/net`)
- 🎧 Catalog-driven bot audio playback with bounded-latency jitter buffering (`@moq/watch`)
- 💬 Bidirectional RTVI messages over dedicated transcript tracks (`@moq/json`) — bot→client events/transcripts, and client→bot messages like `client-ready`
- 🔐 `serverCertificateHashes` pinning for self-signed dev relays

## Usage

### Basic Setup

```javascript
import { PipecatClient } from "@pipecat-ai/client-js";
import { MoqTransport } from "@pipecat-ai/moq-transport";

const transport = new MoqTransport({
  relayUrl: "https://relay.example.com:4080/moq",
});

const pcClient = new PipecatClient({
  transport,
  callbacks: {
    // Event handlers
  },
});

await pcClient.connect();
```

### Self-signed dev relay

```javascript
const transport = new MoqTransport({
  relayUrl: "https://localhost:4080/moq",
  serverCertificateHashes: [
    { algorithm: "sha-256", value: certHashBytes },
  ],
});
```

### Configuration Options

```typescript
interface MoqTransportOptions {
  relayUrl: string;                              // Required: full URL of the MoQ peer
  serverCertificateHashes?: WebTransportHash[];  // Optional: pinned cert hashes for self-signed dev setups
  clientId?: string;                             // Optional: this client's participant id (default "client0")
  botId?: string;                                // Optional: peer (bot) participant id to consume (default "bot0")
  namespace?: string;                            // Optional: top-level namespace / room name (default "pipecat")
  transcriptTrack?: string;                      // Optional: track name for the bidirectional RTVI transcript channel (default "transcript.json.z")
  audioLatencyMs?: number;                       // Optional: jitter buffer floor latency in ms (default 80)
  audioBufferMaxMs?: number | "real-time";       // Optional: buffered-playback latency ceiling in ms, or "real-time" to collapse to the floor (default 30000)
  audioSampleRate?: number;                      // Optional: mic publish sample rate in Hz; one of 8000/12000/16000/24000/48000 (default 48000)
}
```

Broadcast paths are derived as `<namespace>/<clientId>` (publish) and `<namespace>/<botId>` (subscribe). Audio track names inside each broadcast are discovered from the bot's catalog, so they aren't configured directly.

### Connecting via a bot `/start` endpoint

If your `/start` endpoint returns the bot's MoQ config nested under a `moq` key (the shape the bot's `pipecat.transports.moq.transport` returns), pass that response straight to `connect()` / `PipecatClient.startBotAndConnect()` — `MoqTransport` unwraps it (including base64-decoding `certHash` into `serverCertificateHashes`) in `_validateConnectionParams`, no app-side transform needed:

```json
{
  "moq": {
    "relayUrl": "https://relay.example.com:4080/moq",
    "certHash": "base64-encoded-sha-256-or-null",
    "namespace": "pipecat",
    "clientId": "client0",
    "botId": "bot0",
    "transcriptTrack": "transcript.json.z"
  }
}
```

### Handling Events

The transport implements the various [Pipecat event handlers](https://docs.pipecat.ai/client/js/api-reference/callbacks). Check out the docs or samples for more info.

## API Reference

### States

The transport can be in one of these states:
- "disconnected"
- "initialized"
- "connecting"
- "connected"
- "ready"
- "disconnecting"
- "error"

## Error Handling

The transport includes error handling for:
- Microphone acquisition failures (`initDevices`, `_connect`)
- Invalid `relayUrl`
- WebTransport / WebSocket connection failures (surfaced via `@moq/net` auto-reconnect)
- Catalog decode and audio decode errors (logged; the consume loop continues)

## License
BSD-2 Clause
