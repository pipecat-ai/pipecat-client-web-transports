import {
  DeviceArray,
  DeviceError,
  DeviceErrorType,
  Participant,
  PipecatClientOptions,
  RTVI_MESSAGE_LABEL,
  RTVIMessage,
  Tracks,
  Transport,
  TransportStartError,
  TransportState,
  logger,
} from "@pipecat-ai/client-js";
import {
  ConnectionState,
  LocalAudioTrack,
  LocalParticipant,
  LocalTrackPublication,
  LocalVideoTrack,
  MediaDeviceFailure,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomConnectOptions,
  RoomEvent,
  RoomOptions,
  Track,
  createLocalAudioTrack,
  createLocalTracks,
  createLocalVideoTrack,
} from "livekit-client";
import packageJson from "../package.json";

export type LiveKitConnectParams = {
  url: string;
  token: string;
  roomConnectionOptions?: RoomConnectOptions;
};

export type LiveKitTransportConstructorOptions = RoomOptions;

export class LiveKitTransport extends Transport {
  private _room: Room;

  private _selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private _selectedCam: MediaDeviceInfo | Record<string, never> = {};
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};

  private _micEnabled: boolean = false;
  private _camEnabled: boolean = false;
  private _listenersAttached: boolean = false;
  private _readyHandler: (() => void) | null = null;
  private _readyReject: ((reason?: unknown) => void) | null = null;
  private _deviceChangeHandler = () => {
    void this._handleDeviceChange();
  };
  private _localAudioTrack?: LocalAudioTrack;
  private _localVideoTrack?: LocalVideoTrack;
  // The raw MediaStreamTrack last reported to the app via onTrackStarted, if
  // any — _syncSelectedMic/Cam's own record of "what we last told callers is
  // live", diffed against current reality to decide what to report next.
  private _lastReportedMicTrack?: MediaStreamTrack;
  private _lastReportedCamTrack?: MediaStreamTrack;
  private _botId: string = "";

  constructor(options: LiveKitTransportConstructorOptions = {}) {
    super();
    this._room = new Room(options);
  }

  public initialize(
    options: PipecatClientOptions,
    messageHandler: (ev: RTVIMessage) => void
  ): void {
    this._options = options;
    this._callbacks = options.callbacks ?? {};
    this._onMessage = messageHandler;
    this._micEnabled = options.enableMic ?? true;
    this._camEnabled = options.enableCam ?? false;

    this.attachEventListeners();

    this.state = "disconnected";
    logger.debug("[LiveKit Transport] Initialized", packageJson.version);
  }

  get state(): TransportState {
    return this._state;
  }

  set state(state: TransportState) {
    if (this._state === state) return;

    this._state = state;
    this._callbacks.onTransportStateChanged?.(state);
  }

  async initDevices(): Promise<void> {
    this.state = "initializing";

    if (this._micEnabled && this._camEnabled) {
      try {
        // createLocalTracks acquires both in one getUserMedia call, showing a
        // single combined permission prompt instead of two sequential ones.
        // A bare string deviceId is shorthand for { ideal } (a soft
        // preference, silently dropped if unsatisfiable) rather than
        // { exact } (which throws). We want that here: Chrome resolves
        // "default" to its virtual default-device alias so getSettings()
        // reports "default" and reselection stays sticky (see
        // _reacquireIfMissing), but Firefox/Safari have no such device, and
        // exact would make initDevices() throw there.
        const tracks = await createLocalTracks({
          audio: { deviceId: "default" },
          video: { deviceId: "default" },
        });
        const audioTrack = tracks.find((t) => t.kind === Track.Kind.Audio) as
          | LocalAudioTrack
          | undefined;
        const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video) as
          | LocalVideoTrack
          | undefined;
        if (audioTrack) await this._adoptMicTrack(audioTrack);
        if (videoTrack) await this._adoptCamTrack(videoTrack);
      } catch (e) {
        // createLocalTracks, like getUserMedia, is all-or-nothing — one
        // device failing fails the whole combined request. Fall back to
        // acquiring each independently so a single bad device doesn't take
        // the other down with it, and the error attributes to the right one.
        logger.warn(
          "[LiveKit Transport] Combined mic+cam acquisition failed, falling back to acquiring each independently",
          e
        );
        await Promise.all([this._acquireMic(), this._acquireCam()]);
      }
    } else {
      if (this._micEnabled) await this._acquireMic();
      if (this._camEnabled) await this._acquireCam();
    }

    await this.updateAvailableDevices();
    await this._syncSelectedSpeaker();
    this.state = "initialized";
  }

  // Unlike mic/cam, there's no local track to read a live deviceId off of —
  // nothing is being played out yet pre-connect. So on init we just reflect
  // whatever the browser currently considers the default output device,
  // the same way the browser itself would pick one absent any explicit
  // switchActiveDevice() call.
  private async _syncSelectedSpeaker(): Promise<void> {
    const speakers = await this.getAllSpeakers();
    // Chrome exposes a virtual "default" audiooutput device; Firefox/Safari
    // don't — by convention the first device in the list is the default there.
    const speaker =
      speakers.find((d) => d.deviceId === "default") ?? speakers[0];
    if (
      speaker &&
      (this._selectedSpeaker as MediaDeviceInfo).deviceId !== speaker.deviceId
    ) {
      this._selectedSpeaker = speaker;
      this._callbacks.onSpeakerUpdated?.(speaker);
    }
  }

  private async _acquireMic(): Promise<void> {
    try {
      // See the comment in initDevices() re: { deviceId: "default" } — a
      // soft ideal preference, not exact, so this stays safe on Firefox/Safari.
      await this._adoptMicTrack(
        await createLocalAudioTrack({ deviceId: "default" })
      );
    } catch (e) {
      logger.warn("[LiveKit Transport] Could not initialize mic", e);
      this._callbacks.onDeviceError?.(
        new DeviceError(
          ["mic"],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  private async _acquireCam(): Promise<void> {
    try {
      await this._adoptCamTrack(
        await createLocalVideoTrack({ deviceId: "default" })
      );
    } catch (e) {
      logger.warn("[LiveKit Transport] Could not initialize cam", e);
      this._callbacks.onDeviceError?.(
        new DeviceError(
          ["cam"],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  private async _adoptMicTrack(track: LocalAudioTrack): Promise<void> {
    this._localAudioTrack = track;
    await this._syncSelectedMic(track);
  }

  private async _adoptCamTrack(track: LocalVideoTrack): Promise<void> {
    this._localVideoTrack = track;
    await this._syncSelectedCam(track);
  }

  private async _enumerateDevices(): Promise<{
    all: MediaDeviceInfo[];
    mics: MediaDeviceInfo[];
    cams: MediaDeviceInfo[];
    speakers: MediaDeviceInfo[];
  }> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      all,
      mics: all.filter((d) => d.kind === "audioinput"),
      cams: all.filter((d) => d.kind === "videoinput"),
      speakers: all.filter((d) => d.kind === "audiooutput"),
    };
  }

  private async updateAvailableDevices(): Promise<
    MediaDeviceInfo[] | undefined
  > {
    try {
      const { all, cams, mics, speakers } = await this._enumerateDevices();

      this._callbacks.onAvailableCamsUpdated?.(cams);
      this._callbacks.onAvailableMicsUpdated?.(mics);
      this._callbacks.onAvailableSpeakersUpdated?.(speakers);
      return all;
    } catch (e) {
      logger.error("Error enumerating devices", e);
      return undefined;
    }
  }

  /**
   * On devicechange, check whether the mic/cam we're actively capturing from
   * is still present (or, for a "default" selection, whether the underlying
   * physical default changed). livekit-client's own Room.selectDefaultDevices
   * already does this for audiooutput on every devicechange (and switching
   * the active output there also updates every remote participant's <audio>
   * element — see updateSpeaker()), but it deliberately skips audioinput
   * (except a Safari AirPods special case) and videoinput, leaving mic/cam
   * reselection to us.
   */
  private async _handleDeviceChange(): Promise<void> {
    const devices = await this.updateAvailableDevices();
    if (!devices) return;
    await Promise.all([
      this._reacquireIfMissing(
        "mic",
        devices.filter((d) => d.kind === "audioinput")
      ),
      this._reacquireIfMissing(
        "cam",
        devices.filter((d) => d.kind === "videoinput")
      ),
    ]);
  }

  private async _reacquireIfMissing(
    kind: "mic" | "cam",
    devices: MediaDeviceInfo[]
  ): Promise<void> {
    const track =
      kind === "mic" ? this._localAudioTrack : this._localVideoTrack;
    if (!track) return; // not currently capturing — nothing to reacquire

    const current = (
      kind === "mic" ? this._selectedMic : this._selectedCam
    ) as MediaDeviceInfo;
    if (!current?.deviceId) return;

    // Chrome exposes a virtual "default" device alongside the real ones;
    // Firefox/Safari don't — by convention the first device in the list is
    // the default there. Fall back accordingly.
    const defaultDevice =
      devices.find((d) => d.deviceId === "default") ?? devices[0];
    const stillPresent = devices.some((d) => d.deviceId === current.deviceId);
    const defaultChanged =
      current.deviceId === "default" && current.label !== defaultDevice?.label;
    if (stillPresent && !defaultChanged) return;

    try {
      if (defaultChanged) {
        // Re-request the virtual "default" device itself (Chrome-only —
        // defaultChanged can only be true when current.deviceId is literally
        // "default"), not just an unconstrained restart. An unconstrained
        // restartTrack({}) does pick up today's actual default hardware, but
        // getSettings().deviceId then reports that device's own concrete
        // hash, not "default" — so _syncSelectedMic/Cam would pin us to that
        // one device and we'd lose "always follow the default" for the
        // *next* devicechange. Explicitly requesting { exact: "default" }
        // keeps getSettings().deviceId reporting "default" going forward.
        await track.restartTrack({ deviceId: { exact: "default" } });
      } else {
        // The selected device physically disappeared. No deviceId
        // constraint (an empty object, not undefined — restartTrack falls
        // back to the track's *previous* constraints when passed nothing)
        // so the browser picks a fresh default.
        await track.restartTrack({});
      }
      if (kind === "mic") await this._syncSelectedMic(track as LocalAudioTrack);
      else await this._syncSelectedCam(track as LocalVideoTrack);
    } catch (e) {
      this._callbacks.onDeviceError?.(
        new DeviceError(
          [kind],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  _validateConnectionParams(
    connectParams: unknown
  ): LiveKitConnectParams | undefined {
    if (!connectParams || typeof connectParams !== "object") return undefined;
    const p = connectParams as LiveKitConnectParams;
    if (!p.url || !p.token) {
      throw new Error("LiveKit connection requires 'url' and 'token'");
    }
    return p;
  }

  async _connect(connectParams?: LiveKitConnectParams): Promise<void> {
    if (!connectParams?.url || !connectParams?.token) {
      this.state = "error";
      throw new TransportStartError(
        "LiveKit connection requires 'url' and 'token'"
      );
    }

    this.state = "connecting";

    // Publish alongside connect(), not after it. publishTrack() only waits on
    // the signal (WebSocket) connection, not full ICE/PC negotiation — the
    // AddTrackRequest rides in the same initial offer/answer that's already
    // negotiating for connect(). Sequencing it after connect() resolves would
    // pay a slow link's cost twice (a full second renegotiation for the
    // track) instead of once.
    //
    // room.connect() failing is a real connection failure. A publish failing
    // is not — the session can still work with one fewer track — so each
    // publish gets its own catch that reports onDeviceError (correctly
    // attributed to mic vs cam) instead of rejecting the whole connect.
    const roomConnectPromise = this._room.connect(
      connectParams.url,
      connectParams.token,
      connectParams.roomConnectionOptions
    );

    const publishPromises: Promise<unknown>[] = [];
    if (this._localAudioTrack) {
      publishPromises.push(
        this._room.localParticipant
          .publishTrack(this._localAudioTrack)
          .catch((e) => {
            logger.error("[LiveKit Transport] Failed to publish mic track", e);
            this._callbacks.onDeviceError?.(
              new DeviceError(
                ["mic"],
                "unknown",
                e instanceof Error ? e.message : String(e)
              )
            );
          })
      );
    }
    if (this._localVideoTrack) {
      publishPromises.push(
        this._room.localParticipant
          .publishTrack(this._localVideoTrack)
          .catch((e) => {
            logger.error("[LiveKit Transport] Failed to publish cam track", e);
            this._callbacks.onDeviceError?.(
              new DeviceError(
                ["cam"],
                "unknown",
                e instanceof Error ? e.message : String(e)
              )
            );
          })
      );
    }

    try {
      await roomConnectPromise;
    } catch (e) {
      logger.error("Failed to connect to LiveKit room", e);
      this.state = "error";
      throw new TransportStartError();
    }

    // Publishes were kicked off alongside connect() above; their failures are
    // already caught and reported, so this can't reject — just makes sure
    // they've settled before we consider ourselves connected.
    await Promise.all(publishPromises);

    // room.connect() and the publish awaits above are all points at which a
    // concurrent disconnect() may have aborted us and already set state to
    // "disconnected". Guard here so we don't clobber that back to "connected".
    if (this._abortController?.signal.aborted) {
      await this._room.disconnect();
      return;
    }

    this.state = "connected";
    this._callbacks.onConnected?.();
  }

  async _disconnect(): Promise<void> {
    this.state = "disconnecting";
    navigator.mediaDevices.removeEventListener(
      "devicechange",
      this._deviceChangeHandler
    );
    // room.disconnect() emits RoomEvent.Disconnected synchronously, before
    // its own promise resolves, *if* the room was actually connected
    // (confirmed against livekit-client's source — handleDisconnect() runs
    // and emits in the same synchronous block the await here is waiting on).
    // handleRoomDisconnected() is what actually tears everything down, for
    // this explicit path, an involuntary one (network drop, room closed
    // server-side), and a room that was never connected in the first place
    // (initDevices() ran, connect() never did — the real SDK no-ops without
    // emitting anything in that case) — one teardown routine, not two. It's
    // idempotent (guarded on this.state), so calling it explicitly here too
    // is a harmless no-op if the event already ran it.
    await this._room.disconnect();
    this.handleRoomDisconnected();
  }

  sendMessage(message: RTVIMessage): void {
    if (!this._room || (this.state !== "connected" && this.state !== "ready")) {
      logger.warn("Cannot send message, not connected");
      return;
    }
    const str = JSON.stringify(message);
    const encoder = new TextEncoder();
    const data = encoder.encode(str);

    this._room.localParticipant.publishData(data, { reliable: true });
  }

  // Device Management
  async getAllMics(): Promise<MediaDeviceInfo[]> {
    return (await this._enumerateDevices()).mics;
  }

  async getAllCams(): Promise<MediaDeviceInfo[]> {
    return (await this._enumerateDevices()).cams;
  }

  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return (await this._enumerateDevices()).speakers;
  }

  // updateMic/updateCam switch the device on our own owned LocalAudioTrack/
  // LocalVideoTrack via restartTrack() — this works whether or not the track
  // is currently published (Room-agnostic re-acquire pre-connect; a smooth
  // sender.replaceTrack() with no renegotiation once published). There's
  // nothing to switch if the device was never enabled in the first place.
  async updateMic(micId: string): Promise<void> {
    if ((this._selectedMic as MediaDeviceInfo).deviceId === micId) return;
    if (!this._localAudioTrack) {
      logger.warn(
        "[LiveKit Transport] updateMic() called with no active mic track — call initDevices() or enableMic() first"
      );
      return;
    }
    const track = this._localAudioTrack;
    try {
      // A bare string deviceId is shorthand for { ideal: micId } — a soft
      // preference the browser can (and in practice does) ignore in favor of
      // whatever device is already active. { exact } forces the switch,
      // matching what Room.switchActiveDevice does for exactly this reason.
      await track.restartTrack({ deviceId: { exact: micId } });
      await this._syncSelectedMic(track);
    } catch (e) {
      this._callbacks.onDeviceError?.(
        new DeviceError(
          ["mic"],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  async updateCam(camId: string): Promise<void> {
    if ((this._selectedCam as MediaDeviceInfo).deviceId === camId) return;
    if (!this._localVideoTrack) {
      logger.warn(
        "[LiveKit Transport] updateCam() called with no active cam track — call initDevices() or enableCam() first"
      );
      return;
    }
    const track = this._localVideoTrack;
    try {
      await track.restartTrack({ deviceId: { exact: camId } });
      await this._syncSelectedCam(track);
    } catch (e) {
      this._callbacks.onDeviceError?.(
        new DeviceError(
          ["cam"],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  // room.switchActiveDevice("audiooutput", ...) already updates the sinkId on
  // every remote participant's <audio> element internally (Room.ts calls
  // participant.setAudioOutput() for each one) — the DOM-walking LiveKit does
  // itself isn't something we need to replicate here.
  async updateSpeaker(speakerId: string): Promise<void> {
    if ((this._selectedSpeaker as MediaDeviceInfo).deviceId === speakerId)
      return;
    try {
      await this._room.switchActiveDevice("audiooutput", speakerId);
      const speakers = await this.getAllSpeakers();
      const s = speakers.find((d) => d.deviceId === speakerId);
      if (s) {
        this._selectedSpeaker = s;
        this._callbacks.onSpeakerUpdated?.(s);
      }
    } catch (e: unknown) {
      this._callbacks.onDeviceError?.(
        new DeviceError(["speaker"], "unknown", (e as Error).message)
      );
    }
  }

  get selectedMic() {
    return this._selectedMic;
  }
  get selectedCam() {
    return this._selectedCam;
  }
  get selectedSpeaker() {
    return this._selectedSpeaker;
  }

  // Gate on livekit-client's own Room state (not our TransportState) since
  // that's what determines which API applies: setMicrophoneEnabled()
  // depends on an active engine connection, createLocalAudioTrack() doesn't.
  //
  // When connected, always go through setMicrophoneEnabled() rather than
  // branching on whether we already hold a track ourselves — that's exactly
  // what it does internally (livekit-client's own setTrackEnabled() calls
  // track.mute()/unmute() when a publication already exists, or creates +
  // publishes a fresh one otherwise), so there's no reason to duplicate that
  // decision on our end. Either way, _syncSelectedMic() afterwards figures
  // out what actually changed and reports it.
  async enableMic(enable: boolean): Promise<void> {
    try {
      const existingTrack = this._localAudioTrack;

      if (this._room.state === ConnectionState.Connected) {
        await this._room.localParticipant.setMicrophoneEnabled(enable);
        // Set right after the real (fallible) operation succeeds, but
        // *before* _syncSelectedMic/_adoptMicTrack below fire
        // onTrackStarted/Stopped — consumers reacting to that event (e.g.
        // client-react's isMicEnabled resync) read this same getter, and
        // need to see the new value, not whatever it was before this call.
        // Still only reached on success: a thrown error skips straight to
        // the catch below, leaving this reflecting reality.
        this._micEnabled = enable;
        if (existingTrack) {
          await this._syncSelectedMic(existingTrack);
        } else if (enable) {
          const pub = this._room.localParticipant.getTrackPublication(
            Track.Source.Microphone
          );
          if (pub?.track)
            await this._adoptMicTrack(pub.track as LocalAudioTrack);
        }
      } else if (existingTrack) {
        // Not connected: manage our own Room-agnostic pre-warmed track
        // directly — there's no engine connection for setMicrophoneEnabled()
        // to depend on yet.
        if (enable) await existingTrack.unmute();
        else await existingTrack.mute();
        this._micEnabled = enable;
        await this._syncSelectedMic(existingTrack);
      } else if (enable) {
        const track = await createLocalAudioTrack();
        this._micEnabled = enable;
        await this._adoptMicTrack(track);
      } else {
        // Disabling with nothing currently capturing — no fallible
        // operation to gate on, just record the (already-true) reality.
        this._micEnabled = enable;
      }
    } catch (e) {
      logger.error("Failed to toggle mic", e);
      this._callbacks.onDeviceError?.(
        new DeviceError(
          ["mic"],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  // Same shape as enableMic(); see its comment for the setCameraEnabled()/
  // mute()/unmute() split.
  async enableCam(enable: boolean): Promise<void> {
    try {
      const existingTrack = this._localVideoTrack;

      if (this._room.state === ConnectionState.Connected) {
        await this._room.localParticipant.setCameraEnabled(enable);
        // See enableMic()'s comment: set before _syncSelectedCam/
        // _adoptCamTrack below fire onTrackStarted/Stopped, so anything
        // reacting to that event sees the new value.
        this._camEnabled = enable;
        if (existingTrack) {
          await this._syncSelectedCam(existingTrack);
        } else if (enable) {
          const pub = this._room.localParticipant.getTrackPublication(
            Track.Source.Camera
          );
          if (pub?.track)
            await this._adoptCamTrack(pub.track as LocalVideoTrack);
        }
      } else if (existingTrack) {
        if (enable) await existingTrack.unmute();
        else await existingTrack.mute();
        this._camEnabled = enable;
        await this._syncSelectedCam(existingTrack);
      } else if (enable) {
        const track = await createLocalVideoTrack();
        this._camEnabled = enable;
        await this._adoptCamTrack(track);
      } else {
        // Disabling with nothing currently capturing — no fallible
        // operation to gate on, just record the (already-true) reality.
        this._camEnabled = enable;
      }
    } catch (e) {
      logger.error("Failed to toggle cam", e);
      this._callbacks.onDeviceError?.(
        new DeviceError(
          ["cam"],
          this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
          e instanceof Error ? e.message : String(e)
        )
      );
    }
  }

  // Single entry point for "something about the mic/cam track may have
  // changed" — called after every acquire, mute/unmute, restart (device
  // switch or devicechange-driven reselect), and setMicrophoneEnabled()/
  // setCameraEnabled(). Figures out what actually changed by diffing against
  // last-known state, rather than making each call site work that out:
  //   - device: compares against _selectedMic/_selectedCam, fires
  //     onMicUpdated/onCamUpdated if the resolved device differs.
  //   - validity: compares the current "live" raw track (undefined while
  //     muted) against the last one we reported via onTrackStarted, firing
  //     onTrackStopped/onTrackStarted for whatever actually differs. This
  //     covers every case uniformly: a fresh acquire (nothing → track), a
  //     mute (track → nothing), an unmute (nothing → track, same or restarted
  //     object), a device switch (track → different track), and a no-op
  //     repeat call (nothing to report either way).
  private async _syncSelectedMic(track: LocalAudioTrack): Promise<void> {
    const deviceId = track.mediaStreamTrack.getSettings().deviceId;
    const mics = await this.getAllMics();
    const mic = mics.find((m) => m.deviceId === deviceId);
    if (
      mic &&
      (this._selectedMic as MediaDeviceInfo).deviceId !== mic.deviceId
    ) {
      this._selectedMic = mic;
      this._callbacks.onMicUpdated?.(mic);
    }

    const liveTrack = track.isMuted ? undefined : track.mediaStreamTrack;
    if (liveTrack !== this._lastReportedMicTrack) {
      const participant = { id: "local", name: "", local: true };
      if (this._lastReportedMicTrack) {
        this._callbacks.onTrackStopped?.(
          this._lastReportedMicTrack,
          participant
        );
      }
      if (liveTrack) {
        this._callbacks.onTrackStarted?.(liveTrack, participant);
      }
      this._lastReportedMicTrack = liveTrack;
    }
  }

  private async _syncSelectedCam(track: LocalVideoTrack): Promise<void> {
    const deviceId = track.mediaStreamTrack.getSettings().deviceId;
    const cams = await this.getAllCams();
    const cam = cams.find((c) => c.deviceId === deviceId);
    if (
      cam &&
      (this._selectedCam as MediaDeviceInfo).deviceId !== cam.deviceId
    ) {
      this._selectedCam = cam;
      this._callbacks.onCamUpdated?.(cam);
    }

    const liveTrack = track.isMuted ? undefined : track.mediaStreamTrack;
    if (liveTrack !== this._lastReportedCamTrack) {
      const participant = { id: "local", name: "", local: true };
      if (this._lastReportedCamTrack) {
        this._callbacks.onTrackStopped?.(
          this._lastReportedCamTrack,
          participant
        );
      }
      if (liveTrack) {
        this._callbacks.onTrackStarted?.(liveTrack, participant);
      }
      this._lastReportedCamTrack = liveTrack;
    }
  }

  get isMicEnabled(): boolean {
    return this._micEnabled;
  }

  get isCamEnabled(): boolean {
    return this._camEnabled;
  }

  get isSharingScreen(): boolean {
    return this._room.localParticipant.isScreenShareEnabled;
  }

  enableScreenShare(enable: boolean): void {
    this._room.localParticipant.setScreenShareEnabled(enable);
  }

  tracks(): Tracks {
    const local = this._room.localParticipant;
    const getTrack = (
      p: LocalParticipant | RemoteParticipant,
      source: Track.Source
    ) => p.getTrackPublication(source)?.track?.mediaStreamTrack;

    // Mic/cam come straight from our own track references — reflects reality
    // even pre-connect (e.g. right after initDevices()/enableMic(), before
    // _connect() has published anything). Screen share is still LiveKit-native.
    const localTracks = {
      audio: this._localAudioTrack?.mediaStreamTrack,
      video: this._localVideoTrack?.mediaStreamTrack,
      screenVideo: getTrack(local, Track.Source.ScreenShare),
      screenAudio: getTrack(local, Track.Source.ScreenShareAudio),
    };

    const botParticipant = this._botId
      ? this._room.remoteParticipants.get(this._botId)
      : undefined;
    const botTracks = botParticipant
      ? {
          audio: getTrack(botParticipant, Track.Source.Microphone),
          video: getTrack(botParticipant, Track.Source.Camera),
        }
      : {};

    return { local: localTracks, bot: botTracks };
  }

  async sendReadyMessage() {
    return new Promise<void>((resolve, reject) => {
      // "ready" means the bot can hear/see us and we can hear/see it, not
      // just "connected to the room" — so only resolve immediately if the
      // bot's mic or cam track is already subscribed; otherwise wait for
      // handleTrackSubscribed below.
      const botParticipant = this._botId
        ? this._room.remoteParticipants.get(this._botId)
        : undefined;
      const hasBotMedia =
        !!botParticipant?.getTrackPublication(Track.Source.Microphone)?.track ||
        !!botParticipant?.getTrackPublication(Track.Source.Camera)?.track;

      if (hasBotMedia) {
        this.state = "ready";
        this.sendMessage(RTVIMessage.clientReady());
        resolve();
        return;
      }

      const readyHandler = () => {
        this.state = "ready";
        this.sendMessage(RTVIMessage.clientReady());
        resolve();
        this._readyHandler = null;
        this._readyReject = null;
      };
      this._readyHandler = readyHandler;
      // Rejected from handleRoomDisconnected() if the room drops (network
      // loss, room closed server-side) before the bot ever subscribes —
      // otherwise this promise would hang forever, matching
      // openai-realtime-webrtc-transport's _botIsReadyResolve.reject() on a
      // failed/closed peer connection.
      this._readyReject = reject;
    }); // End of Promise
  }

  private attachEventListeners() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    this._room
      .on(RoomEvent.DataReceived, this.handleDataReceived.bind(this))
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed.bind(this))
      .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed.bind(this))
      .on(
        RoomEvent.ParticipantConnected,
        this.handleParticipantConnected.bind(this)
      )
      .on(
        RoomEvent.ParticipantDisconnected,
        this.handleParticipantDisconnected.bind(this)
      )
      .on(RoomEvent.Disconnected, this.handleRoomDisconnected.bind(this))
      .on(
        RoomEvent.LocalTrackPublished,
        this.handleLocalTrackPublished.bind(this)
      )
      .on(
        RoomEvent.LocalTrackUnpublished,
        this.handleLocalTrackUnpublished.bind(this)
      )
      .on(RoomEvent.MediaDevicesError, this.handleMediaDevicesError.bind(this));

    navigator.mediaDevices.addEventListener(
      "devicechange",
      this._deviceChangeHandler
    );
  }

  private handleDataReceived(payload: Uint8Array) {
    try {
      const decoder = new TextDecoder();
      const str = decoder.decode(payload);
      const msg = JSON.parse(str);
      // Only bubble RTVI messages; ignore any other data on the channel.
      if (
        msg &&
        typeof msg === "object" &&
        "type" in msg &&
        msg.label === RTVI_MESSAGE_LABEL
      ) {
        this._onMessage(msg as RTVIMessage);
      }
    } catch (e) {
      logger.error("Failed to parse data message", e);
    }
  }

  private handleTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    logger.debug(
      `[LiveKit Transport] Track subscribed: ${track.kind} ${publication.source} from ${participant.identity}`
    );
    if (this._readyHandler) {
      this._readyHandler();
    }
    const isScreenShare =
      publication.source === Track.Source.ScreenShare ||
      publication.source === Track.Source.ScreenShareAudio;
    if (isScreenShare) {
      this._callbacks.onScreenTrackStarted?.(
        track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    } else {
      this._callbacks.onTrackStarted?.(
        track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
  }

  private handleTrackUnsubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    if (!track.mediaStreamTrack) return;
    const isScreenShare =
      publication.source === Track.Source.ScreenShare ||
      publication.source === Track.Source.ScreenShareAudio;
    if (isScreenShare) {
      this._callbacks.onScreenTrackStopped?.(
        track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    } else {
      this._callbacks.onTrackStopped?.(
        track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
  }

  // Mic/cam publish/unpublish and device-sync are driven explicitly by
  // initDevices()/enableMic()/enableCam()/updateMic()/updateCam() against our
  // own owned LocalAudioTrack/LocalVideoTrack now — reporting them again here
  // off the room's own publish event would double-fire onTrackStarted/
  // onMicUpdated/onCamUpdated. Screen share is still LiveKit-native
  // (setScreenShareEnabled), so it's the only source reported from these
  // room-level events — via onScreenTrackStarted/Stopped, not the generic
  // onTrackStarted/Stopped (those are for mic/cam/remote tracks).
  private handleLocalTrackPublished(
    publication: LocalTrackPublication,
    participant: LocalParticipant
  ) {
    if (
      publication.source !== Track.Source.ScreenShare &&
      publication.source !== Track.Source.ScreenShareAudio
    ) {
      return;
    }
    if (publication.track?.mediaStreamTrack) {
      this._callbacks.onScreenTrackStarted?.(
        publication.track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
  }

  private handleLocalTrackUnpublished(
    publication: LocalTrackPublication,
    participant: LocalParticipant
  ) {
    if (
      publication.source !== Track.Source.ScreenShare &&
      publication.source !== Track.Source.ScreenShareAudio
    ) {
      return;
    }
    if (publication.track?.mediaStreamTrack) {
      this._callbacks.onScreenTrackStopped?.(
        publication.track.mediaStreamTrack,
        this.toParticipant(participant)
      );
    }
  }

  private handleParticipantConnected(participant: RemoteParticipant) {
    logger.debug(
      `[LiveKit Transport] Participant joined: ${participant.identity} (${participant.name})`
    );
    this._callbacks.onParticipantJoined?.(this.toParticipant(participant));

    // Mirrors the other transports: the first remote participant to join is
    // treated as the bot for onBotConnected/onBotDisconnected purposes.
    if (!this._botId) {
      this._botId = participant.identity;
      this._callbacks.onBotConnected?.(this.toParticipant(participant));
    }
  }

  private handleParticipantDisconnected(participant: RemoteParticipant) {
    this._callbacks.onParticipantLeft?.(this.toParticipant(participant));

    if (participant.identity === this._botId) {
      this._botId = "";
      this._callbacks.onBotDisconnected?.(this.toParticipant(participant));
    }
  }

  // The single teardown routine for both an explicit _disconnect() and an
  // involuntary disconnect (network drop, room closed server-side) — see
  // _disconnect()'s comment for why both funnel through here via
  // RoomEvent.Disconnected rather than duplicating this logic.
  private handleRoomDisconnected() {
    if (this.state === "disconnected") return;

    // A pending sendReadyMessage() is still waiting on the bot's mic/cam
    // track to subscribe — that will never happen now, so reject rather
    // than leave the promise (and its caller) hanging forever.
    if (this._readyReject) {
      this._readyReject(new Error("LiveKit room disconnected before ready"));
      this._readyHandler = null;
      this._readyReject = null;
    }

    // room.disconnect() stops tracks it actually published, but a track
    // acquired via initDevices()/enableMic()/enableCam() that was never
    // published (connect() never ran, or failed before Promise.all settled)
    // is still open — stop it explicitly so the mic/camera indicator doesn't
    // linger. Safe to call on an already-stopped track (no-op per spec).
    this._localAudioTrack?.stop();
    this._localVideoTrack?.stop();

    // Report this the same way enableMic(false)/enableCam(false) would,
    // rather than just dropping the references below: fire onTrackStopped
    // for whatever was last live, and flip _mic/camEnabled to false so
    // isMicEnabled()/isCamEnabled() (and any mute/unmute toggle bound to
    // them) reflect reality. Without this, disconnect leaves both saying
    // "enabled" with no track behind them — silently wrong, and still wrong
    // after a later connect() since nothing re-acquires unless the caller
    // notices the mismatch and explicitly re-enables.
    //
    // Assign _mic/camEnabled *before* firing onTrackStopped below — same
    // ordering fix as enableMic()/enableCam(): anything reacting to that
    // event (e.g. client-react resyncing isMicEnabled) reads this same
    // getter, and needs to see false already, not whatever it was pre-
    // disconnect.
    this._micEnabled = false;
    this._camEnabled = false;
    const participant = { id: "local", name: "", local: true };
    if (this._lastReportedMicTrack) {
      this._callbacks.onTrackStopped?.(this._lastReportedMicTrack, participant);
    }
    if (this._lastReportedCamTrack) {
      this._callbacks.onTrackStopped?.(this._lastReportedCamTrack, participant);
    }
    this._localAudioTrack = undefined;
    this._localVideoTrack = undefined;
    this._lastReportedMicTrack = undefined;
    this._lastReportedCamTrack = undefined;
    this._botId = "";
    this.state = "disconnected";
    this._callbacks.onDisconnected?.();
  }

  private handleMediaDevicesError(e: Error, kind?: MediaDeviceKind) {
    const devices: DeviceArray = [];
    if (kind === "audioinput") devices.push("mic");
    else if (kind === "videoinput") devices.push("cam");
    else if (kind === "audiooutput") devices.push("speaker");
    else {
      // No kind reported: fall back to LiveKit's last per-device errors to
      // work out which capture actually failed, defaulting to both.
      const lp = this._room.localParticipant;
      if (lp.lastMicrophoneError) devices.push("mic");
      if (lp.lastCameraError) devices.push("cam");
      if (devices.length === 0) devices.push("cam", "mic");
    }

    this._callbacks.onDeviceError?.(
      new DeviceError(
        devices,
        this.toDeviceErrorType(MediaDeviceFailure.getFailure(e)),
        e.message
      )
    );
  }

  private toDeviceErrorType(failure?: MediaDeviceFailure): DeviceErrorType {
    switch (failure) {
      case MediaDeviceFailure.PermissionDenied:
        return "permissions";
      case MediaDeviceFailure.NotFound:
        return "not-found";
      case MediaDeviceFailure.DeviceInUse:
        return "in-use";
      default:
        return "unknown";
    }
  }

  private toParticipant(p: LocalParticipant | RemoteParticipant): Participant {
    return {
      id: p.identity,
      name: p.name || "",
      local: p instanceof LocalParticipant,
    };
  }
}
