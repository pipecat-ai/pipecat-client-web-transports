/**
 * What a transport needs to provide to run the device contract suite
 * (contract.ts) against it.
 *
 * Each transport's spec mocks its vendor SDK (daily-js, livekit-client,
 * @moq/*, wavtools, the network) with fakes that model the real device
 * behavior, and reports what the devices are actually doing through a
 * DeviceLog. The suite then drives a real PipecatClient over the real
 * transport and checks the devices, so it holds whether the contract ends
 * up implemented in the client or in the transports.
 */

import type { Transport } from "@pipecat-ai/client-js";

export type DeviceKind = "mic" | "cam";

/**
 * The truth about the local devices, as the faked vendor layer sees it.
 * Fakes call set() whenever something actually starts or stops capturing,
 * and the log records every change of a device, so tests can catch one
 * that toggles and comes back.
 *
 * A device can be captured by more than one source at once (a permission
 * probe next to the real track, a restarted track opening before the old
 * one stops), so set() takes a source and the device is on while any of
 * its sources is.
 */
export class DeviceLog {
  private _sources: Record<DeviceKind, Set<string>> = {
    mic: new Set(),
    cam: new Set(),
  };
  /** Every change, in order, e.g. "mic:on", "cam:off". */
  readonly transitions: string[] = [];
  /** Devices the user has blocked; acquiring one fails until unblocked. */
  readonly blocked: Record<DeviceKind, boolean> = { mic: false, cam: false };
  /**
   * Devices the user has granted, by a successful acquisition. Until then
   * the permission is "prompt", and acquiring one would prompt.
   */
  readonly granted: Record<DeviceKind, boolean> = { mic: false, cam: false };

  isOn(kind: DeviceKind): boolean {
    return this._sources[kind].size > 0;
  }

  set(kind: DeviceKind, on: boolean, source = "default"): void {
    const wasOn = this.isOn(kind);
    if (on) this._sources[kind].add(source);
    else this._sources[kind].delete(source);
    if (this.isOn(kind) !== wasOn) {
      this.transitions.push(`${kind}:${on ? "on" : "off"}`);
    }
  }

  /** The transitions logged since `mark` (an earlier transitions.length). */
  since(mark: number): string[] {
    return this.transitions.slice(mark);
  }
}

export interface HarnessInstance {
  transport: Transport;
  /** What PipecatClient.connect() is passed. */
  connectParams: unknown;
  /** Make the next connect() fail at the transport. */
  failNextConnect(): void;
  /**
   * For a transport that sends the local tracks itself (SmallWebRTC): the
   * track it is sending to the bot for `kind`, or null. The suite then
   * checks it is the live local track. Leave out where the vendor SDK sends
   * the tracks.
   */
  sentTrack?(kind: DeviceKind): MediaStreamTrack | null;
  /** Release anything the fakes hold (timers etc.). */
  teardown?(): void;
}

export interface DeviceHarness {
  name: string;
  /**
   * Whether the transport can capture a cam. A transport that can't must
   * throw UnsupportedFeatureError from enableCam(true), and must not throw
   * from initDevices() or connect() when the enableCam flag is set.
   */
  supportsCam: boolean;
  /**
   * Build a fresh transport over fresh fakes that report to `devices` (the
   * suite also makes it the current DeviceLog, see fakes/media.ts). The
   * fakes reply to the client-ready message with bot-ready, so
   * PipecatClient.connect() resolves without a real bot.
   */
  create(devices: DeviceLog): HarnessInstance;
}
