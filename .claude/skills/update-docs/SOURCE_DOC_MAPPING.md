# Source-to-Doc Mapping — pipecat-client-web-transports

The profile for the shared `update-docs` skill, which lives in
`pipecat-ai/pipecat` at `.claude/skills/update-docs/SKILL.md` and is published
through the `pipecat-dev-skills` marketplace. `PROFILE_CONTRACT.md` beside it
describes what this file has to provide.

## Ownership — read this first

The pages this repo documents sit in the same directory as pages owned by
`pipecat-ai/pipecat-client-web`. The split is by file, not by directory:

| Page | Owner |
| --- | --- |
| `api-reference/client/js/transports/transport.mdx` | **pipecat-client-web** — the abstract `Transport` base class |
| `api-reference/client/js/transports/daily.mdx` | this repo |
| `api-reference/client/js/transports/gemini.mdx` | this repo |
| `api-reference/client/js/transports/moq.mdx` | this repo |
| `api-reference/client/js/transports/openai-webrtc.mdx` | this repo |
| `api-reference/client/js/transports/small-webrtc.mdx` | this repo |
| `api-reference/client/js/transports/websocket.mdx` | this repo |

Never edit `transports/transport.mdx` from here. A change in this repo that
appears to require it means a transport has diverged from the base class it
implements — report that as a cross-repo finding.

## Scope

Everything under `transports/*/src/`. Each directory is a separately published
npm package.

Exclude:

- `**/tests/**`, `**/*.spec.ts`, `**/*.test.ts`
- `node_modules/`, `dist/`, `*.d.ts` build output
- `transports/*/src/index.ts` — barrel files that only re-export

As with any barrel file, a **removed** export line is still a documentation
change: the name has left that package's public API.

## Skip list

| File | Why |
| --- | --- |
| `transports/websocket-transport/src/generated/proto/frames.ts` | Generated from the protobuf schema. Changes here follow the schema rather than driving documentation; the serializer that consumes it is what readers configure. |

Nothing else. Each package is small and almost entirely public surface.

## Base classes

| File | Pages to check |
| --- | --- |
| `transports/gemini-live-websocket-transport/src/directToLLMBaseWebSocketTransport.ts` | `api-reference/client/js/transports/gemini.mdx`. It is not re-exported from the package root, but it defines `LLMServiceOptions`, which `GeminiLLMServiceOptions` extends and which the page documents field by field. Its constructor signature is therefore observable even though the class is not. |

## Non-standard locations

| File | Page |
| --- | --- |
| `transports/websocket-transport/src/serializers/*.ts` | `api-reference/client/js/transports/websocket.mdx` — `FrameSerializer`, `ProtobufFrameSerializer`, and `TwilioSerializer` are all documented there, including the shape a custom serializer has to implement |

## Pattern matching

One package, one page — but the directory names and the page names do not match,
so use this table rather than deriving it:

| Package directory | Page |
| --- | --- |
| `transports/daily/` | `api-reference/client/js/transports/daily.mdx` |
| `transports/gemini-live-websocket-transport/` | `api-reference/client/js/transports/gemini.mdx` |
| `transports/moq-transport/` | `api-reference/client/js/transports/moq.mdx` |
| `transports/openai-realtime-webrtc-transport/` | `api-reference/client/js/transports/openai-webrtc.mdx` |
| `transports/small-webrtc-transport/` | `api-reference/client/js/transports/small-webrtc.mdx` |
| `transports/websocket-transport/` | `api-reference/client/js/transports/websocket.mdx` |

## Search

When the tables come up empty, grep `DOCS_PATH` for:

- The transport class name (`DailyTransport`, `MoqTransport`) — each page's
  prose names its class directly.
- The constructor option name with its exact spelling (`serverCertificateHashes`,
  `audioLatencyMs`). Options are the most-edited part of these pages.
- The npm package name (`@pipecat-ai/moq-transport`) — it appears in every
  page's Installation block, and in `client/get-started/`.

A transport often has a **server-side counterpart page** under
`api-reference/server/services/transport/`. That is documented from
`pipecat-ai/pipecat` and is not this repo's to edit. When a client change
implies a server change — a renamed default, a changed handshake — report it
rather than editing across.

## Section vocabulary

Every transport page follows the same shape:

| Section | Built from | Form |
| --- | --- | --- |
| Installation | the package name in `package.json` | fenced `bash` block with `npm install` |
| Usage / Basic Setup | the constructor and a minimal connect | fenced `javascript` or `typescript` block |
| Constructor Options | the options type the constructor accepts | `<ParamField>` entries |
| Events | events the transport emits beyond the standard callbacks | prose or table; several pages state there are none, which is itself a claim to keep true |
| More Information | related pages | `<CardGroup>` of `<Card>` |

A `<ParamField>` `default` must be the value in the source, not the value the
docs wish were true. The MoQ page's `clientId` and `botId` defaults are the
worked example: the client defaults to `client0`/`bot0` while a Pipecat bot
publishes under `response` and listens on `request`, so the two never meet on
defaults alone. The page documents the real defaults and warns about the
mismatch rather than quietly printing the values that would work.

## Guide directories

- `client/concepts/choosing-a-transport.mdx` — compares all six. Any change to
  what a transport is *for*, or what it requires, belongs here too.
- `client/get-started/` — pins exact package names in install commands
- `client/guides/` — practical how-tos that may construct a transport

## New pages

A new transport package means a new page. Create
`DOCS_PATH/api-reference/client/js/transports/<name>.mdx`:

````
---
title: "<Name> Transport"
"og:title": "<Name> Transport - JavaScript SDK"
sidebarTitle: "<Name>"
description: "110-140 chars: the class, the technology it uses, and what it connects to."
---

[What it is, and the one thing that distinguishes it from the other transports.]

## Installation

```bash
npm install @pipecat-ai/client-js @pipecat-ai/<package>
```

## Usage

### Basic Setup

```javascript
[Minimal working example, constructing the transport and connecting]
```

## API Reference

### Constructor Options

<ParamField path="option" type="type" default="value">
  [From the options type.]
</ParamField>

## Events

[Either the transport-specific events, or a sentence saying it reports state
through the standard PipecatClient callbacks.]

## More Information

<CardGroup cols={2}>
  [Cards to the server-side counterpart and to choosing-a-transport]
</CardGroup>
````

The `og:title` suffix is required: other SDKs document the same transport under
the same short title, and the docs metadata lint enforces a unique effective
unfurl title site-wide.

### Registration — both are required

1. Add the path, without `.mdx`, to `DOCS_PATH/docs.json` under the JavaScript
   SDK's Transports group.
2. Add a row to the **Summary** table in
   `DOCS_PATH/client/concepts/choosing-a-transport.mdx`, and a `###` section
   under "How to choose". A transport absent from that page is one nobody
   picks — it is the page a reader reaches before knowing your transport exists.
