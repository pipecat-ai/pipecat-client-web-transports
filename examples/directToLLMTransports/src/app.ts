// Import Types for Gemini Transport
import {
  GeminiLiveWebsocketTransport,
  GeminiLLMServiceOptions,
} from "@pipecat-ai/gemini-live-websocket-transport";

import {
  OpenAIRealTimeWebRTCTransport,
  OpenAIServiceOptions,
} from "@pipecat-ai/openai-realtime-webrtc-transport";

// Import core Pipecat RTVI Client and types
import {
  FunctionCallParams,
  PipecatClient,
  PipecatClientOptions,
  RTVIEvent,
  RTVIMessage,
  Participant,
  TranscriptData,
  BotTTSTextData,
} from "@pipecat-ai/client-js";

// Global variables for DOM elements and client state
let statusDiv: HTMLElement;
let audioDiv: HTMLDivElement;
let toggleBotButton: HTMLButtonElement;
let submitBtn: HTMLButtonElement;
let pcClient: PipecatClient;
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
    pcClient.updateMic(target.value);
  };

  // Set up mute button functionality
  const muteBtn = document.getElementById("toggleMute")!;
  muteBtn.addEventListener("click", () => {
    muteBtn.textContent = pcClient.isMicEnabled ? "Unmute Mic" : "Mute Mic";
    pcClient.enableMic(!pcClient.isMicEnabled);
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

// Connect / Disconnect from bot
async function toggleBot() {
  toggleBotButton.disabled = true;
  if (botRunning) {
    console.log("disconnecting bot");
    await disconnectBot();
  } else {
    console.log("connecting bot");
    await connectBot();
  }
  toggleBotButton.textContent = botRunning ? "Disconnect" : "Connect";
}

// Initialize the bot with configuration
async function initBot() {
  const urlParams = new URLSearchParams(window.location.search);
  const service = urlParams.get("service") || "gemini";

  // Configure RTVI client options
  let pcConfig: PipecatClientOptions = {
    transport:
      service === "gemini"
        ? new GeminiLiveWebsocketTransport(geminiServiceOptions())
        : new OpenAIRealTimeWebRTCTransport(openAIServiceOptions()),
    enableMic: true,
    enableCam: false,
  };

  // Create new Pipecat client instance
  pcClient = new PipecatClient(pcConfig);
  registerFunctionCallHandlers();

  // Make RTVI client and transport available globally for debugging
  (window as any).client = pcClient;

  // Set up RTVI event handlers and initialize devices
  setupEventHandlers();
  await setupDevices();
}

// Initialize the Gemini LLM and its service options
function geminiServiceOptions() {
  // Configure Gemini LLM service options
  const llm_service_options: GeminiLLMServiceOptions = {
    api_key: import.meta.env.VITE_DANGEROUS_GEMINI_API_KEY,
    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
    initial_messages: [
      // Set up initial system and user messages.
      // Without the user message, the bot will not respond immediately
      // and wait for the user to speak first.
      {
        role: "model",
        content: "You are a pencil salesman...",
      },
      { role: "user", content: "Hello!" },
    ],
    settings: {
      response_modalities: "AUDIO",
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

  return llm_service_options;
}

function openAIServiceOptions() {
  // Configure OpenAI LLM service options
  const llm_service_options: OpenAIServiceOptions = {
    api_key: import.meta.env.VITE_DANGEROUS_OPENAI_API_KEY,
    settings: {
      instructions: "You are a pirate. You are looking for buried treasure.",
      voice: "echo",
      input_audio_noise_reduction: { type: "near_field" },
      turn_detection: { type: "semantic_vad" },
      tools: [
        {
          type: "function",
          name: "changeBackgroundColor",
          description: "Change the background color of the page",
          parameters: {
            type: "object",
            properties: {
              color: {
                type: "string",
                description: "A hex value of the color",
              },
            },
          },
        },
        {
          type: "function",
          name: "getWeather",
          description: "Gets the current weather for a given location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "A city or location",
              },
            },
          },
        },
      ],
    },
    initial_messages: [{ role: "user", content: "Hello" }],
  };

  return llm_service_options;
}

// Initialize and update available audio devices
async function setupDevices() {
  await pcClient.initDevices();
  const mics = await pcClient.getAllMics();
  updateMicList(mics);
}

// Updates the microphone selection dropdown
function updateMicList(mics: MediaDeviceInfo[]) {
  const micPicker = document.getElementById("mic-picker")!;
  micPicker.replaceChildren();
  const curMic = pcClient.selectedMic?.deviceId;
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
    await pcClient.connect();
    console.log("READY! Let's GO!");
  } catch (e) {
    console.error("Error connecting", e);
    toggleBotButton.disabled = false;
    return;
  }
  toggleBotButton.disabled = false;
  submitBtn.disabled = false;
  botRunning = true;
}

// Disconnect client from Gemini Multimodal Live bot
async function disconnectBot() {
  try {
    await pcClient.disconnect();
  } catch (e) {
    console.error("Error disconnecting", e);
  }
  toggleBotButton.disabled = false;
  submitBtn.disabled = true;
  botRunning = false;
}

// Set up event handlers for RTVI client
// https://docs.pipecat.ai/client/js/api-reference/callbacks#2-event-listeners
export async function setupEventHandlers() {
  audioDiv = document.getElementById("audio") as HTMLDivElement;

  pcClient.on(RTVIEvent.TransportStateChanged, (state: string) => {
    console.log(`-- transport state change: ${state} --`);
    statusDiv.textContent = `Transport state: ${state}`;
    if (state === "disconnected") {
      botRunning = false;
      toggleBotButton.textContent = "Connect";
    }
  });

  pcClient.on(RTVIEvent.Connected, () => {
    console.log("-- user connected --");
  });

  pcClient.on(RTVIEvent.Disconnected, () => {
    console.log("-- user disconnected --");
  });

  pcClient.on(RTVIEvent.BotConnected, () => {
    console.log("-- bot connected --");
  });

  pcClient.on(RTVIEvent.BotDisconnected, () => {
    console.log("--bot disconnected --");
  });

  pcClient.on(RTVIEvent.BotReady, () => {
    console.log("-- bot ready to chat! --");
  });

  // For realtime v2v transports, this event will only fire for the
  // local participant.
  pcClient.on(
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
  pcClient.on(
    RTVIEvent.TrackStopped,
    (track: MediaStreamTrack, participant?: Participant) => {
      console.log(" --> track stopped", participant, track);
    }
  );

  pcClient.on(RTVIEvent.UserStartedSpeaking, () => {
    console.log("-- user started speaking -- ");
  });

  pcClient.on(RTVIEvent.UserStoppedSpeaking, () => {
    console.log("-- user stopped speaking -- ");
  });

  pcClient.on(RTVIEvent.BotStartedSpeaking, () => {
    console.log("-- bot started speaking -- ");
  });

  pcClient.on(RTVIEvent.BotStoppedSpeaking, () => {
    console.log("-- bot stopped speaking -- ");
  });

  // multimodal live does not currently provide transcripts so this will not fire
  pcClient.on(RTVIEvent.UserTranscript, (transcript: TranscriptData) => {
    console.log("[EVENT] UserTranscript", transcript);
  });

  // multimodal live does not currently provide transcripts so this will not fire
  pcClient.on(RTVIEvent.BotTtsText, (data: BotTTSTextData) => {
    console.log("[EVENT] BotTtsText", data);
  });

  // multimodal live does not currently provide transcripts so this will not fire
  pcClient.on(RTVIEvent.BotTranscript, (data: BotTTSTextData) => {
    console.log("[EVENT] BotTranscript", data);
  });

  pcClient.on(RTVIEvent.Error, (message: RTVIMessage) => {
    console.log("[EVENT] RTVI Error!", message);
  });

  pcClient.on(RTVIEvent.MessageError, (message: RTVIMessage) => {
    console.log("[EVENT] RTVI ErrorMessage error!", message);
  });

  // multimodal live does not currently provide metrics so this will not fire
  pcClient.on(RTVIEvent.Metrics, (data) => {
    // let's only print out ttfb for now
    if (!data.ttfb) {
      return;
    }
    data.ttfb.map((metric) => {
      console.log(`[METRICS] ${metric.processor} ttfb: ${metric.value}`);
    });
  });

  pcClient.on(RTVIEvent.MicUpdated, (mic: MediaDeviceInfo) => {
    const micPicker = document.getElementById("mic-picker")!;
    for (let i = 0; i < micPicker.children.length; i++) {
      let el = micPicker.children[i] as HTMLOptionElement;
      el.selected = el.value === mic.deviceId;
    }
  });

  pcClient.on(RTVIEvent.AvailableMicsUpdated, (mics: MediaDeviceInfo[]) => {
    updateMicList(mics);
  });

  pcClient.on(RTVIEvent.LocalAudioLevel, (level: number) => {
    updateSpeakerBubble(level, "user");
  });
  pcClient.on(RTVIEvent.RemoteAudioLevel, (level: number) => {
    updateSpeakerBubble(level, "bot");
  });
}

// Send user message to bot.
function sendUserMessage() {
  const textInput = document.getElementById("text-input")! as HTMLInputElement;
  pcClient.appendToContext({
    role: "user",
    content: textInput.value,
    run_immediately: true,
  });
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

function _generateRandomWeather() {
  const temperature = Math.random() * 200 - 80;
  const humidity = Math.random() * 100;
  const conditions = ["sunny", "cloudy", "rainy", "snowy"];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];
  const windSpeed = Math.random() * 50;
  const windGusts = windSpeed + Math.random() * 20;
  return {
    temperature,
    humidity,
    condition,
    windSpeed,
    windGusts,
  };
}

async function registerFunctionCallHandlers() {
  pcClient.registerFunctionCallHandler(
    "changeBackgroundColor",
    (params: FunctionCallParams) => {
      console.log("[EVENT] LLMFunctionCall: changeBackgroundColor");
      const color = params.arguments.color as string;
      console.log("changing background color to", color);
      document.body.style.backgroundColor = color;
      return Promise.resolve({ success: true, color });
    }
  );
  pcClient.registerFunctionCallHandler(
    "getWeather",
    async (params: FunctionCallParams) => {
      console.log("[EVENT] LLMFunctionCall: getWeather");
      const location = params.arguments.location as string;
      console.log("getting weather for", location);
      const key = import.meta.env.VITE_DANGEROUS_OPENWEATHER_API_KEY;
      if (!key) {
        const ret = { success: true, weather: _generateRandomWeather() };
        console.log("returning weather", ret);
        return ret;
      }
      const locationReq = await fetch(
        `http://api.openweathermap.org/geo/1.0/direct?q=${location}&limit=1&appid=${key}`
      );
      const locJson = await locationReq.json();
      const loc = { lat: locJson[0].lat, lon: locJson[0].lon };
      const exclude = ["minutely", "hourly", "daily"].join(",");
      const weatherRec = await fetch(
        `https://api.openweathermap.org/data/3.0/onecall?lat=${loc.lat}&lon=${loc.lon}&exclude=${exclude}&appid=${key}`
      );
      const weather = await weatherRec.json();
      return { success: true, weather: weather.current };
    }
  );
}
