// Import Types for Gemini Transport
import {
  GeminiLiveWebsocketTransport,
  GeminiLLMServiceOptions,
} from "@pipecat-ai/gemini-live-websocket-transport";

// Import core Pipecat RTVI Client and types
import {
  Transport,
  RTVIClient,
  RTVIEvent,
  RTVIMessage,
  Participant,
  TranscriptData,
  BotTTSTextData,
  RTVIClientOptions,
} from "@pipecat-ai/client-js";

// Global variables for DOM elements and client state
let statusDiv: HTMLElement;
let audioDiv: HTMLDivElement;
let toggleBotButton: HTMLButtonElement;
let submitBtn: HTMLButtonElement;
let rtviClient: RTVIClient;
let botRunning = false;

// Initialize the application when DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  statusDiv = document.getElementById("status")!;
  toggleBotButton = document.getElementById("toggleBot")! as HTMLButtonElement;
  toggleBotButton.addEventListener("click", () => toggleBot());

  // Handle microphone device selection
  document.getElementById("mic-picker")!.onchange = (e) => {
    const target = e.target as HTMLSelectElement;
    console.log("user changed device", target, target.value);
    rtviClient.updateMic(target.value);
  };

  // Set up mute button functionality
  const muteBtn = document.getElementById("toggleMute")!;
  muteBtn.addEventListener("click", () => {
    muteBtn.textContent = rtviClient.isMicEnabled ? "Unmute Mic" : "Mute Mic";
    rtviClient.enableMic(!rtviClient.isMicEnabled);
  });

  // Set up text submission button
  submitBtn = document.getElementById("submit-text")! as HTMLButtonElement;
  submitBtn.addEventListener("click", () => {
    sendUserMessage();
  });
  submitBtn.disabled = true;

  // Initialize the bot
  initBot();
});

// Connect / Disconnect from Gemini Live bot
async function toggleBot() {
  toggleBotButton.disabled = true;
  if (botRunning) {
    console.log("disconnecting bot");
    await disconnectBot();
    toggleBotButton.textContent = "Connect";
  } else {
    console.log("connecting bot");
    await connectBot();
    toggleBotButton.textContent = "Disconnect";
  }
}

// Initialize the bot with configuration
async function initBot() {
  // Configure Gemini LLM service options
  const llm_service_options: GeminiLLMServiceOptions = {
    api_key: import.meta.env.VITE_DANGEROUS_GEMINI_API_KEY,
    model: "models/gemini-2.0-flash-exp",
    initial_messages: [
      // Set up initial system and user messages.
      // Without the user message, the bot will not respond immediately
      // and wait for the user to speak first.
      {
        role: "system",
        content: "You are a helpful assistant...",
      },
      { role: "user", content: "Hello, ExampleBot!" },
    ],
    generation_config: {
      speech_config: {
        voice_config: {
          prebuilt_voice_config: {
            // Options are: "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede"
            voice_name: "Charon",
          },
        },
      },
    },
  };

  // Initialize transport
  let transport: Transport = new GeminiLiveWebsocketTransport(
    llm_service_options
  );

  // Configure RTVI client options
  let RTVIConfig: RTVIClientOptions = {
    transport,
    params: {
      baseUrl: "api",
      requestData: { llm_service_options },
    },
    enableMic: true,
    enableCam: false,
    timeout: 30 * 1000,
  };
  RTVIConfig.customConnectHandler = () => Promise.resolve();

  // Create new RTVI client instance
  rtviClient = new RTVIClient(RTVIConfig);

  // Make RTVI client available globally for debugging
  window.client = rtviClient;

  // Set up RTVI event handlers and initialize devices
  setupEventHandlers(rtviClient);
  await setupDevices();
}

// Initialize and update available audio devices
async function setupDevices() {
  await rtviClient.initDevices();
  const mics = await rtviClient.getAllMics();
  updateMicList(mics);
}

// Updates the microphone selection dropdown
function updateMicList(mics: MediaDeviceInfo[]) {
  const micPicker = document.getElementById("mic-picker")!;
  micPicker.replaceChildren();
  const curMic = rtviClient.selectedMic?.deviceId;
  mics.forEach((mic) => {
    let el = document.createElement("option");
    el.textContent = mic.label;
    el.value = mic.deviceId;
    micPicker.appendChild(el);
    if (mic.deviceId === curMic) {
      el.selected = true;
    }
  });
}

// Connect client to Gemini Multimodal Live bot
async function connectBot() {
  statusDiv.textContent = "Joining...";
  try {
    await rtviClient.connect();
    console.log("READY! Let's GO!");
  } catch (e) {
    console.error("Error connecting", e);
  }
  toggleBotButton.disabled = false;
  submitBtn.disabled = false;
  botRunning = true;
}

// Disconnect client from Gemini Multimodal Live bot
async function disconnectBot() {
  try {
    await rtviClient.disconnect();
  } catch (e) {
    console.error("Error disconnecting", e);
  }
  toggleBotButton.disabled = false;
  submitBtn.disabled = true;
  botRunning = false;
}

// Set up event handlers for RTVI client
// https://docs.pipecat.ai/client/reference/js/callbacks#2-event-listeners
export async function setupEventHandlers(rtviClient: RTVIClient) {
  audioDiv = document.getElementById("audio") as HTMLDivElement;

  rtviClient.on(RTVIEvent.TransportStateChanged, (state: string) => {
    console.log(`-- transport state change: ${state} --`);
    statusDiv.textContent = `Transport state: ${state}`;
    if (state === "disconnected") {
      botRunning = false;
      toggleBotButton.textContent = "Connect";
    }
  });

  rtviClient.on(RTVIEvent.Connected, () => {
    console.log("-- user connected --");
  });

  rtviClient.on(RTVIEvent.Disconnected, () => {
    console.log("-- user disconnected --");
  });

  rtviClient.on(RTVIEvent.BotConnected, () => {
    console.log("-- bot connected --");
  });

  rtviClient.on(RTVIEvent.BotDisconnected, () => {
    console.log("--bot disconnected --");
  });

  rtviClient.on(RTVIEvent.BotReady, () => {
    console.log("-- bot ready to chat! --");
  });

  // For realtime v2v transports, this event will only fire for the
  // local participant.
  rtviClient.on(
    RTVIEvent.TrackStarted,
    (track: MediaStreamTrack, participant?: Participant) => {
      console.log(" --> track started", participant, track);
      if (participant?.local) {
        return;
      }
      let audio = document.createElement("audio");
      audio.srcObject = new MediaStream([track]);
      audio.autoplay = true;
      audioDiv.appendChild(audio);
    }
  );

  // For realtime v2v transports, this event will only fire for the
  // local participant.
  rtviClient.on(
    RTVIEvent.TrackStopped,
    (track: MediaStreamTrack, participant?: Participant) => {
      console.log(" --> track stopped", participant, track);
    }
  );

  rtviClient.on(RTVIEvent.UserStartedSpeaking, () => {
    console.log("-- user started speaking -- ");
  });

  rtviClient.on(RTVIEvent.UserStoppedSpeaking, () => {
    console.log("-- user stopped speaking -- ");
  });

  rtviClient.on(RTVIEvent.BotStartedSpeaking, () => {
    console.log("-- bot started speaking -- ");
  });

  rtviClient.on(RTVIEvent.BotStoppedSpeaking, () => {
    console.log("-- bot stopped speaking -- ");
  });

  // multimodal live does not currently provide transcripts so this will not fire
  rtviClient.on(RTVIEvent.UserTranscript, (transcript: TranscriptData) => {
    console.log("[EVENT] UserTranscript", transcript);
  });

  // multimodal live does not currently provide transcripts so this will not fire
  rtviClient.on(RTVIEvent.BotTranscript, (data: BotTTSTextData) => {
    console.log("[EVENT] BotTranscript", data);
  });

  rtviClient.on(RTVIEvent.Error, (message: RTVIMessage) => {
    console.log("[EVENT] RTVI Error!", message);
  });

  rtviClient.on(RTVIEvent.MessageError, (message: RTVIMessage) => {
    console.log("[EVENT] RTVI ErrorMessage error!", message);
  });

  // multimodal live does not currently provide metrics so this will not fire
  rtviClient.on(RTVIEvent.Metrics, (data) => {
    // let's only print out ttfb for now
    if (!data.ttfb) {
      return;
    }
    data.ttfb.map((metric) => {
      console.log(`[METRICS] ${metric.processor} ttfb: ${metric.value}`);
    });
  });

  rtviClient.on(RTVIEvent.MicUpdated, (mic: MediaDeviceInfo) => {
    const micPicker = document.getElementById("mic-picker")!;
    for (let i = 0; i < micPicker.children.length; i++) {
      let el = micPicker.children[i] as HTMLOptionElement;
      el.selected = el.value === mic.deviceId;
    }
  });

  rtviClient.on(RTVIEvent.AvailableMicsUpdated, (mics: MediaDeviceInfo[]) => {
    updateMicList(mics);
  });

  rtviClient.on(RTVIEvent.LocalAudioLevel, (level: number) => {
    updateSpeakerBubble(level, "user");
  });
  rtviClient.on(RTVIEvent.RemoteAudioLevel, (level: number) => {
    updateSpeakerBubble(level, "bot");
  });
}

// Send user message to bot. The GeminiLiveWebsocketTransport expects the message
// to be keyed under "send-text" in the RTVIMessage object.
function sendUserMessage() {
  const textInput = document.getElementById("text-input")! as HTMLInputElement;
  rtviClient.sendMessage(new RTVIMessage("send-text", textInput.value));
  textInput.value = "";
}

// Update the speaker bubble size based on the audio level
function updateSpeakerBubble(level: number, whom: string) {
  const volume = level * 100;
  const userBubble = document.getElementById(
    whom === "user" ? "user-bubble" : "bot-bubble"
  )!;
  // Scale the bubble size based on the volume value
  const scale = 1 + volume / 50; // Adjust the divisor to control the scaling effect
  userBubble.style.transform = `scale(${scale})`;
}
