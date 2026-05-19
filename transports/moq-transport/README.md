# `@pipecat-ai/moq-transport`

Media-over-QUIC transport plugin for the
[Pipecat JavaScript client SDK](https://github.com/pipecat-ai/pipecat-client-web).
Lets a `PipecatClient` talk to a Pipecat MoQ bot over a moq-lite relay using
WebTransport (with a WebSocket fallback).

> **Status: pre-alpha.** Day 1 scaffold — lifecycle wiring only. Device
> handling, media tracks, and RTVI message routing land in subsequent
> iterations. See
> [`moq_prebuilt/PLAN-moq-transport-package.md`](https://github.com/pipecat-ai/pipecat/blob/main/moq_prebuilt/PLAN-moq-transport-package.md)
> in the `pipecat-ai/pipecat` repo for the full plan.

## Install

```bash
npm install @pipecat-ai/moq-transport @pipecat-ai/client-js
```

## Usage

```ts
import { PipecatClient } from "@pipecat-ai/client-js";
import { MoqTransport } from "@pipecat-ai/moq-transport";

const transport = new MoqTransport({
  relayUrl: "https://localhost:4080/",
  // For self-signed dev relays, pin via cert hash:
  // serverCertificateHashes: [{ algorithm: "sha-256", value: hashBytes }],
});

const client = new PipecatClient({ transport, callbacks: { /* ... */ } });
await client.connect();
```

## Underlying packages

- [`@moq/lite`](https://www.npmjs.com/package/@moq/lite) — WebTransport + relay subscriptions.
- [`@moq/publish`](https://www.npmjs.com/package/@moq/publish) — mic capture + audio publish.

## License

BSD-2-Clause.
