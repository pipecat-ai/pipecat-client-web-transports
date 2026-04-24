/**
 * Shared helpers for transport characterization tests.
 *
 * These exist so each transport's spec file can be small and focused on the
 * behavior being locked in — today's initDevices() contract, per the Plan A
 * Notion page. Replace these helpers only when the Transport abstract contract
 * itself changes.
 */

import type {
  PipecatClientOptions,
  RTVIEventCallbacks,
  RTVIMessage,
  Transport,
  TransportState,
} from "@pipecat-ai/client-js";
import { vi, type Mock } from "vitest";

/**
 * A record of every TransportState the transport emits through
 * onTransportStateChanged, in order. Populated by wireCallbacks().
 */
export interface StateRecorder {
  states: TransportState[];
}

/**
 * Build the full callback shape with each member wired to a vitest spy. The
 * onTransportStateChanged spy also pushes into the returned StateRecorder for
 * ergonomic sequence assertions.
 */
export function buildSpyCallbacks(): {
  callbacks: RTVIEventCallbacks;
  spies: { [K in keyof RTVIEventCallbacks]-?: Mock };
  recorder: StateRecorder;
} {
  const recorder: StateRecorder = { states: [] };

  const spies = {
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onError: vi.fn(),
    onTransportStateChanged: vi.fn((state: TransportState) => {
      recorder.states.push(state);
    }),
    onBotStarted: vi.fn(),
    onBotConnected: vi.fn(),
    onBotReady: vi.fn(),
    onBotDisconnected: vi.fn(),
    onMetrics: vi.fn(),
    onServerMessage: vi.fn(),
    onMessageError: vi.fn(),
    onParticipantJoined: vi.fn(),
    onParticipantLeft: vi.fn(),
    onAvailableCamsUpdated: vi.fn(),
    onAvailableMicsUpdated: vi.fn(),
    onAvailableSpeakersUpdated: vi.fn(),
    onCamUpdated: vi.fn(),
    onMicUpdated: vi.fn(),
    onSpeakerUpdated: vi.fn(),
    onDeviceError: vi.fn(),
    onTrackStarted: vi.fn(),
    onTrackStopped: vi.fn(),
    onScreenTrackStarted: vi.fn(),
    onScreenTrackStopped: vi.fn(),
    onScreenShareError: vi.fn(),
    onLocalAudioLevel: vi.fn(),
    onRemoteAudioLevel: vi.fn(),
    onUserStartedSpeaking: vi.fn(),
    onUserStoppedSpeaking: vi.fn(),
    onBotStartedSpeaking: vi.fn(),
    onBotStoppedSpeaking: vi.fn(),
    onUserMuteStarted: vi.fn(),
    onUserMuteStopped: vi.fn(),
    onUserTranscript: vi.fn(),
    onBotOutput: vi.fn(),
    onBotTranscript: vi.fn(),
    onBotLlmText: vi.fn(),
    onBotLlmStarted: vi.fn(),
    onBotLlmStopped: vi.fn(),
    onBotTtsText: vi.fn(),
    onBotTtsStarted: vi.fn(),
    onBotTtsStopped: vi.fn(),
    onLLMFunctionCallStarted: vi.fn(),
    onLLMFunctionCallInProgress: vi.fn(),
    onLLMFunctionCallStopped: vi.fn(),
    onBotLlmSearchResponse: vi.fn(),
    onLLMFunctionCall: vi.fn(),
  } as unknown as { [K in keyof RTVIEventCallbacks]-?: Mock };

  return {
    callbacks: spies as unknown as RTVIEventCallbacks,
    spies,
    recorder,
  };
}

/**
 * A minimal PipecatClientOptions. The transport arg is a placeholder — the
 * abstract Transport.initialize() API accepts the parent client options for
 * reading callbacks; tests drive the transport directly without ever needing a
 * real PipecatClient to own it.
 */
export function buildClientOptions(
  transport: Transport,
  callbacks: RTVIEventCallbacks
): PipecatClientOptions {
  return {
    transport,
    callbacks,
    enableMic: true,
    enableCam: false,
    enableScreenShare: false,
  };
}

/**
 * Wire a transport up the way PipecatClient does: call initialize() with
 * options + a message handler spy. Returns the spy so tests can assert on
 * message delivery where relevant.
 */
export function wireTransport(
  transport: Transport,
  callbacks: RTVIEventCallbacks
): { onMessage: Mock<(ev: RTVIMessage) => void> } {
  const onMessage = vi.fn<(ev: RTVIMessage) => void>();
  transport.initialize(buildClientOptions(transport, callbacks), onMessage);
  return { onMessage };
}
