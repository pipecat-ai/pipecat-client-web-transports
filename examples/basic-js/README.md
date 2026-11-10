# Basic JS example

A bare-bones client page plus a matching bot for exercising every transport in
this repo. It exists purely for development and manual testing of the
transports; nothing here is published and it is not a reference for how to
build an app.

- `client/` is a plain-JS page served by Parcel. It compiles the transports
  straight from their `src/`, so transport edits hot-reload.
- `bot/` is a minimal Pipecat bot that runs under the Pipecat development
  runner and exposes `POST /start` for all five transports.

## 1. Run the bot

You need [uv](https://docs.astral.sh/uv/) and API keys for Deepgram, Cartesia,
and OpenAI. Daily and LiveKit additionally need their own credentials; see
`bot/env.example`.

```bash
cd examples/basic-js/bot
cp env.example .env   # then fill in the keys
uv sync
uv run bot.py
```

With no `-t` flag the runner serves every transport it has dependencies for,
and the client picks one per session via the `transport` field it posts to
`/start`. The exception is MoQ, which needs the runner started in MoQ mode:

```bash
uv run bot.py -t moq
```

That runs the bot as the MoQ server with a self-signed localhost cert; the
`/start` response carries the cert hash so the browser can connect.

## 2. Run the client

From the repo root:

```bash
npm install
npm run dev -w @pipecat-ai-transports/example-basic-js
```

Then open http://localhost:1234, pick a transport, click **Create client**,
then **Connect**.

What the page gives you:

- A dropdown to pick the transport (SmallWebRTC, Daily, WebSocket, LiveKit, MoQ).
- For the WebSocket and SmallWebRTC transports, a media manager selector:
  the transport's default `DailyMediaManager` or a `WavMediaManager`. The
  chosen instance is exposed as `window.mediaManager`.
- JSON textareas for the transport constructor options and the `/start`
  request body, remembered per transport in `localStorage`. Clear the start
  endpoint field and the JSON is passed straight to `connect()` instead,
  which is handy for pointing at a room or server that already exists.
- Mic / cam / speaker selects, mute toggles, screen share toggle, and a
  `sendText()` box. The mic, cam, and screen share controls are disabled
  and labelled "unsupported" when `client.mediaSupport` rules that kind out
  for the chosen transport and media manager.
- Local cam and bot video elements plus an `<audio>` element for bot audio.
- Volume meters for the local mic and the bot, fed by the RTVI audio-level
  events when the transport emits them and otherwise by an analyser on the
  audio tracks. The outline lights up on user/bot started-speaking events.
- A transcript built from the `userInput` and `botOutput` events. A user
  turn is one line: finals accumulate on it with the current interim shown
  grey, and it closes when the bot starts speaking. Bot segments appear when
  announced (`spoken_status: "new"`), the spoken prefix goes bold as
  `in-progress` updates arrive, and an interruption (a later segment
  starting, or `botInterrupted`) trims the cut-off segment to what was
  spoken and drops the pending ones.

The client runs at DEBUG log level, so watch the browser console for
everything else: transport state, RTVI messages, device changes, and errors.

Everything is on `window` for console debugging once a client exists:
`client`, `transport`, `mediaManager` (when one was chosen), `RTVIEvent`,
`LogLevel`, `PipecatClient`, and `transports` (the transport classes).

## Notes

- `startBotAndConnect()` posts the JSON to `/start` and hands the response to
  the transport's connect-params validation, so each transport receives
  whatever the runner returns for it (`dailyRoom`/`dailyToken`,
  `url`/`token`, `wsUrl`, `{ moq: {...} }`, or a session id for WebRTC, in
  which case the offer URL is derived from the start endpoint).
- WebSocket and MoQ play bot audio themselves and do not report a bot audio
  track, so the `<audio>` element stays empty for them.
- The MoQ transport requires `relayUrl` in its constructor options; the value
  from `/start` overrides it at connect time.
