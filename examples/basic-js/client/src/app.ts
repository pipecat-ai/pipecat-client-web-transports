// Bare-bones dev page for exercising a PipecatClient over any transport in
// this repo. Everything interesting is exposed on `window` so you can drive
// it from the devtools console: `client`, `transport`, `RTVIEvent`, `LogLevel`.

import {
  BotOutputData,
  LogLevel,
  MediaSupport,
  Participant,
  PipecatClient,
  RTVIEvent,
  RTVIMessage,
  Transport,
  TransportState,
  UserInputData,
} from "@pipecat-ai/client-js";
import {
  DailyTransport,
  DailyTransportConstructorOptions,
} from "@pipecat-ai/daily-transport";
import {
  LiveKitTransport,
  LiveKitTransportConstructorOptions,
} from "@pipecat-ai/livekit-transport";
import { MoqTransport, MoqTransportOptions } from "@pipecat-ai/moq-transport";
import {
  SmallWebRTCTransport,
  SmallWebRTCTransportConstructorOptions,
} from "@pipecat-ai/small-webrtc-transport";
import {
  WavMediaManager,
  WebSocketTransport,
  WebSocketTransportConstructorOptions,
} from "@pipecat-ai/websocket-transport";

// ---------------------------------------------------------------------------
// Transport registry. `ctorDefaults` seeds the constructor-options textarea
// and `startEndpoint` / `requestDefaults` seed the connect form the first
// time a transport is selected; after that the form values are remembered
// per transport in localStorage.
//
// The defaults assume the bot in ../../bot is running under the Pipecat dev
// runner on port 7860, so every transport goes through `POST /start` with
// `{ transport: "<name>" }` and the response is handed to the transport.
// Clear the start endpoint to pass the JSON straight to `connect()` instead.
// ---------------------------------------------------------------------------
const START_ENDPOINT = "http://localhost:7860/start";

// What the JSON textareas can hold. Constructor options stay untyped until
// handed to a specific transport's constructor; the /start request body is
// whatever the bot accepts.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type CtorOptions = Record<string, unknown>;

// Media manager choices for the transports that take one. `create` is a
// factory given the parsed constructor options; `null` means "leave it to
// the transport", which picks DailyMediaManager.
interface MediaManagerChoice {
  label: string;
  create: ((ctorOpts: CtorOptions) => WavMediaManager) | null;
}

interface TransportDef {
  label: string;
  create: (opts: CtorOptions) => Transport;
  mediaManagers?: Record<string, MediaManagerChoice>;
  ctorDefaults: CtorOptions;
  startEndpoint: string;
  requestDefaults: Record<string, unknown>;
}

const DEFAULT_MEDIA_MANAGER = "default";
const WEBSOCKET_MEDIA_MANAGERS: Record<string, MediaManagerChoice> = {
  [DEFAULT_MEDIA_MANAGER]: {
    label: "DailyMediaManager (default)",
    create: null,
  },
  wav: {
    label: "WavMediaManager",
    // Mirror the chunk size / sample rate the transport uses for its default
    // DailyMediaManager so the bot sees the same audio format either way.
    create: (ctorOpts) =>
      new WavMediaManager(
        512,
        typeof ctorOpts.recorderSampleRate === "number"
          ? ctorOpts.recorderSampleRate
          : 16_000
      ),
  },
};
const SMALLWEBRTC_MEDIA_MANAGERS: Record<string, MediaManagerChoice> = {
  [DEFAULT_MEDIA_MANAGER]: {
    label: "DailyMediaManager (default)",
    create: null,
  },
  wav: { label: "WavMediaManager", create: () => new WavMediaManager() },
};

const TRANSPORTS: Record<string, TransportDef> = {
  smallwebrtc: {
    label: "SmallWebRTCTransport",
    create: (opts) =>
      new SmallWebRTCTransport(opts as SmallWebRTCTransportConstructorOptions),
    mediaManagers: SMALLWEBRTC_MEDIA_MANAGERS,
    ctorDefaults: {},
    startEndpoint: START_ENDPOINT,
    requestDefaults: { transport: "webrtc" },
  },
  daily: {
    label: "DailyTransport",
    create: (opts) =>
      new DailyTransport(opts as DailyTransportConstructorOptions),
    ctorDefaults: {},
    startEndpoint: START_ENDPOINT,
    requestDefaults: { transport: "daily", createDailyRoom: true },
  },
  websocket: {
    label: "WebSocketTransport",
    create: (opts) =>
      new WebSocketTransport(opts as WebSocketTransportConstructorOptions),
    mediaManagers: WEBSOCKET_MEDIA_MANAGERS,
    ctorDefaults: {},
    startEndpoint: START_ENDPOINT,
    requestDefaults: { transport: "websocket" },
  },
  livekit: {
    label: "LiveKitTransport",
    create: (opts) =>
      new LiveKitTransport(opts as LiveKitTransportConstructorOptions),
    ctorDefaults: {},
    startEndpoint: START_ENDPOINT,
    requestDefaults: { transport: "livekit" },
  },
  moq: {
    label: "MoqTransport",
    // relayUrl is required by the type but comes from the JSON textarea.
    create: (opts) => new MoqTransport(opts as unknown as MoqTransportOptions),
    // relayUrl is required by the constructor; /start overrides it.
    ctorDefaults: { relayUrl: "https://localhost:4443/moq" },
    startEndpoint: START_ENDPOINT,
    requestDefaults: { transport: "moq" },
  },
};

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const ui = {
  transportSelect: $<HTMLSelectElement>("transport-select"),
  mediaManagerLabel: $<HTMLLabelElement>("media-manager-label"),
  mediaManagerSelect: $<HTMLSelectElement>("media-manager-select"),
  enableMic: $<HTMLInputElement>("enable-mic"),
  enableCam: $<HTMLInputElement>("enable-cam"),
  ctorOptions: $<HTMLTextAreaElement>("ctor-options"),
  createClient: $<HTMLButtonElement>("create-client"),
  initDevices: $<HTMLButtonElement>("init-devices"),
  transportState: $<HTMLSpanElement>("transport-state"),
  micSelect: $<HTMLSelectElement>("mic-select"),
  camSelect: $<HTMLSelectElement>("cam-select"),
  speakerSelect: $<HTMLSelectElement>("speaker-select"),
  toggleMic: $<HTMLButtonElement>("toggle-mic"),
  toggleCam: $<HTMLButtonElement>("toggle-cam"),
  toggleScreen: $<HTMLButtonElement>("toggle-screen"),
  startEndpoint: $<HTMLInputElement>("start-endpoint"),
  connectParams: $<HTMLTextAreaElement>("connect-params"),
  connect: $<HTMLButtonElement>("connect"),
  disconnect: $<HTMLButtonElement>("disconnect"),
  sendText: $<HTMLInputElement>("send-text"),
  sendTextBtn: $<HTMLButtonElement>("send-text-btn"),
  meterLocal: $<HTMLDivElement>("meter-local"),
  meterBot: $<HTMLDivElement>("meter-bot"),
  localVideo: $<HTMLVideoElement>("local-video"),
  botVideo: $<HTMLVideoElement>("bot-video"),
  botAudio: $<HTMLAudioElement>("bot-audio"),
  clearTranscript: $<HTMLButtonElement>("clear-transcript"),
  transcript: $<HTMLDivElement>("transcript"),
};

let client: PipecatClient | null = null;
let transport: Transport | null = null;
let screenShareOn = false;

// Console handles for manual debugging.
declare global {
  interface Window {
    client?: PipecatClient;
    transport?: Transport;
    mediaManager?: WavMediaManager;
    RTVIEvent: typeof RTVIEvent;
    LogLevel: typeof LogLevel;
    PipecatClient: typeof PipecatClient;
    transports: {
      DailyTransport: typeof DailyTransport;
      LiveKitTransport: typeof LiveKitTransport;
      MoqTransport: typeof MoqTransport;
      SmallWebRTCTransport: typeof SmallWebRTCTransport;
      WebSocketTransport: typeof WebSocketTransport;
    };
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function fmt(value: unknown): string {
  if (value === undefined) return "";
  if (value instanceof MediaStreamTrack) {
    return `MediaStreamTrack(${value.kind}, ${value.id.slice(0, 8)}…)`;
  }
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// The page's own messages go to the console next to the client's DEBUG
// output, so there is one place to watch.
function log(tag: string, ...args: unknown[]) {
  console.log(`[example:${tag}]`, ...args.map(fmt));
}

function logError(where: string, err: unknown) {
  console.error(`[example:${where}]`, err);
}

// ---------------------------------------------------------------------------
// Transcript, from userInput / botOutput.
//
// User side: one line per user turn. Finals are appended to it (STT splits
// a long utterance into several finals) and the current interim is shown
// grey after them. The turn only closes once the bot starts speaking, so
// a user who keeps talking stays on one line. Typed text (input_type
// "chat") arrives final and is handled the same way.
//
// Bot side: a bot turn is a line made of segments (sentences, usually). Each
// segment's lifecycle on bot-output is driven by `spoken_status`:
//   "new"          the segment's full text is known; append it to the turn.
//   "in-progress"  spoken_progress.accumulated_text grows as TTS plays; the
//                  spoken prefix is shown bold.
//   "completed"    the whole segment was spoken.
// Segments arrive "new" ahead of being spoken, so several can be pending at
// once. If a segment starts "in-progress" while an earlier one is still
// unfinished, the earlier one was interrupted: trim it to what was spoken and
// drop any pending segments between them. `bot-interrupted` does the same
// for the segment being spoken and every pending segment after it.
// ---------------------------------------------------------------------------
interface UserTurn {
  el: HTMLDivElement;
  finalsEl: HTMLSpanElement;
  interimEl: HTMLSpanElement;
  finals: string[];
}

type SegmentStatus = "new" | "in-progress" | "completed" | "interrupted";

interface Segment {
  id: number;
  el: HTMLSpanElement;
  spokenEl: HTMLElement;
  restEl: HTMLSpanElement;
  text: string;
  status: SegmentStatus;
  turn: BotTurn;
}

interface BotTurn {
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  order: Segment[];
  active: Segment | null;
}

let userTurn: UserTurn | null = null;
// The bot line new segments are appended to, or null when the next segment
// should start a line.
let botTurn: BotTurn | null = null;
// Every segment by id, across lines, so progress updates and interruptions
// still find a line after a user turn has closed it for appends.
const botSegments = new Map<number, Segment>();
// The line holding the segment currently being spoken, if any.
let speakingBotTurn: BotTurn | null = null;

function addTranscriptEntry(
  who: "user" | "bot",
  text: string,
  cls = ""
): HTMLDivElement {
  const entry = document.createElement("div");
  entry.className = `entry ${who} ${cls}`.trim();
  const whoEl = document.createElement("span");
  whoEl.className = "who";
  whoEl.textContent = who;
  const textEl = document.createElement("span");
  textEl.className = "text";
  textEl.textContent = text;
  entry.append(whoEl, textEl);
  ui.transcript.appendChild(entry);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return entry;
}

function ensureUserTurn(): UserTurn {
  if (userTurn) return userTurn;
  const el = addTranscriptEntry("user", "");
  const textEl = el.querySelector<HTMLSpanElement>(".text")!;
  const finalsEl = document.createElement("span");
  finalsEl.className = "finals";
  const interimEl = document.createElement("span");
  interimEl.className = "interim";
  textEl.append(finalsEl, interimEl);
  userTurn = { el, finalsEl, interimEl, finals: [] };
  // The user talking means whatever the bot says next is a new line, even
  // if its previous line is still being spoken (bot-interrupted follows).
  botTurn = null;
  return userTurn;
}

function handleUserInput(data: UserInputData) {
  const text = (data.text ?? "").trim();
  const turn = ensureUserTurn();
  if (data.final === false) {
    turn.interimEl.textContent = text ? " " + text : "";
  } else {
    if (text) turn.finals.push(text);
    turn.finalsEl.textContent = turn.finals.join(" ");
    turn.interimEl.textContent = "";
  }
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

// Called when the bot starts speaking: the user's turn is over.
function closeUserTurn() {
  if (!userTurn) return;
  // Promote a dangling interim rather than lose it.
  const interim = (userTurn.interimEl.textContent ?? "").trim();
  if (interim) {
    userTurn.finals.push(interim);
    userTurn.finalsEl.textContent = userTurn.finals.join(" ");
    userTurn.interimEl.textContent = "";
  }
  userTurn = null;
}

function ensureBotTurn(): BotTurn {
  if (botTurn) return botTurn;
  const el = addTranscriptEntry("bot", "");
  botTurn = {
    el,
    textEl: el.querySelector<HTMLSpanElement>(".text")!,
    order: [],
    active: null,
  };
  return botTurn;
}

// Find or create the segment, keyed by segment_id. A segment seen first as
// "in-progress" (client created mid-utterance) is created on the fly.
function getSegment(id: number, text: string): Segment {
  let seg = botSegments.get(id);
  if (seg) return seg;
  const turn = ensureBotTurn();
  const el = document.createElement("span");
  el.className = "segment";
  const spokenEl = document.createElement("b");
  spokenEl.className = "spoken";
  const restEl = document.createElement("span");
  restEl.className = "rest";
  restEl.textContent = text;
  el.append(spokenEl, restEl);
  if (turn.order.length) turn.textEl.append(" ");
  turn.textEl.append(el);
  seg = { id, el, spokenEl, restEl, text, status: "new", turn };
  botSegments.set(id, seg);
  turn.order.push(seg);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return seg;
}

function setSegmentProgress(seg: Segment, accumulated: string) {
  // accumulated_text is a prefix of the segment text; split on its length so
  // the rendered text never drifts from what was announced as "new".
  const n = seg.text.startsWith(accumulated)
    ? accumulated.length
    : Math.min(accumulated.length, seg.text.length);
  seg.spokenEl.textContent = seg.text.slice(0, n);
  seg.restEl.textContent = seg.text.slice(n);
}

function removeSegment(turn: BotTurn, seg: Segment) {
  const prev = seg.el.previousSibling;
  if (prev?.nodeType === Node.TEXT_NODE) prev.remove(); // the joining space
  seg.el.remove();
  botSegments.delete(seg.id);
  turn.order.splice(turn.order.indexOf(seg), 1);
}

// The segment being spoken was cut off: keep only what was spoken, and drop
// the pending segments after it up to (not including) `until`, or all of
// them when `until` is null.
function interruptSegments(turn: BotTurn, until: Segment | null = null) {
  const active = turn.active;
  if (active && active.status === "in-progress") {
    active.restEl.textContent = "";
    active.status = "interrupted";
    active.el.classList.add("interrupted");
  }
  const from = active ? turn.order.indexOf(active) + 1 : 0;
  const to = until ? turn.order.indexOf(until) : turn.order.length;
  for (const seg of turn.order.slice(from, to)) {
    if (seg.status === "new") removeSegment(turn, seg);
  }
  turn.active = null;
}

function handleBotOutput(data: BotOutputData) {
  const text = data.text ?? "";
  const id = data.segment_id;
  // Older bots send plain text with no segment lifecycle: one line each.
  if (id === undefined || id === null) {
    if (text) addTranscriptEntry("bot", text);
    return;
  }
  // Bots predating spoken_status send the text once; show it as spoken.
  const status = data.spoken_status ?? "completed";

  switch (status) {
    case "new": {
      const seg = getSegment(id, text);
      if (data.will_be_spoken === false) {
        // Text-only output (no TTS). There is nothing to progress through,
        // and it is not pending speech, so an interrupt must not drop it.
        seg.status = "completed";
        seg.el.classList.add("not-spoken");
      }
      break;
    }
    case "in-progress": {
      closeUserTurn();
      const seg = getSegment(id, text);
      const turn = seg.turn;
      if (turn.active && turn.active !== seg) interruptSegments(turn, seg);
      turn.active = seg;
      speakingBotTurn = turn;
      seg.status = "in-progress";
      setSegmentProgress(seg, data.spoken_progress?.accumulated_text ?? "");
      break;
    }
    case "completed": {
      closeUserTurn();
      const seg = getSegment(id, text);
      setSegmentProgress(seg, seg.text);
      seg.status = "completed";
      if (seg.turn.active === seg) seg.turn.active = null;
      break;
    }
    default:
      log("transcript", `unknown spoken_status ${status}`, data);
  }
}

function handleBotInterrupted() {
  // The line being spoken may already be closed for appends (the user's
  // interim text arrived first), so trim that one, not just the open line.
  const turn = speakingBotTurn ?? botTurn;
  if (turn) interruptSegments(turn);
  // Whatever the bot says next is a new line.
  botTurn = null;
  speakingBotTurn = null;
}

function clearTranscript() {
  ui.transcript.innerHTML = "";
  userTurn = null;
  botTurn = null;
  speakingBotTurn = null;
  botSegments.clear();
}

// ---------------------------------------------------------------------------
// Form persistence (per transport) so you don't retype URLs every reload.
// ---------------------------------------------------------------------------
interface SavedForm {
  mediaManager?: string;
  ctorOptions?: string;
  startEndpoint?: string;
  connectParams?: string;
}

function storageKey(transportKey: string) {
  return `pipecat-transports-example:${transportKey}`;
}

function loadForm(transportKey: string) {
  const def = TRANSPORTS[transportKey];
  let saved: SavedForm | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(transportKey)) ?? "");
  } catch {
    /* ignore */
  }
  fillMediaManagerSelect(def, saved?.mediaManager);
  ui.ctorOptions.value =
    saved?.ctorOptions ?? JSON.stringify(def.ctorDefaults, null, 2);
  ui.startEndpoint.value = saved?.startEndpoint ?? def.startEndpoint;
  ui.connectParams.value =
    saved?.connectParams ?? JSON.stringify(def.requestDefaults, null, 2);
}

function fillMediaManagerSelect(def: TransportDef, selected?: string) {
  ui.mediaManagerSelect.innerHTML = "";
  if (!def.mediaManagers) {
    ui.mediaManagerLabel.hidden = true;
    return;
  }
  for (const [key, mm] of Object.entries(def.mediaManagers)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = mm.label;
    ui.mediaManagerSelect.appendChild(opt);
  }
  ui.mediaManagerSelect.value =
    selected && def.mediaManagers[selected] ? selected : DEFAULT_MEDIA_MANAGER;
  ui.mediaManagerLabel.hidden = false;
}

function saveForm() {
  try {
    const form: SavedForm = {
      mediaManager: ui.mediaManagerSelect.value,
      ctorOptions: ui.ctorOptions.value,
      startEndpoint: ui.startEndpoint.value,
      connectParams: ui.connectParams.value,
    };
    localStorage.setItem(
      storageKey(ui.transportSelect.value),
      JSON.stringify(form)
    );
    localStorage.setItem(
      "pipecat-transports-example:transport",
      ui.transportSelect.value
    );
  } catch {
    /* ignore */
  }
}

function parseJSON(text: string, label: string): JsonObject | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
function setState(state: TransportState | "no client") {
  ui.transportState.textContent = state;
  ui.transportState.dataset.state = state;
}

function refreshButtons() {
  const haveClient = !!client;
  const state: TransportState = transport?.state ?? "disconnected";
  const connected = state === "connected" || state === "ready";
  const busy =
    state === "initializing" ||
    state === "authenticating" ||
    state === "connecting" ||
    state === "disconnecting";

  ui.initDevices.disabled = !haveClient || busy;
  ui.connect.disabled = !haveClient || connected || busy;
  ui.disconnect.disabled = !haveClient || state === "disconnected";
  ui.sendText.disabled = !connected;
  ui.sendTextBtn.disabled = !connected;

  // client.mediaSupport says what the transport / media manager can capture.
  // `false` rules a kind out; a missing key means "unknown", which is
  // treated as supported so the buttons stay usable while it settles.
  const support: MediaSupport = client ? client.mediaSupport : {};
  const micOk = support.mic !== false;
  const camOk = support.cam !== false;
  const screenOk = support.screenShare !== false;

  ui.micSelect.disabled = !haveClient || !micOk;
  ui.camSelect.disabled = !haveClient || !camOk;
  ui.speakerSelect.disabled = !haveClient;
  ui.toggleMic.disabled = !haveClient || !micOk;
  ui.toggleCam.disabled = !haveClient || !camOk;
  ui.toggleScreen.disabled = !connected || !screenOk;

  const stateLabel = (ok: boolean, on: boolean) =>
    ok ? (on ? "on" : "off") : "unsupported";
  if (client) {
    ui.toggleMic.textContent = `Mic: ${stateLabel(micOk, client.isMicEnabled)}`;
    ui.toggleCam.textContent = `Cam: ${stateLabel(camOk, client.isCamEnabled)}`;
  } else {
    ui.toggleMic.textContent = "Mic: ?";
    ui.toggleCam.textContent = "Cam: ?";
  }
  ui.toggleScreen.textContent = `Screen share: ${stateLabel(screenOk, screenShareOn)}`;
}

// `selectedMic` & co. return `{}` when nothing is selected yet.
type MaybeDevice = { deviceId?: string } | undefined;

function fillDeviceSelect(
  select: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  selected: MaybeDevice
) {
  select.innerHTML = "";
  if (!devices.length) {
    const opt = document.createElement("option");
    opt.textContent = "(none)";
    opt.value = "";
    select.appendChild(opt);
    return;
  }
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || d.deviceId;
    select.appendChild(opt);
  }
  if (selected?.deviceId) select.value = selected.deviceId;
}

function markSelected(select: HTMLSelectElement, device: MaybeDevice) {
  if (
    device?.deviceId &&
    select.querySelector(`option[value="${device.deviceId}"]`)
  ) {
    select.value = device.deviceId;
  }
}

async function refreshDevices() {
  if (!client) return;
  try {
    const [mics, cams, speakers] = await Promise.all([
      client.getAllMics(),
      client.getAllCams(),
      client.getAllSpeakers(),
    ]);
    fillDeviceSelect(ui.micSelect, mics, client.selectedMic);
    fillDeviceSelect(ui.camSelect, cams, client.selectedCam);
    fillDeviceSelect(ui.speakerSelect, speakers, client.selectedSpeaker);
  } catch (e) {
    logError("refreshDevices", e);
  }
}

// ---------------------------------------------------------------------------
// Media elements
// ---------------------------------------------------------------------------
function attachTrack(el: HTMLMediaElement, track: MediaStreamTrack) {
  el.srcObject = new MediaStream([track]);
}

function detachTrack(el: HTMLMediaElement, track?: MediaStreamTrack) {
  const stream = el.srcObject;
  if (!(stream instanceof MediaStream)) return;
  if (!track || stream.getTracks().includes(track)) el.srcObject = null;
}

function handleTrackStarted(
  track: MediaStreamTrack,
  participant?: Participant
) {
  const isLocal = !!participant?.local;
  if (isLocal) {
    if (track.kind === "video") attachTrack(ui.localVideo, track);
    else if (track.kind === "audio") attachMeter("local", track);
    return;
  }
  // Bot tracks. Transports that play audio themselves (websocket, moq) do
  // not report a bot audio track here, so attaching is safe for the rest.
  if (track.kind === "audio") {
    attachTrack(ui.botAudio, track);
    attachMeter("bot", track);
  } else if (track.kind === "video") attachTrack(ui.botVideo, track);
}

function handleTrackStopped(
  track: MediaStreamTrack,
  participant?: Participant
) {
  if (participant?.local) {
    if (track.kind === "video") detachTrack(ui.localVideo, track);
    else if (track.kind === "audio") detachMeter("local");
    return;
  }
  if (track.kind === "audio") {
    detachTrack(ui.botAudio, track);
    detachMeter("bot");
  } else if (track.kind === "video") detachTrack(ui.botVideo, track);
}

function clearMedia() {
  for (const el of [ui.localVideo, ui.botVideo, ui.botAudio])
    el.srcObject = null;
  detachMeter("local");
  detachMeter("bot");
}

// ---------------------------------------------------------------------------
// Volume meters. Two sources feed each meter:
//  - the RTVI LocalAudioLevel / RemoteAudioLevel events, for transports that
//    emit them (currently Daily and anything on DailyMediaManager);
//  - an AnalyserNode on the local / bot audio track, for everything else.
// Whichever is present writes the level; the label says which one is live.
// Transports that play bot audio themselves without exposing a track (the
// websocket transport on its default media manager) only get the
// bot-started/stopped-speaking outline.
// ---------------------------------------------------------------------------
type MeterKey = "local" | "bot";

interface Meter {
  el: HTMLElement;
  analyser: AnalyserNode | null;
  srcNode: MediaStreamAudioSourceNode | null;
  data: Float32Array<ArrayBuffer> | null;
  level: number;
  source: string;
}

const meters: Record<MeterKey, Meter> = {
  local: {
    el: ui.meterLocal,
    analyser: null,
    srcNode: null,
    data: null,
    level: 0,
    source: "",
  },
  bot: {
    el: ui.meterBot,
    analyser: null,
    srcNode: null,
    data: null,
    level: 0,
    source: "",
  },
};
let audioCtx: AudioContext | null = null;
let meterRaf = 0;

function setMeterSource(which: MeterKey, source: string) {
  const m = meters[which];
  m.source = source;
  m.el.querySelector(".meter-source")!.textContent = source;
}

function setMeterLevel(which: MeterKey, level: number) {
  const m = meters[which];
  m.level = Math.max(0, Math.min(1, level));
  m.el.querySelector<HTMLElement>(".meter-fill")!.style.width =
    `${m.level * 100}%`;
}

function attachMeter(which: MeterKey, track: MediaStreamTrack | undefined) {
  if (!track || track.kind !== "audio") return;
  const m = meters[which];
  if (m.srcNode?.mediaStream.getTracks()[0] === track) return;
  detachMeter(which);
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    m.srcNode = audioCtx.createMediaStreamSource(new MediaStream([track]));
    m.analyser = audioCtx.createAnalyser();
    m.analyser.fftSize = 512;
    m.srcNode.connect(m.analyser);
    m.data = new Float32Array(m.analyser.fftSize);
    setMeterSource(which, `track ${track.id.slice(0, 8)}`);
    if (!meterRaf) meterRaf = requestAnimationFrame(tickMeters);
  } catch (e) {
    logError(`attachMeter(${which})`, e);
  }
}

function detachMeter(which: MeterKey) {
  const m = meters[which];
  m.srcNode?.disconnect();
  m.analyser?.disconnect();
  m.srcNode = null;
  m.analyser = null;
  m.data = null;
  setMeterSource(which, "");
  setMeterLevel(which, 0);
  m.el.classList.remove("speaking");
}

function tickMeters() {
  meterRaf = 0;
  let active = false;
  for (const which of Object.keys(meters) as MeterKey[]) {
    const m = meters[which];
    if (!m.analyser || !m.data) continue;
    active = true;
    // Event-fed meters keep the loop alive for the analyser teardown but
    // leave the bar to the events.
    if (m.source === "event") continue;
    m.analyser.getFloatTimeDomainData(m.data);
    let sum = 0;
    for (const v of m.data) sum += v * v;
    const rms = Math.sqrt(sum / m.data.length);
    // Speech RMS is small; scale so normal talking fills most of the bar.
    setMeterLevel(which, rms * 4);
  }
  if (active) meterRaf = requestAnimationFrame(tickMeters);
}

// For transports that never report a bot audio track via TrackStarted (MoQ
// synthesizes one, reachable only through tracks()), look it up once the
// bot is ready.
function attachMetersFromTracks() {
  if (!client) return;
  try {
    const t = client.tracks();
    if (!meters.local.analyser && t.local?.audio)
      attachMeter("local", t.local.audio);
    if (!meters.bot.analyser && t.bot?.audio) attachMeter("bot", t.bot.audio);
  } catch (e) {
    logError("attachMetersFromTracks", e);
  }
}

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------
async function destroyClient() {
  if (!client) return;
  const old = client;
  client = null;
  transport = null;
  window.client = undefined;
  window.transport = undefined;
  window.mediaManager = undefined;
  try {
    await old.disconnect();
  } catch (e) {
    logError("disconnect (during teardown)", e);
  }
  clearMedia();
  screenShareOn = false;
  setState("no client");
  refreshButtons();
}

function wireEvents(c: PipecatClient) {
  c.on(RTVIEvent.UserInput, handleUserInput);
  c.on(RTVIEvent.BotOutput, handleBotOutput);
  c.on(RTVIEvent.BotInterrupted, handleBotInterrupted);
  c.on(RTVIEvent.BotStartedSpeaking, closeUserTurn);
  c.on(RTVIEvent.Error, (msg: RTVIMessage) => logError("rtvi error", msg));

  c.on(RTVIEvent.TransportStateChanged, (state: TransportState) => {
    setState(state);
    refreshButtons();
  });
  c.on(RTVIEvent.Disconnected, () => {
    clearMedia();
    screenShareOn = false;
    refreshButtons();
  });
  c.on(RTVIEvent.TrackStarted, handleTrackStarted);
  c.on(RTVIEvent.TrackStopped, handleTrackStopped);
  c.on(RTVIEvent.BotReady, attachMetersFromTracks);
  c.on(RTVIEvent.Connected, attachMetersFromTracks);

  // Event-driven levels. These win over the analyser when both exist, since
  // they overwrite the same bar; the label notes which is feeding it.
  c.on(RTVIEvent.LocalAudioLevel, (level: number) => {
    if (meters.local.source !== "event") setMeterSource("local", "event");
    setMeterLevel("local", level);
  });
  c.on(RTVIEvent.RemoteAudioLevel, (level: number) => {
    if (meters.bot.source !== "event") setMeterSource("bot", "event");
    setMeterLevel("bot", level);
  });
  c.on(RTVIEvent.UserStartedSpeaking, () =>
    meters.local.el.classList.add("speaking")
  );
  c.on(RTVIEvent.UserStoppedSpeaking, () =>
    meters.local.el.classList.remove("speaking")
  );
  c.on(RTVIEvent.BotStartedSpeaking, () =>
    meters.bot.el.classList.add("speaking")
  );
  c.on(RTVIEvent.BotStoppedSpeaking, () =>
    meters.bot.el.classList.remove("speaking")
  );
  c.on(RTVIEvent.ScreenTrackStarted, () => {
    screenShareOn = true;
    refreshButtons();
  });
  c.on(RTVIEvent.ScreenTrackStopped, () => {
    screenShareOn = false;
    refreshButtons();
  });

  c.on(RTVIEvent.AvailableMicsUpdated, (mics: MediaDeviceInfo[]) =>
    fillDeviceSelect(ui.micSelect, mics, c.selectedMic)
  );
  c.on(RTVIEvent.AvailableCamsUpdated, (cams: MediaDeviceInfo[]) =>
    fillDeviceSelect(ui.camSelect, cams, c.selectedCam)
  );
  c.on(RTVIEvent.AvailableSpeakersUpdated, (speakers: MediaDeviceInfo[]) =>
    fillDeviceSelect(ui.speakerSelect, speakers, c.selectedSpeaker)
  );
  c.on(RTVIEvent.MicUpdated, (mic: MediaDeviceInfo) =>
    markSelected(ui.micSelect, mic)
  );
  c.on(RTVIEvent.CamUpdated, (cam: MediaDeviceInfo) =>
    markSelected(ui.camSelect, cam)
  );
  c.on(RTVIEvent.SpeakerUpdated, (spk: MediaDeviceInfo) =>
    markSelected(ui.speakerSelect, spk)
  );
  c.on(RTVIEvent.MediaStateUpdated, refreshButtons);
  c.on(RTVIEvent.MediaSupportUpdated, (support: MediaSupport) => {
    log("mediaSupport", support);
    refreshButtons();
  });
}

async function createClient() {
  await destroyClient();
  saveForm();

  const key = ui.transportSelect.value;
  const def = TRANSPORTS[key];
  let ctorOpts: CtorOptions;
  try {
    ctorOpts = parseJSON(ui.ctorOptions.value, "Constructor options") ?? {};
  } catch (e) {
    logError("createClient", e);
    return;
  }

  let mediaManager: WavMediaManager | null = null;
  const mmKey = def.mediaManagers ? ui.mediaManagerSelect.value : null;
  const mmChoice = mmKey ? def.mediaManagers?.[mmKey] : undefined;
  try {
    if (mmChoice?.create) {
      mediaManager = mmChoice.create(ctorOpts);
      ctorOpts = { ...ctorOpts, mediaManager };
    }
    const t = def.create(ctorOpts);
    const c = new PipecatClient({
      transport: t,
      enableMic: ui.enableMic.checked,
      enableCam: ui.enableCam.checked,
    });
    c.setLogLevel(LogLevel.DEBUG);
    wireEvents(c);
    transport = t;
    client = c;
  } catch (e) {
    client = null;
    transport = null;
    logError("createClient", e);
    return;
  }

  window.client = client;
  window.transport = transport;
  window.mediaManager = mediaManager ?? undefined;
  log("example", `created ${def.label}`, {
    ctorOpts: { ...ctorOpts, mediaManager: undefined },
    mediaManager: mmChoice ? mmChoice.label : "n/a",
    enableMic: ui.enableMic.checked,
    enableCam: ui.enableCam.checked,
  });
  setState(transport.state);
  refreshButtons();
  await refreshDevices();
}

async function initDevices() {
  if (!client) return;
  try {
    await client.initDevices();
    await refreshDevices();
  } catch (e) {
    logError("initDevices", e);
  }
  refreshButtons();
}

async function connect() {
  if (!client) return;
  saveForm();
  let params: JsonObject | undefined;
  try {
    params = parseJSON(ui.connectParams.value, "Connect params");
  } catch (e) {
    logError("connect", e);
    return;
  }
  const endpoint = ui.startEndpoint.value.trim();
  // A new session starts a fresh transcript.
  clearTranscript();
  try {
    if (endpoint) {
      log("example", "startBotAndConnect", { endpoint, requestData: params });
      await client.startBotAndConnect({ endpoint, requestData: params });
    } else {
      log("example", "connect", params);
      await client.connect(params);
    }
  } catch (e) {
    logError("connect", e);
  }
  refreshButtons();
}

async function disconnect() {
  if (!client) return;
  try {
    await client.disconnect();
  } catch (e) {
    logError("disconnect", e);
  }
  refreshButtons();
}

async function sendText() {
  const text = ui.sendText.value.trim();
  if (!client || !text) return;
  try {
    await client.sendText(text);
    ui.sendText.value = "";
  } catch (e) {
    logError("sendText", e);
  }
}

// ---------------------------------------------------------------------------
// Wire up the page
// ---------------------------------------------------------------------------
for (const [key, def] of Object.entries(TRANSPORTS)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = def.label;
  ui.transportSelect.appendChild(opt);
}
try {
  const last = localStorage.getItem("pipecat-transports-example:transport");
  if (last && TRANSPORTS[last]) ui.transportSelect.value = last;
} catch {
  /* ignore */
}
loadForm(ui.transportSelect.value);

ui.transportSelect.addEventListener("change", () => {
  loadForm(ui.transportSelect.value);
  saveForm();
});
ui.mediaManagerSelect.addEventListener("change", saveForm);
for (const el of [ui.ctorOptions, ui.startEndpoint, ui.connectParams]) {
  el.addEventListener("change", saveForm);
}

ui.createClient.addEventListener("click", () => void createClient());
ui.initDevices.addEventListener("click", () => void initDevices());
ui.connect.addEventListener("click", () => void connect());
ui.disconnect.addEventListener("click", () => void disconnect());
ui.sendTextBtn.addEventListener("click", () => void sendText());
ui.sendText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void sendText();
});
ui.clearTranscript.addEventListener("click", clearTranscript);

ui.micSelect.addEventListener("change", () =>
  client?.updateMic(ui.micSelect.value)
);
ui.camSelect.addEventListener("change", () =>
  client?.updateCam(ui.camSelect.value)
);
ui.speakerSelect.addEventListener("change", () =>
  client?.updateSpeaker(ui.speakerSelect.value)
);
ui.toggleMic.addEventListener("click", () => {
  client?.enableMic(!client.isMicEnabled);
  refreshButtons();
});
ui.toggleCam.addEventListener("click", () => {
  client?.enableCam(!client.isCamEnabled);
  refreshButtons();
});
ui.toggleScreen.addEventListener("click", () => {
  client?.enableScreenShare(!screenShareOn);
});

window.RTVIEvent = RTVIEvent;
window.LogLevel = LogLevel;
window.PipecatClient = PipecatClient;
window.transports = {
  DailyTransport,
  LiveKitTransport,
  MoqTransport,
  SmallWebRTCTransport,
  WebSocketTransport,
};

refreshButtons();
log("example", "ready. Pick a transport and click “Create client”.");
